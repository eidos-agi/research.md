---
id: "GUARD-003"
type: "guardrail"
title: "Gates must reject with actionable error messages"
status: "active"
date: "2026-03-31"
---

When a gate blocks a finding or score, the error message must tell the agent exactly what to do next. Not just "rejected" but "you need X, here's the format, if you haven't done X yet use grade Y instead." The agent's next action should be obvious from the error message alone. This is what makes the tool force action instead of just blocking it.
