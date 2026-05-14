"""CLI session boot — auto-register projects from filesystem before any tool call.

The MCP server kept a long-lived in-memory GUID → path map; a fresh CLI
subprocess does not. ``boot_from_cwd()`` scans CWD (and optionally a passed
path) for ``.research/research.json``, registers every project + subproject
it finds, and is safe to call repeatedly.
"""

from __future__ import annotations

import os
from pathlib import Path

from ..config import _is_root, load_config, register_project


def _walk_up_for_research(start: Path) -> Path | None:
    """Walk up from start looking for a directory containing .research/research.json."""
    cur = start.resolve()
    while True:
        if (cur / ".research" / "research.json").is_file():
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

    if not (root / ".research" / "research.json").is_file():
        return

    try:
        register_project(str(root))
    except Exception:
        return

    config = load_config(str(root))
    if config and _is_root(config):
        for sub in config.get("projects", []):
            sub_path = os.path.join(str(root), sub)
            if (Path(sub_path) / ".research" / "research.json").is_file():
                try:
                    register_project(sub_path)
                except Exception:
                    pass
