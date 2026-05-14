"""Candidate CRUD + claim management + scoring."""

from __future__ import annotations

import os
import re

from ..config import advance_phase, require_phase
from ..errors import ResearchGateError, ResearchNotFoundError, ResearchValidationError
from ..files import (
    candidate_path,
    list_candidates,
    peer_review_path,
    read_markdown,
    write_markdown,
)
from ..gates import run_scoring_gates
from ..security import sanitize_slug
from ._common import get_project


def candidate_create(
    research_id: str,
    title: str,
    slug: str | None = None,
    description: str | None = None,
) -> str:
    """Create a new candidate for evaluation."""
    resolved = get_project(research_id)
    s = sanitize_slug(slug or title)
    fp = candidate_path(resolved.projectRoot, s)

    if os.path.exists(fp):
        raise ResearchValidationError(f"Candidate '{s}' already exists.")

    desc = description or "_No description provided._"
    frontmatter = {"title": title, "verdict": "provisional"}
    content = f"\n## What It Is\n\n{desc}\n\n## Validation Checklist\n\n- [ ] Claim 1: _TBD_\n\n## Scoring\n\n_Not yet scored._\n"

    write_markdown(fp, frontmatter, content)

    result = f"Candidate created: candidates/{s}.md"

    existing = list_candidates(resolved.projectRoot)
    if len(existing) <= 1:
        result += (
            "\n\n💡 This is the first candidate. Before evaluating options, have you documented "
            "the full landscape? Consider a finding tagged 'landscape' listing all known "
            "alternatives — including ones you've decided not to evaluate — so the research "
            "record shows the aperture was wide before narrowing."
        )

    return result


def candidate_list(research_id: str) -> str:
    """List all candidates with verdict status."""
    resolved = get_project(research_id)
    candidates = list_candidates(resolved.projectRoot)
    if not candidates:
        return "No candidates yet."
    rows = [
        f"{c.frontmatter['verdict']:<12} | {c.frontmatter['title']}" for c in candidates
    ]
    return "\n".join(["Verdict       | Title", "------------- | -----", *rows])


def candidate_update(
    research_id: str,
    slug: str,
    verdict: str | None = None,
    description: str | None = None,
) -> str:
    """Update a candidate's verdict and/or description."""
    resolved = get_project(research_id)
    fp = candidate_path(resolved.projectRoot, slug)
    if not os.path.exists(fp):
        raise ResearchNotFoundError("Candidate", slug)

    parsed = read_markdown(fp)
    updated = {**parsed.frontmatter}
    if verdict:
        updated["verdict"] = verdict

    content = parsed.content
    if description:
        content = re.sub(
            r"(## What It Is\n\n)[\s\S]*?\n\n(## )",
            rf"\g<1>{description}\n\n\g<2>",
            content,
        )

    write_markdown(fp, updated, content)
    changes = []
    if verdict:
        changes.append(f"verdict → {verdict}")
    if description:
        changes.append("description updated")
    return f"Candidate '{slug}' updated: {', '.join(changes)}."


def candidate_add_claim(research_id: str, slug: str, claim: str) -> str:
    """Add a binary testable claim to a candidate's validation checklist."""
    resolved = get_project(research_id)
    fp = candidate_path(resolved.projectRoot, slug)
    if not os.path.exists(fp):
        raise ResearchNotFoundError("Candidate", slug)

    parsed = read_markdown(fp)
    new_content = re.sub(
        r"(## Validation Checklist\n)([\s\S]*?)(## Scoring)",
        lambda m: (
            f"{m.group(1)}{m.group(2).rstrip()}\n- [ ] {claim}: _TBD_\n\n{m.group(3)}"
        ),
        parsed.content,
    )
    write_markdown(fp, parsed.frontmatter, new_content)
    return f"Claim added to '{slug}'."


def candidate_resolve_claim(
    research_id: str, slug: str, claim_index: int, result: str
) -> str:
    """Mark a validation claim Y or N (clears _TBD_)."""
    resolved = get_project(research_id)
    fp = candidate_path(resolved.projectRoot, slug)
    if not os.path.exists(fp):
        raise ResearchNotFoundError("Candidate", slug)

    parsed = read_markdown(fp)
    count = [0]
    original = parsed.content

    def replacer(m):
        count[0] += 1
        if count[0] == claim_index:
            mark = "x" if result == "Y" else " "
            return f"- [{mark}] {m.group(1)}: {result}"
        return m.group(0)

    new_content = re.sub(r"- \[ \] (.+?): _TBD_", replacer, parsed.content)

    if new_content == original:
        raise ResearchNotFoundError("Claim", str(claim_index))

    write_markdown(fp, parsed.frontmatter, new_content)
    return f"Claim {claim_index} in '{slug}' marked {result}."


def candidate_score(research_id: str, slug: str, scores: dict, notes: str = "") -> str:
    """Score a candidate. Fails if criteria not locked, peer review missing, or _TBD_ items remain."""
    resolved = get_project(research_id)
    root = resolved.projectRoot
    require_phase(resolved.config, "reviewed", "score candidates")

    gate_result = run_scoring_gates(root, slug)
    if not gate_result["passed"]:
        raise ResearchGateError(gate_result["error"])

    review_file = peer_review_path(root)
    if os.path.exists(review_file):
        review_content = open(review_file).read()
        if "DISPUTED" in review_content:
            disputed = re.findall(r"\*\*(\w+-?\d*)\*\*:\s*DISPUTED", review_content)
            if disputed:
                ids = ", ".join(disputed)
                raise ResearchGateError(
                    f"Scoring blocked: {len(disputed)} finding(s) have DISPUTED attestations ({ids}). "
                    "Resolve disputes before scoring — either fix the finding, change its evidence grade, or re-review."
                )

    fp = candidate_path(root, slug)
    parsed = read_markdown(fp)
    total = sum(scores.values())
    score_lines = "\n".join(f"| {c} | {s}/10 |" for c, s in scores.items())
    notes_section = f"\n**Notes:** {notes}\n" if notes else ""
    scoring_section = f"\n## Scores\n\n| Criterion | Score |\n|-----------|-------|\n{score_lines}\n| **Total** | **{total}** |\n{notes_section}"

    new_content = re.sub(
        r"## Scoring[\s\S]*", f"## Scoring{scoring_section}", parsed.content
    )
    write_markdown(fp, parsed.frontmatter, new_content)

    try:
        advance_phase(root, "scored", f"Scored candidate: {slug}")
    except Exception:
        pass

    return f"Scored '{slug}'. Total: {total}\n" + "\n".join(
        f"  {k}: {v}" for k, v in scores.items()
    )
