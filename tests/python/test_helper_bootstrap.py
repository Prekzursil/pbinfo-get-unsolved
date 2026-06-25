"""Cover the import-time ``sys.path`` bootstrap in the helper-importing scripts.

Each of ``check_codacy_zero`` / ``check_deepscan_zero`` / ``check_sentry_zero`` /
``check_sonar_zero`` opens with an identical bootstrap that inserts the helper
root (the ``scripts`` dir) onto ``sys.path`` so ``security_helpers`` resolves
when the script is run standalone. conftest imports these once before coverage
tracing settles, so we force a *fresh* import here (under active coverage) to
exercise both sides of the ``if str(_HELPER_ROOT) not in sys.path`` branch.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

_SCRIPTS = str(Path(__file__).resolve().parents[2] / "scripts")

_MODULES = [
    "check_codacy_zero",
    "check_deepscan_zero",
    "check_sentry_zero",
    "check_sonar_zero",
]


@pytest.mark.parametrize("mod_name", _MODULES)
def test_bootstrap_inserts_helper_root_when_absent(mod_name: str) -> None:
    # Drop the cached module AND remove ``scripts`` from sys.path so the
    # bootstrap takes the "not in sys.path -> insert" (True) branch on re-import.
    sys.modules.pop(mod_name, None)
    saved = list(sys.path)
    try:
        while _SCRIPTS in sys.path:
            sys.path.remove(_SCRIPTS)
        reloaded = importlib.import_module(mod_name)
        assert _SCRIPTS in sys.path  # the bootstrap re-added it
        assert hasattr(reloaded, "main")
    finally:
        sys.path[:] = saved


@pytest.mark.parametrize("mod_name", _MODULES)
def test_bootstrap_skips_when_already_present(mod_name: str) -> None:
    # With ``scripts`` already on sys.path, re-import takes the "already present
    # -> skip insert" (False) branch.
    sys.modules.pop(mod_name, None)
    if _SCRIPTS not in sys.path:
        sys.path.insert(0, _SCRIPTS)
    reloaded = importlib.import_module(mod_name)
    assert hasattr(reloaded, "main")
