/**
 * Golden fixture capture for research.md TypeScript → Python migration.
 * Walks through the full research lifecycle: init → findings → candidates →
 * criteria → lock → review → score → decide.
 */

import { createServer } from "../dist/server.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

async function callTool(server, name, args) {
  const handler = server._requestHandlers?.get("tools/call");
  if (!handler) throw new Error("No call handler");
  const result = await handler({
    method: "tools/call",
    params: { name, arguments: args },
  }, {});
  return result;
}

function saveFixture(toolName, fixtureId, input, output, sideEffects = {}) {
  const dir = path.join(FIXTURES_DIR, toolName);
  fs.mkdirSync(dir, { recursive: true });
  const fixture = {
    tool: toolName,
    fixture_id: fixtureId,
    input,
    output,
    side_effects: sideEffects,
    source_language: "typescript",
    captured_at: new Date().toISOString().split("T")[0],
  };
  fs.writeFileSync(
    path.join(dir, `${fixtureId}.json`),
    JSON.stringify(fixture, null, 2) + "\n"
  );
}

async function main() {
  const server = createServer();

  // ── project_init ────────────────────────────────────────────────────────
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmd-fix-"));
    const input = { path: dir, name: "test-research", question: "What is the best approach?", context: "We need to decide on architecture." };
    const output = await callTool(server, "project_init", input);
    saveFixture("project_init", "001-with-question", input, output);
  }

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmd-fix-"));
    const input = { path: dir };
    const output = await callTool(server, "project_init", input);
    saveFixture("project_init", "002-no-question", input, output);
  }

  // ── Full lifecycle in one project ────────────────────────────────────────
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "rmd-lifecycle-"));
  await callTool(server, "project_init", {
    path: projDir, name: "lifecycle-test",
    question: "Which database should we use?",
    context: "Evaluating Postgres vs SQLite for our MCP server data."
  });

  // Register it
  const setOutput = await callTool(server, "project_set", { path: projDir });
  saveFixture("project_set", "001-happy-path", { path: projDir }, setOutput);

  const ridMatch = setOutput.content[0].text.match(/ID: ([a-f0-9-]+)/);
  const rid = ridMatch[1];

  // project_get
  {
    const output = await callTool(server, "project_get", {});
    saveFixture("project_get", "001-with-projects", {}, output);
  }

  // ── finding_create ──────────────────────────────────────────────────────
  {
    const input = { research_id: rid, title: "Postgres handles concurrent writes better", claim: "Postgres WAL-based concurrency handles 10x more concurrent writes than SQLite.", evidence: "LOW", source: "Team experience" };
    const output = await callTool(server, "finding_create", input);
    saveFixture("finding_create", "001-low-evidence", input, output);
  }

  {
    const input = { research_id: rid, title: "SQLite is zero-config", claim: "SQLite requires no server process, no configuration, and works out of the box.", evidence: "UNVERIFIED" };
    const output = await callTool(server, "finding_create", input);
    saveFixture("finding_create", "002-unverified", input, output);
  }

  {
    // HIGH evidence requires content_hash
    const input = { research_id: rid, title: "Postgres benchmarks", claim: "Official benchmarks show 50k TPS.", evidence: "HIGH", source: "postgresql.org (content_hash:abc12345)" };
    const output = await callTool(server, "finding_create", input);
    saveFixture("finding_create", "003-high-with-hash", input, output);
  }

  {
    // HIGH evidence without hash should fail
    const input = { research_id: rid, title: "Should fail", claim: "No hash provided.", evidence: "HIGH", source: "some blog" };
    const output = await callTool(server, "finding_create", input);
    saveFixture("finding_create", "004-high-no-hash-error", input, output);
  }

  // ── finding_list ────────────────────────────────────────────────────────
  {
    const output = await callTool(server, "finding_list", { research_id: rid });
    saveFixture("finding_list", "001-with-findings", { research_id: rid }, output);
  }

  // ── finding_update ──────────────────────────────────────────────────────
  {
    const input = { research_id: rid, id: "0001", status: "confirmed", evidence: "MODERATE" };
    const output = await callTool(server, "finding_update", input);
    saveFixture("finding_update", "001-update-status", input, output);
  }

  // ── candidate_create ────────────────────────────────────────────────────
  {
    const input = { research_id: rid, title: "PostgreSQL", description: "Full-featured relational database" };
    const output = await callTool(server, "candidate_create", input);
    saveFixture("candidate_create", "001-with-description", input, output);
  }

  {
    const input = { research_id: rid, title: "SQLite", slug: "sqlite" };
    const output = await callTool(server, "candidate_create", input);
    saveFixture("candidate_create", "002-with-slug", input, output);
  }

  {
    // Duplicate should fail
    const input = { research_id: rid, title: "SQLite", slug: "sqlite" };
    const output = await callTool(server, "candidate_create", input);
    saveFixture("candidate_create", "003-duplicate-error", input, output);
  }

  // ── candidate_list ──────────────────────────────────────────────────────
  {
    const output = await callTool(server, "candidate_list", { research_id: rid });
    saveFixture("candidate_list", "001-with-candidates", { research_id: rid }, output);
  }

  // ── candidate_update ────────────────────────────────────────────────────
  {
    const input = { research_id: rid, slug: "postgresql", verdict: "recommended" };
    const output = await callTool(server, "candidate_update", input);
    saveFixture("candidate_update", "001-update-verdict", input, output);
  }

  // ── candidate_add_claim ─────────────────────────────────────────────────
  {
    const input = { research_id: rid, slug: "postgresql", claim: "Handles >10k concurrent connections" };
    const output = await callTool(server, "candidate_add_claim", input);
    saveFixture("candidate_add_claim", "001-add-claim", input, output);
  }

  // ── candidate_resolve_claim ─────────────────────────────────────────────
  {
    // Resolve first TBD claim (claim 1)
    const input = { research_id: rid, slug: "postgresql", claim_index: 1, result: "Y" };
    const output = await callTool(server, "candidate_resolve_claim", input);
    saveFixture("candidate_resolve_claim", "001-resolve-yes", input, output);
  }

  {
    // Resolve second claim
    const input = { research_id: rid, slug: "postgresql", claim_index: 1, result: "N" };
    const output = await callTool(server, "candidate_resolve_claim", input);
    saveFixture("candidate_resolve_claim", "002-resolve-no", input, output);
  }

  // Resolve SQLite claims too (need TBD-free for scoring later)
  {
    const input = { research_id: rid, slug: "sqlite", claim_index: 1, result: "Y" };
    await callTool(server, "candidate_resolve_claim", input);
  }

  // ── Set up decision criteria (manual file, then lock) ───────────────────
  // Create decision-criteria.md manually (this is normally done by the user)
  const criteriaDir = path.join(projDir, ".research", "evaluations");
  fs.mkdirSync(criteriaDir, { recursive: true });
  const criteriaContent = `---
locked: false
locked_date: null
---

# Decision Criteria

| # | Criterion | Weight |
|---|-----------|--------|
| 1 | Performance | 3 |
| 2 | Simplicity | 2 |
| 3 | Ecosystem | 1 |
`;
  fs.writeFileSync(path.join(criteriaDir, "decision-criteria.md"), criteriaContent);

  // ── criteria_lock ───────────────────────────────────────────────────────
  {
    const output = await callTool(server, "criteria_lock", { research_id: rid });
    saveFixture("criteria_lock", "001-lock", { research_id: rid }, output);
  }

  {
    // Already locked
    const output = await callTool(server, "criteria_lock", { research_id: rid });
    saveFixture("criteria_lock", "002-already-locked", { research_id: rid }, output);
  }

  // ── status ──────────────────────────────────────────────────────────────
  {
    const output = await callTool(server, "status", { research_id: rid });
    saveFixture("status", "001-mid-project", { research_id: rid }, output);
  }

  // ── peer_review_log ─────────────────────────────────────────────────────
  {
    const input = {
      research_id: rid,
      reviewer: "Gemini 2.5 Pro",
      findings: ["Postgres concurrency claim is well-supported", "SQLite simplicity is obvious but understated"],
      attestations: { "0003": "ATTESTED" },
      notes: "Solid research. Consider adding latency benchmarks."
    };
    const output = await callTool(server, "peer_review_log", input);
    saveFixture("peer_review_log", "001-with-attestations", input, output);
  }

  // ── candidate_score ─────────────────────────────────────────────────────
  {
    const input = { research_id: rid, slug: "postgresql", scores: { "Performance": 9, "Simplicity": 5, "Ecosystem": 8 }, notes: "Strong all-around" };
    const output = await callTool(server, "candidate_score", input);
    saveFixture("candidate_score", "001-score-postgres", input, output);
  }

  {
    const input = { research_id: rid, slug: "sqlite", scores: { "Performance": 4, "Simplicity": 10, "Ecosystem": 5 }, notes: "Simple but limited" };
    const output = await callTool(server, "candidate_score", input);
    saveFixture("candidate_score", "002-score-sqlite", input, output);
  }

  // ── scoring_matrix_generate ─────────────────────────────────────────────
  {
    const output = await callTool(server, "scoring_matrix_generate", { research_id: rid });
    saveFixture("scoring_matrix_generate", "001-generate", { research_id: rid }, output);
  }

  // ── project_decide ──────────────────────────────────────────────────────
  {
    const input = { research_id: rid, decision: "Use PostgreSQL for the MCP server database.", rationale: "Higher performance under concurrent load outweighs SQLite simplicity. Ecosystem support is also stronger.", adr_reference: "ADR-2026-42" };
    const output = await callTool(server, "project_decide", input);
    saveFixture("project_decide", "001-decide", input, output);
  }

  // ── research_brief ──────────────────────────────────────────────────────
  {
    const input = { research_id: rid, audience: "engineering team" };
    const output = await callTool(server, "research_brief", input);
    saveFixture("research_brief", "001-generate", input, output);
  }

  // ── research_report ─────────────────────────────────────────────────────
  {
    const output = await callTool(server, "research_report", { research_id: rid });
    saveFixture("research_report", "001-generate", { research_id: rid }, output);
  }

  // ── project_supersede ───────────────────────────────────────────────────
  {
    const input = { research_id: rid, superseded_by: "ADR-2026-99: Switch to DuckDB" };
    const output = await callTool(server, "project_supersede", input);
    saveFixture("project_supersede", "001-supersede", input, output);
  }

  // ── Error cases ─────────────────────────────────────────────────────────
  {
    const output = await callTool(server, "project_set", { path: "/nonexistent" });
    saveFixture("project_set", "002-not-found", { path: "/nonexistent" }, output);
  }

  {
    const output = await callTool(server, "finding_create", { research_id: "bad-guid", title: "Fail", claim: "Fail" });
    saveFixture("finding_create", "005-bad-research-id", { research_id: "bad-guid", title: "Fail", claim: "Fail" }, output);
  }

  // Count
  let total = 0;
  for (const dir of fs.readdirSync(FIXTURES_DIR)) {
    const files = fs.readdirSync(path.join(FIXTURES_DIR, dir)).filter(f => f.endsWith(".json"));
    total += files.length;
    console.log(`  ${dir}: ${files.length} fixtures`);
  }
  console.log(`\nTotal: ${total} golden fixtures captured`);
}

main().catch(err => { console.error(err); process.exit(1); });
