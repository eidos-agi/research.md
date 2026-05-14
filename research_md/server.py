"""research.md MCP server — thin shim over ``research_md._logic``.

Stage A (CLI-first refactor): all 20 tool bodies have moved to ``_logic/``;
this file imports them and registers them with FastMCP. Stage B will collapse
the surface to a single ``help`` tool (see ADR-006).
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from ._logic.candidate import (
    candidate_add_claim,
    candidate_create,
    candidate_list,
    candidate_resolve_claim,
    candidate_score,
    candidate_update,
)
from ._logic.finding import finding_create, finding_list, finding_update
from ._logic.project import (
    project_decide,
    project_get,
    project_init,
    project_set,
    project_supersede,
    status,
)
from ._logic.research import (
    criteria_lock,
    peer_review_log,
    research_brief,
    research_report,
    scoring_matrix_generate,
)

INSTRUCTIONS = """research.md is the decision forge — evidence-graded, phase-gated, peer-reviewed decisions.

Use it when a question has consequences: architecture choices, technology selections, strategic bets, anything that will become a contract in visionlog. Do not make consequential decisions in conversation. Run them through research.md so the evidence is recorded, the criteria are locked, and the decision is reviewable by any future agent or human.

Call project_set first to register the project GUID for this session. Every subsequent tool call takes that GUID.

The trilogy:
- research.md: decide with evidence — this is where decisions are earned
- visionlog: records the decision as an ADR and contract — what all execution must honor
- ike.md: executes tasks within those contracts

The flow is one-way: research.md feeds visionlog, visionlog feeds ike.md. A decision skipped here is a contract that was never earned."""

mcp = FastMCP("research-md", instructions=INSTRUCTIONS)


# Register every logic function as an MCP tool.
# FastMCP introspects type hints + docstrings — the source of truth lives in _logic/.
for fn in (
    project_set,
    project_get,
    project_init,
    status,
    finding_create,
    finding_list,
    finding_update,
    candidate_create,
    candidate_list,
    candidate_update,
    candidate_add_claim,
    candidate_resolve_claim,
    criteria_lock,
    candidate_score,
    scoring_matrix_generate,
    peer_review_log,
    project_decide,
    project_supersede,
    research_brief,
    research_report,
):
    mcp.tool()(fn)


def main():
    mcp.run()
