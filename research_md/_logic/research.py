"""Research-meta: criteria locking, scoring matrix, peer review, brief, report."""

from __future__ import annotations

import os
import re

from ..config import advance_phase
from ..errors import ResearchGateError, ResearchNotFoundError
from ..files import (
    decision_criteria_path,
    extract_section,
    list_candidates,
    list_findings,
    load_decision_criteria,
    peer_review_exists,
    peer_review_path,
    read_markdown,
    scoring_matrix_path,
    write_markdown,
)
from ._common import get_project, today


def criteria_lock(research_id: str) -> str:
    """Lock decision criteria, preventing further weight changes."""
    resolved = get_project(research_id)
    criteria_file = decision_criteria_path(resolved.projectRoot)
    if not os.path.exists(criteria_file):
        raise ResearchNotFoundError(
            "File", ".research/evaluations/decision-criteria.md"
        )

    parsed = read_markdown(criteria_file)
    if parsed.frontmatter.get("locked"):
        return f"Criteria already locked on {parsed.frontmatter.get('locked_date')}."

    write_markdown(
        criteria_file, {"locked": True, "locked_date": today()}, parsed.content
    )
    advance_phase(resolved.projectRoot, "locked", "Criteria weights frozen")
    return (
        f"Decision criteria locked on {today()}. Weights are now frozen. Phase → locked"
    )


def scoring_matrix_generate(research_id: str) -> str:
    """Generate evaluations/scoring-matrix.md from locked criteria and candidates."""
    resolved = get_project(research_id)
    root = resolved.projectRoot
    criteria = load_decision_criteria(root)
    if not criteria or not criteria.frontmatter.get("locked"):
        raise ResearchGateError(
            "Criteria must be locked before generating scoring matrix."
        )

    candidates = list_candidates(root)
    matrix_path = scoring_matrix_path(root)

    criteria_rows = []
    for line in criteria.content.split("\n"):
        if (
            line.startswith("|")
            and "---" not in line
            and "Criterion" not in line
            and "Weight" not in line
        ):
            cols = [s.strip() for s in line.split("|") if s.strip()]
            if len(cols) >= 2 and cols[1] != "_TBD_":
                criteria_rows.append(
                    {
                        "num": cols[0],
                        "name": cols[1],
                        "weight": cols[2] if len(cols) > 2 else "1",
                    }
                )

    header = " | ".join(c["name"] for c in criteria_rows)
    dashes = "|".join("---" for _ in criteria_rows)

    candidate_lines = []
    for c in candidates:
        score_matches = re.findall(r"\| (.+?) \| (\d+)/10 \|", c.content)
        score_map = {m[0].strip(): int(m[1]) for m in score_matches}
        scores_list = [str(score_map.get(cr["name"], "–")) for cr in criteria_rows]
        total = sum(score_map.get(cr["name"], 0) for cr in criteria_rows)
        candidate_lines.append(
            f"| {c.frontmatter['title']} | {' | '.join(scores_list)} | **{total}** |"
        )

    matrix_content = "\n".join(
        [
            "# Scoring Matrix",
            "",
            f"_Generated {today()} — criteria locked {criteria.frontmatter.get('locked_date')}_",
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
        ]
    )

    with open(matrix_path, "w") as f:
        f.write(matrix_content + "\n")
    return "Scoring matrix generated at evaluations/scoring-matrix.md"


def peer_review_log(
    research_id: str,
    reviewer: str,
    findings: list[str],
    attestations: dict | None = None,
    notes: str = "",
) -> str:
    """Log a peer review. Required before scoring. Advances project to 'reviewed' phase."""
    resolved = get_project(research_id)
    root = resolved.projectRoot
    atts = attestations or {}

    all_findings = list_findings(root)
    high_findings = [
        f
        for f in all_findings
        if f.frontmatter["evidence"] in ("CONFIRMED", "REASONED")
    ]
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
        attestation_lines.extend(
            [
                "",
                f"> ⚠️ {len(unattested)} CONFIRMED/REASONED finding(s) without attestation: {', '.join(f.frontmatter['id'] for f in unattested)}",
                "> These will be treated as SKIPPED at scoring time — evidence grade may be downgraded.",
            ]
        )

    content = "\n".join(
        [
            "# Peer Review",
            "",
            f"**Reviewer:** {reviewer}",
            f"**Date:** {today()}",
            "",
            "## Findings",
            "",
            *finding_lines,
            *attestation_lines,
            *(["", "## Notes", "", notes] if notes else []),
        ]
    )

    fp = peer_review_path(root)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w") as f:
        f.write(content + "\n")

    advance_phase(root, "reviewed", f"Peer review by {reviewer}")

    warnings = (
        f"\n⚠️ {len(unattested)} CONFIRMED/REASONED finding(s) lack attestation — will be downgraded at scoring."
        if unattested
        else ""
    )
    return f"Peer review logged by {reviewer} on {today()}. Scoring is now unblocked. Phase → reviewed{warnings}"


def research_brief(research_id: str, audience: str = "general") -> str:
    """Generate a layered research brief from a completed (decided) project."""
    resolved = get_project(research_id)
    root = resolved.projectRoot
    pc = resolved.config
    findings_list = list_findings(root)
    candidates_list = list_candidates(root)
    criteria = load_decision_criteria(root)
    has_peer_review = peer_review_exists(root)

    decision_path = os.path.join(root, ".research", "DECISION.md")
    decision_content = (
        open(decision_path).read() if os.path.exists(decision_path) else ""
    )
    high_findings = [
        f for f in findings_list if f.frontmatter["evidence"] == "CONFIRMED"
    ]
    mod_findings = [f for f in findings_list if f.frontmatter["evidence"] == "REASONED"]

    candidate_scores = []
    for c in candidates_list:
        total_match = re.search(r"\*\*Total\*\*.*?\*\*(\d+)\*\*", c.content)
        total = int(total_match.group(1)) if total_match else 0
        candidate_scores.append(
            {
                "title": c.frontmatter["title"],
                "total": total,
                "verdict": c.frontmatter["verdict"],
            }
        )
    candidate_scores.sort(key=lambda x: -x["total"])

    brief = [
        f"# Research Brief: {pc['projectName']}",
        "",
        f"*Generated {today()} by research.md*",
        "",
    ]
    if pc.get("question"):
        brief.extend([f"> **Question:** {pc['question']}", ""])

    if decision_content:
        for line in decision_content.split("\n"):
            line = line.strip()
            if (
                line
                and not line.startswith("#")
                and not line.startswith("*")
                and line not in ("", "# Decision")
            ):
                if not line.startswith("**"):
                    brief.extend([f"**Verdict:** {line}", ""])
                    break

    brief.extend(
        [
            f"**Evidence:** {len(findings_list)} findings ({len(high_findings)} CONFIRMED, {len(mod_findings)} REASONED) | {len(candidates_list)} candidates scored | Peer reviewed: {'Yes' if has_peer_review else 'No'}",
            "",
        ]
    )

    brief.extend(["---", "", "## Key Findings", ""])
    for f in high_findings[:8]:
        claim_first = (
            extract_section(f.content, "Claim").split("\n")[0]
            if extract_section(f.content, "Claim")
            else ""
        )
        brief.append(f"- **{f.frontmatter['title']}** — {claim_first}")
    if len(high_findings) > 8:
        brief.append(
            f"- *...and {len(high_findings) - 8} more CONFIRMED-evidence findings*"
        )
    if mod_findings:
        brief.append(
            f"- *Plus {len(mod_findings)} REASONED-evidence findings (see full report)*"
        )
    brief.append("")

    if candidate_scores:
        brief.extend(
            [
                "---",
                "",
                "## Candidates Evaluated",
                "",
                "| Rank | Candidate | Score | Verdict |",
                "|------|-----------|-------|---------|",
            ]
        )
        for i, c in enumerate(candidate_scores):
            brief.append(f"| {i + 1} | {c['title']} | {c['total']} | {c['verdict']} |")
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
    brief.extend(
        [
            f"- **Project:** {pc['projectName']}",
            f"- **Phase:** {pc['phase']}",
            f"- **Created:** {pc['created']}",
            f"- **Findings:** {len(findings_list)} ({len(high_findings)} CONFIRMED, {len(mod_findings)} REASONED)",
            f"- **Candidates:** {len(candidates_list)} evaluated",
            f"- **Criteria:** {'Locked' if criteria else 'Not defined'}",
            f"- **Peer review:** {'Logged' if has_peer_review else 'Not logged'}",
            "",
        ]
    )

    if pc.get("transitions"):
        brief.extend(["### Timeline", ""])
        for t in pc["transitions"]:
            brief.append(
                f"- {t['date']}: {t['phase']}{' — ' + t['note'] if t.get('note') else ''}"
            )
        brief.append("")

    if pc.get("context"):
        brief.extend(["### Research Context", "", pc["context"], ""])

    brief.extend(
        [
            "---",
            "",
            "*Generated by [research.md](https://github.com/eidos-agi/research.md) — structured research workflow for AI-augmented decision making.*",
        ]
    )

    brief_path = os.path.join(root, ".research", "BRIEF.md")
    with open(brief_path, "w") as f:
        f.write("\n".join(brief) + "\n")

    return f"Research brief generated: BRIEF.md ({len(brief)} lines)\n\n7 layers: One-liner → Key Findings → Candidates → Decision → Playbook → Design Rules → Methodology\n\nAudience: {audience}"


def research_report(research_id: str) -> str:
    """Generate a FULL research report from a completed project."""
    resolved = get_project(research_id)
    root = resolved.projectRoot
    pc = resolved.config
    findings_list = list_findings(root)
    candidates_list = list_candidates(root)
    criteria = load_decision_criteria(root)
    has_peer_review = peer_review_exists(root)

    decision_path = os.path.join(root, ".research", "DECISION.md")
    decision_content = (
        open(decision_path).read() if os.path.exists(decision_path) else ""
    )
    matrix_p = scoring_matrix_path(root)
    matrix_content = open(matrix_p).read() if os.path.exists(matrix_p) else ""

    high = [f for f in findings_list if f.frontmatter["evidence"] == "CONFIRMED"]
    mod = [f for f in findings_list if f.frontmatter["evidence"] == "REASONED"]
    low = [f for f in findings_list if f.frontmatter["evidence"] == "LOW"]
    unverified = [f for f in findings_list if f.frontmatter["evidence"] == "UNVERIFIED"]

    report = [
        f"# Research Report: {pc['projectName']}",
        "",
        f"*Full report generated {today()} by research.md*",
        "",
    ]
    sections = []

    if pc.get("question"):
        report.extend([f"> **Question:** {pc['question']}", ""])

    if decision_content:
        for line in decision_content.split("\n"):
            line = line.strip()
            if (
                line
                and not line.startswith("#")
                and not line.startswith("*")
                and not line.startswith("**")
            ):
                report.extend([f"**Verdict:** {line}", ""])
                break
    sections.append("Title + Question + Verdict")

    report.extend(
        [
            f"**Evidence:** {len(findings_list)} findings ({len(high)} CONFIRMED, {len(mod)} REASONED, {len(low)} LOW, {len(unverified)} UNVERIFIED) | {len(candidates_list)} candidates scored | Peer reviewed: {'Yes' if has_peer_review else 'No'}",
            "",
        ]
    )
    sections.append("Evidence Summary")

    report.extend(["---", "", "## All Findings", ""])
    for label, group in [
        ("CONFIRMED", high),
        ("REASONED", mod),
        ("LOW", low),
        ("UNVERIFIED", unverified),
    ]:
        if not group:
            continue
        report.extend([f"### {label} Evidence ({len(group)})", ""])
        for f in group:
            claim_text = extract_section(f.content, "Claim") or ""
            raw_sources = f.frontmatter.get("sources", 0)
            src_n = (
                len(raw_sources)
                if isinstance(raw_sources, list)
                else (raw_sources if isinstance(raw_sources, int) else 0)
            )
            source_text = f"{src_n} source(s)"
            report.extend(
                [
                    f"#### {f.frontmatter['id']}: {f.frontmatter['title']}",
                    "",
                    f"**Evidence:** {f.frontmatter['evidence']} | **Status:** {f.frontmatter['status']} | **Sources:** {source_text}",
                    "",
                ]
            )
            if claim_text:
                report.extend([claim_text, ""])
    sections.append(f"All Findings ({len(findings_list)})")

    if candidates_list:
        report.extend(["---", "", "## All Candidates", ""])
        for c in candidates_list:
            report.extend(
                [
                    f"### {c.frontmatter['title']}",
                    "",
                    f"**Verdict:** {c.frontmatter['verdict']}",
                    "",
                ]
            )
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
    report.extend(
        [
            f"- **Project:** {pc['projectName']}",
            f"- **Phase:** {pc['phase']}",
            f"- **Created:** {pc['created']}",
            f"- **Findings:** {len(findings_list)} ({len(high)} CONFIRMED, {len(mod)} REASONED, {len(low)} LOW, {len(unverified)} UNVERIFIED)",
            f"- **Candidates:** {len(candidates_list)} evaluated",
            f"- **Criteria:** {'Locked' if criteria else 'Not defined'}",
            f"- **Peer review:** {'Logged' if has_peer_review else 'Not logged'}",
            "",
        ]
    )
    if pc.get("transitions"):
        report.extend(["### Timeline", ""])
        for t in pc["transitions"]:
            report.append(
                f"- {t['date']}: {t['phase']}{' — ' + t['note'] if t.get('note') else ''}"
            )
        report.append("")
    if pc.get("context"):
        report.extend(["### Research Context", "", pc["context"], ""])

    report.extend(
        [
            "---",
            "",
            "*Generated by [research.md](https://github.com/eidos-agi/research.md) — structured research workflow for AI-augmented decision making.*",
        ]
    )
    sections.append("Methodology")

    report_path = os.path.join(root, ".research", "REPORT.md")
    with open(report_path, "w") as f:
        f.write("\n".join(report) + "\n")

    return f"Full research report generated: REPORT.md ({len(report)} lines)\n\nSections: {' → '.join(sections)}\n\nIncludes ALL {len(findings_list)} findings and ALL {len(candidates_list)} candidates (untruncated)."
