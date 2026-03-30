---
id: '0001'
title: 'The gap: research.md enforces downstream rigor but not upstream evidence gathering'
status: open
evidence: CONFIRMED
sources: 1
created: '2026-03-29'
---

## Claim

research.md's current gates (criteria locking, peer review, TBD resolution) enforce rigor in the decision phase but are completely silent on the research phase. An agent can: (1) mark a finding CONFIRMED from a single source, (2) search only for confirming evidence, (3) cite vendor marketing as authoritative, (4) never search for disconfirming evidence, and (5) skip exploring alternatives before narrowing to candidates. The DESIGN.md states 'make the right thing automatic and the wrong thing impossible' — but this principle stops at the evidence-gathering boundary. The evidence grading field (UNVERIFIED/REASONED/CONFIRMED) is self-assessed with no structural enforcement. This is equivalent to having strict courtroom rules of evidence but no investigation standards for the police.

## Supporting Evidence

> **Evidence: [CONFIRMED]** — Direct analysis of research.md source code (gates.ts, DESIGN.md). Observed during Tipsy Trailer project (7921f25f) where 6 findings were created with ad-hoc web research and no disconfirmation search., retrieved 2026-03-29

## Caveats

None identified yet.
