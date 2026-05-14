---
id: "SOP-005"
type: "sop"
title: "Resuming work on research.md evidence enforcement"
status: "draft"
date: "2026-03-31"
---

When picking this project back up:

1. **Read visionlog** — vision, goals, guardrails, ADR-001
2. **Read ike task list** — `ike task_list` shows current state
3. **Check the GitHub issue** — eidos-agi/research.md#1 may have new comments
4. **Run `npm run build`** in the research.md repo to verify current state compiles
5. **Priority order**: TASK-0001 (tests) → TASK-0002 (depth) → TASK-0003 (triangulation) → TASK-0005 (UNVERIFIED cap) → TASK-0004 (landscape advisory)
6. **The key files**: src/server.ts (TS production), src/gates.ts (scoring gates), src/files.ts (types), research_md/server.py (Python port), research_md/gates.py (Python gates)
7. **The active MCP config** runs the TypeScript build via `bin/research-md.js mcp start`
