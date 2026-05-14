---
id: TASK-0002
title: Clarify HIGH vs CONFIRMED evidence grade semantics
status: Done
created: '2026-03-29'
priority: medium
tags:
  - evidence-gates
  - docs
acceptance-criteria:
  - Evidence grade semantics are documented and unambiguous
  - Tool descriptions reflect the enforced meaning of each grade
  - DESIGN.md updated with the new definitions
updated: '2026-03-29'
---
The proposal used CONFIRMED as the grade name but the codebase uses HIGH/MODERATE/LOW/UNVERIFIED. HIGH originally meant "peer-reviewed, primary source" and now means "2+ sources + disconfirmation." This is a subtle redefinition that could confuse agents. Either rename the grade, update DESIGN.md and tool descriptions to be explicit about the new meaning, or add CONFIRMED as an alias.
