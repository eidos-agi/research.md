"""Project lifecycle: set, get, init, status, decide, supersede."""

from __future__ import annotations

import os
import re

from ..config import (
    advance_phase,
    init_project,
    init_root,
    init_subproject,
    list_registered,
    load_config,
    register_project,
    require_phase,
)
from ..files import (
    list_candidates,
    list_findings,
    load_decision_criteria,
    peer_review_exists,
)
from ..integrity import check_integrity
from ._common import format_finding_status, get_project, today


def project_set(path: str) -> str:
    """Register a research project for this session. Call this first — reads .research/research.json at the given path and registers its GUID. Also registers all subprojects if it's a root."""
    info = register_project(path)
    lines = [f"Registered: {path}", f"ID: {info['id']}", f"Name: {info['projectName']}"]
    if info.get("question"):
        lines.append(f"\n**Question:** {info['question']}")
    if info.get("context"):
        lines.append(f"\n**Context:**\n{info['context']}")
    if info.get("isRoot"):
        lines.append(
            f"\nThis is a multi-project root with {len(info['projects'])} subproject(s)."
        )
        lines.append(
            "Subprojects also registered. Read each subproject's research-md.json for its research_id."
        )
        lines.append(f"\nSubprojects: {', '.join(info['projects'])}")
    lines.append("\nUse the 'id' field as research_id on all subsequent tool calls.")
    return "\n".join(lines)


def project_get() -> str:
    """Show all registered research projects in this session."""
    registered = list_registered()
    if not registered:
        return "No projects registered this session. Use `project_set` with a project path."
    lines = [f"{r['id']} → {r['path']}" for r in registered]
    return "\n".join(["Registered projects:", "", *lines])


def project_init(
    path: str,
    name: str | None = None,
    root: bool = False,
    subproject: str | None = None,
    question: str | None = None,
    context: str | None = None,
) -> str:
    """Initialize a new research project with folder structure and GUID."""
    if root:
        init_root(path)
        config = load_config(path)
        return f"Multi-project root initialized at {path}\nID: {config['id'] if config else 'unknown'}\n\nUse init with 'subproject' to add research projects."

    if subproject:
        init_subproject(path, subproject, question, context)
        sub_config = load_config(os.path.join(path, subproject))
        warnings = []
        if not question:
            warnings.append("WARNING: No research question provided.")
        if not context:
            warnings.append("WARNING: No context brief provided.")
        warn_text = "\n\n" + "\n".join(warnings) if warnings else ""
        return f"Subproject '{subproject}' initialized at {path}/{subproject}\nID: {sub_config['id'] if sub_config else 'unknown'}\n\nFolders: .research/findings/ .research/candidates/ .research/evaluations/{warn_text}"

    init_project(path, name, question, context)
    config = load_config(path)
    warnings = []
    if not question:
        warnings.append(
            "WARNING: No research question provided. Future sessions won't know what this research is about."
        )
    if not context:
        warnings.append(
            "WARNING: No context brief provided. Future sessions will lack the background needed to continue this research."
        )
    warn_text = "\n\n" + "\n".join(warnings) if warnings else ""
    return f"Research project initialized at {path}\nID: {config['id'] if config else 'unknown'}\n\nAll artifacts stored under .research/{warn_text}"


def status(research_id: str) -> str:
    """Show project health: criteria locked, peer review, TBD count, findings, candidates."""
    resolved = get_project(research_id)
    root = resolved.projectRoot
    pc = resolved.config
    findings = list_findings(root)
    candidates = list_candidates(root)
    criteria = load_decision_criteria(root)
    has_peer_review = peer_review_exists(root)
    tbd_count = sum(len(re.findall(r"_TBD_", c.content)) for c in candidates)

    lines = [
        f"## {pc['projectName']} — Research Status",
        "",
    ]
    if pc.get("question"):
        lines.extend([f"**Question:** {pc['question']}", ""])
    if pc.get("context"):
        lines.extend(["**Context:**", pc["context"], ""])

    lines.extend(
        [
            f"**Phase:** {pc['phase']}",
            f"**Criteria locked:** {'Yes (' + str(criteria.frontmatter.get('locked_date', '')) + ')' if criteria and criteria.frontmatter.get('locked') else 'No'}",
            f"**Peer review logged:** {'Yes' if has_peer_review else 'No'}",
            f"**TBD items remaining:** {tbd_count}",
            "",
            f"**Findings ({len(findings)}):**",
            *[format_finding_status(f) for f in findings],
            "",
            f"**Candidates ({len(candidates)}):**",
            *[
                f"  {c.frontmatter['title']} — {c.frontmatter['verdict']}"
                for c in candidates
            ],
            "",
            "**Phase history:**",
            *[
                f"  {t['date']} → {t['phase']}{' (' + t['note'] + ')' if t.get('note') else ''}"
                for t in pc["transitions"]
            ],
        ]
    )

    issues = check_integrity(root, pc)
    if issues:
        lines.extend(["", "**Integrity issues:**"])
        for issue in issues:
            icon = "ERROR" if issue["severity"] == "error" else "WARNING"
            lines.append(f"  [{icon}] {issue['message']}")
    else:
        lines.extend(["", "**Integrity:** All checks passed."])

    return "\n".join(lines)


def project_decide(
    research_id: str, decision: str, rationale: str, adr_reference: str = ""
) -> str:
    """Record a decision. Advances project to 'decided' phase. Requires 'scored' phase or later."""
    resolved = get_project(research_id)
    root = resolved.projectRoot
    require_phase(resolved.config, "scored", "record a decision")

    decisions_dir = os.path.join(root, "decisions")
    updated_files = []
    if os.path.exists(decisions_dir):
        for df in os.listdir(decisions_dir):
            if df.endswith(".md") and df.lower() != "readme.md":
                fp = os.path.join(decisions_dir, df)
                content = open(fp).read()
                changed = False
                if "Under Research" in content or "Status: Draft" in content:
                    content = content.replace("Under Research", "Decided").replace(
                        "Status: Draft", "Status: Decided"
                    )
                    changed = True
                if (
                    "_To be written after scoring matrix is complete._" in content
                    or "_To be written after decision is made._" in content
                ):
                    content = re.sub(
                        r"## Decision\n\n_To be written[^_]*_",
                        f"## Decision\n\n{decision}"
                        + (
                            f"\n\nSee {adr_reference} for the full decision record."
                            if adr_reference
                            else ""
                        ),
                        content,
                    )
                    changed = True
                if "_To be written after decision is made._" in content:
                    content = re.sub(
                        r"## Consequences\n\n_To be written[^_]*_",
                        f"## Consequences\n\n{rationale}",
                        content,
                    )
                    changed = True
                content = content.replace("**Date:** _TBD_", f"**Date:** {today()}")
                if changed:
                    with open(fp, "w") as f:
                        f.write(content)
                    updated_files.append(df)

    summary = "\n".join(
        [
            "# Decision",
            "",
            f"**Date:** {today()}",
            "**Status:** Decided",
            *([f"**ADR:** {adr_reference}"] if adr_reference else []),
            "",
            "## Decision",
            "",
            decision,
            "",
            "## Rationale",
            "",
            rationale,
        ]
    )
    decision_path = os.path.join(root, ".research", "DECISION.md")
    with open(decision_path, "w") as f:
        f.write(summary + "\n")

    advance_phase(root, "decided", decision[:100])

    response = ["Decision recorded. Phase → decided", ""]
    if updated_files:
        response.append(f"Updated existing decision files: {', '.join(updated_files)}")
    response.extend(["Wrote .research/DECISION.md", "", decision])
    return "\n".join(response)


def project_supersede(research_id: str, superseded_by: str) -> str:
    """Mark a decided project as superseded by a later decision."""
    resolved = get_project(research_id)
    require_phase(resolved.config, "decided", "supersede a decision")
    advance_phase(resolved.projectRoot, "superseded", f"Superseded by {superseded_by}")
    return f"Project marked as superseded by {superseded_by}. Phase → superseded"
