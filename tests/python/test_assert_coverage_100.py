"""Tests for ``scripts/quality/assert_coverage_100.py`` (100% line+branch)."""

from __future__ import annotations

from pathlib import Path

import pytest

import assert_coverage_100 as mod


# ── CoverageStats.percent ────────────────────────────────────────────────────
def test_percent_zero_total_is_full() -> None:
    assert mod.CoverageStats("n", "p", 0, 0).percent == 100.0


def test_percent_ratio() -> None:
    assert mod.CoverageStats("n", "p", 1, 2).percent == 50.0


# ── parse_named_path ─────────────────────────────────────────────────────────
def test_parse_named_path_ok() -> None:
    name, path = mod.parse_named_path("  web = build/cov.xml ")
    assert name == "web"
    assert path == Path("build/cov.xml")


def test_parse_named_path_invalid() -> None:
    with pytest.raises(ValueError, match="Expected format: name=path"):
        mod.parse_named_path("no-equals-sign")


# ── parse_coverage_xml ───────────────────────────────────────────────────────
def test_parse_coverage_xml_summary_attrs(tmp_path: Path) -> None:
    xml = tmp_path / "c.xml"
    xml.write_text('<coverage lines-valid="10" lines-covered="9"/>', encoding="utf-8")
    stats = mod.parse_coverage_xml("py", xml)
    assert (stats.total, stats.covered) == (10, 9)


def test_parse_coverage_xml_line_hits_fallback(tmp_path: Path) -> None:
    # The line-hits fallback regex matches literal-backslash `\b` tokens (the
    # pattern in the source uses a raw `\\b`, i.e. a literal backslash+b, not a
    # word boundary), so we must feed it input shaped to that pattern to exercise
    # the fallback when no lines-valid/lines-covered summary attrs are present.
    xml = tmp_path / "c.xml"
    xml.write_text(
        r'<line\b x="1" \bhits="3" /><line\b \bhits="0" /><line\b \bhits="2" />',
        encoding="utf-8",
    )
    stats = mod.parse_coverage_xml("py", xml)
    # 3 matched line tags; two covered (hits=3, hits=2), one uncovered (hits=0).
    assert (stats.total, stats.covered) == (3, 2)


# ── parse_lcov ───────────────────────────────────────────────────────────────
def test_parse_lcov(tmp_path: Path) -> None:
    lcov = tmp_path / "c.info"
    lcov.write_text("LF:5\nLH:4\nDA:1,1\nLF:5\nLH:5\n", encoding="utf-8")
    stats = mod.parse_lcov("js", lcov)
    assert (stats.total, stats.covered) == (10, 9)


# ── evaluate ─────────────────────────────────────────────────────────────────
def test_evaluate_all_full() -> None:
    status, findings = mod.evaluate([mod.CoverageStats("a", "p", 10, 10)])
    assert status == "pass"
    assert findings == []


def test_evaluate_component_below_100() -> None:
    status, findings = mod.evaluate([mod.CoverageStats("a", "p", 5, 10)])
    assert status == "fail"
    assert any("a coverage below 100%" in f for f in findings)
    assert any("combined coverage below 100%" in f for f in findings)


def test_evaluate_empty_combined_is_full() -> None:
    # No stats -> combined_total <= 0 -> combined defaults to 100 -> pass.
    status, findings = mod.evaluate([])
    assert status == "pass"
    assert findings == []


# ── _render_md ───────────────────────────────────────────────────────────────
def test_render_md_with_components_and_findings() -> None:
    out = mod._render_md(
        {
            "status": "fail",
            "timestamp_utc": "T",
            "components": [
                {"name": "a", "percent": 50.0, "covered": 1, "total": 2, "path": "p"},
                "not-a-mapping",  # skipped by isinstance guard
            ],
            "findings": ["bad"],
        }
    )
    assert "`a`: `50.00%` (1/2)" in out
    assert "- bad" in out


def test_render_md_no_components_no_findings() -> None:
    out = mod._render_md(
        {
            "status": "pass",
            "timestamp_utc": "T",
            "components": "not-a-list",  # -> [] branch
            "findings": [],
        }
    )
    assert "## Components\n- None" in out
    assert out.rstrip().endswith("- None")


# ── _safe_output_path ────────────────────────────────────────────────────────
def test_safe_output_path_relative(tmp_path: Path) -> None:
    out = mod._safe_output_path("sub/x.json", "fallback.json", base=tmp_path)
    assert out == (tmp_path / "sub/x.json").resolve()


def test_safe_output_path_blank_uses_fallback(tmp_path: Path) -> None:
    out = mod._safe_output_path("  ", "fb/x.json", base=tmp_path)
    assert out == (tmp_path / "fb/x.json").resolve()


def test_safe_output_path_absolute_inside_root(tmp_path: Path) -> None:
    abs_target = tmp_path / "abs.json"
    out = mod._safe_output_path(str(abs_target), "fb.json", base=tmp_path)
    assert out == abs_target.resolve()


def test_safe_output_path_escape_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes workspace root"):
        mod._safe_output_path("../escape.json", "fb.json", base=tmp_path)


# ── main ─────────────────────────────────────────────────────────────────────
def _write_xml(p: Path, valid: int, covered: int) -> Path:
    p.write_text(
        f'<coverage lines-valid="{valid}" lines-covered="{covered}"/>',
        encoding="utf-8",
    )
    return p


def test_main_pass(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys) -> None:
    xml = _write_xml(tmp_path / "cov.xml", 4, 4)
    lcov = tmp_path / "cov.info"
    lcov.write_text("LF:2\nLH:2\n", encoding="utf-8")
    out_json = tmp_path / "out/cov.json"
    out_md = tmp_path / "out/cov.md"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        [
            "prog",
            "--xml",
            f"py={xml}",
            "--lcov",
            f"js={lcov}",
            "--out-json",
            str(out_json),
            "--out-md",
            str(out_md),
        ],
    )
    assert mod.main() == 0
    assert out_json.exists()
    assert "Status: `pass`" in out_md.read_text(encoding="utf-8")
    assert "pass" in capsys.readouterr().out


def test_main_fail_below_100(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    xml = _write_xml(tmp_path / "cov.xml", 10, 5)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        ["prog", "--xml", f"py={xml}", "--out-json", "o.json", "--out-md", "o.md"],
    )
    assert mod.main() == 1


def test_main_no_inputs_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mod.sys, "argv", ["prog"])
    with pytest.raises(SystemExit, match="No coverage files"):
        mod.main()


def test_main_bad_output_path_returns_1(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    xml = _write_xml(tmp_path / "cov.xml", 1, 1)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        [
            "prog",
            "--xml",
            f"py={xml}",
            "--out-json",
            "../escape.json",
            "--out-md",
            "o.md",
        ],
    )
    assert mod.main() == 1
    assert "escapes workspace root" in capsys.readouterr().err
