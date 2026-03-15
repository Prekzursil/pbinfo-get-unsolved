#!/usr/bin/env python3

import argparse
import importlib.util
import json
import sys
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
normalize_https_url = _security_helpers.normalize_https_url
request_json = _security_helpers.request_json
safe_output_path = _security_helpers.safe_output_path

TOTAL_KEYS = {"total", "totalItems", "total_items", "count", "hits", "open_issues"}


@dataclass(frozen=True)
class _DeepScanGateResult:
    open_issues: Optional[int]
    findings: List[str]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Assert DeepScan has zero total open issues.")
    parser.add_argument("--token", default="", help="DeepScan API token (falls back to DEEPSCAN_API_TOKEN env)")
    parser.add_argument("--out-json", default="deepscan-zero/deepscan.json", help="Output JSON path")
    parser.add_argument("--out-md", default="deepscan-zero/deepscan.md", help="Output markdown path")
    return parser.parse_args()


def _extract_total_from_mapping(mapping: Dict[str, Any]) -> Optional[int]:
    for key, value in mapping.items():
        if key in TOTAL_KEYS and isinstance(value, (int, float)):
            return int(value)
    return None


def _append_mapping_values(stack: List[Any], mapping: Dict[str, Any]) -> None:
    for nested in reversed(list(mapping.values())):
        stack.append(nested)


def _append_sequence_values(stack: List[Any], values: List[Any]) -> None:
    for nested in reversed(values):
        stack.append(nested)


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


def _request_json(url: str, token: str) -> Dict[str, Any]:
    return request_json(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "reframe-deepscan-zero-gate",
        },
        allowed_host_suffixes={"deepscan.io"},
    )


def _render_md(payload: Dict[str, Any]) -> str:
    lines = [
        "# DeepScan Zero Gate",
        "",
        f"- Status: `{payload['status']}`",
        f"- Open issues: `{payload.get('open_issues')}`",
        f"- Source URL: `{payload.get('open_issues_url') or 'n/a'}`",
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


def _validate_inputs(token: str, raw_open_issues_url: str) -> Tuple[str, List[str]]:
    findings: List[str] = []
    open_issues_url = raw_open_issues_url.strip()

    if not token:
        findings.append("DEEPSCAN_API_TOKEN is missing.")
    if not open_issues_url:
        findings.append("DEEPSCAN_OPEN_ISSUES_URL is missing.")
    else:
        try:
            open_issues_url = normalize_https_url(open_issues_url, allowed_host_suffixes={"deepscan.io"})
        except ValueError as exc:
            findings.append(str(exc))

    return open_issues_url, findings


def _evaluate_gate(open_issues_url: str, token: str) -> _DeepScanGateResult:
    findings: List[str] = []
    try:
        payload = _request_json(open_issues_url, token)
    except (RuntimeError, ValueError, TypeError) as exc:  # pragma: no cover - network/runtime surface
        findings.append(f"DeepScan API request failed: {exc}")
        return _DeepScanGateResult(open_issues=None, findings=findings)

    open_issues = extract_total_open(payload)
    if open_issues is None:
        findings.append("DeepScan response did not include a parseable total issue count.")
    elif open_issues != 0:
        findings.append(f"DeepScan reports {open_issues} open issues (expected 0).")

    return _DeepScanGateResult(open_issues=open_issues, findings=findings)


def main() -> int:
    import os

    args = _parse_args()
    token = (args.token or os.environ.get("DEEPSCAN_API_TOKEN", "")).strip()
    open_issues_url, findings = _validate_inputs(token, os.environ.get("DEEPSCAN_OPEN_ISSUES_URL", ""))

    open_issues: Optional[int] = None
    if not findings:
        gate_result = _evaluate_gate(open_issues_url, token)
        findings.extend(gate_result.findings)
        open_issues = gate_result.open_issues

    status = "pass" if not findings else "fail"
    payload = {
        "status": status,
        "open_issues": open_issues,
        "open_issues_url": open_issues_url,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "findings": findings,
    }

    try:
        out_json = safe_output_path(args.out_json, "deepscan-zero/deepscan.json")
        out_md = safe_output_path(args.out_md, "deepscan-zero/deepscan.md")
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
