# research.md

MCP server for research workflows — findings, candidates, scoring matrices, and ADRs.

Process gates enforced in code, not convention. Agents can't skip them under time pressure.

## What it enforces

| Gate | Trigger |
|------|---------|
| Criteria locked before scoring | `score_candidate` fails if `decision-criteria.md` not locked |
| No TBD on scored criteria | `score_candidate` fails if candidate has `_TBD_` items |
| Peer review before scoring | `score_candidate` fails if no `evaluations/peer-review.md` |
| ADR sections populated before acceptance | `update_adr_status accepted` fails if Alternatives or Risks empty |

## Install

```bash
npx research-md init
```

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "research-md": {
      "command": "npx",
      "args": ["research-md", "start"]
    }
  }
}
```

## Project structure

```
findings/                        ← NNNN-slug.md — claims + evidence grades
candidates/                      ← slug.md — candidates under evaluation
decisions/                       ← NNNN-slug.md — Architecture Decision Records
evaluations/
  decision-criteria.md           ← criteria table (lock before scoring)
  peer-review.md                 ← reviewer log (required before scoring)
  scoring-matrix.md              ← generated from locked criteria + candidates
research-md.json                 ← project config
```

## Tools

### Project
| Tool | Description |
|------|-------------|
| `init` | Initialize project structure |
| `status` | Show project health |

### Findings
| Tool | Description |
|------|-------------|
| `create_finding` | Create finding with evidence grade + source |
| `list_findings` | List all findings |
| `update_finding` | Update status, evidence, or claim |

### Candidates
| Tool | Description |
|------|-------------|
| `create_candidate` | Create candidate for evaluation |
| `list_candidates` | List all candidates |
| `add_validation_claim` | Add binary testable claim to checklist |
| `resolve_validation_claim` | Mark claim Y or N |

### Scoring
| Tool | Description |
|------|-------------|
| `lock_criteria` | Freeze criteria weights (required before scoring) |
| `score_candidate` | Score a candidate (gated) |
| `generate_scoring_matrix` | Build scoring-matrix.md |

### ADRs
| Tool | Description |
|------|-------------|
| `create_adr` | Create ADR with status `proposed` |
| `update_adr_status` | Transition status (gated on `accepted`) |

### Peer Review
| Tool | Description |
|------|-------------|
| `log_peer_review` | Log reviewer + findings (required before scoring) |

## Resources

```
research://findings/all       → all findings as markdown
research://candidates/all     → all candidates with verdict
research://decisions/all      → all ADRs with status
research://scoring-matrix     → current scoring matrix
research://status             → project health summary
```

## Evidence grades

| Grade | Meaning |
|-------|---------|
| `HIGH` | Peer-reviewed, primary source, reproducible |
| `MODERATE` | Secondary source, credible but not independently verified |
| `LOW` | Anecdotal, single source, unverified claim |
| `UNVERIFIED` | Not yet assessed |

## Development

```bash
npm install
npm run build
npm run dev
```
