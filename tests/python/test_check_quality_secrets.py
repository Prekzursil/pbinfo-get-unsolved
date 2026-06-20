"""Tests for ``scripts/quality/check_quality_secrets.py`` (100% line+branch)."""

from __future__ import annotations

from pathlib import Path

import pytest

import check_quality_secrets as mod

_ALL = mod.DEFAULT_REQUIRED_SECRETS + mod.DEFAULT_REQUIRED_VARS


def _set_all_present(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _ALL:
        monkeypatch.setenv(name, "value")


def _clear_all(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _ALL:
        monkeypatch.delenv(name, raising=False)


# ── _dedupe ──────────────────────────────────────────────────────────────────
def test_dedupe_drops_blanks_and_repeats() -> None:
    assert mod._dedupe(["A", "  A  ", "", "  ", "B"]) == ["A", "B"]


# ── evaluate_env ─────────────────────────────────────────────────────────────
def test_evaluate_env_all_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_all(monkeypatch)
    result = mod.evaluate_env(["S1"], ["V1"])
    assert result["missing_secrets"] == ["S1"]
    assert result["missing_vars"] == ["V1"]
    assert result["present_secrets"] == []
    assert result["present_vars"] == []


def test_evaluate_env_all_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("S1", "x")
    monkeypatch.setenv("V1", "y")
    result = mod.evaluate_env(["S1"], ["V1"])
    assert result["missing_secrets"] == []
    assert result["missing_vars"] == []
    assert result["present_secrets"] == ["S1"]
    assert result["present_vars"] == ["V1"]


def test_evaluate_env_blank_value_counts_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("S1", "   ")
    result = mod.evaluate_env(["S1"], [])
    assert result["missing_secrets"] == ["S1"]


# ── _render_md ───────────────────────────────────────────────────────────────
def test_render_md_with_missing() -> None:
    out = mod._render_md(
        {
            "status": "fail",
            "timestamp_utc": "T",
            "missing_secrets": ["S1"],
            "missing_vars": ["V1"],
        }
    )
    assert "`S1`" in out
    assert "`V1`" in out


def test_render_md_none_missing() -> None:
    out = mod._render_md(
        {
            "status": "pass",
            "timestamp_utc": "T",
            "missing_secrets": [],
            "missing_vars": [],
        }
    )
    assert "## Missing secrets\n- None" in out
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
        str(tmp_path / "q.json"),
        "--out-md",
        str(tmp_path / "q.md"),
        *extra,
    ]


def test_main_pass_all_present(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    _set_all_present(monkeypatch)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 0
    assert "Status: `pass`" in capsys.readouterr().out


def test_main_fail_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _clear_all(monkeypatch)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1


def test_main_extra_required(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Extra required secret/var supplied via CLI and absent -> fail.
    _set_all_present(monkeypatch)
    monkeypatch.delenv("EXTRA_SECRET", raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        _argv(
            tmp_path,
            "--required-secret",
            "EXTRA_SECRET",
            "--required-var",
            "EXTRA_VAR",
        ),
    )
    assert mod.main() == 1
    md = (tmp_path / "q.md").read_text("utf-8")
    assert "EXTRA_SECRET" in md
    assert "EXTRA_VAR" in md


def test_main_bad_output_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    _set_all_present(monkeypatch)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        ["prog", "--out-json", "../escape.json", "--out-md", "ok.md"],
    )
    assert mod.main() == 1
    assert "escapes workspace root" in capsys.readouterr().err
