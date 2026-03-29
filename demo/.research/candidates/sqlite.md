---
title: SQLite
verdict: recommended
---

## What It Is

Embedded SQL database. Single file, zero config, included in Python stdlib. Handles reads at any scale and writes up to moderate concurrency.

## Validation Checklist

- [x] Claim 1: Zero operational overhead — YES, confirmed by finding 0001
- [x] Claim 2: Handles <1000 concurrent users — YES, well within limits
- [x] Claim 3: Backup is a file copy — YES, documented on sqlite.org

## Scoring

| Criterion | Weight | Score | Weighted |
|-----------|--------|-------|----------|
| Operational simplicity | 40% | 10 | 4.0 |
| Cost | 30% | 10 | 3.0 |
| Query capability | 20% | 7 | 1.4 |
| Ecosystem/tooling | 10% | 6 | 0.6 |
| **Total** | | | **9.0** |
