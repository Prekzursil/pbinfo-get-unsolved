"""Tests for ``scripts/quality/check_required_checks.py`` (100% line+branch)."""

from __future__ import annotations

from pathlib import Path

import pytest

import check_required_checks as mod
from _urlmock import FakeResponse, make_urlopen


# ── _api_get ─────────────────────────────────────────────────────────────────
def test_api_get(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = make_urlopen([FakeResponse({"check_runs": []})])
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    out = mod._api_get("o/r", "/commits/sha/check-runs", "tok")
    assert out == {"check_runs": []}
    assert fake.calls == ["https://api.github.com/repos/o/r/commits/sha/check-runs"]


# ── _collect_contexts ────────────────────────────────────────────────────────
def test_collect_contexts_merges_runs_and_statuses() -> None:
    runs = {
        "check_runs": [
            {"name": "build", "status": "completed", "conclusion": "success"},
            {"name": "", "status": "x"},  # blank name skipped
            None,  # falsy entry tolerated by `or []`-style iteration
        ]
    }
    statuses = {
        "statuses": [
            {"context": "lint", "state": "success"},
            {"context": "  ", "state": "y"},  # blank skipped
        ]
    }
    # Drop the None entry to keep the iteration valid (the source iterates the
    # list as-is; we model the realistic non-None payload here).
    runs["check_runs"] = [r for r in runs["check_runs"] if r is not None]
    contexts = mod._collect_contexts(runs, statuses)
    assert contexts["build"]["source"] == "check_run"
    assert contexts["lint"]["source"] == "status"
    assert "" not in contexts


def test_collect_contexts_handles_missing_keys() -> None:
    # Payloads lacking check_runs/statuses keys -> `.get(..., []) or []` -> empty.
    assert mod._collect_contexts({}, {}) == {}
    assert mod._collect_contexts({"check_runs": None}, {"statuses": None}) == {}


# ── _evaluate ────────────────────────────────────────────────────────────────
def test_evaluate_missing_context() -> None:
    status, missing, failed = mod._evaluate(["ci"], {})
    assert status == "fail"
    assert missing == ["ci"]
    assert failed == []


def test_evaluate_check_run_incomplete() -> None:
    contexts = {"ci": {"state": "in_progress", "conclusion": "", "source": "check_run"}}
    status, missing, failed = mod._evaluate(["ci"], contexts)
    assert status == "fail"
    assert failed == ["ci: status=in_progress"]


def test_evaluate_check_run_completed_not_success() -> None:
    contexts = {
        "ci": {"state": "completed", "conclusion": "failure", "source": "check_run"}
    }
    _, _, failed = mod._evaluate(["ci"], contexts)
    assert failed == ["ci: conclusion=failure"]


def test_evaluate_check_run_success() -> None:
    contexts = {
        "ci": {"state": "completed", "conclusion": "success", "source": "check_run"}
    }
    status, missing, failed = mod._evaluate(["ci"], contexts)
    assert status == "pass"
    assert (missing, failed) == ([], [])


def test_evaluate_status_source_failure() -> None:
    contexts = {"ci": {"conclusion": "pending", "source": "status"}}
    _, _, failed = mod._evaluate(["ci"], contexts)
    assert failed == ["ci: state=pending"]


def test_evaluate_status_source_success() -> None:
    contexts = {"ci": {"conclusion": "success", "source": "status"}}
    status, _, failed = mod._evaluate(["ci"], contexts)
    assert status == "pass"
    assert failed == []


# ── _render_md ───────────────────────────────────────────────────────────────
def test_render_md_with_missing_and_failed() -> None:
    out = mod._render_md(
        {
            "status": "fail",
            "repo": "o/r",
            "sha": "abc",
            "timestamp_utc": "T",
            "missing": ["m"],
            "failed": ["f: conclusion=failure"],
        }
    )
    assert "`m`" in out
    assert "- f: conclusion=failure" in out


def test_render_md_none() -> None:
    out = mod._render_md(
        {
            "status": "pass",
            "repo": "o/r",
            "sha": "abc",
            "timestamp_utc": "T",
            "missing": [],
            "failed": [],
        }
    )
    assert "## Missing contexts\n- None" in out
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
        "--repo",
        "o/r",
        "--sha",
        "abc",
        "--required-context",
        "ci",
        "--out-json",
        str(tmp_path / "r.json"),
        "--out-md",
        str(tmp_path / "r.md"),
        *extra,
    ]


def test_main_no_required_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setattr(mod.sys, "argv", ["prog", "--repo", "o/r", "--sha", "abc"])
    with pytest.raises(SystemExit, match="At least one --required-context"):
        mod.main()


def test_main_no_token_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    with pytest.raises(SystemExit, match="GITHUB_TOKEN or GH_TOKEN"):
        mod.main()


def _run_check(state: str, conclusion: str) -> FakeResponse:
    return FakeResponse(
        {"check_runs": [{"name": "ci", "status": state, "conclusion": conclusion}]}
    )


def test_main_pass_first_poll(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    # check-runs (success) + status (empty) -> pass -> break immediately.
    fake = make_urlopen(
        [_run_check("completed", "success"), FakeResponse({"statuses": []})]
    )
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 0
    assert "Status: `pass`" in capsys.readouterr().out


def test_main_settled_failure_breaks_without_sleep(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GH_TOKEN", "t")
    # check-run completed+failure -> not pass, but settled (not in_progress) and
    # nothing missing -> break without sleeping.
    fake = make_urlopen(
        [_run_check("completed", "failure"), FakeResponse({"statuses": []})]
    )
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path))
    assert mod.main() == 1


def test_main_polls_then_passes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    # Poll 1: ci in_progress -> not pass, in_progress -> sleep + loop.
    # Poll 2: ci success -> pass -> break.
    fake = make_urlopen(
        [
            _run_check("in_progress", ""),
            FakeResponse({"statuses": []}),
            _run_check("completed", "success"),
            FakeResponse({"statuses": []}),
        ]
    )
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    slept: list[int] = []
    monkeypatch.setattr(mod.time, "sleep", lambda s: slept.append(s))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--poll-seconds", "1"))
    assert mod.main() == 0
    assert slept == [1]


def test_main_times_out(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    # Deadline already passed on the first time.time() check after setup ->
    # the while-loop body never runs; final_payload stays None -> SystemExit.
    times = iter([0.0, 100.0])  # deadline=0+timeout; second read exceeds it
    monkeypatch.setattr(mod.time, "time", lambda: next(times))
    monkeypatch.setattr(mod.sys, "argv", _argv(tmp_path, "--timeout-seconds", "1"))
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit, match="No payload collected"):
        mod.main()


def test_main_bad_output_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    fake = make_urlopen(
        [_run_check("completed", "success"), FakeResponse({"statuses": []})]
    )
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        mod.sys,
        "argv",
        [
            "prog",
            "--repo",
            "o/r",
            "--sha",
            "abc",
            "--required-context",
            "ci",
            "--out-json",
            "../escape.json",
            "--out-md",
            "ok.md",
        ],
    )
    assert mod.main() == 1
    assert "escapes workspace root" in capsys.readouterr().err
