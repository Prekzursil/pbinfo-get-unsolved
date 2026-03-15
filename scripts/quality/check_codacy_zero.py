#!/usr/bin/env python3
from __future__ import absolute_import

import argparse
import importlib.util
import json
import sys
import time
import urllib.parse
from dataclasses import dataclass
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
safe_output_path = _security_helpers.safe_output_path

TOTAL_KEYS = {"total", "totalItems", "total_items", "count", "hits", "open_issues"}
CODACY_API_BASE = "https://api.codacy.com"


@dataclass(frozen=True)
class _CodacyContext:
    api_base: str
    token: str
    owner: str
    repo: str
    providers: Tuple[str, ...]


@dataclass(frozen=True)
class _BranchGateOptions:
    branch: str
    expected_sha: str
    timeout_seconds: int
    poll_seconds: int


@dataclass(frozen=True)
class _ProviderResponse:
    passed: bool
    not_found: bool
    open_issues: Optional[int]
    findings: Tuple[str, ...]
    selected_branch: str = ""
    analysed_sha: str = ""
    error: Optional[Exception] = None


@dataclass(frozen=True)
class _GateOutcome:
    status: str
    open_issues: Optional[int]
    findings: Tuple[str, ...]
    selected_branch: str = ""
    analysed_sha: str = ""


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


def _extract_total_from_mapping(mapping: Dict[str, Any]) -> Optional[int]:
    for key, value in mapping.items():
        if key in TOTAL_KEYS and isinstance(value, (int, float)):
            return int(value)
    return None


def _append_mapping_values(stack: List[Any], mapping: Dict[str, Any]) -> None:
    prioritized = [mapping.get(key) for key in ("pagination", "page", "meta")]
    nested = [value for value in prioritized if value is not None] + list(mapping.values())
    for value in reversed(nested):
        stack.append(value)


def _append_sequence_values(stack: List[Any], values: List[Any]) -> None:
    for value in reversed(values):
        stack.append(value)


def extract_total_open(payload: Any) -> Optional[int]:
    stack = [payload]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            total = _extract_total_from_mapping(current)
            if total is not None:
                return total
            _append_mapping_values(stack, current)
        elif isinstance(current, list):
            _append_sequence_values(stack, current)
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


def _build_repository_url(context: _CodacyContext, provider: str, branch: str) -> str:
    query = urllib.parse.urlencode({"branch": branch})
    return f"{context.api_base}/api/v3/analysis/organizations/{provider}/{context.owner}/repositories/{context.repo}?{query}"


def _build_backlog_url(context: _CodacyContext, provider: str) -> str:
    query = urllib.parse.urlencode({"limit": "1"})
    return (
        f"{context.api_base}/api/v3/analysis/organizations/{provider}/"
        f"{context.owner}/repositories/{context.repo}/issues/search?{query}"
    )


def _provider_candidates(primary_provider: str) -> Tuple[str, ...]:
    return tuple(dict.fromkeys(p for p in (primary_provider, "gh", "github") if p))


def _build_branch_findings(options: _BranchGateOptions, selected_branch: str, analysed_sha: str, open_issues: Optional[int]) -> Tuple[str, ...]:
    if not selected_branch:
        return ("Codacy branch lookup did not return a selected branch name.",)
    if selected_branch != options.branch:
        return (f"Codacy selected branch {selected_branch!r} instead of the expected branch {options.branch!r}.",)
    if options.expected_sha and analysed_sha != options.expected_sha:
        observed = analysed_sha or "none"
        return (f"Codacy branch analysis is stale: expected {options.expected_sha}, observed {observed}.",)
    if open_issues is None:
        return ("Codacy branch response did not include a parseable issue count.",)
    if open_issues != 0:
        return (f"Codacy reports {open_issues} open issues for branch {options.branch!r} (expected 0).",)
    return ()


def _query_branch_provider(context: _CodacyContext, provider: str, options: _BranchGateOptions) -> _ProviderResponse:
    try:
        payload = _request_json(_build_repository_url(context, provider, options.branch), context.token)
        selected_branch = extract_selected_branch_name(payload)
        analysed_sha = extract_last_analysed_sha(payload)
        open_issues = extract_repository_issue_count(payload)
        findings = _build_branch_findings(options, selected_branch, analysed_sha, open_issues)
        return _ProviderResponse(
            passed=not findings,
            not_found=False,
            open_issues=open_issues,
            findings=findings,
            selected_branch=selected_branch,
            analysed_sha=analysed_sha,
        )
    except HttpsStatusError as exc:
        if exc.status_code == 404:
            return _ProviderResponse(False, True, None, (), error=exc)
        return _ProviderResponse(False, False, None, (f"Codacy API request failed: HTTP {exc.status_code}",), error=exc)
    except (RuntimeError, ValueError, TypeError) as exc:  # pragma: no cover - network/runtime surface
        return _ProviderResponse(False, False, None, (f"Codacy API request failed: {exc}",), error=exc)


def _is_retryable_stale(options: _BranchGateOptions, findings: Tuple[str, ...], deadline: float) -> bool:
    if not options.expected_sha:
        return False
    if time.monotonic() >= deadline:
        return False
    return any("branch analysis is stale" in finding for finding in findings)


def _build_missing_provider_findings(providers: Tuple[str, ...], last_exc: Optional[Exception]) -> Tuple[str, ...]:
    findings: List[str] = [f"Codacy API endpoint was not found for provider(s): {', '.join(providers)}."]
    if last_exc is not None:
        findings.append(f"Last Codacy API error: {last_exc}")
    return tuple(findings)


def _query_branch_providers_once(context: _CodacyContext, options: _BranchGateOptions, deadline: float) -> _GateOutcome:
    last_exc: Optional[Exception] = None
    for provider in context.providers:
        provider_response = _query_branch_provider(context, provider, options)
        last_exc = provider_response.error
        if provider_response.not_found:
            continue
        if provider_response.passed:
            return _GateOutcome(
                status="pass",
                open_issues=provider_response.open_issues,
                findings=(),
                selected_branch=provider_response.selected_branch,
                analysed_sha=provider_response.analysed_sha,
            )
        if _is_retryable_stale(options, provider_response.findings, deadline):
            return _GateOutcome(
                status="retry",
                open_issues=provider_response.open_issues,
                findings=provider_response.findings,
                selected_branch=provider_response.selected_branch,
                analysed_sha=provider_response.analysed_sha,
            )
        return _GateOutcome(
            status="fail",
            open_issues=provider_response.open_issues,
            findings=provider_response.findings,
            selected_branch=provider_response.selected_branch,
            analysed_sha=provider_response.analysed_sha,
        )

    return _GateOutcome("fail", None, _build_missing_provider_findings(context.providers, last_exc))


def _poll_branch_zero_gate(context: _CodacyContext, options: _BranchGateOptions) -> _GateOutcome:
    deadline = time.monotonic() + max(options.timeout_seconds, 0)
    while True:
        outcome = _query_branch_providers_once(context, options, deadline)
        if outcome.status == "pass":
            return _GateOutcome(
                status="pass",
                open_issues=outcome.open_issues,
                findings=(),
                selected_branch=outcome.selected_branch,
                analysed_sha=outcome.analysed_sha,
            )
        if outcome.status == "retry":
            time.sleep(max(options.poll_seconds, 1))
            continue
        return _GateOutcome(
            status="fail",
            open_issues=outcome.open_issues,
            findings=outcome.findings,
            selected_branch=outcome.selected_branch,
            analysed_sha=outcome.analysed_sha,
        )


def _build_backlog_findings(open_issues: Optional[int]) -> Tuple[str, ...]:
    if open_issues is None:
        return ("Codacy response did not include a parseable total issue count.",)
    if open_issues != 0:
        return (f"Codacy reports {open_issues} open issues (expected 0).",)
    return ()


def _query_backlog_provider(context: _CodacyContext, provider: str) -> _ProviderResponse:
    try:
        payload = _request_json(_build_backlog_url(context, provider), context.token, method="POST", data={})
        open_issues = extract_total_open(payload)
        findings = _build_backlog_findings(open_issues)
        return _ProviderResponse(not findings, False, open_issues, findings)
    except HttpsStatusError as exc:
        if exc.status_code == 404:
            return _ProviderResponse(False, True, None, (), error=exc)
        return _ProviderResponse(False, False, None, (f"Codacy API request failed: HTTP {exc.status_code}",), error=exc)
    except (RuntimeError, ValueError, TypeError) as exc:  # pragma: no cover - network/runtime surface
        return _ProviderResponse(False, False, None, (f"Codacy API request failed: {exc}",), error=exc)


def _check_repository_backlog_zero(context: _CodacyContext) -> _GateOutcome:
    last_exc: Optional[Exception] = None
    for provider in context.providers:
        provider_response = _query_backlog_provider(context, provider)
        last_exc = provider_response.error
        if provider_response.not_found:
            continue
        return _GateOutcome(
            status="pass" if provider_response.passed else "fail",
            open_issues=provider_response.open_issues,
            findings=provider_response.findings,
        )

    return _GateOutcome("fail", None, _build_missing_provider_findings(context.providers, last_exc))


def main() -> int:
    import os

    args = _parse_args()
    token = (args.token or os.environ.get("CODACY_API_TOKEN", "")).strip()
    context = _CodacyContext(
        api_base=normalize_https_url(CODACY_API_BASE, allowed_hosts={"api.codacy.com"}).rstrip("/"),
        token=token,
        owner=urllib.parse.quote(args.owner.strip(), safe=""),
        repo=urllib.parse.quote(args.repo.strip(), safe=""),
        providers=_provider_candidates(args.provider),
    )

    branch_options = _BranchGateOptions(
        branch=(args.branch or "").strip(),
        expected_sha=(args.expected_sha or "").strip(),
        timeout_seconds=args.timeout_seconds,
        poll_seconds=args.poll_seconds,
    )

    open_issues: Optional[int] = None
    selected_branch = ""
    analysed_sha = ""
    findings: List[str] = []

    if not token:
        status = "fail"
        findings.append("CODACY_API_TOKEN is missing.")
    else:
        if branch_options.branch:
            outcome = _poll_branch_zero_gate(context, branch_options)
        else:
            outcome = _check_repository_backlog_zero(context)

        status = outcome.status
        open_issues = outcome.open_issues
        selected_branch = outcome.selected_branch
        analysed_sha = outcome.analysed_sha
        findings.extend(outcome.findings)

    payload = {
        "status": status,
        "owner": args.owner,
        "repo": args.repo,
        "provider": args.provider,
        "branch": branch_options.branch,
        "selected_branch": selected_branch,
        "expected_sha": branch_options.expected_sha,
        "analysed_sha": analysed_sha,
        "open_issues": open_issues,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "findings": findings,
    }

    try:
        out_json = safe_output_path(args.out_json, "codacy-zero/codacy.json")
        out_md = safe_output_path(args.out_md, "codacy-zero/codacy.md")
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
