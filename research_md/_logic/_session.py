"""CLI session boot — auto-register projects from filesystem before any tool call.

The MCP server kept a long-lived in-memory GUID → path map; a fresh CLI
subprocess does not. ``boot_from_cwd()`` scans CWD (and optionally a passed
path) for ``.research/research.json`` OR ``.eidos/research/research.json``,
registers every project + subproject it finds, and is safe to call repeatedly.

When called from inside an eidos (``<eidos_home>/.eidos/research/`` exists),
research-md respects the eidos's storage layout. When called standalone
(``<repo>/.research/`` exists), it uses the legacy layout. This is the
"eidos-aware but eidos-not-required" property per THE-EIDOS doctrine.
"""

from __future__ import annotations

import os
from pathlib import Path

from .. import config as _cfg
from ..config import _is_root, load_config, register_project


def _walk_up_for_research(start: Path) -> Path | None:
    """Walk up looking for a research project, eidos-aware or legacy."""
    cur = start.resolve()
    while True:
        # Honor whatever CONFIG_DIR is set to (eidos-cli may have patched
        # it to .eidos/research; otherwise it's the legacy .research).
        if (cur / _cfg.CONFIG_DIR / "research.json").is_file():
            return cur
        # Also explicitly check eidos-aware path so standalone research-md
        # inside an eidos finds the right project.
        if (cur / ".eidos" / "research" / "research.json").is_file():
            _cfg.CONFIG_DIR = ".eidos/research"
            return cur
        if cur.parent == cur:
            return None
        cur = cur.parent


def boot_from_cwd(path: str | None = None) -> None:
    """Register any research project rooted at ``path`` (default: walked-up from CWD).

    Safe to call repeatedly — register_project is idempotent.
    """
    if path is not None:
        root = Path(path).resolve()
    else:
        cwd = Path.cwd()
        found = _walk_up_for_research(cwd)
        if found is None:
            return
        root = found

    if not (root / _cfg.CONFIG_DIR / "research.json").is_file():
        return

    try:
        register_project(str(root))
    except Exception:
        return

    config = load_config(str(root))
    if config and _is_root(config):
        for sub in config.get("projects", []):
            sub_path = os.path.join(str(root), sub)
            if (Path(sub_path) / _cfg.CONFIG_DIR / "research.json").is_file():
                try:
                    register_project(sub_path)
                except Exception:
                    pass
