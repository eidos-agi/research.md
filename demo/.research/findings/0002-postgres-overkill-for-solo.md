---
id: '0002'
title: 'PostgreSQL is overkill for solo projects under 1000 users'
status: open
evidence: MODERATE
sources:
- text: 'https://supabase.com/docs/guides/getting-started (content_hash:b4c5d6e7)'
  tier: VENDOR
- text: 'https://news.ycombinator.com/item?id=38786293 (content_hash:f8a9b0c1)'
  tier: SECONDARY
disconfirmation: null
created: '2026-03-16'
---

## Claim

PostgreSQL requires a running server, connection management, and operational knowledge. Managed services (Supabase, Neon) reduce ops but add cost and vendor dependency.

## Supporting Evidence

> **Source [VENDOR]:** https://supabase.com/docs/guides/getting-started (content_hash:b4c5d6e7), retrieved 2026-03-16
>
> **Source [SECONDARY]:** https://news.ycombinator.com/item?id=38786293 (content_hash:f8a9b0c1), retrieved 2026-03-16

## Caveats

PostgreSQL is the right choice at scale. This finding is scoped to the solo/<1000 user context.
