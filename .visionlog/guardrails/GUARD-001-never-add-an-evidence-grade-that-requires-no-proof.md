---
id: "GUARD-001"
type: "guardrail"
title: "Never add an evidence grade that requires no proof"
status: "active"
date: "2026-03-31"
adr: "ADR-001"
---

The LOW grade existed and required nothing — it was exploited to file 20+ zero-effort findings. Any new evidence grade MUST require structural proof of source engagement. UNVERIFIED is the only grade that requires nothing, and it is explicitly flagged as a placeholder that does not count toward scoring. Never create a grade between UNVERIFIED and REASONED that relaxes the content_hash requirement.
