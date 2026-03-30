# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-03-29

### Fixed
- Ruff lint and format issues (unused import, ambiguous variable name, dead code).
- Missed HIGH/MODERATE references in DESIGN.md and demo peer-review.

## [0.4.0] - 2026-03-29

### Changed
- **BREAKING:** Evidence grades renamed for clarity: `HIGH` → `CONFIRMED`, `MODERATE` → `REASONED`. `LOW` and `UNVERIFIED` unchanged. Existing findings with old grade names will need manual update.
- `REASONED` is now a hard gate — requires at least 1 source. Previously `MODERATE` was advisory-only for source count.

### Added
- `gate_reasoned_has_source` — blocks upgrade to REASONED without at least 1 source with content_hash proof. This closes the gap where agents could stay at reasoning-only evidence indefinitely.
- YAML serializer tests (13 tests) covering quoting edge cases and list indentation round-trips.
- 10 new tests for REASONED gate (unit + integration). Total: 62 tests.

## [0.3.0] - 2026-03-29

### Added
- **Evidence gates for HIGH findings** -- 2+ independent sources and a documented disconfirmation search required before a finding can be graded HIGH. Enforced as hard gates in `finding_create` and `finding_update`.
- **Source quality tiers** -- sources tagged as PRIMARY, EXPERT, SECONDARY, or VENDOR. Soft advisory when all sources are VENDOR tier.
- **Web research nudge** -- tool returns advisory when findings are created without sources, prompting agents to use WebSearch/WebFetch.
- **Landscape scan advisory** -- nudge on first `candidate_create` to document the full option landscape before narrowing.
- **Disconfirmation field** -- findings now track what the agent searched for to disprove the claim and what it found.
- **Sources array** -- findings accept structured source entries with text and tier, replacing the legacy single-source string (backward compatible).
- **Python test suite** -- 38 pytest tests covering evidence gates (unit) and server tool integration.
- **Status display enhancements** -- shows source counts per finding and gate failure warnings.

### Changed
- DESIGN.md updated from two-layer to three-layer enforcement model (evidence gates, process gates, GUID targeting).
- Evidence grade definitions now have enforced structural meaning, not just labels.
- README fully rewritten for Python package (was still referencing Node.js/npm).

### Removed
- Legacy TypeScript source code (`src/`, `test/`, `tsconfig.json`, `vitest.config.ts`, `package.json`). Python port is the sole implementation.

### Fixed
- `research_report` source count now handles array sources correctly (was rendering raw list).
- YAML serializer properly quotes strings with colons and special characters.
- YAML list indentation handles nested dict-in-list structures (source arrays).

## [0.2.1] - 2026-03-27

### Fixed
- Nested f-string syntax that broke Python < 3.12.

## [0.2.0] - 2026-03-26

### Added
- Complete Python port of the TypeScript MCP server (98.6% fixture parity, then 100%).
- 70 golden fixtures for cross-implementation validation.
- `project_decide` tool -- record final decisions with rationale.
- `project_supersede` tool -- mark decided projects as superseded.
- `research_brief` tool -- generate layered briefs from completed research.
- `research_report` tool -- generate full untruncated reports.
- Layered evidence integrity -- HIGH/MODERATE require `content_hash:` proof of source consultation.
- `.research/` directory convention -- all artifacts under dot-dir, no root pollution.
- Phase state machine with transition log.
- Integrity checker validating phase vs actual project state.

### Changed
- Build system migrated from TypeScript/Node to Python/hatchling.
- All tools now use Python FastMCP instead of TypeScript MCP SDK.

## [0.1.0] - 2026-03-22

### Added
- Initial release: MCP server for structured research workflows.
- 16 tools: findings, candidates, scoring, peer review, criteria locking.
- GUID-based project targeting (no working directory detection).
- Multi-project root support.
- Process gates: criteria locked, peer review, no TBD before scoring.
- Instructional error messages with remediation steps.
