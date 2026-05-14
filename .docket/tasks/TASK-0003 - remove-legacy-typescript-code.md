---
id: TASK-0003
title: Remove legacy TypeScript code
status: Done
created: '2026-03-29'
priority: medium
tags:
  - cleanup
acceptance-criteria:
  - src/ directory removed
  - test/ directory removed
  - TS config files removed (tsconfig.json, vitest.config.ts)
  - refactor/ fixtures preserved
  - Python server still imports and runs correctly
updated: '2026-03-29'
---
The Python port is complete and verified. src/, test/, vitest.config.ts, tsconfig.json, and related TS config files are dead weight. They cause confusion (e.g. editing the wrong files). Remove them. Keep refactor/ (golden fixtures used to validate the port).
