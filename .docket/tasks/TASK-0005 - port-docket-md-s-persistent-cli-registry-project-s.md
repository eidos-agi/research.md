---
id: TASK-0005
title: Port docket.md's persistent CLI registry — project-set vanishes across invocations
status: To Do
created: '2026-08-19'
priority: Medium
tags:
  - bug
  - cli
acceptance-criteria:
  - finding-create works from any cwd after one project-set
  - stale registry entries rejected with clear message
  - MCP runtime unchanged (no registry writes)
---
Same per-process registration disease its sibling docket.md just fixed (docket.md TASK-0101, commit 9565de8, 2026-08-19): research-md project-init prints a GUID, then finding-create from any other cwd errors 'Unknown research_id... Call project_set' — _guid_to_path is in-memory, each CLI invocation a fresh process; only boot-from-cwd works. Hit live 2026-08-19 during the showme browser-ownership research (workaround: cd into the .research dir). Port the fix: RUNTIME flag (cli vs mcp), persist {guid: path} to ~/.research-md/cli-registry.json (atomic write, env override for tests), resolve falls back with stale-entry validation (research-md.json exists + id matches), CLI-shaped vs MCP-shaped error messages. docket.md's tests/test_cli_registry.py is the template.
