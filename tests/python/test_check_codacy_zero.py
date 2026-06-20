"""Tests for ``scripts/quality/check_codacy_zero.py`` (100% line+branch)."""

from __future__ import annotations

import urllib.error
from email.message import Message as EmailMessage
from pathlib import Path

import pytest

import check_codacy_zero as mod
from _urlmock import FakeResponse, make_urlopen


# ── extract_total_open ───────────────────────────────────────────────────────
def test_extract_direct_total_key() -> None:
    assert mod.extract_total_open({"total": 7}) == 7


def test_extract_ignores_non_numeric_total() -> None:
    # "total" present but not int/float -> falls through to nested search.
    assert mod.extract_total_open({"total": "x", "meta": {"count": 3}}) == 3


def test_extract_from_pagination_block() -> None:
    assert mod.extract_total_open({"pagination": {"total": 2}}) == 2


def test_extract_from_generic_nested_value() -> None:
    assert mod.extract_total_open({"data": {"hits": 9}}) == 9


def test_extract_from_list() -> None:
    assert mod.extract_total_open([{"a": 1}, {"count": 4}]) == 4


def test_extract_none_when_absent() -> None:
    assert mod.extract_total_open({"unrelated": "value"}) is None
    assert mod.extract_total_open("scalar") is None


def test_extract_list_with_no_totals_falls_through() -> None:
    # A list whose items never yield a total exits the loop and returns None.
    assert mod.extract_total_open([{"a": "x"}, "scalar"]) is None


# ── _request_json (POST with body) ───────────────────────────────────────────
def test_request_json_posts_body(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    out = mod._request_json(
        "https://api.codacy.com/x/", "tok", method="POST", data={"k": "v"}
    )
    assert out == {"total": 0}
    assert fake.calls == ["https://api.codacy.com/x"]


def test_request_json_get_no_body(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    assert mod._request_json("https://api.codacy.com/y", "tok") == {"total": 0}


# ── _render_md ───────────────────────────────────────────────────────────────
def test_render_md_with_findings() -> None:
    out = mod._render_md(
        {
            "status": "fail",
            "owner": "o",
            "repo": "r",
            "open_issues": 3,
            "timestamp_utc": "T",
            "findings": ["x"],
        }
    )
    assert "- x" in out
    assert "`o/r`" in out


def test_render_md_no_findings() -> None:
    out = mod._render_md(
        {
            "status": "pass",
            "owner": "o",
            "repo": "r",
            "open_issues": 0,
            "timestamp_utc": "T",
            "findings": [],
        }
    )
    assert out.rstrip().endswith("- None")


# ── _safe_output_path ────────────────────────────────────────────────────────
def test_safe_output_path_escape(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes workspace root"):
        mod._safe_output_path("../x.json", "fb.json", base=tmp_path)


def test_safe_output_path_ok(tmp_path: Path) -> None:
    assert (
        mod._safe_output_path("a.json", "fb.json", base=tmp_path)
        == (tmp_path / "a.json").resolve()
    )


# ── main ─────────────────────────────────────────────────────────────────────
def _argv(tmp_path: Path, *extra: str) -> list[str]:
    return [
        "prog",
        "--owner",
        "ow",
        "--repo",
        "re",
        "--out-json",
        str(tmp_path / "c.json"),
        "--out-md",
        str(tmp_path / "c.md"),
        *extra,
    ]


def test_main_missing_token(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("CODACY_API_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1
    assert "CODACY_API_TOKEN is missing" in (tmp_path / "c.md").read_text("utf-8")


def test_main_pass_zero_issues(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 0
    assert "Status: `pass`" in capsys.readouterr().out


def test_main_nonzero_issues_fail(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake = make_urlopen([FakeResponse({"total": 5})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 1


def test_main_unparseable_total_fail(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake = make_urlopen([FakeResponse({"unrelated": True})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 1
    assert "did not include a parseable" in (tmp_path / "c.md").read_text("utf-8")


def _http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="https://api.codacy.com",
        code=code,
        msg="x",
        hdrs=EmailMessage(),
        fp=None,
    )


def test_main_404_then_success_next_provider(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # First provider 404s (continue), second provider returns 0 -> pass.
    fake = make_urlopen([_http_error(404), FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys, "argv", _argv(tmp_path, "--token", "t", "--provider", "custom")
    )
    assert mod.main() == 0


def test_main_http_error_non_404(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake = make_urlopen([_http_error(500)])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 1
    assert "HTTP 500" in (tmp_path / "c.md").read_text("utf-8")


def test_main_all_providers_404(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # provider defaults to gh; candidates = [gh, github]; both 404 -> else clause
    # (endpoint not found + last error appended).
    fake = make_urlopen([_http_error(404), _http_error(404)])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--token", "t"))
    assert mod.main() == 1
    md = (tmp_path / "c.md").read_text("utf-8")
    assert "was not found for provider" in md
    assert "Last Codacy API error" in md


def test_main_token_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CODACY_API_TOKEN", "envtok")
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 0


def test_main_bad_output_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    fake = make_urlopen([FakeResponse({"total": 0})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        [
            "prog",
            "--owner",
            "o",
            "--repo",
            "r",
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
