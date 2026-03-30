---
id: '0001'
title: 'SQLite requires zero operational overhead'
status: open
evidence: CONFIRMED
sources:
- text: 'https://sqlite.org/whentouse.html (content_hash:a3f1b2c4)'
  tier: PRIMARY
- text: 'https://www.epicweb.dev/why-you-should-probably-be-using-sqlite (content_hash:d7e8f9a1)'
  tier: EXPERT
disconfirmation: 'Searched "SQLite production failures" and "SQLite scaling problems." Found reports of write contention above ~100 concurrent writers, but this does not apply to a solo SaaS with <1000 users.'
created: '2026-03-15'
---

## Claim

SQLite requires no separate server process, no configuration, no DBA. The database is a single file. Backups are a file copy.

## Supporting Evidence

> **Source [PRIMARY]:** https://sqlite.org/whentouse.html (content_hash:a3f1b2c4), retrieved 2026-03-15
>
> **Source [EXPERT]:** https://www.epicweb.dev/why-you-should-probably-be-using-sqlite (content_hash:d7e8f9a1), retrieved 2026-03-15

## Disconfirmation Search

Searched "SQLite production failures" and "SQLite scaling problems." Found reports of write contention above ~100 concurrent writers, but this does not apply to a solo SaaS with <1000 users.

## Caveats

Write-heavy workloads with high concurrency are a known limitation. Not relevant for the target use case.
