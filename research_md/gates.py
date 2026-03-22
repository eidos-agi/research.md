"""Scoring gates — must pass before a candidate can be scored."""

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
