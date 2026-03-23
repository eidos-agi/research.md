# research.md

MCP server for structured research workflows. Enforces process gates in code so agents cannot skip findings, peer review, or criteria locking under time pressure.

## What it enforces

| Gate | Trigger |
|------|---------|
| Criteria locked before scoring | `candidate_score` fails if `decision-criteria.md` not locked |
| No TBD on scored candidates | `candidate_score` fails if candidate has `_TBD_` claims |
| Peer review before scoring | `candidate_score` fails if no `evaluations/peer-review.md` |

## Install

Not yet published to npm. Install from local path.

```bash
npm install
npm run build
```

Add to `.mcp.json` (use `node` with the local path, not `npx`):

```json
{
  "mcpServers": {
    "research-md": {
      "command": "node",
      "args": ["/absolute/path/to/research.md/dist/index.js"]
    }
  }
}
```

Or for Claude Code:

```bash
claude mcp add research-md --scope user -- node /absolute/path/to/research.md/dist/index.js
```

## Trilogy conventions

research.md follows shared conventions with ike.md and visionlog.md. See [CONVENTIONS.md](https://github.com/eidos-agi/ike.md/blob/main/CONVENTIONS.md) for the full standard: dot-dirs, git commitment, GUID routing, monorepo patterns.

- Config lives at `.research/research.json` (committed to git)
- Tools: `project_init` (new project) and `project_set` (register existing for session)

## Targeting pattern: project_set + research_id

Every tool call requires a `research_id` -- the GUID from the project's `.research/research.json`. This is an in-memory mapping that does not persist across MCP server restarts.

**Session startup:**

1. Call `project_set` with the project's absolute path
2. It returns the project's `research_id` (a UUID)
3. Pass that `research_id` on every subsequent tool call

If you call a tool without a valid `research_id`, the server tells you exactly how to fix it.

## Project structure

### Single project

```
my-research/
  .research/
    research.json              <- config with project GUID (commit this)
    findings/                  <- NNNN-slug.md
    candidates/                <- slug.md
    evaluations/
      decision-criteria.md     <- criteria table (lock before scoring)
      peer-review.md           <- reviewer log (required before scoring)
      scoring-matrix.md        <- generated from locked criteria + candidates
```

### Multi-project root

A root directory holds multiple research projects. Each subproject is a full project with its own GUID.

```
research-root/
  .research/
    research.json              <- root config (lists subprojects)
  vendor-selection/
    .research/
      research.json            <- subproject GUID
      findings/
      candidates/
      evaluations/
  platform-comparison/
    .research/
      research.json            <- subproject GUID
      findings/
      candidates/
      evaluations/
```

Initialize a root and add subprojects:

```
project_init { path: "/path/to/root", root: true }
project_init { path: "/path/to/root", subproject: "vendor-selection" }
project_init { path: "/path/to/root", subproject: "platform-comparison" }
```

When you `project_set` a root, all subprojects are registered automatically. Use each subproject's `research_id` for tool calls -- you cannot operate on the root directly.

## Tools (16)

### Session

| Tool | Description |
|------|-------------|
| `project_set` | Register a project path, returns its GUID. Also registers subprojects if root. |
| `project_get` | List all registered projects and their GUIDs for this session. |

### Project

| Tool | Description |
|------|-------------|
| `init` | Initialize project structure (single, root, or subproject). |
| `status` | Project health: criteria locked, peer review done, TBD count, finding/candidate totals. |

### Findings

| Tool | Description |
|------|-------------|
| `finding_create` | Create finding with evidence grade and source. |
| `finding_list` | List all findings with status and evidence grade. |
| `finding_update` | Update status, evidence grade, or claim text. |

### Candidates

| Tool | Description |
|------|-------------|
| `candidate_create` | Create candidate for evaluation. |
| `candidate_list` | List all candidates with verdict status. |
| `candidate_update` | Update verdict (provisional/recommended/eliminated) or description. |
| `candidate_add_claim` | Add binary testable claim to validation checklist. |
| `candidate_resolve_claim` | Mark a claim Y or N (clears `_TBD_`). |

### Scoring

| Tool | Description |
|------|-------------|
| `criteria_lock` | Lock decision criteria weights. Required before scoring. |
| `candidate_score` | Score a candidate against locked criteria. Gated on criteria lock + peer review + no TBD. |
| `scoring_matrix_generate` | Generate `evaluations/scoring-matrix.md` comparison table. |

### Peer Review

| Tool | Description |
|------|-------------|
| `peer_review_log` | Log reviewer name and findings. Required before scoring. |

## Evidence grades

| Grade | Meaning |
|-------|---------|
| `HIGH` | Peer-reviewed, primary source, reproducible |
| `MODERATE` | Secondary source, credible but not independently verified |
| `LOW` | Anecdotal, single source, unverified claim |
| `UNVERIFIED` | Not yet assessed |

## Resources

```
research://workflow/overview   -> workflow guide (auto-loaded into agent context)
research://findings/all        -> all findings as markdown
research://candidates/all      -> all candidates with verdict
research://scoring-matrix      -> current scoring matrix
research://status              -> project health summary
```

## Development

```bash
npm install
npm run build
npm run dev
```
