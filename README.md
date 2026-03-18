# research.md

MCP server for research workflows — findings, candidates, scoring matrices, and peer review.

Process gates enforced in code, not convention. Agents can't skip them under time pressure.

## What it enforces

| Gate | Trigger |
|------|---------|
| Criteria locked before scoring | `candidate_score` fails if `decision-criteria.md` not locked |
| No TBD on scored criteria | `candidate_score` fails if candidate has `_TBD_` items |
| Peer review before scoring | `candidate_score` fails if no `evaluations/peer-review.md` |

## Install

```bash
research-md init
```

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "research-md": {
      "command": "npx",
      "args": ["research-md", "mcp", "start"]
    }
  }
}
```

Or for Claude Code:

```bash
claude mcp add research-md --scope user -- research-md mcp start
```

Set `RESEARCH_MD_CWD` if your client can't set the working directory:

```json
{
  "mcpServers": {
    "research-md": {
      "command": "npx",
      "args": ["research-md", "mcp", "start"],
      "env": {
        "RESEARCH_MD_CWD": "/absolute/path/to/your/research/project"
      }
    }
  }
}
```

## Project structure

```
findings/                        ← NNNN-slug.md — claims + evidence grades
candidates/                      ← slug.md — candidates under evaluation
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
| `finding_create` | Create finding with evidence grade + source |
| `finding_list` | List all findings |
| `finding_update` | Update status, evidence, or claim |

### Candidates
| Tool | Description |
|------|-------------|
| `candidate_create` | Create candidate for evaluation |
| `candidate_list` | List all candidates |
| `candidate_add_claim` | Add binary testable claim to checklist |
| `candidate_resolve_claim` | Mark claim Y or N |

### Scoring
| Tool | Description |
|------|-------------|
| `criteria_lock` | Freeze criteria weights (required before scoring) |
| `candidate_score` | Score a candidate (gated) |
| `scoring_matrix_generate` | Build scoring-matrix.md |

### Peer Review
| Tool | Description |
|------|-------------|
| `peer_review_log` | Log reviewer + findings (required before scoring) |

## Resources

```
research://workflow/overview   → workflow guide (auto-loaded into agent context)
research://findings/all        → all findings as markdown
research://candidates/all      → all candidates with verdict
research://scoring-matrix      → current scoring matrix
research://status              → project health summary
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
