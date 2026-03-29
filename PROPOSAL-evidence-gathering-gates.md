# Proposal: Evidence Gathering Gates for research.md

**Author:** AIC (via Tipsy Trailer strategy session)
**Date:** 2026-03-29
**Research project:** 4d679af3-d280-4cee-ab9a-243f832c889a
**Status:** Draft

---

## The Problem

research.md enforces rigor in the **decision** phase but is silent on the **research** phase. An agent can:

1. Mark a finding `CONFIRMED` from a single blog post
2. Search only for confirming evidence
3. Cite vendor marketing as authoritative
4. Never search for disconfirming evidence
5. Skip exploring alternatives before narrowing to candidates

DESIGN.md says: *"make the right thing automatic and the wrong thing impossible."*

That principle currently stops at the evidence-gathering boundary.

---

## What the Research Says

| Domain | Key insight | Source |
|---|---|---|
| Academic methodology | Triangulation (2+ independent sources) is the standard for validated findings | PMC, European Journal of Epidemiology, Scribbr |
| Intelligence analysis | Analysis of Competing Hypotheses (ACH) requires listing ALL hypotheses before evaluating evidence; disconfirming evidence is the most valuable kind | CIA Tradecraft Primer, RAND, Richards Heuer |
| Decision science | Devil's advocacy groups had 33-34% higher decision quality than consensus groups | Schweiger et al. longitudinal study |
| Information literacy | CRAAP test (Currency, Relevance, Authority, Accuracy, Purpose) is the standard framework for source credibility | CSU Chico, EBSCO, widely adopted in academic settings |
| AI bias research | Confirmation bias is the second most common cognitive bias affecting AI-assisted decisions (37% of analysts) | Springer systematic lit review, PMC |

---

## Proposed Changes

### 1. Source Triangulation Gate (Hard)

**Rule:** `CONFIRMED` evidence grade requires 2+ independent sources.

**Implementation:**
- `finding_create` and `finding_update` accept a `sources` array (not just a freetext string)
- Each source entry has: `{ text: string, tier: string }`
- `finding_update` to `evidence: "CONFIRMED"` fails if `sources.length < 2`
- A single source, regardless of quality, caps the finding at `REASONED`

**Gate in `gates.ts`:**
```typescript
export function gateConfirmedTriangulation(finding: Finding): GateResult {
  if (finding.evidence === 'CONFIRMED' && finding.sources.length < 2) {
    return {
      passed: false,
      error: 'CONFIRMED evidence requires 2+ independent sources. ' +
             'Add more sources or downgrade to REASONED.'
    };
  }
  return { passed: true };
}
```

**Why hard gate:** This is the single most common evidence failure. One blog post is not confirmation. The gate is low-friction (just add a second source) but prevents the most egregious shortcuts.

---

### 2. Source Quality Tiers (Soft — metadata, no gate)

**Rule:** Each source is tagged with a quality tier.

**Tiers:**
| Tier | Description | Examples |
|---|---|---|
| `PRIMARY` | Original data, surveys, case studies, official docs | Census data, user study results, RFC specs |
| `EXPERT` | Industry analysis, experienced practitioners, peer-reviewed | PMC papers, RAND reports, Thoughtworks Radar |
| `SECONDARY` | Aggregation, comparison guides, educational content | Blog roundups, "X vs Y" articles, tutorials |
| `VENDOR` | Produced by a company with commercial interest in the conclusion | Asana's blog comparing itself to Trello |

**Implementation:**
- `source` field becomes `sources: Array<{ text: string, tier: "PRIMARY" | "EXPERT" | "SECONDARY" | "VENDOR" }>`
- Tier is recorded in the finding markdown as metadata
- No hard gate on tier (too subjective to enforce mechanically)
- **Advisory:** When a finding has only `VENDOR` sources, the tool returns a warning (not an error): *"All sources for this finding are vendor-produced. Consider seeking independent validation."*

**Why soft:** Source tier classification requires judgment. A vendor source can be accurate. An expert source can be wrong. The goal is awareness, not blocking.

---

### 3. Disconfirmation Search Gate (Hard)

**Rule:** `CONFIRMED` findings must include a documented disconfirmation search.

**Implementation:**
- New field on findings: `disconfirmation: string | null`
- Content: what the agent searched for to try to disprove the claim, and what it found
- `finding_update` to `evidence: "CONFIRMED"` fails if `disconfirmation` is null/empty

**Gate in `gates.ts`:**
```typescript
export function gateConfirmedDisconfirmation(finding: Finding): GateResult {
  if (finding.evidence === 'CONFIRMED' && !finding.disconfirmation) {
    return {
      passed: false,
      error: 'CONFIRMED evidence requires a disconfirmation search. ' +
             'Document what you searched for to disprove this claim ' +
             'and what you found. Use finding_update to add it.'
    };
  }
  return { passed: true };
}
```

**Example:**
```markdown
---
evidence: CONFIRMED
disconfirmation: >
  Searched "why Google Sheets fails for small business project management"
  and "solopreneurs who switched from Sheets to Asana." Found ProofHub article
  noting Sheets lacks dependency tracking and notifications. Also found Reddit
  threads where users outgrew Sheets at ~10 team members. These limitations
  are real but don't apply to Adrien's solo context — they're Phase 3 problems.
  The claim holds for the solo/early-stage use case.
---
```

**Why hard gate:** This is the CIA's key insight. The most valuable evidence is the evidence you search for and don't find. If an agent can't document what it looked for to disprove its own claim, the claim isn't confirmed — it's just uncontested. The gate forces the red team step that agents naturally skip.

---

### 4. Landscape Scan Advisory (Soft)

**Rule:** Before creating the first candidate, the agent should have explored the landscape of options.

**Implementation:**
- When `candidate_create` is called and no candidates exist yet, the tool returns a success response with an advisory:
  *"This is the first candidate. Before evaluating options, have you documented the full landscape? Consider a finding tagged 'landscape' listing all known alternatives — including ones you've decided not to evaluate — so the research record shows the aperture was wide before narrowing."*
- Not a gate. Not blocking. Just a nudge.

**Why soft:** Sometimes you know the candidates upfront. Sometimes the research naturally narrows. A hard gate here would be annoying in clear-cut cases. The advisory catches the cases where the agent is tunnel-visioning without adding friction to the normal path.

---

### 5. Evidence Grading Enforcement (Clarification of existing field)

**Current state:** `UNVERIFIED`, `REASONED`, `CONFIRMED` are freetext labels with no enforced meaning.

**Proposed definitions (documented, enforced by gates above):**

| Grade | Meaning | Requirements |
|---|---|---|
| `UNVERIFIED` | Claim recorded but not yet investigated | None |
| `REASONED` | Logical argument supported by 0-1 sources, or agent's analysis | At least a coherent argument documented |
| `CONFIRMED` | Claim validated by evidence | 2+ independent sources + disconfirmation search documented |

This makes the grades mean something structural, not just vibes.

---

## Updated Phase Flow

```
CURRENT:
  research → criteria_lock → peer_review → score → decide

PROPOSED:
  research → [evidence gates on CONFIRMED] → criteria_lock → peer_review → score → decide
             ↑                                    ↑
             │                                    │
             ├─ triangulation (2+ sources)        ├─ landscape advisory
             ├─ disconfirmation search             │   on first candidate
             └─ source tier awareness              │
                                                   │
                                              (existing gates unchanged)
```

The new gates live entirely in the `research` phase. They don't change the downstream flow at all. They only constrain when a finding can be upgraded to `CONFIRMED`.

---

## Migration

**Backwards compatible.** Existing findings with freetext `source` fields continue to work. The gates only fire on `finding_update` to `CONFIRMED` — existing findings aren't retroactively blocked.

To adopt:
1. `source` field accepts both string (legacy) and array (new)
2. New `disconfirmation` field defaults to null
3. Gates only enforce on explicit upgrade to `CONFIRMED`

---

## What This Doesn't Do

- **Doesn't automate research.** The agent still decides what to search for.
- **Doesn't assess source quality automatically.** Tier classification is agent-judged.
- **Doesn't replace peer review.** These gates are pre-peer-review, not a substitute.
- **Doesn't slow down exploratory findings.** Only `CONFIRMED` has gates. `UNVERIFIED` and `REASONED` remain frictionless.

---

## Summary

| Change | Type | Enforces |
|---|---|---|
| 2+ sources for CONFIRMED | Hard gate | Triangulation |
| Source quality tiers | Soft metadata | Awareness of source credibility |
| Disconfirmation search field | Hard gate | Red team / devil's advocate step |
| Landscape scan advisory | Soft nudge | Widen before narrowing |
| Evidence grade definitions | Documentation | Consistent meaning across projects |

Three of these are new gates in `gates.ts`. Two are advisory. All follow the DESIGN.md principle: make the right thing automatic and the wrong thing impossible.

---

## Sources

- [CIA Tradecraft Primer: Structured Analytic Techniques](https://www.cia.gov/resources/csi/static/Tradecraft-Primer-apr09.pdf)
- [RAND: Assessing the Value of Structured Analytic Techniques](https://www.rand.org/content/dam/rand/pubs/research_reports/RR1400/RR1408/RAND_RR1408.pdf)
- [Richards Heuer: Psychology of Intelligence Analysis](https://www.cia.gov/resources/csi/static/Pyschology-of-Intelligence-Analysis.pdf)
- [PMC: Principles, Scope, and Limitations of Methodological Triangulation](https://pmc.ncbi.nlm.nih.gov/articles/PMC9714985/)
- [European Journal of Epidemiology: Evidence triangulation in health research](https://link.springer.com/article/10.1007/s10654-024-01194-6)
- [Scribbr: Triangulation in Research](https://www.scribbr.com/methodology/triangulation/)
- [Scribbr: Applying the CRAAP Test](https://www.scribbr.com/working-with-sources/craap-test/)
- [EBSCO: CRAAP Test Research Starter](https://www.ebsco.com/research-starters/social-sciences-and-humanities/craap-test)
- [Springer: Systematic Literature Review on Bias Mitigation in Generative AI](https://link.springer.com/article/10.1007/s43681-025-00721-9)
- [Schweiger et al. on Devil's Advocacy (via LSA Global)](https://lsaglobal.com/how-teams-avoid-groupthink/)
- [Canvalytic: What are Structured Analytic Techniques and Why Does the CIA Use Them?](https://www.canvalytic.com/post/what-are-structured-analytic-techniques-and-why-does-the-cia-use-them)
