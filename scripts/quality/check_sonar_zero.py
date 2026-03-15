#!/usr/bin/env python3
from __future__ import absolute_import

import argparse
import base64
import importlib.util
import json
import sys
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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
safe_output_path = _security_helpers.safe_output_path

SONAR_API_BASE = "https://sonarcloud.io"
SONAR_HOST_SUFFIX = "sonarcloud.io"
UNRESOLVED_HOTSPOT_STATUS = "TO_REVIEW"


@dataclass(frozen=True)
class _SonarContext:
    api_base: str
    auth_header: str
    project_key: str
    branch: str
    pull_request: str


@dataclass
class _SonarGateState:
    open_issues: int | None = None
    security_hotspots_total: int | None = None
    security_hotspots_to_review: int | None = None
    quality_gate: str | None = None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Assert SonarCloud has zero open issues, zero unresolved security hotspots, "
            "and a passing quality gate."
        )
    )
    parser.add_argument("--project-key", required=True, help="Sonar project key")
    parser.add_argument("--token", default="", help="Sonar token (falls back to SONAR_TOKEN env)")
    parser.add_argument("--branch", default="", help="Optional branch scope")
    parser.add_argument("--pull-request", default="", help="Optional PR scope")
    parser.add_argument("--out-json", default="sonar-zero/sonar.json", help="Output JSON path")
    parser.add_argument("--out-md", default="sonar-zero/sonar.md", help="Output markdown path")
    return parser.parse_args()


def _auth_header(token: str) -> str:
    raw = f"{token}:".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _request_json(url: str, auth_header: str) -> dict[str, Any]:
    return request_json(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": auth_header,
            "User-Agent": "reframe-sonar-zero-gate",
        },
        allowed_host_suffixes={SONAR_HOST_SUFFIX},
    )


def _render_md(payload: dict) -> str:
    lines = [
        "# Sonar Zero Gate",
        "",
        f"- Status: `{payload['status']}`",
        f"- Project: `{payload['project_key']}`",
        f"- Open issues: `{payload.get('open_issues')}`",
        f"- Security hotspots total: `{payload.get('security_hotspots_total')}`",
        f"- Security hotspots to review: `{payload.get('security_hotspots_to_review')}`",
        f"- Quality gate: `{payload.get('quality_gate')}`",
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


def _scope_query(context: _SonarContext) -> dict[str, str]:
    query = {"projectKey": context.project_key}
    if context.branch:
        query["branch"] = context.branch
    if context.pull_request:
        query["pullRequest"] = context.pull_request
    return query


def _issues_query(context: _SonarContext) -> dict[str, str]:
    query = {
        "componentKeys": context.project_key,
        "resolved": "false",
        "ps": "1",
    }
    if context.branch:
        query["branch"] = context.branch
    if context.pull_request:
        query["pullRequest"] = context.pull_request
    return query


def _search_total(context: _SonarContext, endpoint: str, query: dict[str, str]) -> int:
    url = f"{context.api_base}{endpoint}?{urllib.parse.urlencode(query)}"
    payload = _request_json(url, context.auth_header)
    paging = payload.get("paging") or {}
    return int(paging.get("total") or 0)


def _populate_gate_state(context: _SonarContext, state: _SonarGateState) -> None:
    state.open_issues = _search_total(context, "/api/issues/search", _issues_query(context))

    hotspots_query = _scope_query(context)
    hotspots_query["ps"] = "1"
    state.security_hotspots_total = _search_total(
        context,
        "/api/hotspots/search",
        dict(hotspots_query),
    )

    to_review_query = dict(hotspots_query)
    to_review_query["status"] = UNRESOLVED_HOTSPOT_STATUS
    state.security_hotspots_to_review = _search_total(
        context,
        "/api/hotspots/search",
        to_review_query,
    )

    gate_url = f"{context.api_base}/api/qualitygates/project_status?{urllib.parse.urlencode(_scope_query(context))}"
    gate_payload = _request_json(gate_url, context.auth_header)
    project_status = gate_payload.get("projectStatus") or {}
    state.quality_gate = str(project_status.get("status") or "UNKNOWN")


def _findings_from_gate_state(state: _SonarGateState) -> list[str]:
    findings: list[str] = []
    if state.open_issues != 0:
        findings.append(f"Sonar reports {state.open_issues} open issues (expected 0).")
    if state.security_hotspots_to_review != 0:
        findings.append(
            f"Sonar reports {state.security_hotspots_to_review} unresolved security hotspots (expected 0)."
        )
    if state.quality_gate != "OK":
        findings.append(f"Sonar quality gate status is {state.quality_gate} (expected OK).")
    return findings


def main() -> int:
    import os

    args = _parse_args()
    token = (args.token or os.environ.get("SONAR_TOKEN", "")).strip()
    api_base = normalize_https_url(SONAR_API_BASE, allowed_hosts={SONAR_HOST_SUFFIX}).rstrip("/")

    findings: list[str] = []
    gate_state = _SonarGateState()

    if not token:
        findings.append("SONAR_TOKEN is missing.")
    else:
        context = _SonarContext(
            api_base=api_base,
            auth_header=_auth_header(token),
            project_key=args.project_key,
            branch=args.branch,
            pull_request=args.pull_request,
        )
        try:
            _populate_gate_state(context, gate_state)
            findings.extend(_findings_from_gate_state(gate_state))
        except Exception as exc:  # pragma: no cover - network/runtime surface
            findings.append(f"Sonar API request failed: {exc}")

    status = "pass" if not findings else "fail"
    payload = {
        "status": status,
        "project_key": args.project_key,
        "open_issues": gate_state.open_issues,
        "security_hotspots_total": gate_state.security_hotspots_total,
        "security_hotspots_to_review": gate_state.security_hotspots_to_review,
        "quality_gate": gate_state.quality_gate,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "findings": findings,
    }

    try:
        out_json = safe_output_path(args.out_json, "sonar-zero/sonar.json")
        out_md = safe_output_path(args.out_md, "sonar-zero/sonar.md")
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
