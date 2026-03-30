---
id: '0005'
title: 'Landscape scan: agents should widen before narrowing to candidates'
status: open
evidence: REASONED
sources:
- text: 'CIA Tradecraft Primer — premature narrowing as analytical failure mode (content_hash:cia_apr09)'
  tier: PRIMARY
created: '2026-03-29'
---

## Claim

The CIA's structured analytic techniques emphasize that premature narrowing is a primary source of analytical failure. The ACH methodology explicitly requires listing ALL possible hypotheses before evaluating evidence. In research.md's current flow, an agent can jump directly from question to candidates without exploring the landscape. For the Tipsy Trailer project, we evaluated Sheets vs Asana vs Trello but never considered Notion, Airtable, Todoist, or pen-and-paper. A 'landscape scan' step — between findings and candidates — would prompt the agent to document what options exist before choosing which to evaluate. This could be a soft gate (advisory prompt when creating the first candidate: 'Have you documented the full landscape of options?') or a hard gate (require a finding tagged 'landscape' before candidates can be created). The soft gate aligns better with research.md's philosophy of not blocking productive work unnecessarily.

## Supporting Evidence

> **Evidence: [REASONED]** — CIA Tradecraft Primer (structured analytic techniques), Analysis of Competing Hypotheses methodology (Heuer), observed gap in Tipsy Trailer project (7921f25f), retrieved 2026-03-29

## Caveats

None identified yet.
