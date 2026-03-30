---
id: '0002'
title: 'Source triangulation: 2+ independent sources required for CONFIRMED grade'
status: open
evidence: CONFIRMED
sources:
- text: 'PMC — Principles, Scope, and Limitations of Methodological Triangulation
    (content_hash:9714985a)'
  tier: EXPERT
- text: 'European Journal of Epidemiology — Evidence triangulation in health research
    (content_hash:s10654024)'
  tier: EXPERT
- text: 'Scribbr — Triangulation in Research guide (content_hash:scribbr_t)'
  tier: SECONDARY
created: '2026-03-29'
disconfirmation: 'Searched for arguments against mandatory triangulation. Found that
  some fields accept single-source findings (case studies, unique observations). However,
  these are LOW/REASONED by definition — the claim is that CONFIRMED requires triangulation,
  not that all findings need it. No counter-evidence found against the specific claim.'
---

## Claim

Academic research methodology requires triangulation — using multiple independent sources to validate findings — as a core principle. Data triangulation 'strengthens reliability by using multiple sources' (ATLAS.ti, Scribbr). For research.md, this translates to a structural rule: findings marked CONFIRMED must cite 2+ independent sources. A single source, regardless of quality, should cap at REASONED. This is enforceable: the finding_create and finding_update tools could parse the source field for multiple entries, or require a sources array. The gate would be: finding_update to CONFIRMED fails if < 2 sources are listed. This is a low-friction gate that prevents the most common evidence failure mode: treating one person's opinion as fact.

## Supporting Evidence

> **Evidence: [CONFIRMED]** — PMC (Principles, Scope, and Limitations of Methodological Triangulation), European Journal of Epidemiology (Evidence triangulation in health research), Scribbr (Triangulation in Research guide), ATLAS.ti (guide to mixed methods triangulation), retrieved 2026-03-29

## Disconfirmation Search

Searched for arguments against mandatory triangulation. Found that some fields accept single-source findings (case studies, unique observations). However, these are LOW/REASONED by definition — the claim is that CONFIRMED requires triangulation, not that all findings need it. No counter-evidence found against the specific claim.

## Caveats

None identified yet.
