/**
 * Workflow guide resources — loaded into agent context automatically.
 * Modeled on Backlog.md's backlog://workflow/* pattern.
 */

export const INIT_REQUIRED_GUIDE = `# research.md — Project Not Initialized

This directory does not have a \`research-md.json\` config file.

## Quick Start

Run the \`init\` tool to set up a research project:
- Creates \`findings/\`, \`candidates/\`, \`evaluations/\` directories
- Writes \`research-md.json\` config

Or from the CLI:
\`\`\`bash
research-md init
\`\`\`
`;

export const WORKFLOW_OVERVIEW = `# research.md — Workflow Overview

research.md is an MCP server that enforces structured research workflows through tooling, not convention.

## Core Loop

1. **Document findings** — \`finding_create\` with evidence grade and source
2. **Register candidates** — \`candidate_create\` for each option under evaluation
3. **Add validation claims** — \`candidate_add_claim\` for binary testable assertions
4. **Resolve claims** — \`candidate_resolve_claim\` as you verify Y/N
5. **Define criteria** — edit \`evaluations/decision-criteria.md\` with weighted criteria
6. **Lock criteria** — \`criteria_lock\` freezes weights (no anchoring after this)
7. **Log peer review** — \`peer_review_log\` (required gate before scoring)
8. **Score candidates** — \`candidate_score\` (gated: criteria locked + peer review + no TBD)
9. **Generate matrix** — \`scoring_matrix_generate\` produces the comparison table

## Process Gates (Enforced)

| Gate | What Blocks |
|------|-------------|
| Criteria not locked | \`candidate_score\` fails |
| No peer review | \`candidate_score\` fails |
| TBD items remain | \`candidate_score\` fails for that candidate |

## Available Tools

### Findings
- \`finding_create\` — create finding with evidence grade + source
- \`finding_list\` — list all findings
- \`finding_update\` — update status, evidence, or claim

### Candidates
- \`candidate_create\` — create candidate for evaluation
- \`candidate_list\` — list all candidates
- \`candidate_add_claim\` — add binary testable claim
- \`candidate_resolve_claim\` — mark claim Y or N

### Scoring
- \`criteria_lock\` — freeze criteria weights
- \`candidate_score\` — score a candidate (gated)
- \`scoring_matrix_generate\` — build comparison table

### Peer Review
- \`peer_review_log\` — log reviewer + findings

### Project
- \`init\` — initialize project structure
- \`status\` — project health summary

## Resources

- \`research://workflow/overview\` — this guide
- \`research://findings/all\` — all findings
- \`research://candidates/all\` — all candidates
- \`research://scoring-matrix\` — current scoring matrix
- \`research://status\` — project health
`;

export const RESOURCE_DEFINITIONS = [
  // Workflow resources
  {
    uri: "research://workflow/overview",
    name: "Workflow Overview",
    description: "Complete guide to research.md workflow, tools, and process gates",
    mimeType: "text/markdown",
  },
  // Data resources
  {
    uri: "research://findings/all",
    name: "All Findings",
    description: "All research findings with status and evidence grade",
    mimeType: "text/markdown",
  },
  {
    uri: "research://candidates/all",
    name: "All Candidates",
    description: "All candidates with verdict status",
    mimeType: "text/markdown",
  },
  {
    uri: "research://scoring-matrix",
    name: "Scoring Matrix",
    description: "Current scoring matrix",
    mimeType: "text/markdown",
  },
  {
    uri: "research://status",
    name: "Project Status",
    description: "Project health summary",
    mimeType: "text/markdown",
  },
] as const;

export const INIT_REQUIRED_RESOURCE = {
  uri: "research://init-required",
  name: "Initialization Required",
  description: "Guide for initializing a research.md project",
  mimeType: "text/markdown",
} as const;
