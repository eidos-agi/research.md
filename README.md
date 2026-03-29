# research.md

[![PyPI](https://img.shields.io/pypi/v/research-md)](https://pypi.org/project/research-md/)
[![CI](https://github.com/eidos-agi/research.md/actions/workflows/ci.yml/badge.svg)](https://github.com/eidos-agi/research.md/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)

The decision forge. An MCP server that enforces evidence-graded, phase-gated, peer-reviewed research workflows so AI agents cannot skip rigor under time pressure.

## What it enforces

### Evidence gates (upstream)

| Gate | Trigger |
|------|---------|
| 2+ sources for HIGH evidence | `finding_create` / `finding_update` fail if upgrading to HIGH with < 2 sources |
| Disconfirmation search required | `finding_create` / `finding_update` fail if upgrading to HIGH without documenting what you searched to disprove the claim |
| Content hash for MODERATE+ | Source must include `content_hash:` proving the agent fetched and read the material |
| Web research nudge | Tool returns advisory when findings have no sources |
| Vendor-only warning | Advisory when all sources are VENDOR tier |
| Landscape scan advisory | Nudge on first candidate to document the full option landscape |

### Process gates (downstream)

| Gate | Trigger |
|------|---------|
| Criteria locked before scoring | `candidate_score` fails if `decision-criteria.md` not locked |
| No TBD on scored candidates | `candidate_score` fails if candidate has `_TBD_` claims |
| Peer review before scoring | `candidate_score` fails if no `evaluations/peer-review.md` |

## Install

```bash
pip install research-md
```

Or install from source:

```bash
pip install -e ".[dev]"
```

## MCP configuration

Add to your Claude Code config:

```bash
claude mcp add research-md --scope user -- research-md
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "research-md": {
      "command": "research-md"
    }
  }
}
```

## Agent workflow

A typical research session follows this path:

```
project_set          Register project, get research_id
    |
finding_create       Record claims with evidence grades (UNVERIFIED -> LOW -> MODERATE -> HIGH)
    |                Tool nudges: "Use WebSearch to find sources"
finding_update       Add sources, disconfirmation search, upgrade evidence grade
    |                Gate: HIGH requires 2+ sources + disconfirmation
candidate_create     Define options to evaluate
    |                Advisory: "Document the full landscape before narrowing"
criteria_lock        Freeze decision criteria weights
    |
peer_review_log      Log reviewer assessment
    |
candidate_score      Score candidates (gated on criteria + peer review + no TBD)
    |
project_decide       Record the decision with rationale
```

### Evidence grade ladder

| Grade | Meaning | Requirements |
|-------|---------|-------------|
| `UNVERIFIED` | Claim recorded, not yet investigated | None -- tool nudges toward web research |
| `LOW` | Single source or anecdotal | At least a coherent argument |
| `MODERATE` | Credible source, verified consultation | 1+ source with `content_hash:` proof |
| `HIGH` | Confirmed -- validated by evidence | 2+ independent sources + disconfirmation search |

### Source quality tiers

Each source is tagged with a tier for awareness (no hard gate):

| Tier | Examples |
|------|---------|
| `PRIMARY` | Census data, RFC specs, user study results |
| `EXPERT` | PMC papers, RAND reports, Thoughtworks Radar |
| `SECONDARY` | Blog roundups, tutorials, comparison guides |
| `VENDOR` | Company blog comparing itself to competitors |

## Trilogy conventions

research.md follows shared conventions with [ike.md](https://github.com/eidos-agi/ike.md) and [visionlog](https://github.com/eidos-agi/visionlog). See [CONVENTIONS.md](https://github.com/eidos-agi/ike.md/blob/main/CONVENTIONS.md) for the full standard.

- **research.md** -- decide with evidence (this tool)
- **visionlog** -- record the decision as a contract
- **ike.md** -- execute tasks within those contracts

Config lives at `.research/research.json` (committed to git).

## Targeting pattern: project_set + research_id

Every tool call requires a `research_id` -- the GUID from `.research/research.json`. This is an in-memory mapping that does not persist across MCP server restarts.

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
```

Initialize: `project_init { path, root: true }` then `project_init { path, subproject: "name" }`.
When you `project_set` a root, all subprojects are registered automatically.

## Tools (20)

### Session

| Tool | Description |
|------|-------------|
| `project_set` | Register a project path, returns its GUID. Also registers subprojects if root. |
| `project_get` | List all registered projects and their GUIDs for this session. |

### Project

| Tool | Description |
|------|-------------|
| `project_init` | Initialize project structure (single, root, or subproject). |
| `status` | Project health: evidence gate status, criteria locked, peer review, TBD count, finding/candidate totals. |

### Findings

| Tool | Description |
|------|-------------|
| `finding_create` | Create finding with evidence grade, sources array, and disconfirmation. Nudges toward web research. |
| `finding_list` | List all findings with status and evidence grade. |
| `finding_update` | Update status, evidence grade, sources, disconfirmation, or claim. Gates HIGH evidence. |

### Candidates

| Tool | Description |
|------|-------------|
| `candidate_create` | Create candidate for evaluation. Landscape advisory on first candidate. |
| `candidate_list` | List all candidates with verdict status. |
| `candidate_update` | Update verdict (provisional/recommended/eliminated) or description. |
| `candidate_add_claim` | Add binary testable claim to validation checklist. |
| `candidate_resolve_claim` | Mark a claim Y or N (clears `_TBD_`). |

### Scoring

| Tool | Description |
|------|-------------|
| `criteria_lock` | Lock decision criteria weights. Required before scoring. |
| `candidate_score` | Score a candidate against locked criteria. Gated on criteria lock + peer review + no TBD. |
| `scoring_matrix_generate` | Generate comparison table from locked criteria + scored candidates. |

### Peer Review

| Tool | Description |
|------|-------------|
| `peer_review_log` | Log reviewer name and findings. Required before scoring. |

### Decision

| Tool | Description |
|------|-------------|
| `project_decide` | Record the final decision with rationale. |
| `project_supersede` | Mark a decided project as superseded by new research. |
| `research_brief` | Generate a layered research brief from a completed project. |
| `research_report` | Generate a full untruncated research report. |

## Development

```bash
pip install -e ".[dev]"
pytest
ruff check .
```

## License

MIT -- see [LICENSE](LICENSE).
