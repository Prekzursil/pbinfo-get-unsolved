"""Tests for ``scripts/quality/check_sonar_zero.py`` (100% line+branch)."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

import check_sonar_zero as mod
from _urlmock import FakeResponse, make_urlopen


# ── _auth_header ─────────────────────────────────────────────────────────────
def test_auth_header() -> None:
    header = mod._auth_header("tok")
    assert header.startswith("Basic ")
    assert base64.b64decode(header[len("Basic ") :]).decode() == "tok:"


# ── _request_json ────────────────────────────────────────────────────────────
def test_request_json(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse({"paging": {"total": 0}})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    out = mod._request_json("https://sonarcloud.io/api/x/", "Basic z")
    assert out == {"paging": {"total": 0}}


# ── _scope_query ─────────────────────────────────────────────────────────────
def test_scope_query_minimal() -> None:
    assert mod._scope_query("k", "", "") == {"projectKey": "k"}


def test_scope_query_with_branch_and_pr() -> None:
    assert mod._scope_query("k", "main", "7") == {
        "projectKey": "k",
        "branch": "main",
        "pullRequest": "7",
    }


# ── _search_total ────────────────────────────────────────────────────────────
def test_search_total_reads_paging(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse({"paging": {"total": 9}})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    assert (
        mod._search_total(
            "https://sonarcloud.io",
            "/api/issues/search",
            {"projectKey": "k"},
            "Basic z",
        )
        == 9
    )


def test_search_total_missing_paging_defaults_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = make_urlopen([FakeResponse({})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    assert (
        mod._search_total("https://sonarcloud.io", "/api/x", {"projectKey": "k"}, "z")
        == 0
    )


# ── _render_md ───────────────────────────────────────────────────────────────
def test_render_md_findings() -> None:
    out = mod._render_md(
        {
            "status": "fail",
            "project_key": "k",
            "open_issues": 1,
            "security_hotspots_total": 2,
            "security_hotspots_to_review": 1,
            "quality_gate": "ERROR",
            "timestamp_utc": "T",
            "findings": ["bad"],
        }
    )
    assert "- bad" in out


def test_render_md_no_findings() -> None:
    out = mod._render_md(
        {
            "status": "pass",
            "project_key": "k",
            "open_issues": 0,
            "security_hotspots_total": 0,
            "security_hotspots_to_review": 0,
            "quality_gate": "OK",
            "timestamp_utc": "T",
            "findings": [],
        }
    )
    assert out.rstrip().endswith("- None")


# ── _safe_output_path ────────────────────────────────────────────────────────
def test_safe_output_path_escape(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes workspace root"):
        mod._safe_output_path("../x", "fb", base=tmp_path)


def test_safe_output_path_ok(tmp_path: Path) -> None:
    assert (
        mod._safe_output_path("a.json", "fb", base=tmp_path)
        == (tmp_path / "a.json").resolve()
    )


# ── main ─────────────────────────────────────────────────────────────────────
def _argv(tmp_path: Path, *extra: str) -> list[str]:
    return [
        "prog",
        "--project-key",
        "key",
        "--out-json",
        str(tmp_path / "s.json"),
        "--out-md",
        str(tmp_path / "s.md"),
        *extra,
    ]


def _clean_responses(
    *, issues: int, hotspots: int, to_review: int, gate: str
) -> list[FakeResponse]:
    # main makes 4 calls in order: issues, hotspots total, hotspots to-review,
    # quality-gate project_status.
    return [
        FakeResponse({"paging": {"total": issues}}),
        FakeResponse({"paging": {"total": hotspots}}),
        FakeResponse({"paging": {"total": to_review}}),
        FakeResponse({"projectStatus": {"status": gate}}),
    ]


def test_main_missing_token(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("SONAR_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1
    assert "SONAR_TOKEN is missing" in (tmp_path / "s.md").read_text("utf-8")


def test_main_pass_all_clean(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    fake = make_urlopen(_clean_responses(issues=0, hotspots=0, to_review=0, gate="OK"))
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 0
    assert "Status: `pass`" in capsys.readouterr().out


def test_main_token_from_env_with_scopes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Exercises the branch/pull-request scope additions to the issues query.
    monkeypatch.setenv("SONAR_TOKEN", "envtok")
    fake = make_urlopen(_clean_responses(issues=0, hotspots=0, to_review=0, gate="OK"))
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys, "argv", _argv(tmp_path, "--branch", "main", "--pull-request", "5")
    )
    assert mod.main() == 0


def test_main_all_findings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Nonzero issues + nonzero to-review hotspots + non-OK gate -> 3 findings.
    fake = make_urlopen(
        _clean_responses(issues=2, hotspots=3, to_review=1, gate="ERROR")
    )
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 1
    md = (tmp_path / "s.md").read_text("utf-8")
    assert "2 open issues" in md
    assert "1 unresolved security hotspots" in md
    assert "quality gate status is ERROR" in md


def test_main_gate_missing_status_defaults_unknown(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # projectStatus without a status -> "UNKNOWN" (!= OK) -> gate finding.
    fake = make_urlopen(
        [
            FakeResponse({"paging": {"total": 0}}),
            FakeResponse({"paging": {"total": 0}}),
            FakeResponse({"paging": {"total": 0}}),
            FakeResponse({}),
        ]
    )
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 1
    assert "UNKNOWN" in (tmp_path / "s.md").read_text("utf-8")


def test_main_bad_output_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    fake = make_urlopen(_clean_responses(issues=0, hotspots=0, to_review=0, gate="OK"))
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        [
            "prog",
            "--project-key",
            "k",
            "--token",
            "t",
            "--out-json",
            "../escape.json",
            "--out-md",
            "ok.md",
        ],
    )
    assert mod.main() == 1
    assert "escapes workspace root" in capsys.readouterr().err
