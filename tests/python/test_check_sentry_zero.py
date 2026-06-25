"""Tests for ``scripts/quality/check_sentry_zero.py`` (100% line+branch)."""

from __future__ import annotations

from pathlib import Path

import pytest

import check_sentry_zero as mod
from _urlmock import FakeResponse, make_urlopen

_URL = "https://sentry.io/api/0/projects/o/p/issues/"


# ── _request ─────────────────────────────────────────────────────────────────
def test_request_returns_body_and_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse([{"id": 1}], headers={"X-Hits": "5"})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    body, headers = mod._request(_URL, "t")
    assert body == [{"id": 1}]
    assert headers["x-hits"] == "5"


def test_request_rejects_non_list(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse({"not": "a list"})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    with pytest.raises(RuntimeError, match="Unexpected Sentry response"):
        mod._request(_URL, "t")


# ── _hits_from_headers ───────────────────────────────────────────────────────
def test_hits_from_headers_valid() -> None:
    assert mod._hits_from_headers({"x-hits": "12"}) == 12


def test_hits_from_headers_missing() -> None:
    assert mod._hits_from_headers({}) is None


def test_hits_from_headers_non_numeric() -> None:
    assert mod._hits_from_headers({"x-hits": "abc"}) is None


# ── _render_md ───────────────────────────────────────────────────────────────
def test_render_md_with_projects_and_findings() -> None:
    out = mod._render_md(
        {
            "status": "fail",
            "org": "o",
            "timestamp_utc": "T",
            "projects": [
                {"project": "p", "unresolved": 2},
                "not-a-mapping",  # skipped
            ],
            "findings": ["bad"],
        }
    )
    assert "`p` unresolved=`2`" in out
    assert "- bad" in out


def test_render_md_empty() -> None:
    out = mod._render_md(
        {
            "status": "pass",
            "org": "o",
            "timestamp_utc": "T",
            "projects": "not-a-list",  # -> [] branch
            "findings": [],
        }
    )
    assert "## Project results\n- None" in out
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
        str(tmp_path / "s.json"),
        "--out-md",
        str(tmp_path / "s.md"),
        *extra,
    ]


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "SENTRY_AUTH_TOKEN",
        "SENTRY_ORG",
        "SENTRY_PROJECT_BACKEND",
        "SENTRY_PROJECT_WEB",
    ):
        monkeypatch.delenv(name, raising=False)


def test_main_all_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _clear_env(monkeypatch)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1
    md = (tmp_path / "s.md").read_text("utf-8")
    assert "SENTRY_AUTH_TOKEN is missing" in md
    assert "SENTRY_ORG is missing" in md
    assert "No Sentry projects configured" in md


def test_main_projects_from_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # No --project args -> pulled from SENTRY_PROJECT_BACKEND/_WEB env.
    _clear_env(monkeypatch)
    monkeypatch.setenv("SENTRY_AUTH_TOKEN", "t")
    monkeypatch.setenv("SENTRY_ORG", "org")
    monkeypatch.setenv("SENTRY_PROJECT_BACKEND", "backend")
    fake = make_urlopen([FakeResponse([], headers={"X-Hits": "0"})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 0


def test_main_unresolved_nonzero(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _clear_env(monkeypatch)
    fake = make_urlopen([FakeResponse([{"id": 1}], headers={"X-Hits": "3"})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        _argv(tmp_path, "--token", "t", "--org", "o", "--project", "p"),
    )
    assert mod.main() == 1
    assert "3 unresolved issues" in (tmp_path / "s.md").read_text("utf-8")


def test_main_no_hits_header_with_issues(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # No X-Hits header -> falls back to len(issues); >=1 adds the no-header
    # finding AND the nonzero finding.
    _clear_env(monkeypatch)
    fake = make_urlopen([FakeResponse([{"id": 1}, {"id": 2}])])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        _argv(tmp_path, "--token", "t", "--org", "o", "--project", "p"),
    )
    assert mod.main() == 1
    md = (tmp_path / "s.md").read_text("utf-8")
    assert "no X-Hits header" in md
    assert "2 unresolved issues" in md


def test_main_no_hits_header_zero_issues(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # No X-Hits header and empty list -> len()==0 -> no findings -> pass.
    _clear_env(monkeypatch)
    fake = make_urlopen([FakeResponse([])])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        _argv(tmp_path, "--token", "t", "--org", "o", "--project", "p"),
    )
    assert mod.main() == 0


def test_main_pass_hits_zero(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    _clear_env(monkeypatch)
    fake = make_urlopen([FakeResponse([], headers={"X-Hits": "0"})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        _argv(tmp_path, "--token", "t", "--org", "o", "--project", "p"),
    )
    assert mod.main() == 0
    assert "Status: `pass`" in capsys.readouterr().out


def test_main_bad_output_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    _clear_env(monkeypatch)
    fake = make_urlopen([FakeResponse([], headers={"X-Hits": "0"})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        [
            "prog",
            "--token",
            "t",
            "--org",
            "o",
            "--project",
            "p",
            "--out-json",
            "../escape.json",
            "--out-md",
            "ok.md",
        ],
    )
    assert mod.main() == 1
    assert "escapes workspace root" in capsys.readouterr().err
