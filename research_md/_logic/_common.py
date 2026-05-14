"""Helpers shared across logic modules — date, GUID resolution, formatting."""

from __future__ import annotations

from datetime import date

from ..config import (
    _guid_to_path,
    _is_root,
    load_config,
    resolve_by_guid,
)
from ..errors import ResearchNotFoundError, ResearchValidationError


def today() -> str:
    return date.today().isoformat()


def get_project(research_id):
    if not research_id or not isinstance(research_id, str):
        raise ResearchValidationError(
            "Missing required parameter: research_id. "
            "Read the project's research-md.json file to find the 'id' field (a UUID). "
            "If the project hasn't been registered this session, call `project_set` with its path first."
        )
    project_path = _guid_to_path.get(research_id)
    if not project_path:
        raise ResearchValidationError(
            f"Unknown research_id '{research_id}'. This project hasn't been registered in this session. "
            "Call `project_set` with the project's path to register it. "
            "The research_id is the 'id' field in the project's research-md.json."
        )
    resolved = resolve_by_guid(research_id)
    if not resolved:
        config = load_config(project_path)
        if config and _is_root(config):
            projects = config.get("projects", [])
            raise ResearchValidationError(
                f"research_id '{research_id}' points to a multi-project root, not a specific project. "
                f"Use the research_id of one of its subprojects: {', '.join(projects)}. "
                "Read each subproject's research-md.json to find its id."
            )
        raise ResearchNotFoundError("Project", research_id)
    return resolved


def format_finding_status(f) -> str:
    """Format a single finding for status display, with evidence gate warnings."""
    from ..gates import run_evidence_gates

    fm = f.frontmatter
    base = f"  {fm['id']} [{fm['status']}] [{fm['evidence']}] {fm['title']}"
    if fm.get("evidence") == "CONFIRMED":
        gate = run_evidence_gates(fm)
        if not gate["passed"]:
            base += " ⚠ GATE FAIL"
    sources = fm.get("sources", 0)
    src_count = (
        len(sources)
        if isinstance(sources, list)
        else (sources if isinstance(sources, int) else 0)
    )
    if isinstance(sources, list) and src_count > 0:
        base += f" ({src_count} sources)"
    return base
