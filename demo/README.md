# Demo: Database Selection for Solo SaaS

This is a complete research.md project showing the full workflow from question to decision.

## What's here

```
.research/
  research.json           <- project config (phase: decided)
  findings/
    0001-sqlite-zero-ops.md       <- CONFIRMED evidence (2 sources + disconfirmation)
    0002-postgres-overkill.md     <- REASONED evidence (vendor + secondary sources)
  candidates/
    sqlite.md             <- recommended (score: 9.0)
    postgresql.md         <- eliminated (score: 7.1)
  evaluations/
    decision-criteria.md  <- locked criteria with weights
    peer-review.md        <- reviewer attestations
  DECISION.md             <- final decision with rationale
```

## Evidence gates in action

- Finding 0001 is **CONFIRMED** — has 2 independent sources (sqlite.org + epicweb.dev) and a documented disconfirmation search ("SQLite production failures").
- Finding 0002 is **REASONED** — has sources but no disconfirmation search, so it can't be upgraded to CONFIRMED.

## Try it

```bash
# Register the demo project
project_set /path/to/research-md/demo

# Check project health
status <research_id>
```
