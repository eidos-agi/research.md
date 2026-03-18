# Design: research.md

## The Problem

AI agents skip process when they're under time pressure or context is long. Advisory rules in markdown — "lock criteria before scoring," "do peer review first" — are ignored the moment they're inconvenient. The agent has good intentions but no guardrails.

This is true for two categories of mistakes:

1. **Process shortcuts** — scoring without peer review, accepting decisions without documenting alternatives
2. **Wrong-target writes** — operating on the wrong research project because the agent guessed from its working directory

Both categories share a root cause: the tooling trusts the agent to do the right thing. research.md doesn't.

## Two Layers of Enforcement

### Layer 1: Process Gates

Certain research operations have prerequisites. research.md encodes these as hard failures:

| Gate | Tool | Prerequisite |
|------|------|-------------|
| Criteria must be locked before scoring | `candidate_score` | `criteria_lock` must have been called |
| Peer review must exist before scoring | `candidate_score` | `peer_review_log` must have been called |
| No unresolved claims before scoring | `candidate_score` | All `_TBD_` items must be resolved Y/N |

These aren't warnings. The tool returns an error with `isError: true`. The agent cannot proceed. The error message tells it exactly what's missing and which tool to call.

The gates exist because research quality degrades silently. An unreviewed scoring matrix looks identical to a reviewed one. A score assigned before criteria were locked might have been anchored to a preferred candidate. The output looks fine. The process was wrong. By the time anyone notices, the decision is made.

### Layer 2: GUID-Based Project Targeting

Every research project gets a UUID at initialization:

```json
{
  "id": "959b9b96-7f18-4ccb-8e22-76ab54301086",
  "version": "0.1.0",
  "projectName": "secrets-manager",
  "created": "2026-03-18"
}
```

Every tool call requires this GUID as `research_id`. No GUID, no operation.

This solves a problem that most MCP servers ignore: **how does the server know which project the agent is talking about?**

The common answer is working directory detection — walk up the filesystem looking for a config file, infer the project from `cwd`. This is fragile:

- The agent doesn't control its own `cwd`. That's set by how the user launched their editor.
- Moving a terminal tab, opening a second workspace, or renaming a folder silently changes which project the server operates on.
- In a multi-project research repo, `cwd` is ambiguous — are you in the root or a subproject?
- Detection failures are silent. The server finds the wrong config and writes to the wrong project. Nothing errors. The agent doesn't know.

research.md rejects detection entirely. The agent must:

1. **Call `project_set`** with an explicit path to register the project
2. **Read the config file** to discover the GUID
3. **Pass the GUID on every tool call**

If the GUID is missing, the tool fails with:

> Missing required parameter: research_id. Read the project's research-md.json file to find the 'id' field (a UUID). If the project hasn't been registered this session, call `project_set` with its path first.

If the GUID is wrong or unregistered:

> Unknown research_id '...'. This project hasn't been registered in this session. Call `project_set` with the project's path to register it.

The error messages are instructional. They don't just say "failed" — they tell the agent exactly what to do next.

## Why a GUID Instead of a Path

A path would work mechanically. But a GUID forces the agent to read the config file before operating. This is the intentionality gate:

- **Path**: the agent can construct it from convention (`/home/dev/repos/research/secrets-manager`). It might be right. It might be stale.
- **GUID**: the agent must open `research-md.json` and extract the `id` field. This guarantees it has seen the current state of the project config before writing to it.

The extra friction is the point. Making the agent work to obtain the targeting key ensures it knows exactly which project it's about to modify. Wrong-project writes become structurally impossible rather than merely unlikely.

## Multi-Project, Multi-Window, No Singletons

The GUID-to-path mapping lives in process memory, not on disk. Each Claude Code window spawns its own MCP server process. Each process maintains its own independent map.

- Window 1 registers `secrets-manager` (GUID A) → operates on secrets-manager
- Window 2 registers `cost-accounting` (GUID B) → operates on cost-accounting
- Neither blocks the other. No shared state. No lock contention.

A single session can also register multiple projects simultaneously:

```
project_set /home/dev/repos/research  → registers root + all subprojects
```

The root GUID is registered but can't be used directly for data operations — it points to a container, not a project. The agent must use a subproject's GUID. If it tries the root GUID on `finding_create`, it gets:

> research_id '...' points to a multi-project root, not a specific project. Use the research_id of one of its subprojects: secrets-manager, cost-accounting.

## Project Structure

research.md supports standalone projects and multi-project roots:

```
# Standalone
my-research/
├── research-md.json    ← { id: "...", projectName: "my-research" }
├── findings/
├── candidates/
└── evaluations/

# Multi-project root
research/
├── research-md.json    ← { id: "...", projects: ["secrets-manager", "cost-accounting"] }
├── secrets-manager/
│   ├── research-md.json  ← { id: "...", projectName: "secrets-manager" }
│   ├── findings/
│   ├── candidates/
│   └── evaluations/
└── cost-accounting/
    ├── research-md.json  ← { id: "...", projectName: "cost-accounting" }
    └── ...
```

Each subproject is fully self-contained. Extract it to its own repo and it works standalone — it has its own config, its own GUID, its own folder structure. The root config is just a convenience for grouping related research.

## Comparison to Backlog.md

research.md is modeled on [Backlog.md](https://github.com/MrLesk/Backlog.md), the task management MCP. The structural patterns are aligned:

| Pattern | Backlog.md | research.md |
|---------|-----------|-------------|
| Transport | stdio | stdio |
| CLI structure | `backlog init` / `backlog mcp start` | `research-md init` / `research-md mcp start` |
| Tool naming | `task_create`, `task_list` | `finding_create`, `candidate_list` |
| Schema enforcement | `additionalProperties: false` | `additionalProperties: false` |
| Error hierarchy | `McpError` → subtypes | `ResearchError` → subtypes |

The key divergence is project targeting:

| | Backlog.md | research.md |
|--|-----------|-------------|
| Project detection | `cwd` + `BACKLOG_CWD` env var | None — explicit GUID |
| Multi-project | Not supported | Root + subprojects |
| Concurrency | One project per process | Multiple projects per process |
| Wrong-target protection | None (trusts cwd) | GUID mismatch = hard fail |

## Summary

research.md enforces two things:

1. **You can't skip process.** The gates are in the code, not in a conventions doc.
2. **You can't hit the wrong target.** The GUID is a targeting lock that requires intentional acquisition.

Both follow the same principle: make the right thing automatic and the wrong thing impossible. Advisory rules get skipped. Tooling doesn't.
