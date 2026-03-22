"""Integrity checks — verify project phase matches actual file state."""

import os
import re

from .config import PHASE_ORDER
from .files import (
    load_decision_criteria, peer_review_exists, list_findings, list_candidates,
)


def check_integrity(project_root: str, config: dict) -> list[dict]:
    issues = []
    phase = config["phase"]
    phase_idx = PHASE_ORDER.index(phase)

    # Phase vs criteria lock
    criteria = load_decision_criteria(project_root)
    criteria_locked = criteria and criteria.frontmatter.get("locked") is True

    if phase_idx >= PHASE_ORDER.index("locked") and not criteria_locked:
        issues.append({
            "severity": "error",
            "message": f"Phase is '{phase}' but decision-criteria.md is not locked. Phase says criteria are frozen but the file disagrees.",
        })
    if phase_idx < PHASE_ORDER.index("locked") and criteria_locked:
        issues.append({
            "severity": "warning",
            "message": f"Criteria are locked but phase is '{phase}'. Phase should be 'locked' or later.",
        })

    # Phase vs peer review
    has_peer_review = peer_review_exists(project_root)
    if phase_idx >= PHASE_ORDER.index("reviewed") and not has_peer_review:
        issues.append({
            "severity": "error",
            "message": f"Phase is '{phase}' but no peer-review.md exists. Phase says review happened but the file is missing.",
        })

    # Phase vs decision files
    if phase_idx >= PHASE_ORDER.index("decided"):
        decisions_dir = os.path.join(project_root, ".research", "decisions")
        decision_file = os.path.join(project_root, ".research", "DECISION.md")
        has_decision = os.path.exists(decision_file)

        if os.path.exists(decisions_dir):
            for df in os.listdir(decisions_dir):
                if df.endswith(".md") and df.lower() != "readme.md":
                    has_decision = True
                    content = open(os.path.join(decisions_dir, df)).read()
                    for marker in ["_To be written", "_To be determined", "Under Research", "Status: Draft"]:
                        if marker in content:
                            issues.append({
                                "severity": "error",
                                "message": f"Phase is '{phase}' but decisions/{df} contains '{marker}'. The decision file was not updated to reflect the outcome.",
                            })

        if not has_decision:
            issues.append({
                "severity": "error",
                "message": f"Phase is '{phase}' but no decision file found (no DECISION.md and no files in decisions/). Record the decision.",
            })

    # Candidates with no verdict at decided phase
    if phase_idx >= PHASE_ORDER.index("decided"):
        candidates = list_candidates(project_root)
        provisional = [c for c in candidates if c.frontmatter.get("verdict") == "provisional"]
        if provisional:
            names = ", ".join(c.frontmatter.get("title", "unknown") for c in provisional)
            issues.append({
                "severity": "warning",
                "message": f"Phase is '{phase}' but {len(provisional)} candidate(s) still have verdict 'provisional': {names}. Update verdicts to reflect the decision.",
            })

    # TBD items at scored or later
    if phase_idx >= PHASE_ORDER.index("scored"):
        candidates = list_candidates(project_root)
        tbd_count = sum(len(re.findall(r"_TBD_", c.content)) for c in candidates)
        if tbd_count > 0:
            issues.append({
                "severity": "warning",
                "message": f"Phase is '{phase}' but {tbd_count} _TBD_ item(s) remain in candidate validation checklists.",
            })

    # No findings at criteria or later
    if phase_idx >= PHASE_ORDER.index("criteria"):
        findings = list_findings(project_root)
        if not findings:
            issues.append({
                "severity": "warning",
                "message": f"Phase is '{phase}' but no findings have been recorded. Research should produce findings before defining criteria.",
            })

    # No candidates at locked or later
    if phase_idx >= PHASE_ORDER.index("locked"):
        candidates = list_candidates(project_root)
        if not candidates:
            issues.append({
                "severity": "warning",
                "message": f"Phase is '{phase}' but no candidates exist. Can't score without candidates.",
            })

    return issues
