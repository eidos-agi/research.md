---
id: TASK-0004
title: Add Python tests for evidence gates
status: Done
created: '2026-03-29'
priority: high
tags:
  - evidence-gates
  - testing
acceptance-criteria:
  - Unit tests for all 3 evidence gate functions
  - Integration tests for finding_create with HIGH evidence blocked by gates
  - Integration tests for finding_update upgrade to HIGH blocked by gates
  - Tests for vendor-only advisory
  - Tests for landscape scan advisory on candidate_create
  - All tests pass
updated: '2026-03-29'
---
No Python tests exist. The fixture suite validates old behavior but not the new evidence gates. Need tests for: gate_confirmed_triangulation (pass/fail), gate_confirmed_disconfirmation (pass/fail), gate_vendor_only_advisory, run_evidence_gates, and integration tests via finding_create/finding_update that exercise the gates end-to-end.
