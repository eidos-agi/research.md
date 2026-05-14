"""Finding CRUD: create, list, update."""

from __future__ import annotations

import re

from ..errors import ResearchGateError, ResearchNotFoundError, ResearchValidationError
from ..files import (
    finding_path,
    list_findings,
    next_finding_id,
    write_markdown,
)
from ..gates import gate_vendor_only_advisory, run_evidence_gates
from ..security import sanitize_slug
from ._common import get_project, today


def finding_create(
    research_id: str,
    title: str,
    claim: str,
    evidence: str = "UNVERIFIED",
    source: str = "unspecified",
    sources: list[dict] | None = None,
    disconfirmation: str | None = None,
) -> str:
    """Create a new finding with evidence grade and source."""
    resolved = get_project(research_id)
    root = resolved.projectRoot

    source_entries = sources or []
    if not source_entries and source != "unspecified":
        source_entries = [{"text": source, "tier": "SECONDARY"}]

    all_source_texts = (
        " ".join(s.get("text", "") for s in source_entries)
        if source_entries
        else source
    )
    if (
        evidence in ("CONFIRMED", "REASONED")
        and "content_hash:" not in all_source_texts
    ):
        raise ResearchValidationError(
            f'Evidence grade "{evidence}" requires proof of source consultation. '
            "Include a content_hash in your source field to prove you fetched and read the source material. "
            'Format: "<url_or_description> (content_hash:<first_8_chars_of_sha256>)"\n\n'
            "To compute: fetch the URL content, SHA256 hash it, include the first 8 hex chars.\n"
            'If your evidence is based on reasoning rather than a fetched source, use evidence: "LOW" or "UNVERIFIED" instead.'
        )

    frontmatter_preview = {
        "evidence": evidence,
        "sources": source_entries,
        "disconfirmation": disconfirmation,
    }
    gate_result = run_evidence_gates(frontmatter_preview)
    if not gate_result["passed"]:
        raise ResearchGateError(gate_result["error"])

    fid = next_finding_id(root)
    slug = sanitize_slug(title)
    fp = finding_path(root, fid, slug)

    frontmatter = {
        "id": fid,
        "title": title,
        "status": "open",
        "evidence": evidence,
        "sources": source_entries
        if source_entries
        else (0 if source == "unspecified" else 1),
        "disconfirmation": disconfirmation,
        "created": today(),
    }

    if source_entries:
        evidence_lines = []
        for s in source_entries:
            tier_tag = f" [{s.get('tier', 'SECONDARY')}]" if s.get("tier") else ""
            evidence_lines.append(
                f"> **Source{tier_tag}:** {s['text']}, retrieved {today()}"
            )
        evidence_text = "\n>\n".join(evidence_lines)
    else:
        evidence_text = f"> **Evidence: [{evidence}]** — {source}, retrieved {today()}"

    disconfirmation_section = ""
    if disconfirmation:
        disconfirmation_section = f"\n\n## Disconfirmation Search\n\n{disconfirmation}"

    content = f"\n## Claim\n\n{claim}\n\n## Supporting Evidence\n\n{evidence_text}{disconfirmation_section}\n\n## Caveats\n\nNone identified yet.\n"

    write_markdown(fp, frontmatter, content)

    advisories = []
    vendor_warning = gate_vendor_only_advisory(frontmatter)
    if vendor_warning:
        advisories.append(vendor_warning)

    result = (
        f"Finding created: findings/{fid}-{slug}.md\nID: {fid} | Evidence: {evidence}"
    )

    if not source_entries and evidence in ("UNVERIFIED", "LOW"):
        advisories.append(
            "This finding has no sources yet. Use WebSearch and WebFetch to find "
            "supporting evidence, then call finding_update with a sources array to "
            "strengthen the evidence grade. Research findings should be grounded in "
            "web research, not just reasoning."
        )

    if advisories:
        result += "\n\n" + "\n".join(f"⚠ {a}" for a in advisories)
    return result


def finding_list(research_id: str) -> str:
    """List all findings with status and evidence grade."""
    resolved = get_project(research_id)
    findings = list_findings(resolved.projectRoot)
    if not findings:
        return "No findings yet."
    rows = [
        f"{f.frontmatter['id']} | {f.frontmatter['status']:<10} | {f.frontmatter['evidence']:<10} | {f.frontmatter['title']}"
        for f in findings
    ]
    return "\n".join(
        [
            "ID   | Status     | Evidence   | Title",
            "---- | ---------- | ---------- | -----",
            *rows,
        ]
    )


def finding_update(
    research_id: str,
    id: str,
    status: str | None = None,
    evidence: str | None = None,
    claim: str | None = None,
    sources: list[dict] | None = None,
    disconfirmation: str | None = None,
) -> str:
    """Update a finding's status, evidence grade, claim, sources, or disconfirmation."""
    resolved = get_project(research_id)
    padded_id = id.zfill(4)
    findings = list_findings(resolved.projectRoot)
    finding = next((f for f in findings if f.frontmatter["id"] == padded_id), None)
    if not finding:
        raise ResearchNotFoundError("Finding", padded_id)

    updated = {**finding.frontmatter}
    if status:
        updated["status"] = status
    if evidence:
        updated["evidence"] = evidence
    if sources is not None:
        updated["sources"] = sources
    if disconfirmation is not None:
        updated["disconfirmation"] = disconfirmation

    target_evidence = updated.get("evidence", "UNVERIFIED")
    if target_evidence in ("CONFIRMED", "REASONED"):
        gate_result = run_evidence_gates(updated)
        if not gate_result["passed"]:
            raise ResearchGateError(gate_result["error"])

    content = finding.content
    if claim:
        content = re.sub(
            r"## Claim\n\n[\s\S]*?\n\n## Supporting",
            f"## Claim\n\n{claim}\n\n## Supporting",
            content,
        )

    if disconfirmation is not None:
        if "## Disconfirmation Search" in content:
            content = re.sub(
                r"## Disconfirmation Search\n\n[\s\S]*?(?=\n\n## |\Z)",
                f"## Disconfirmation Search\n\n{disconfirmation}",
                content,
            )
        else:
            if "## Caveats" in content:
                content = content.replace(
                    "## Caveats",
                    f"## Disconfirmation Search\n\n{disconfirmation}\n\n## Caveats",
                )
            else:
                content += f"\n\n## Disconfirmation Search\n\n{disconfirmation}\n"

    write_markdown(finding.filePath, updated, content)

    advisories = []
    vendor_warning = gate_vendor_only_advisory(updated)
    if vendor_warning:
        advisories.append(vendor_warning)

    result = f"Finding {padded_id} updated."

    updated_sources = updated.get("sources", 0)
    has_sources = (isinstance(updated_sources, list) and len(updated_sources) > 0) or (
        isinstance(updated_sources, int) and updated_sources > 0
    )
    if not has_sources and target_evidence in ("UNVERIFIED", "LOW"):
        advisories.append(
            "This finding still has no sources. Use WebSearch and WebFetch to find "
            "supporting evidence, then call finding_update with a sources array."
        )

    if advisories:
        result += "\n\n" + "\n".join(f"⚠ {a}" for a in advisories)
    return result
