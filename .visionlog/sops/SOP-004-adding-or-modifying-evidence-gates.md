---
id: "SOP-004"
type: "sop"
title: "Adding or modifying evidence gates"
status: "draft"
date: "2026-03-31"
---

When adding a new evidence gate or modifying an existing one:

1. **Design the gate** — What does it require? What error message does the agent see? What's the escape hatch (downgrade path)?
2. **Implement in TypeScript first** (src/server.ts, src/gates.ts, src/files.ts) — this is the production server
3. **Port to Python** (research_md/server.py, research_md/gates.py, research_md/files.py) — must match exactly
4. **Update the schema** — enum values in inputSchema (TS) and tool decorators (Python)
5. **Update resources.ts** — the workflow overview that agents read on boot
6. **Update README.md** — evidence grades table
7. **Build** — `npm run build` must pass clean
8. **Write tests** — at minimum: gate rejects bad input, gate accepts good input, error message is actionable
9. **Update golden fixtures** if any in refactor/ reference changed grades

GUARD-002 requires TS and Python to stay in sync. GUARD-003 requires actionable error messages. Check both before shipping.
