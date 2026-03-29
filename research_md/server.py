"""research.md MCP server — all 20 tools."""

import os
import re
from datetime import date
from mcp.server.fastmcp import FastMCP

from .config import (
    resolve_by_guid, load_config, init_project, init_subproject, init_root,
    register_project, list_registered, advance_phase, require_phase,
    _guid_to_path, _is_root, PHASE_ORDER,
)
from .security import sanitize_slug
from .errors import (
    ResearchNotFoundError, ResearchGateError, ResearchValidationError, format_error,
)
from .files import (
    list_findings, next_finding_id, finding_path, read_markdown, write_markdown,
    list_candidates, candidate_path, load_decision_criteria, decision_criteria_path,
    peer_review_path, peer_review_exists, scoring_matrix_path, extract_section,
)
from .gates import run_scoring_gates, run_evidence_gates, gate_vendor_only_advisory
from .integrity import check_integrity

INSTRUCTIONS = """research.md is the decision forge — evidence-graded, phase-gated, peer-reviewed decisions.

Use it when a question has consequences: architecture choices, technology selections, strategic bets, anything that will become a contract in visionlog. Do not make consequential decisions in conversation. Run them through research.md so the evidence is recorded, the criteria are locked, and the decision is reviewable by any future agent or human.

Call project_set first to register the project GUID for this session. Every subsequent tool call takes that GUID.

The trilogy:
- research.md: decide with evidence — this is where decisions are earned
- visionlog: records the decision as an ADR and contract — what all execution must honor
- ike.md: executes tasks within those contracts

The flow is one-way: research.md feeds visionlog, visionlog feeds ike.md. A decision skipped here is a contract that was never earned."""

mcp = FastMCP("research-md", instructions=INSTRUCTIONS)


def _today() -> str:
    return date.today().isoformat()


def _get_project(research_id):
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


def _format_finding_status(f) -> str:
    """Format a single finding for status display, with evidence gate warnings."""
    fm = f.frontmatter
    base = f"  {fm['id']} [{fm['status']}] [{fm['evidence']}] {fm['title']}"
    if fm.get("evidence") == "HIGH":
        from .gates import run_evidence_gates
        gate = run_evidence_gates(fm)
        if not gate["passed"]:
            base += " ⚠ GATE FAIL"
    sources = fm.get("sources", 0)
    src_count = len(sources) if isinstance(sources, list) else (sources if isinstance(sources, int) else 0)
    if isinstance(sources, list) and src_count > 0:
        base += f" ({src_count} sources)"
    return base


# ── Projects ──────────────────────────────────────────────────────────────────

@mcp.tool()
def project_set(path: str) -> str:
    """Register a research project for this session. Call this first — reads .research/research.json at the given path and registers its GUID. Also registers all subprojects if it's a root."""
    info = register_project(path)
    lines = [f"Registered: {path}", f"ID: {info['id']}", f"Name: {info['projectName']}"]
    if info.get("question"):
        lines.append(f"\n**Question:** {info['question']}")
    if info.get("context"):
        lines.append(f"\n**Context:**\n{info['context']}")
    if info.get("isRoot"):
        lines.append(f"\nThis is a multi-project root with {len(info['projects'])} subproject(s).")
        lines.append("Subprojects also registered. Read each subproject's research-md.json for its research_id.")
        lines.append(f"\nSubprojects: {', '.join(info['projects'])}")
    lines.append("\nUse the 'id' field as research_id on all subsequent tool calls.")
    return "\n".join(lines)


@mcp.tool()
def project_get() -> str:
    """Show all registered research projects in this session."""
    registered = list_registered()
    if not registered:
        return "No projects registered this session. Use `project_set` with a project path."
    lines = [f"{r['id']} → {r['path']}" for r in registered]
    return "\n".join(["Registered projects:", "", *lines])


@mcp.tool()
def project_init(path: str, name: str | None = None, root: bool = False, subproject: str | None = None, question: str | None = None, context: str | None = None) -> str:
    """Initialize a new research project with folder structure and GUID. IMPORTANT: Always provide question and context — they are stored in .research/research.json so any future session can understand the research without prior conversation history."""
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
        warnings.append("WARNING: No research question provided. Future sessions won't know what this research is about.")
    if not context:
        warnings.append("WARNING: No context brief provided. Future sessions will lack the background needed to continue this research.")
    warn_text = "\n\n" + "\n".join(warnings) if warnings else ""
    return f"Research project initialized at {path}\nID: {config['id'] if config else 'unknown'}\n\nAll artifacts stored under .research/{warn_text}"


@mcp.tool()
def status(research_id: str) -> str:
    """Show project health: criteria locked, peer review, TBD count, findings, candidates."""
    resolved = _get_project(research_id)
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

    lines.extend([
        f"**Phase:** {pc['phase']}",
        f"**Criteria locked:** {'Yes (' + str(criteria.frontmatter.get('locked_date', '')) + ')' if criteria and criteria.frontmatter.get('locked') else 'No'}",
        f"**Peer review logged:** {'Yes' if has_peer_review else 'No'}",
        f"**TBD items remaining:** {tbd_count}",
        "",
        f"**Findings ({len(findings)}):**",
        *[_format_finding_status(f) for f in findings],
        "",
        f"**Candidates ({len(candidates)}):**",
        *[f"  {c.frontmatter['title']} — {c.frontmatter['verdict']}" for c in candidates],
        "",
        "**Phase history:**",
        *[f"  {t['date']} → {t['phase']}{' (' + t['note'] + ')' if t.get('note') else ''}" for t in pc["transitions"]],
    ])

    issues = check_integrity(root, pc)
    if issues:
        lines.extend(["", "**Integrity issues:**"])
        for issue in issues:
            icon = "ERROR" if issue["severity"] == "error" else "WARNING"
            lines.append(f"  [{icon}] {issue['message']}")
    else:
        lines.extend(["", "**Integrity:** All checks passed."])

    return "\n".join(lines)


# ── Findings ──────────────────────────────────────────────────────────────────

@mcp.tool()
def finding_create(
    research_id: str,
    title: str,
    claim: str,
    evidence: str = "UNVERIFIED",
    source: str = "unspecified",
    sources: list[dict] | None = None,
    disconfirmation: str | None = None,
) -> str:
    """Create a new finding with evidence grade and source.

    Args:
        research_id: Project GUID from .research/research.json 'id' field.
        title: Short title for the finding.
        claim: The factual claim this finding asserts.
        evidence: Evidence grade — HIGH (confirmed, 2+ sources + disconfirmation), MODERATE (credible, 1+ source with hash), LOW (single source), UNVERIFIED (not yet investigated).
        source: Legacy single-source string. Prefer 'sources' array for new findings.
        sources: Array of source objects: [{"text": "url or description (content_hash:abcd1234)", "tier": "PRIMARY|EXPERT|SECONDARY|VENDOR"}]. Required for HIGH evidence.
        disconfirmation: What you searched for to disprove this claim and what you found. Required for HIGH evidence.
    """
    resolved = _get_project(research_id)
    root = resolved.projectRoot

    # Build the sources list from either new array or legacy string
    source_entries = sources or []
    if not source_entries and source != "unspecified":
        source_entries = [{"text": source, "tier": "SECONDARY"}]

    # Layer 1: Evidence integrity — HIGH/MODERATE require proof of source consultation
    all_source_texts = " ".join(s.get("text", "") for s in source_entries) if source_entries else source
    if evidence in ("HIGH", "MODERATE") and "content_hash:" not in all_source_texts:
        raise ResearchValidationError(
            f'Evidence grade "{evidence}" requires proof of source consultation. '
            'Include a content_hash in your source field to prove you fetched and read the source material. '
            'Format: "<url_or_description> (content_hash:<first_8_chars_of_sha256>)"\n\n'
            'To compute: fetch the URL content, SHA256 hash it, include the first 8 hex chars.\n'
            'If your evidence is based on reasoning rather than a fetched source, use evidence: "LOW" or "UNVERIFIED" instead.'
        )

    # Layer 2: Evidence gates — HIGH requires triangulation + disconfirmation
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
        "id": fid, "title": title, "status": "open", "evidence": evidence,
        "sources": source_entries if source_entries else (0 if source == "unspecified" else 1),
        "disconfirmation": disconfirmation,
        "created": _today(),
    }

    # Build evidence section
    if source_entries:
        evidence_lines = []
        for s in source_entries:
            tier_tag = f" [{s.get('tier', 'SECONDARY')}]" if s.get("tier") else ""
            evidence_lines.append(f"> **Source{tier_tag}:** {s['text']}, retrieved {_today()}")
        evidence_text = "\n>\n".join(evidence_lines)
    else:
        evidence_text = f"> **Evidence: [{evidence}]** — {source}, retrieved {_today()}"

    disconfirmation_section = ""
    if disconfirmation:
        disconfirmation_section = f"\n\n## Disconfirmation Search\n\n{disconfirmation}"

    content = f"\n## Claim\n\n{claim}\n\n## Supporting Evidence\n\n{evidence_text}{disconfirmation_section}\n\n## Caveats\n\nNone identified yet.\n"

    write_markdown(fp, frontmatter, content)

    # Soft advisories
    advisories = []
    vendor_warning = gate_vendor_only_advisory(frontmatter)
    if vendor_warning:
        advisories.append(vendor_warning)

    result = f"Finding created: findings/{fid}-{slug}.md\nID: {fid} | Evidence: {evidence}"
    if advisories:
        result += "\n\n" + "\n".join(f"⚠ {a}" for a in advisories)
    return result


@mcp.tool()
def finding_list(research_id: str) -> str:
    """List all findings with status and evidence grade."""
    resolved = _get_project(research_id)
    findings = list_findings(resolved.projectRoot)
    if not findings:
        return "No findings yet."
    rows = [f"{f.frontmatter['id']} | {f.frontmatter['status']:<10} | {f.frontmatter['evidence']:<10} | {f.frontmatter['title']}" for f in findings]
    return "\n".join(["ID   | Status     | Evidence   | Title", "---- | ---------- | ---------- | -----", *rows])


@mcp.tool()
def finding_update(
    research_id: str,
    id: str,
    status: str | None = None,
    evidence: str | None = None,
    claim: str | None = None,
    sources: list[dict] | None = None,
    disconfirmation: str | None = None,
) -> str:
    """Update a finding's status, evidence grade, claim, sources, or disconfirmation.

    Args:
        research_id: Project GUID.
        id: Finding ID (e.g. "0001" or "1").
        status: New status (open, confirmed, refuted, superseded).
        evidence: New evidence grade (HIGH, MODERATE, LOW, UNVERIFIED). HIGH requires 2+ sources and a disconfirmation search.
        claim: Updated claim text.
        sources: Replace sources array: [{"text": "url (content_hash:abc12345)", "tier": "PRIMARY|EXPERT|SECONDARY|VENDOR"}].
        disconfirmation: What you searched for to disprove this claim and what you found.
    """
    resolved = _get_project(research_id)
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

    # Evidence gates — enforce when upgrading to HIGH
    target_evidence = updated.get("evidence", "UNVERIFIED")
    if target_evidence == "HIGH":
        gate_result = run_evidence_gates(updated)
        if not gate_result["passed"]:
            raise ResearchGateError(gate_result["error"])

    content = finding.content
    if claim:
        content = re.sub(r"## Claim\n\n[\s\S]*?\n\n## Supporting", f"## Claim\n\n{claim}\n\n## Supporting", content)

    # Update disconfirmation section in markdown body
    if disconfirmation is not None:
        if "## Disconfirmation Search" in content:
            content = re.sub(
                r"## Disconfirmation Search\n\n[\s\S]*?(?=\n\n## |\Z)",
                f"## Disconfirmation Search\n\n{disconfirmation}",
                content,
            )
        else:
            # Insert before Caveats, or append
            if "## Caveats" in content:
                content = content.replace(
                    "## Caveats",
                    f"## Disconfirmation Search\n\n{disconfirmation}\n\n## Caveats",
                )
            else:
                content += f"\n\n## Disconfirmation Search\n\n{disconfirmation}\n"

    write_markdown(finding.filePath, updated, content)

    # Soft advisories
    advisories = []
    vendor_warning = gate_vendor_only_advisory(updated)
    if vendor_warning:
        advisories.append(vendor_warning)

    result = f"Finding {padded_id} updated."
    if advisories:
        result += "\n\n" + "\n".join(f"⚠ {a}" for a in advisories)
    return result


# ── Candidates ────────────────────────────────────────────────────────────────

@mcp.tool()
def candidate_create(research_id: str, title: str, slug: str | None = None, description: str | None = None) -> str:
    """Create a new candidate for evaluation."""
    resolved = _get_project(research_id)
    s = sanitize_slug(slug or title)
    fp = candidate_path(resolved.projectRoot, s)

    if os.path.exists(fp):
        raise ResearchValidationError(f"Candidate '{s}' already exists.")

    desc = description or "_No description provided._"
    frontmatter = {"title": title, "verdict": "provisional"}
    content = f"\n## What It Is\n\n{desc}\n\n## Validation Checklist\n\n- [ ] Claim 1: _TBD_\n\n## Scoring\n\n_Not yet scored._\n"

    write_markdown(fp, frontmatter, content)

    result = f"Candidate created: candidates/{s}.md"

    # Landscape scan advisory — nudge on first candidate
    existing = list_candidates(resolved.projectRoot)
    if len(existing) <= 1:
        result += (
            "\n\n💡 This is the first candidate. Before evaluating options, have you documented "
            "the full landscape? Consider a finding tagged 'landscape' listing all known "
            "alternatives — including ones you've decided not to evaluate — so the research "
            "record shows the aperture was wide before narrowing."
        )

    return result


@mcp.tool()
def candidate_list(research_id: str) -> str:
    """List all candidates with verdict status."""
    resolved = _get_project(research_id)
    candidates = list_candidates(resolved.projectRoot)
    if not candidates:
        return "No candidates yet."
    rows = [f"{c.frontmatter['verdict']:<12} | {c.frontmatter['title']}" for c in candidates]
    return "\n".join(["Verdict       | Title", "------------- | -----", *rows])


@mcp.tool()
def candidate_update(research_id: str, slug: str, verdict: str | None = None, description: str | None = None) -> str:
    """Update a candidate's verdict and/or description."""
    resolved = _get_project(research_id)
    fp = candidate_path(resolved.projectRoot, slug)
    if not os.path.exists(fp):
        raise ResearchNotFoundError("Candidate", slug)

    parsed = read_markdown(fp)
    updated = {**parsed.frontmatter}
    if verdict:
        updated["verdict"] = verdict

    content = parsed.content
    if description:
        content = re.sub(r"(## What It Is\n\n)[\s\S]*?\n\n(## )", rf"\g<1>{description}\n\n\g<2>", content)

    write_markdown(fp, updated, content)
    changes = []
    if verdict:
        changes.append(f"verdict → {verdict}")
    if description:
        changes.append("description updated")
    return f"Candidate '{slug}' updated: {', '.join(changes)}."


@mcp.tool()
def candidate_add_claim(research_id: str, slug: str, claim: str) -> str:
    """Add a binary testable claim to a candidate's validation checklist."""
    resolved = _get_project(research_id)
    fp = candidate_path(resolved.projectRoot, slug)
    if not os.path.exists(fp):
        raise ResearchNotFoundError("Candidate", slug)

    parsed = read_markdown(fp)
    new_content = re.sub(
        r"(## Validation Checklist\n)([\s\S]*?)(## Scoring)",
        lambda m: f"{m.group(1)}{m.group(2).rstrip()}\n- [ ] {claim}: _TBD_\n\n{m.group(3)}",
        parsed.content,
    )
    write_markdown(fp, parsed.frontmatter, new_content)
    return f"Claim added to '{slug}'."


@mcp.tool()
def candidate_resolve_claim(research_id: str, slug: str, claim_index: int, result: str) -> str:
    """Mark a validation claim Y or N (clears _TBD_)."""
    resolved = _get_project(research_id)
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


# ── Criteria ──────────────────────────────────────────────────────────────────

@mcp.tool()
def criteria_lock(research_id: str) -> str:
    """Lock decision criteria, preventing further weight changes."""
    resolved = _get_project(research_id)
    criteria_file = decision_criteria_path(resolved.projectRoot)
    if not os.path.exists(criteria_file):
        raise ResearchNotFoundError("File", ".research/evaluations/decision-criteria.md")

    parsed = read_markdown(criteria_file)
    if parsed.frontmatter.get("locked"):
        return f"Criteria already locked on {parsed.frontmatter.get('locked_date')}."

    write_markdown(criteria_file, {"locked": True, "locked_date": _today()}, parsed.content)
    advance_phase(resolved.projectRoot, "locked", "Criteria weights frozen")
    return f"Decision criteria locked on {_today()}. Weights are now frozen. Phase → locked"


# ── Scoring ───────────────────────────────────────────────────────────────────

@mcp.tool()
def candidate_score(research_id: str, slug: str, scores: dict, notes: str = "") -> str:
    """Score a candidate. Fails if criteria not locked, peer review missing, or _TBD_ items remain."""
    resolved = _get_project(research_id)
    root = resolved.projectRoot
    require_phase(resolved.config, "reviewed", "score candidates")

    gate_result = run_scoring_gates(root, slug)
    if not gate_result["passed"]:
        raise ResearchGateError(gate_result["error"])

    # Check for DISPUTED attestations
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

    new_content = re.sub(r"## Scoring[\s\S]*", f"## Scoring{scoring_section}", parsed.content)
    write_markdown(fp, parsed.frontmatter, new_content)

    try:
        advance_phase(root, "scored", f"Scored candidate: {slug}")
    except Exception:
        pass  # Already at scored or later

    return f"Scored '{slug}'. Total: {total}\n" + "\n".join(f"  {k}: {v}" for k, v in scores.items())


@mcp.tool()
def scoring_matrix_generate(research_id: str) -> str:
    """Generate evaluations/scoring-matrix.md from locked criteria and candidates."""
    resolved = _get_project(research_id)
    root = resolved.projectRoot
    criteria = load_decision_criteria(root)
    if not criteria or not criteria.frontmatter.get("locked"):
        raise ResearchGateError("Criteria must be locked before generating scoring matrix.")

    candidates = list_candidates(root)
    matrix_path = scoring_matrix_path(root)

    criteria_rows = []
    for line in criteria.content.split("\n"):
        if line.startswith("|") and "---" not in line and "Criterion" not in line and "Weight" not in line:
            cols = [s.strip() for s in line.split("|") if s.strip()]
            if len(cols) >= 2 and cols[1] != "_TBD_":
                criteria_rows.append({"num": cols[0], "name": cols[1], "weight": cols[2] if len(cols) > 2 else "1"})

    header = " | ".join(c["name"] for c in criteria_rows)
    dashes = "|".join("---" for _ in criteria_rows)

    candidate_lines = []
    for c in candidates:
        score_matches = re.findall(r"\| (.+?) \| (\d+)/10 \|", c.content)
        score_map = {m[0].strip(): int(m[1]) for m in score_matches}
        scores_list = [str(score_map.get(cr["name"], "–")) for cr in criteria_rows]
        total = sum(score_map.get(cr["name"], 0) for cr in criteria_rows)
        candidate_lines.append(f"| {c.frontmatter['title']} | {' | '.join(scores_list)} | **{total}** |")

    matrix_content = "\n".join([
        "# Scoring Matrix",
        "",
        f"_Generated {_today()} — criteria locked {criteria.frontmatter.get('locked_date')}_",
        "",
        "## Criteria",
        "",
        "| # | Criterion | Weight |",
        "|---|-----------|--------|",
        *[f"| {c['num']} | {c['name']} | {c['weight']} |" for c in criteria_rows],
        "",
        "## Scores",
        "",
        f"| Candidate | {header} | **Total** |",
        f"|-----------|{dashes}|-----------|",
        *candidate_lines,
    ])

    with open(matrix_path, "w") as f:
        f.write(matrix_content + "\n")
    return "Scoring matrix generated at evaluations/scoring-matrix.md"


# ── Peer Review ───────────────────────────────────────────────────────────────

@mcp.tool()
def peer_review_log(research_id: str, reviewer: str, findings: list[str], attestations: dict | None = None, notes: str = "") -> str:
    """Log a peer review. Required before scoring. Advances project to 'reviewed' phase."""
    resolved = _get_project(research_id)
    root = resolved.projectRoot
    atts = attestations or {}

    all_findings = list_findings(root)
    high_findings = [f for f in all_findings if f.frontmatter["evidence"] in ("HIGH", "MODERATE")]
    unattested = [f for f in high_findings if f.frontmatter["id"] not in atts]

    finding_lines = []
    for f in findings:
        att = atts.get(f.split(":")[0].strip(), "") or atts.get(f, "")
        finding_lines.append(f"- {f} — **{att}**" if att else f"- {f}")

    attestation_lines = []
    if atts:
        attestation_lines.extend(["", "## Attestations", ""])
        for finding_id, att in atts.items():
            attestation_lines.append(f"- **{finding_id}**: {att}")

    if unattested:
        attestation_lines.extend([
            "",
            f"> ⚠️ {len(unattested)} HIGH/MODERATE finding(s) without attestation: {', '.join(f.frontmatter['id'] for f in unattested)}",
            "> These will be treated as SKIPPED at scoring time — evidence grade may be downgraded.",
        ])

    content = "\n".join([
        "# Peer Review", "", f"**Reviewer:** {reviewer}", f"**Date:** {_today()}", "",
        "## Findings", "", *finding_lines, *attestation_lines,
        *(["", "## Notes", "", notes] if notes else []),
    ])

    fp = peer_review_path(root)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w") as f:
        f.write(content + "\n")

    advance_phase(root, "reviewed", f"Peer review by {reviewer}")

    warnings = f"\n⚠️ {len(unattested)} HIGH/MODERATE finding(s) lack attestation — will be downgraded at scoring." if unattested else ""
    return f"Peer review logged by {reviewer} on {_today()}. Scoring is now unblocked. Phase → reviewed{warnings}"


# ── Decision ──────────────────────────────────────────────────────────────────

@mcp.tool()
def project_decide(research_id: str, decision: str, rationale: str, adr_reference: str = "") -> str:
    """Record a decision. Advances project to 'decided' phase. Requires 'scored' phase or later."""
    resolved = _get_project(research_id)
    root = resolved.projectRoot
    require_phase(resolved.config, "scored", "record a decision")

    # Update existing decision files
    decisions_dir = os.path.join(root, "decisions")
    updated_files = []
    if os.path.exists(decisions_dir):
        for df in os.listdir(decisions_dir):
            if df.endswith(".md") and df.lower() != "readme.md":
                fp = os.path.join(decisions_dir, df)
                content = open(fp).read()
                changed = False
                if "Under Research" in content or "Status: Draft" in content:
                    content = content.replace("Under Research", "Decided").replace("Status: Draft", "Status: Decided")
                    changed = True
                if "_To be written after scoring matrix is complete._" in content or "_To be written after decision is made._" in content:
                    content = re.sub(
                        r"## Decision\n\n_To be written[^_]*_",
                        f"## Decision\n\n{decision}" + (f"\n\nSee {adr_reference} for the full decision record." if adr_reference else ""),
                        content,
                    )
                    changed = True
                if "_To be written after decision is made._" in content:
                    content = re.sub(r"## Consequences\n\n_To be written[^_]*_", f"## Consequences\n\n{rationale}", content)
                    changed = True
                content = content.replace("**Date:** _TBD_", f"**Date:** {_today()}")
                if changed:
                    with open(fp, "w") as f:
                        f.write(content)
                    updated_files.append(df)

    # Write DECISION.md
    summary = "\n".join([
        "# Decision", "", f"**Date:** {_today()}", "**Status:** Decided",
        *([ f"**ADR:** {adr_reference}"] if adr_reference else []),
        "", "## Decision", "", decision, "", "## Rationale", "", rationale,
    ])
    decision_path = os.path.join(root, ".research", "DECISION.md")
    with open(decision_path, "w") as f:
        f.write(summary + "\n")

    advance_phase(root, "decided", decision[:100])

    response = ["Decision recorded. Phase → decided", ""]
    if updated_files:
        response.append(f"Updated existing decision files: {', '.join(updated_files)}")
    response.extend(["Wrote .research/DECISION.md", "", decision])
    return "\n".join(response)


@mcp.tool()
def project_supersede(research_id: str, superseded_by: str) -> str:
    """Mark a decided project as superseded by a later decision."""
    resolved = _get_project(research_id)
    require_phase(resolved.config, "decided", "supersede a decision")
    advance_phase(resolved.projectRoot, "superseded", f"Superseded by {superseded_by}")
    return f"Project marked as superseded by {superseded_by}. Phase → superseded"


# ── Brief & Report ────────────────────────────────────────────────────────────

@mcp.tool()
def research_brief(research_id: str, audience: str = "general") -> str:
    """Generate a layered research brief from a completed (decided) project."""
    resolved = _get_project(research_id)
    root = resolved.projectRoot
    pc = resolved.config
    findings_list = list_findings(root)
    candidates_list = list_candidates(root)
    criteria = load_decision_criteria(root)
    has_peer_review = peer_review_exists(root)

    decision_path = os.path.join(root, ".research", "DECISION.md")
    decision_content = open(decision_path).read() if os.path.exists(decision_path) else ""
    matrix_p = scoring_matrix_path(root)
    matrix_content = open(matrix_p).read() if os.path.exists(matrix_p) else ""

    high_findings = [f for f in findings_list if f.frontmatter["evidence"] == "HIGH"]
    mod_findings = [f for f in findings_list if f.frontmatter["evidence"] == "MODERATE"]

    candidate_scores = []
    for c in candidates_list:
        total_match = re.search(r"\*\*Total\*\*.*?\*\*(\d+)\*\*", c.content)
        total = int(total_match.group(1)) if total_match else 0
        candidate_scores.append({"title": c.frontmatter["title"], "total": total, "verdict": c.frontmatter["verdict"]})
    candidate_scores.sort(key=lambda x: -x["total"])

    brief = [f"# Research Brief: {pc['projectName']}", "", f"*Generated {_today()} by research.md*", ""]
    if pc.get("question"):
        brief.extend([f"> **Question:** {pc['question']}", ""])

    if decision_content:
        for line in decision_content.split("\n"):
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith("*") and line not in ("", "# Decision"):
                # Skip metadata lines
                if not line.startswith("**"):
                    brief.extend([f"**Verdict:** {line}", ""])
                    break

    brief.extend([f"**Evidence:** {len(findings_list)} findings ({len(high_findings)} HIGH, {len(mod_findings)} MODERATE) | {len(candidates_list)} candidates scored | Peer reviewed: {'Yes' if has_peer_review else 'No'}", ""])

    brief.extend(["---", "", "## Key Findings", ""])
    for f in high_findings[:8]:
        claim_first = extract_section(f.content, "Claim").split("\n")[0] if extract_section(f.content, "Claim") else ""
        brief.append(f"- **{f.frontmatter['title']}** — {claim_first}")
    if len(high_findings) > 8:
        brief.append(f"- *...and {len(high_findings) - 8} more HIGH-evidence findings*")
    if mod_findings:
        brief.append(f"- *Plus {len(mod_findings)} MODERATE-evidence findings (see full report)*")
    brief.append("")

    if candidate_scores:
        brief.extend(["---", "", "## Candidates Evaluated", "", "| Rank | Candidate | Score | Verdict |", "|------|-----------|-------|---------|"])
        for i, c in enumerate(candidate_scores):
            brief.append(f"| {i+1} | {c['title']} | {c['total']} | {c['verdict']} |")
        brief.append("")

    if decision_content:
        brief.extend(["---", "", "## Decision", ""])
        dt = extract_section(decision_content, "Decision")
        rt = extract_section(decision_content, "Rationale")
        if dt:
            brief.append(dt)
        if rt:
            brief.extend(["", "**Rationale:** " + rt.split("\n")[0]])
        brief.append("")

    brief.extend(["---", "", "## Methodology", ""])
    brief.extend([
        f"- **Project:** {pc['projectName']}",
        f"- **Phase:** {pc['phase']}",
        f"- **Created:** {pc['created']}",
        f"- **Findings:** {len(findings_list)} ({len(high_findings)} HIGH, {len(mod_findings)} MODERATE)",
        f"- **Candidates:** {len(candidates_list)} evaluated",
        f"- **Criteria:** {'Locked' if criteria else 'Not defined'}",
        f"- **Peer review:** {'Logged' if has_peer_review else 'Not logged'}",
        "",
    ])

    if pc.get("transitions"):
        brief.extend(["### Timeline", ""])
        for t in pc["transitions"]:
            brief.append(f"- {t['date']}: {t['phase']}{' — ' + t['note'] if t.get('note') else ''}")
        brief.append("")

    if pc.get("context"):
        brief.extend(["### Research Context", "", pc["context"], ""])

    brief.extend(["---", "", "*Generated by [research.md](https://github.com/eidos-agi/research.md) — structured research workflow for AI-augmented decision making.*"])

    brief_path = os.path.join(root, ".research", "BRIEF.md")
    with open(brief_path, "w") as f:
        f.write("\n".join(brief) + "\n")

    return f"Research brief generated: BRIEF.md ({len(brief)} lines)\n\n7 layers: One-liner → Key Findings → Candidates → Decision → Playbook → Design Rules → Methodology\n\nAudience: {audience}"


@mcp.tool()
def research_report(research_id: str) -> str:
    """Generate a FULL research report from a completed project."""
    resolved = _get_project(research_id)
    root = resolved.projectRoot
    pc = resolved.config
    findings_list = list_findings(root)
    candidates_list = list_candidates(root)
    criteria = load_decision_criteria(root)
    has_peer_review = peer_review_exists(root)

    decision_path = os.path.join(root, ".research", "DECISION.md")
    decision_content = open(decision_path).read() if os.path.exists(decision_path) else ""
    matrix_p = scoring_matrix_path(root)
    matrix_content = open(matrix_p).read() if os.path.exists(matrix_p) else ""

    high = [f for f in findings_list if f.frontmatter["evidence"] == "HIGH"]
    mod = [f for f in findings_list if f.frontmatter["evidence"] == "MODERATE"]
    low = [f for f in findings_list if f.frontmatter["evidence"] == "LOW"]
    unverified = [f for f in findings_list if f.frontmatter["evidence"] == "UNVERIFIED"]

    report = [f"# Research Report: {pc['projectName']}", "", f"*Full report generated {_today()} by research.md*", ""]
    sections = []

    if pc.get("question"):
        report.extend([f"> **Question:** {pc['question']}", ""])

    if decision_content:
        for line in decision_content.split("\n"):
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith("*") and not line.startswith("**"):
                report.extend([f"**Verdict:** {line}", ""])
                break
    sections.append("Title + Question + Verdict")

    report.extend([
        f"**Evidence:** {len(findings_list)} findings ({len(high)} HIGH, {len(mod)} MODERATE, {len(low)} LOW, {len(unverified)} UNVERIFIED) | {len(candidates_list)} candidates scored | Peer reviewed: {'Yes' if has_peer_review else 'No'}",
        "",
    ])
    sections.append("Evidence Summary")

    report.extend(["---", "", "## All Findings", ""])
    for label, group in [("HIGH", high), ("MODERATE", mod), ("LOW", low), ("UNVERIFIED", unverified)]:
        if not group:
            continue
        report.extend([f"### {label} Evidence ({len(group)})", ""])
        for f in group:
            claim_text = extract_section(f.content, "Claim") or ""
            source_text = f"{f.frontmatter.get('sources', 0)} source(s)"
            report.extend([
                f"#### {f.frontmatter['id']}: {f.frontmatter['title']}", "",
                f"**Evidence:** {f.frontmatter['evidence']} | **Status:** {f.frontmatter['status']} | **Sources:** {source_text}", "",
            ])
            if claim_text:
                report.extend([claim_text, ""])
    sections.append(f"All Findings ({len(findings_list)})")

    if candidates_list:
        report.extend(["---", "", "## All Candidates", ""])
        for c in candidates_list:
            report.extend([f"### {c.frontmatter['title']}", "", f"**Verdict:** {c.frontmatter['verdict']}", ""])
            what = extract_section(c.content, "What It Is")
            if what:
                report.extend(["**What It Is**", "", what, ""])
            scoring = extract_section(c.content, "Scoring")
            if scoring:
                report.extend(["**Scoring**", "", scoring, ""])
            total_match = re.search(r"\*\*Total\*\*.*?\*\*(\d+)\*\*", c.content)
            if total_match:
                report.extend([f"**Total Score: {total_match.group(1)}**", ""])
        sections.append(f"All Candidates ({len(candidates_list)})")

    if matrix_content:
        report.extend(["---", "", "## Complete Scoring Matrix", "", matrix_content, ""])
        sections.append("Complete Scoring Matrix")

    if decision_content:
        report.extend(["---", "", "## Decision", ""])
        dt = extract_section(decision_content, "Decision")
        rt = extract_section(decision_content, "Rationale")
        if dt:
            report.extend([dt, ""])
        if rt:
            report.extend(["### Rationale", "", rt, ""])
        sections.append("Decision")

    report.extend(["---", "", "## Methodology", ""])
    report.extend([
        f"- **Project:** {pc['projectName']}",
        f"- **Phase:** {pc['phase']}",
        f"- **Created:** {pc['created']}",
        f"- **Findings:** {len(findings_list)} ({len(high)} HIGH, {len(mod)} MODERATE, {len(low)} LOW, {len(unverified)} UNVERIFIED)",
        f"- **Candidates:** {len(candidates_list)} evaluated",
        f"- **Criteria:** {'Locked' if criteria else 'Not defined'}",
        f"- **Peer review:** {'Logged' if has_peer_review else 'Not logged'}",
        "",
    ])
    if pc.get("transitions"):
        report.extend(["### Timeline", ""])
        for t in pc["transitions"]:
            report.append(f"- {t['date']}: {t['phase']}{' — ' + t['note'] if t.get('note') else ''}")
        report.append("")
    if pc.get("context"):
        report.extend(["### Research Context", "", pc["context"], ""])

    report.extend(["---", "", "*Generated by [research.md](https://github.com/eidos-agi/research.md) — structured research workflow for AI-augmented decision making.*"])
    sections.append("Methodology")

    report_path = os.path.join(root, ".research", "REPORT.md")
    with open(report_path, "w") as f:
        f.write("\n".join(report) + "\n")

    return f"Full research report generated: REPORT.md ({len(report)} lines)\n\nSections: {' → '.join(sections)}\n\nIncludes ALL {len(findings_list)} findings and ALL {len(candidates_list)} candidates (untruncated)."


def main():
    mcp.run()
