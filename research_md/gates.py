"""Scoring gates — must pass before a candidate can be scored.
   Evidence gates — must pass before a finding can be upgraded to CONFIRMED."""

from .files import load_decision_criteria, peer_review_exists, list_candidates


def gate_criteria_locked(project_root: str) -> dict:
    criteria = load_decision_criteria(project_root)
    if not criteria:
        return {"passed": False, "error": "No decision-criteria.md found in evaluations/. Run `init` and add criteria before scoring."}
    if not criteria.frontmatter.get("locked"):
        return {"passed": False, "error": "Decision criteria are not locked. Run `lock_criteria` to freeze weights before scoring."}
    return {"passed": True}


def gate_peer_review_exists(project_root: str) -> dict:
    if not peer_review_exists(project_root):
        return {"passed": False, "error": "No peer-review.md found in evaluations/. Run `log_peer_review` before scoring."}
    return {"passed": True}


def gate_candidate_no_tbd(project_root: str, slug: str) -> dict:
    candidates = list_candidates(project_root)
    candidate = next((c for c in candidates if f"/{slug}.md" in c.filePath), None)
    if not candidate:
        return {"passed": False, "error": f"Candidate '{slug}' not found."}
    if "_TBD_" in candidate.content:
        return {"passed": False, "error": f"Candidate '{slug}' has unresolved _TBD_ items in its validation checklist. Resolve all claims before scoring."}
    return {"passed": True}


def run_scoring_gates(project_root: str, candidate_slug: str) -> dict:
    checks = [
        gate_criteria_locked(project_root),
        gate_peer_review_exists(project_root),
        gate_candidate_no_tbd(project_root, candidate_slug),
    ]
    for result in checks:
        if not result["passed"]:
            return result
    return {"passed": True}


# ── Evidence gates ───────────────────────────────────────────────────────────


def gate_confirmed_triangulation(frontmatter: dict) -> dict:
    """CONFIRMED requires 2+ independent sources."""
    if frontmatter.get("evidence") != "HIGH":
        return {"passed": True}
    sources = frontmatter.get("sources", 0)
    count = len(sources) if isinstance(sources, list) else (sources if isinstance(sources, int) else 0)
    if count < 2:
        return {
            "passed": False,
            "error": (
                "CONFIRMED (HIGH) evidence requires 2+ independent sources. "
                "Add more sources via finding_update or downgrade to MODERATE/LOW. "
                "A single source, regardless of quality, caps a finding at MODERATE."
            ),
        }
    return {"passed": True}


def gate_confirmed_disconfirmation(frontmatter: dict) -> dict:
    """CONFIRMED requires a documented disconfirmation search."""
    if frontmatter.get("evidence") != "HIGH":
        return {"passed": True}
    disconfirmation = frontmatter.get("disconfirmation")
    if not disconfirmation or (isinstance(disconfirmation, str) and not disconfirmation.strip()):
        return {
            "passed": False,
            "error": (
                "CONFIRMED (HIGH) evidence requires a disconfirmation search. "
                "Document what you searched for to disprove this claim and what you found. "
                "Use finding_update with the disconfirmation parameter."
            ),
        }
    return {"passed": True}


def gate_vendor_only_advisory(frontmatter: dict) -> str | None:
    """Soft advisory: warn if all sources are VENDOR tier."""
    sources = frontmatter.get("sources", [])
    if not isinstance(sources, list) or len(sources) == 0:
        return None
    tiers = [s.get("tier", "").upper() for s in sources if isinstance(s, dict)]
    if tiers and all(t == "VENDOR" for t in tiers):
        return (
            "Advisory: All sources for this finding are vendor-produced. "
            "Consider seeking independent validation from PRIMARY or EXPERT sources."
        )
    return None


def run_evidence_gates(frontmatter: dict) -> dict:
    """Run all evidence gates for a finding being upgraded to HIGH. Returns first failure."""
    checks = [
        gate_confirmed_triangulation(frontmatter),
        gate_confirmed_disconfirmation(frontmatter),
    ]
    for result in checks:
        if not result["passed"]:
            return result
    return {"passed": True}
