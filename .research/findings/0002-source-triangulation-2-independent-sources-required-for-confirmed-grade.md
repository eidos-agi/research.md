---
id: '0002'
title: 'Source triangulation: 2+ independent sources required for CONFIRMED grade'
status: open
evidence: CONFIRMED
sources: 1
created: '2026-03-29'
---

## Claim

Academic research methodology requires triangulation — using multiple independent sources to validate findings — as a core principle. Data triangulation 'strengthens reliability by using multiple sources' (ATLAS.ti, Scribbr). For research.md, this translates to a structural rule: findings marked CONFIRMED must cite 2+ independent sources. A single source, regardless of quality, should cap at REASONED. This is enforceable: the finding_create and finding_update tools could parse the source field for multiple entries, or require a sources array. The gate would be: finding_update to CONFIRMED fails if < 2 sources are listed. This is a low-friction gate that prevents the most common evidence failure mode: treating one person's opinion as fact.

## Supporting Evidence

> **Evidence: [CONFIRMED]** — PMC (Principles, Scope, and Limitations of Methodological Triangulation), European Journal of Epidemiology (Evidence triangulation in health research), Scribbr (Triangulation in Research guide), ATLAS.ti (guide to mixed methods triangulation), retrieved 2026-03-29

## Caveats

None identified yet.
