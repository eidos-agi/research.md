---
chosen: sqlite
date: '2026-03-19'
---

# Decision

SQLite is the recommended database for this solo SaaS project.

## Rationale

SQLite scored 9.0 vs PostgreSQL's 7.1. The decisive factor was operational simplicity (40% weight) — SQLite requires zero infrastructure, zero configuration, and backups are a file copy. PostgreSQL's superior query capabilities don't justify the operational overhead at <1000 users.

## When to revisit

Revisit this decision if:
- Concurrent write volume exceeds ~50 writers/second
- Team grows beyond 2 developers needing concurrent schema migrations
- Analytical query requirements exceed SQLite's window function support
