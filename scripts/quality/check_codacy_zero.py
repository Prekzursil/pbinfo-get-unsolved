#!/usr/bin/env python3
from __future__ import absolute_import, annotations

import argparse
import importlib.util
import json
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _load_security_helpers():
    helper_path = Path(__file__).resolve().parent.parent.joinpath("security_helpers.py")
    spec = importlib.util.spec_from_file_location("security_helpers", helper_path)
    if spec is None or spec.loader is None:
        raise ImportError("Unable to load security_helpers module.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_security_helpers = _load_security_helpers()
HttpsStatusError = _security_helpers.HttpsStatusError
normalize_https_url = _security_helpers.normalize_https_url
request_json = _security_helpers.request_json


TOTAL_KEYS = {"total", "totalItems", "total_items", "count", "hits", "open_issues"}
CODACY_API_BASE = "https://api.codacy.com"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Assert Codacy has zero total open issues.")
    parser.add_argument("--provider", default="gh", help="Organization provider, for example gh")
    parser.add_argument("--owner", required=True, help="Repository owner")
    parser.add_argument("--repo", required=True, help="Repository name")
    parser.add_argument("--branch", default="", help="Branch name to validate against Codacy branch analysis")
    parser.add_argument(
        "--expected-sha",
        default="",
        help="Expected analysed commit SHA for the target branch (optional but recommended in CI)",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=600,
        help="How long to wait for Codacy branch analysis to reach the expected SHA",
    )
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=20,
        help="Polling interval while waiting for Codacy branch analysis to catch up",
    )
    parser.add_argument("--token", default="", help="Codacy API token (falls back to CODACY_API_TOKEN env)")
    parser.add_argument("--out-json", default="codacy-zero/codacy.json", help="Output JSON path")
    parser.add_argument("--out-md", default="codacy-zero/codacy.md", help="Output markdown path")
    return parser.parse_args()


def _request_json(
    url: str,
    token: str,
    *,
    method: str = "GET",
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return request_json(
        url,
        headers={
            "Accept": "application/json",
            "api-token": token,
            "User-Agent": "reframe-codacy-zero-gate",
        },
        method=method,
        data=data,
        allowed_host_suffixes={"codacy.com"},
    )


def extract_total_open(payload: Any) -> Optional[int]:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in TOTAL_KEYS and isinstance(value, (int, float)):
                return int(value)

        # common pagination structures
        for key in ("pagination", "page", "meta"):
            nested = payload.get(key)
            total = extract_total_open(nested)
            if total is not None:
                return total

        for value in payload.values():
            total = extract_total_open(value)
            if total is not None:
                return total

    if isinstance(payload, list):
        for item in payload:
            total = extract_total_open(item)
            if total is not None:
                return total

    return None


def extract_repository_payload(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return payload


def extract_selected_branch_name(payload: Any) -> str:
    repository_payload = extract_repository_payload(payload)
    selected_branch = repository_payload.get("selectedBranch")
    if isinstance(selected_branch, dict):
        name = selected_branch.get("name")
        if isinstance(name, str):
            return name.strip()
    return ""


def extract_last_analysed_sha(payload: Any) -> str:
    repository_payload = extract_repository_payload(payload)
    for key in ("lastAnalysedCommit", "lastAnalyzedCommit"):
        commit = repository_payload.get(key)
        if isinstance(commit, dict):
            sha = commit.get("sha")
            if isinstance(sha, str):
                return sha.strip()
    return ""


def extract_repository_issue_count(payload: Any) -> Optional[int]:
    repository_payload = extract_repository_payload(payload)
    issues_count = repository_payload.get("issuesCount")
    if isinstance(issues_count, (int, float)):
        return int(issues_count)
    return extract_total_open(payload)


def _render_md(payload: dict) -> str:
    lines = [
        "# Codacy Zero Gate",
        "",
        f"- Status: `{payload['status']}`",
        f"- Owner/repo: `{payload['owner']}/{payload['repo']}`",
        f"- Requested branch: `{payload.get('branch')}`",
        f"- Selected branch: `{payload.get('selected_branch')}`",
        f"- Expected analysed SHA: `{payload.get('expected_sha')}`",
        f"- Observed analysed SHA: `{payload.get('analysed_sha')}`",
        f"- Open issues: `{payload.get('open_issues')}`",
        f"- Timestamp (UTC): `{payload['timestamp_utc']}`",
        "",
        "## Findings",
    ]
    findings = payload.get("findings") or []
    if findings:
        lines.extend(f"- {item}" for item in findings)
    else:
        lines.append("- None")
    return "\n".join(lines) + "\n"


def _safe_output_path(raw: str, fallback: str, base: Optional[Path] = None) -> Path:
    root = (base or Path.cwd()).resolve()
    candidate = Path((raw or "").strip() or fallback).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve(strict=False)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Output path escapes workspace root: {candidate}") from exc
    return resolved


def _build_repository_url(api_base: str, provider: str, owner: str, repo: str, branch: str) -> str:
    query = urllib.parse.urlencode({"branch": branch})
    return f"{api_base}/api/v3/analysis/organizations/{provider}/{owner}/repositories/{repo}?{query}"


def _build_backlog_url(api_base: str, provider: str, owner: str, repo: str) -> str:
    query = urllib.parse.urlencode({"limit": "1"})
    return f"{api_base}/api/v3/analysis/organizations/{provider}/{owner}/repositories/{repo}/issues/search?{query}"


def _provider_candidates(primary_provider: str) -> List[str]:
    return list(dict.fromkeys(p for p in (primary_provider, "gh", "github") if p))


def _build_branch_findings(
    *,
    branch: str,
    expected_sha: str,
    selected_branch: str,
    analysed_sha: str,
    open_issues: Optional[int],
) -> List[str]:
    if not selected_branch:
        return ["Codacy branch lookup did not return a selected branch name."]
    if selected_branch != branch:
        return [f"Codacy selected branch {selected_branch!r} instead of the expected branch {branch!r}."]
    if expected_sha and analysed_sha != expected_sha:
        observed = analysed_sha or "none"
        return [f"Codacy branch analysis is stale: expected {expected_sha}, observed {observed}."]
    if open_issues is None:
        return ["Codacy branch response did not include a parseable issue count."]
    if open_issues != 0:
        return [f"Codacy reports {open_issues} open issues for branch {branch!r} (expected 0)."]
    return []


def _query_branch_provider(
    *,
    api_base: str,
    token: str,
    provider: str,
    owner: str,
    repo: str,
    branch: str,
    expected_sha: str,
) -> Tuple[bool, bool, str, str, Optional[int], List[str], Optional[Exception]]:
    url = _build_repository_url(api_base, provider, owner, repo, branch)
    try:
        payload = _request_json(url, token)
        selected_branch = extract_selected_branch_name(payload)
        analysed_sha = extract_last_analysed_sha(payload)
        open_issues = extract_repository_issue_count(payload)
        findings = _build_branch_findings(
            branch=branch,
            expected_sha=expected_sha,
            selected_branch=selected_branch,
            analysed_sha=analysed_sha,
            open_issues=open_issues,
        )
        return not findings, False, selected_branch, analysed_sha, open_issues, findings, None
    except HttpsStatusError as exc:
        if exc.status_code == 404:
            return False, True, "", "", None, [], exc
        return False, False, "", "", None, [f"Codacy API request failed: HTTP {exc.status_code}"], exc
    except (RuntimeError, ValueError, TypeError) as exc:  # pragma: no cover - network/runtime surface
        return False, False, "", "", None, [f"Codacy API request failed: {exc}"], exc


def _is_retryable_stale(*, expected_sha: str, findings: List[str], deadline: float) -> bool:
    if not expected_sha:
        return False
    if time.monotonic() >= deadline:
        return False
    return any("branch analysis is stale" in finding for finding in findings)


def _build_missing_provider_findings(providers: List[str], last_exc: Optional[Exception]) -> List[str]:
    findings = [f"Codacy API endpoint was not found for provider(s): {', '.join(providers)}."]
    if last_exc is not None:
        findings.append(f"Last Codacy API error: {last_exc}")
    return findings


def _query_branch_providers_once(
    *,
    api_base: str,
    token: str,
    providers: List[str],
    repository: Tuple[str, str],
    branch: str,
    expected_sha: str,
    deadline: float,
) -> Tuple[str, Optional[int], str, str, List[str]]:
    owner, repo = repository
    last_exc: Optional[Exception] = None

    for provider in providers:
        provider_passed, provider_not_found, selected_branch, analysed_sha, open_issues, findings, provider_error = (
            _query_branch_provider(
                api_base=api_base,
                token=token,
                provider=provider,
                owner=owner,
                repo=repo,
                branch=branch,
                expected_sha=expected_sha,
            )
        )
        last_exc = provider_error
        if provider_not_found:
            continue
        if provider_passed:
            return "pass", open_issues, selected_branch, analysed_sha, []
        if _is_retryable_stale(expected_sha=expected_sha, findings=findings, deadline=deadline):
            return "retry", open_issues, selected_branch, analysed_sha, findings
        return "fail", open_issues, selected_branch, analysed_sha, findings

    return "fail", None, "", "", _build_missing_provider_findings(providers, last_exc)



def _poll_branch_zero_gate(
    *,
    api_base: str,
    token: str,
    providers: List[str],
    repository: Tuple[str, str],
    branch: str,
    expected_sha: str,
    timeout_seconds: int,
    poll_seconds: int,
) -> Tuple[str, Optional[int], str, str, List[str]]:
    deadline = time.monotonic() + max(timeout_seconds, 0)

    while True:
        status, open_issues, selected_branch, analysed_sha, findings = _query_branch_providers_once(
            api_base=api_base,
            token=token,
            providers=providers,
            repository=repository,
            branch=branch,
            expected_sha=expected_sha,
            deadline=deadline,
        )
        if status == "pass":
            return "pass", open_issues, selected_branch, analysed_sha, []
        if status == "retry":
            time.sleep(max(poll_seconds, 1))
            continue
        return "fail", open_issues, selected_branch, analysed_sha, findings


def _build_backlog_findings(open_issues: Optional[int]) -> List[str]:
    if open_issues is None:
        return ["Codacy response did not include a parseable total issue count."]
    if open_issues != 0:
        return [f"Codacy reports {open_issues} open issues (expected 0)."]
    return []


def _query_backlog_provider(
    *, api_base: str, token: str, provider: str, owner: str, repo: str
) -> Tuple[bool, bool, Optional[int], List[str], Optional[Exception]]:
    url = _build_backlog_url(api_base, provider, owner, repo)
    try:
        payload = _request_json(url, token, method="POST", data={})
        open_issues = extract_total_open(payload)
        findings = _build_backlog_findings(open_issues)
        return not findings, False, open_issues, findings, None
    except HttpsStatusError as exc:
        if exc.status_code == 404:
            return False, True, None, [], exc
        return False, False, None, [f"Codacy API request failed: HTTP {exc.status_code}"], exc
    except (RuntimeError, ValueError, TypeError) as exc:  # pragma: no cover - network/runtime surface
        return False, False, None, [f"Codacy API request failed: {exc}"], exc


def _check_repository_backlog_zero(
    *, api_base: str, token: str, providers: List[str], owner: str, repo: str
) -> Tuple[str, Optional[int], List[str]]:
    last_exc: Optional[Exception] = None

    for provider in providers:
        provider_passed, provider_not_found, open_issues, findings, provider_error = _query_backlog_provider(
            api_base=api_base,
            token=token,
            provider=provider,
            owner=owner,
            repo=repo,
        )
        last_exc = provider_error
        if provider_not_found:
            continue
        return ("pass" if provider_passed else "fail"), open_issues, findings

    return "fail", None, _build_missing_provider_findings(providers, last_exc)


def main() -> int:
    import os

    args = _parse_args()
    token = (args.token or os.environ.get("CODACY_API_TOKEN", "")).strip()
    api_base = normalize_https_url(CODACY_API_BASE, allowed_hosts={"api.codacy.com"}).rstrip("/")
    owner = urllib.parse.quote(args.owner.strip(), safe="")
    repo = urllib.parse.quote(args.repo.strip(), safe="")
    branch = (args.branch or "").strip()
    expected_sha = (args.expected_sha or "").strip()

    findings: List[str] = []
    open_issues: Optional[int] = None
    selected_branch = ""
    analysed_sha = ""

    if not token:
        findings.append("CODACY_API_TOKEN is missing.")
        status = "fail"
    else:
        providers = _provider_candidates(args.provider)
        repository = (owner, repo)
        if branch:
            status, open_issues, selected_branch, analysed_sha, findings = _poll_branch_zero_gate(
                api_base=api_base,
                token=token,
                providers=providers,
                repository=repository,
                branch=branch,
                expected_sha=expected_sha,
                timeout_seconds=args.timeout_seconds,
                poll_seconds=args.poll_seconds,
            )
        else:
            status, open_issues, findings = _check_repository_backlog_zero(
                api_base=api_base,
                token=token,
                providers=providers,
                owner=owner,
                repo=repo,
            )

    payload = {
        "status": status,
        "owner": args.owner,
        "repo": args.repo,
        "provider": args.provider,
        "branch": branch,
        "selected_branch": selected_branch,
        "expected_sha": expected_sha,
        "analysed_sha": analysed_sha,
        "open_issues": open_issues,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "findings": findings,
    }

    try:
        out_json = _safe_output_path(args.out_json, "codacy-zero/codacy.json")
        out_md = _safe_output_path(args.out_md, "codacy-zero/codacy.md")
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    out_md.write_text(_render_md(payload), encoding="utf-8")
    print(out_md.read_text(encoding="utf-8"), end="")
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
