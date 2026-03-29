---
title: PostgreSQL (managed)
verdict: eliminated
---

## What It Is

Full-featured relational database via managed service (Supabase or Neon). Excellent query capabilities and ecosystem, but requires server management or vendor dependency.

## Validation Checklist

- [x] Claim 1: Requires server process or managed service — YES
- [x] Claim 2: Free tier available — YES (Supabase, Neon both have free tiers)
- [x] Claim 3: More operational complexity than SQLite — YES, per finding 0002

## Scoring

| Criterion | Weight | Score | Weighted |
|-----------|--------|-------|----------|
| Operational simplicity | 40% | 5 | 2.0 |
| Cost | 30% | 7 | 2.1 |
| Query capability | 20% | 10 | 2.0 |
| Ecosystem/tooling | 10% | 10 | 1.0 |
| **Total** | | | **7.1** |
