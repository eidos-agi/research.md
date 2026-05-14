---
id: "GUARD-002"
type: "guardrail"
title: "Both TypeScript and Python servers must stay in sync"
status: "active"
date: "2026-03-31"
---

The TypeScript server (src/server.ts) is the active production server. The Python server (research_md/server.py) is the port. Any gate, grade, or validation change must be applied to both. If they diverge, agents hitting the Python server will bypass gates that the TS server enforces. Test both.
