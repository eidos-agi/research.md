---
id: "ADR-001"
type: "decision"
title: "Eliminate LOW evidence grade \u2014 enforce source proof at write time"
status: "accepted"
date: "2026-03-31"
---

## Context

On 2026-03-30, an agent used research.md to file 20+ findings across multiple ASMP research projects. Every finding was graded LOW with no primary source material consulted. The agent asked Gemini a question, filed the one-sentence summary as a "finding," and moved on. The user caught it and called it "hot garbage."

The evidence grade system (UNVERIFIED → LOW → MODERATE → HIGH) was supposed to gate quality, but LOW required literally nothing. The tool accepted "Gemini said so" as a source. There was no enforcement of actual research.

## Decision

Collapse 4 evidence grades to 3, with structural enforcement at write time:

- **UNVERIFIED** — no source required, but findings are flagged as placeholders and will NOT count toward scoring
- **REASONED** — requires `content_hash:` proof + `source_url` (proves you fetched and read a primary document)
- **CONFIRMED** — requires everything REASONED needs + `disconfirmation` search (20+ chars documenting what you searched for to disprove the claim)

Added `gateEvidenceQuality` to scoring gates — blocks `candidate_score` if all findings are UNVERIFIED.

Same gates enforced on `finding_update` upgrades.

## Consequences

- LOW grade is eliminated. Agents cannot file findings above UNVERIFIED without proving they read a source.
- Existing findings with OLD grades (HIGH/MODERATE/LOW) in completed projects won't match new enum — this is acceptable since those projects are already decided.
- Phase 2 work remains: depth enforcement, landscape scan advisory, source triangulation for CONFIRMED.
- The test fixture suite (refactor/verify-fixtures.py) references old grades and will need updating.

## References

- GitHub issue: eidos-agi/research.md#1
- Session: cockpit-eidos, 2026-03-31
- Prior art: PROPOSAL-evidence-gathering-gates.md (draft, 2026-03-29)
