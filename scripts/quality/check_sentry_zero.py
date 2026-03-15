#!/usr/bin/env python3

import argparse
import importlib.util
import json
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _load_security_helpers():
    helper_path = Path(__file__).resolve().parent.parent.joinpath("security_helpers.py")
    spec = importlib.util.spec_from_file_location("security_helpers", helper_path)
    if spec is None or spec.loader is None:
        raise ImportError("Unable to load security_helpers module.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_security_helpers = _load_security_helpers()
normalize_https_url = _security_helpers.normalize_https_url
request_json = _security_helpers.request_json
request_json_with_headers = _security_helpers.request_json_with_headers

SENTRY_API_BASE = "https://sentry.io/api/0"
SENTRY_HOST_SUFFIX = "sentry.io"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Assert Sentry has zero unresolved issues for configured projects.")
    parser.add_argument("--org", default="", help="Sentry org slug (falls back to SENTRY_ORG env)")
    parser.add_argument(
        "--project",
        action="append",
        default=[],
        help="Project slug (repeatable, falls back to SENTRY_PROJECT_BACKEND/SENTRY_PROJECT_WEB env)",
    )
    parser.add_argument("--token", default="", help="Sentry auth token (falls back to SENTRY_AUTH_TOKEN env)")
    parser.add_argument("--out-json", default="sentry-zero/sentry.json", help="Output JSON path")
    parser.add_argument("--out-md", default="sentry-zero/sentry.md", help="Output markdown path")
    return parser.parse_args()


def _request(url: str, token: str) -> Tuple[List[Any], Dict[str, str]]:
    body, headers = request_json_with_headers(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "reframe-sentry-zero-gate",
        },
        allowed_host_suffixes={SENTRY_HOST_SUFFIX},
    )
    if not isinstance(body, list):
        raise RuntimeError("Unexpected Sentry response payload")
    return body, headers


def _request_projects(api_base: str, org_slug: str, token: str) -> List[Dict[str, Any]]:
    body = request_json(
        f"{api_base}/organizations/{org_slug}/projects/",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "reframe-sentry-zero-gate",
        },
        allowed_host_suffixes={SENTRY_HOST_SUFFIX},
    )
    if not isinstance(body, list):
        raise RuntimeError("Unexpected Sentry project payload")

    projects: List[Dict[str, Any]] = []
    for item in body:
        if isinstance(item, dict):
            projects.append(item)
    return projects


def _request_project_issues(api_base: str, org_slug: str, project_slug: str, token: str) -> Tuple[List[Any], Dict[str, str]]:
    query = urllib.parse.urlencode(
        {
            "query": "is:unresolved",
            "limit": "1",
        }
    )
    safe_project_slug = urllib.parse.quote(project_slug, safe="")
    return _request(f"{api_base}/projects/{org_slug}/{safe_project_slug}/issues/?{query}", token)


def _hits_from_headers(headers: dict[str, str]) -> int | None:
    raw = headers.get("x-hits")
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _render_md(payload: dict) -> str:
    lines = [
        "# Sentry Zero Gate",
        "",
        f"- Status: `{payload['status']}`",
        f"- Org: `{payload.get('org')}`",
        f"- Timestamp (UTC): `{payload['timestamp_utc']}`",
        "",
        "## Project results",
    ]

    for item in payload.get("projects", []):
        lines.append(f"- `{item['project']}` unresolved=`{item['unresolved']}`")

    if not payload.get("projects"):
        lines.append("- None")

    lines.extend(["", "## Findings"])
    findings = payload.get("findings") or []
    if findings:
        lines.extend(f"- {item}" for item in findings)
    else:
        lines.append("- None")

    return "\n".join(lines) + "\n"


def _safe_output_path(raw: str, fallback: str, base: Path | None = None) -> Path:
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


def main() -> int:
    import os

    args = _parse_args()
    token = (args.token or os.environ.get("SENTRY_AUTH_TOKEN", "")).strip()
    org = (args.org or os.environ.get("SENTRY_ORG", "")).strip()
    api_base = normalize_https_url(SENTRY_API_BASE, allowed_hosts={SENTRY_HOST_SUFFIX}).rstrip("/")

    projects = [p for p in args.project if p]
    if not projects:
        for env_name in ("SENTRY_PROJECT", "SENTRY_PROJECT_BACKEND", "SENTRY_PROJECT_WEB"):
            value = str(os.environ.get(env_name, "")).strip()
            if value:
                projects.append(value)

    findings: List[str] = []
    project_results: List[Dict[str, Any]] = []

    if not token:
        findings.append("SENTRY_AUTH_TOKEN is missing.")
    if not org:
        findings.append("SENTRY_ORG is missing.")
    if not projects:
        findings.append("No Sentry projects configured (SENTRY_PROJECT_BACKEND/SENTRY_PROJECT_WEB).")

    status = "fail"
    if not findings:
        try:
            org_slug = urllib.parse.quote(org, safe="")
            project_ids_by_slug = {}
            try:
                available_projects = _request_projects(api_base, org_slug, token)
            except Exception:
                available_projects = []

            for item in available_projects:
                slug = str(item.get("slug") or "").strip()
                project_id = item.get("id")
                if slug and project_id is not None:
                    project_ids_by_slug[slug] = str(project_id)

            for project in projects:
                project_id = project_ids_by_slug.get(project)
                issues: List[Any] | None = None
                headers: Dict[str, str] | None = None

                if project_id:
                    query = urllib.parse.urlencode(
                        {
                            "query": "is:unresolved",
                            "limit": "1",
                            "project": project_id,
                        }
                    )
                    url = f"{api_base}/organizations/{org_slug}/issues/?{query}"
                    try:
                        issues, headers = _request(url, token)
                    except Exception:
                        issues = None
                        headers = None

                if issues is None or headers is None:
                    issues, headers = _request_project_issues(api_base, org_slug, project, token)

                unresolved = _hits_from_headers(headers)
                if unresolved is None:
                    unresolved = len(issues)
                    if unresolved >= 1:
                        findings.append(
                            f"Sentry project {project} returned unresolved issues but no X-Hits header for exact totals."
                        )
                if unresolved != 0:
                    findings.append(f"Sentry project {project} has {unresolved} unresolved issues (expected 0).")
                project_results.append({"project": project, "unresolved": unresolved})

            status = "pass" if not findings else "fail"
        except Exception as exc:  # pragma: no cover - network/runtime surface
            findings.append(f"Sentry API request failed: {exc}")
            status = "fail"

    payload = {
        "status": status,
        "org": org,
        "projects": project_results,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "findings": findings,
    }

    try:
        out_json = _safe_output_path(args.out_json, "sentry-zero/sentry.json")
        out_md = _safe_output_path(args.out_md, "sentry-zero/sentry.md")
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
