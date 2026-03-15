#!/usr/bin/env python3

import argparse
import importlib.util
import json
import sys
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Tuple


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
HttpsStatusError = _security_helpers.HttpsStatusError
safe_output_path = _security_helpers.safe_output_path

SENTRY_API_BASE = "https://sentry.io/api/0"
SENTRY_HOST_SUFFIX = "sentry.io"
RECOVERABLE_SENTRY_ERRORS = (HttpsStatusError, RuntimeError, ValueError)


@dataclass(frozen=True)
class _SentryContext:
    api_base: str
    token: str
    org: str
    projects: tuple[str, ...]


@dataclass(frozen=True)
class _SentryProjectSummary:
    project: str
    unresolved: int


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


def _auth_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "reframe-sentry-zero-gate",
    }


def _request(url: str, token: str) -> Tuple[List[Any], Dict[str, str]]:
    body, headers = request_json_with_headers(
        url,
        headers=_auth_headers(token),
        allowed_host_suffixes={SENTRY_HOST_SUFFIX},
    )
    if not isinstance(body, list):
        raise RuntimeError("Unexpected Sentry response payload")
    return body, headers


def _request_projects(api_base: str, org_slug: str, token: str) -> List[Dict[str, Any]]:
    body = request_json(
        f"{api_base}/organizations/{org_slug}/projects/",
        headers=_auth_headers(token),
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
    query = urllib.parse.urlencode({"query": "is:unresolved", "limit": "1"})
    safe_project_slug = urllib.parse.quote(project_slug, safe="")
    return _request(f"{api_base}/projects/{org_slug}/{safe_project_slug}/issues/?{query}", token)


def _request_org_issues(api_base: str, org_slug: str, project_id: str, token: str) -> Tuple[List[Any], Dict[str, str]]:
    query = urllib.parse.urlencode({"query": "is:unresolved", "limit": "1", "project": project_id})
    url = f"{api_base}/organizations/{org_slug}/issues/?{query}"
    return _request(url, token)


def _hits_from_headers(headers: Mapping[str, str]) -> int | None:
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


def _collect_projects(requested_projects: list[str], environ: Mapping[str, str]) -> list[str]:
    projects = [project for project in requested_projects if project]
    if projects:
        return projects

    for env_name in ("SENTRY_PROJECT", "SENTRY_PROJECT_BACKEND", "SENTRY_PROJECT_WEB"):
        value = str(environ.get(env_name, "")).strip()
        if value:
            projects.append(value)
    return projects


def _validate_context(context: _SentryContext) -> list[str]:
    findings: list[str] = []
    if not context.token:
        findings.append("SENTRY_AUTH_TOKEN is missing.")
    if not context.org:
        findings.append("SENTRY_ORG is missing.")
    if not context.projects:
        findings.append("No Sentry projects configured (SENTRY_PROJECT_BACKEND/SENTRY_PROJECT_WEB).")
    return findings


def _discover_project_ids(context: _SentryContext, org_slug: str) -> dict[str, str]:
    try:
        available_projects = _request_projects(context.api_base, org_slug, context.token)
    except RECOVERABLE_SENTRY_ERRORS:
        return {}

    project_ids_by_slug: dict[str, str] = {}
    for item in available_projects:
        slug = str(item.get("slug") or "").strip()
        project_id = item.get("id")
        if slug and project_id is not None:
            project_ids_by_slug[slug] = str(project_id)
    return project_ids_by_slug


def _fetch_project_issues(
    context: _SentryContext,
    org_slug: str,
    project_slug: str,
    project_id: str | None,
) -> Tuple[List[Any], Dict[str, str]]:
    if project_id:
        try:
            return _request_org_issues(context.api_base, org_slug, project_id, context.token)
        except RECOVERABLE_SENTRY_ERRORS:
            pass

    return _request_project_issues(context.api_base, org_slug, project_slug, context.token)


def _project_summary(project: str, issues: List[Any], headers: Dict[str, str]) -> tuple[_SentryProjectSummary, list[str]]:
    findings: list[str] = []
    unresolved = _hits_from_headers(headers)

    if unresolved is None:
        unresolved = len(issues)
        if unresolved >= 1:
            findings.append(
                f"Sentry project {project} returned unresolved issues but no X-Hits header for exact totals."
            )

    if unresolved != 0:
        findings.append(f"Sentry project {project} has {unresolved} unresolved issues (expected 0).")

    return _SentryProjectSummary(project=project, unresolved=unresolved), findings


def _evaluate_context(context: _SentryContext) -> tuple[list[dict[str, Any]], list[str]]:
    org_slug = urllib.parse.quote(context.org, safe="")
    project_ids_by_slug = _discover_project_ids(context, org_slug)

    findings: list[str] = []
    project_results: list[dict[str, Any]] = []

    for project in context.projects:
        issues, headers = _fetch_project_issues(context, org_slug, project, project_ids_by_slug.get(project))
        summary, project_findings = _project_summary(project, issues, headers)
        findings.extend(project_findings)
        project_results.append({"project": summary.project, "unresolved": summary.unresolved})

    return project_results, findings


def main() -> int:
    import os

    args = _parse_args()
    context = _SentryContext(
        api_base=normalize_https_url(SENTRY_API_BASE, allowed_hosts={SENTRY_HOST_SUFFIX}).rstrip("/"),
        token=(args.token or os.environ.get("SENTRY_AUTH_TOKEN", "")).strip(),
        org=(args.org or os.environ.get("SENTRY_ORG", "")).strip(),
        projects=tuple(_collect_projects(args.project, os.environ)),
    )

    findings = _validate_context(context)
    project_results: list[dict[str, Any]] = []

    if not findings:
        try:
            project_results, runtime_findings = _evaluate_context(context)
            findings.extend(runtime_findings)
        except RECOVERABLE_SENTRY_ERRORS as exc:  # pragma: no cover - network/runtime surface
            findings.append(f"Sentry API request failed: {exc}")

    status = "pass" if not findings else "fail"
    payload = {
        "status": status,
        "org": context.org,
        "projects": project_results,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "findings": findings,
    }

    try:
        out_json = safe_output_path(args.out_json, "sentry-zero/sentry.json")
        out_md = safe_output_path(args.out_md, "sentry-zero/sentry.md")
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
