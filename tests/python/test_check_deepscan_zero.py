"""Tests for ``scripts/quality/check_deepscan_zero.py`` (100% line+branch)."""

from __future__ import annotations

from pathlib import Path

import pytest

import check_deepscan_zero as mod
from _urlmock import FakeResponse, make_urlopen

_URL = "https://api.deepscan.io/issues"


# ── extract_total_open ───────────────────────────────────────────────────────
def test_extract_direct() -> None:
    assert mod.extract_total_open({"count": 0}) == 0


def test_extract_non_numeric_then_nested() -> None:
    assert mod.extract_total_open({"total": "x", "n": {"hits": 2}}) == 2


def test_extract_from_list() -> None:
    assert mod.extract_total_open([{"x": 1}, {"total": 6}]) == 6


def test_extract_none() -> None:
    assert mod.extract_total_open({"a": "b"}) is None
    assert mod.extract_total_open([{"a": "b"}]) is None
    assert mod.extract_total_open(42) is None


# ── _request_json ────────────────────────────────────────────────────────────
def test_request_json(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    assert mod._request_json(_URL, "tok") == {"total": 0}


# ── _render_md ───────────────────────────────────────────────────────────────
def test_render_md_findings() -> None:
    out = mod._render_md(
        {
            "status": "fail",
            "open_issues": 1,
            "open_issues_url": _URL,
            "timestamp_utc": "T",
            "findings": ["bad"],
        }
    )
    assert "- bad" in out
    assert _URL in out


def test_render_md_no_url_no_findings() -> None:
    out = mod._render_md(
        {
            "status": "pass",
            "open_issues": 0,
            "open_issues_url": "",
            "timestamp_utc": "T",
            "findings": [],
        }
    )
    assert "`n/a`" in out
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
        "--out-json",
        str(tmp_path / "d.json"),
        "--out-md",
        str(tmp_path / "d.md"),
        *extra,
    ]


def test_main_missing_token_and_url(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("DEEPSCAN_API_TOKEN", raising=False)
    monkeypatch.delenv("DEEPSCAN_OPEN_ISSUES_URL", raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1
    md = (tmp_path / "d.md").read_text("utf-8")
    assert "DEEPSCAN_API_TOKEN is missing" in md
    assert "DEEPSCAN_OPEN_ISSUES_URL is missing" in md


def test_main_token_present_url_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # token present (no token-missing finding) but URL missing -> still fails.
    monkeypatch.setenv("DEEPSCAN_API_TOKEN", "t")
    monkeypatch.delenv("DEEPSCAN_OPEN_ISSUES_URL", raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1


def test_main_invalid_url_finding(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("DEEPSCAN_API_TOKEN", "t")
    # Non-deepscan host fails the suffix allowlist inside normalize_https_url.
    monkeypatch.setenv("DEEPSCAN_OPEN_ISSUES_URL", "https://evil.com/x")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1
    assert "suffix allowlist" in (tmp_path / "d.md").read_text("utf-8")


def test_main_pass_zero(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    monkeypatch.setenv("DEEPSCAN_API_TOKEN", "t")
    monkeypatch.setenv("DEEPSCAN_OPEN_ISSUES_URL", _URL)
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 0
    assert "Status: `pass`" in capsys.readouterr().out


def test_main_nonzero_fail(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DEEPSCAN_API_TOKEN", "t")
    monkeypatch.setenv("DEEPSCAN_OPEN_ISSUES_URL", _URL)
    fake = make_urlopen([FakeResponse({"total": 4})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1
    assert "4 open issues" in (tmp_path / "d.md").read_text("utf-8")


def test_main_unparseable_total(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("DEEPSCAN_API_TOKEN", "t")
    monkeypatch.setenv("DEEPSCAN_OPEN_ISSUES_URL", _URL)
    fake = make_urlopen([FakeResponse({"nope": 1})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1
    assert "did not include a parseable" in (tmp_path / "d.md").read_text("utf-8")


def test_main_bad_output_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    monkeypatch.setenv("DEEPSCAN_API_TOKEN", "t")
    monkeypatch.setenv("DEEPSCAN_OPEN_ISSUES_URL", _URL)
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        ["prog", "--out-json", "../escape.json", "--out-md", "ok.md"],
    )
    assert mod.main() == 1
    assert "escapes workspace root" in capsys.readouterr().err
