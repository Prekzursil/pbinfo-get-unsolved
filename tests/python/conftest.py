"""Shared pytest fixtures/path bootstrap for the Python quality-script tests.

The quality scripts live in ``scripts/`` and ``scripts/quality/`` and import the
shared ``security_helpers`` module via a runtime ``sys.path`` bootstrap. We add
both directories to ``sys.path`` here so the test modules can import the scripts
directly (mirroring ``[tool.pytest.ini_options] pythonpath`` for editors/tools
that do not read it).
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Only ``scripts/quality`` is bootstrapped here so the quality modules are
# importable by name. We deliberately do NOT add ``scripts`` to sys.path: each
# quality module's own runtime bootstrap inserts the helper root (``scripts``)
# the first time it is imported, which keeps that bootstrap branch exercised
# under coverage. ``security_helpers`` becomes importable as a side effect of
# importing the first quality module.
_QUALITY = str(_REPO_ROOT / "scripts" / "quality")
if _QUALITY not in sys.path:
    sys.path.insert(0, _QUALITY)

# Import one quality module eagerly so its bootstrap puts ``scripts`` on the path
# before any test (incl. the standalone security_helpers test) needs it.
import check_codacy_zero as _bootstrap  # noqa: E402,F401
