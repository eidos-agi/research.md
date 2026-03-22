/**
 * Extended fixture capture — edge cases, error paths, boundary conditions.
 * Run AFTER capture-fixtures.mjs. Adds to the same fixtures directory.
 */

import { createServer } from "../dist/server.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

async function callTool(server, name, args) {
  const handler = server._requestHandlers?.get("tools/call");
  const result = await handler({ method: "tools/call", params: { name, arguments: args } }, {});
  return result;
}

function saveFixture(toolName, fixtureId, input, output) {
  const dir = path.join(FIXTURES_DIR, toolName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${fixtureId}.json`),
    JSON.stringify({ tool: toolName, fixture_id: fixtureId, input, output, source_language: "typescript", captured_at: new Date().toISOString().split("T")[0] }, null, 2) + "\n"
  );
}

async function main() {
  const server = createServer();

  // ── Project edge cases ────────────────────────────────────────────────
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmd-e-"));
    const o = await callTool(server, "project_init", { path: dir, name: "no-question-test" });
    saveFixture("project_init", "003-no-context-warnings", { path: dir, name: "no-question-test" }, o);
  }

  {
    const o = await callTool(server, "project_get", {});
    saveFixture("project_get", "002-empty-session", {}, o);
  }

  // ── Full edge case lifecycle ──────────────────────────────────────────
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rmd-edge-"));
  await callTool(server, "project_init", { path: d, name: "edge-cases", question: "Edge testing?", context: "Boundary conditions" });
  const setR = await callTool(server, "project_set", { path: d });
  const rid = setR.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

  // Finding: empty title
  {
    const o = await callTool(server, "finding_create", { research_id: rid, title: "", claim: "empty title test" });
    saveFixture("finding_create", "006-empty-title", { research_id: rid, title: "", claim: "empty title test" }, o);
  }

  // Finding: very long title
  {
    const t = "x".repeat(300);
    const o = await callTool(server, "finding_create", { research_id: rid, title: t, claim: "long" });
    saveFixture("finding_create", "007-long-title", { research_id: rid, title: t, claim: "long" }, o);
  }

  // Finding: unicode
  {
    const o = await callTool(server, "finding_create", { research_id: rid, title: "データベース比較", claim: "Japanese test" });
    saveFixture("finding_create", "008-unicode", { research_id: rid, title: "データベース比較", claim: "Japanese test" }, o);
  }

  // Finding: MODERATE without hash
  {
    const o = await callTool(server, "finding_create", { research_id: rid, title: "Mod no hash", claim: "test", evidence: "MODERATE", source: "blog" });
    saveFixture("finding_create", "009-moderate-no-hash", { research_id: rid, title: "Mod no hash", claim: "test", evidence: "MODERATE", source: "blog" }, o);
  }

  // Finding: MODERATE with hash
  {
    const o = await callTool(server, "finding_create", { research_id: rid, title: "Mod with hash", claim: "test", evidence: "MODERATE", source: "blog (content_hash:12345678)" });
    saveFixture("finding_create", "010-moderate-with-hash", { research_id: rid, title: "Mod with hash", claim: "test", evidence: "MODERATE", source: "blog (content_hash:12345678)" }, o);
  }

  // Finding: update nonexistent
  {
    const o = await callTool(server, "finding_update", { research_id: rid, id: "9999", status: "confirmed" });
    saveFixture("finding_update", "002-not-found", { research_id: rid, id: "9999", status: "confirmed" }, o);
  }

  // Finding: update claim text
  {
    const o = await callTool(server, "finding_update", { research_id: rid, id: "0001", claim: "Updated claim" });
    saveFixture("finding_update", "003-update-claim", { research_id: rid, id: "0001", claim: "Updated claim" }, o);
  }

  // Finding: update evidence grade
  {
    const o = await callTool(server, "finding_update", { research_id: rid, id: "0001", evidence: "LOW" });
    saveFixture("finding_update", "004-update-evidence", { research_id: rid, id: "0001", evidence: "LOW" }, o);
  }

  // Finding list after updates
  {
    const o = await callTool(server, "finding_list", { research_id: rid });
    saveFixture("finding_list", "002-after-updates", { research_id: rid }, o);
  }

  // ── Candidate edge cases ──────────────────────────────────────────────

  // Candidate: custom slug
  {
    const o = await callTool(server, "candidate_create", { research_id: rid, title: "DynamoDB", slug: "dynamodb-aws" });
    saveFixture("candidate_create", "004-custom-slug", { research_id: rid, title: "DynamoDB", slug: "dynamodb-aws" }, o);
  }

  // Candidate: with description
  {
    const o = await callTool(server, "candidate_create", { research_id: rid, title: "CockroachDB", description: "Distributed SQL database" });
    saveFixture("candidate_create", "005-with-description", { research_id: rid, title: "CockroachDB", description: "Distributed SQL database" }, o);
  }

  // Candidate: no description
  {
    const o = await callTool(server, "candidate_create", { research_id: rid, title: "TiDB" });
    saveFixture("candidate_create", "006-minimal", { research_id: rid, title: "TiDB" }, o);
  }

  // Candidate update: nonexistent
  {
    const o = await callTool(server, "candidate_update", { research_id: rid, slug: "nonexistent", verdict: "eliminated" });
    saveFixture("candidate_update", "002-not-found", { research_id: rid, slug: "nonexistent", verdict: "eliminated" }, o);
  }

  // Candidate update: eliminate
  {
    const o = await callTool(server, "candidate_update", { research_id: rid, slug: "tidb", verdict: "eliminated" });
    saveFixture("candidate_update", "003-eliminate", { research_id: rid, slug: "tidb", verdict: "eliminated" }, o);
  }

  // Candidate update: description
  {
    const o = await callTool(server, "candidate_update", { research_id: rid, slug: "cockroachdb", description: "Updated: Global SQL with geo-partitioning" });
    saveFixture("candidate_update", "004-update-description", { research_id: rid, slug: "cockroachdb", description: "Updated: Global SQL with geo-partitioning" }, o);
  }

  // Add multiple claims
  {
    const o = await callTool(server, "candidate_add_claim", { research_id: rid, slug: "dynamodb-aws", claim: "Supports DynamoDB Streams" });
    saveFixture("candidate_add_claim", "002-second-claim", { research_id: rid, slug: "dynamodb-aws", claim: "Supports DynamoDB Streams" }, o);
  }
  {
    const o = await callTool(server, "candidate_add_claim", { research_id: rid, slug: "dynamodb-aws", claim: "Sub-10ms reads at P99" });
    saveFixture("candidate_add_claim", "003-third-claim", { research_id: rid, slug: "dynamodb-aws", claim: "Sub-10ms reads at P99" }, o);
  }

  // Resolve claims
  {
    const o = await callTool(server, "candidate_resolve_claim", { research_id: rid, slug: "dynamodb-aws", claim_index: 1, result: "Y" });
    saveFixture("candidate_resolve_claim", "003-resolve-first", { research_id: rid, slug: "dynamodb-aws", claim_index: 1, result: "Y" }, o);
  }
  {
    const o = await callTool(server, "candidate_resolve_claim", { research_id: rid, slug: "dynamodb-aws", claim_index: 1, result: "N" });
    saveFixture("candidate_resolve_claim", "004-resolve-second", { research_id: rid, slug: "dynamodb-aws", claim_index: 1, result: "N" }, o);
  }
  {
    const o = await callTool(server, "candidate_resolve_claim", { research_id: rid, slug: "dynamodb-aws", claim_index: 1, result: "Y" });
    saveFixture("candidate_resolve_claim", "005-resolve-third", { research_id: rid, slug: "dynamodb-aws", claim_index: 1, result: "Y" }, o);
  }

  // Resolve claim on nonexistent candidate
  {
    const o = await callTool(server, "candidate_resolve_claim", { research_id: rid, slug: "nonexistent", claim_index: 1, result: "Y" });
    saveFixture("candidate_resolve_claim", "006-not-found", { research_id: rid, slug: "nonexistent", claim_index: 1, result: "Y" }, o);
  }

  // Resolve claim with bad index
  {
    const o = await callTool(server, "candidate_resolve_claim", { research_id: rid, slug: "cockroachdb", claim_index: 99, result: "Y" });
    saveFixture("candidate_resolve_claim", "007-bad-index", { research_id: rid, slug: "cockroachdb", claim_index: 99, result: "Y" }, o);
  }

  // Candidate list after all changes
  {
    const o = await callTool(server, "candidate_list", { research_id: rid });
    saveFixture("candidate_list", "002-after-changes", { research_id: rid }, o);
  }

  // ── Phase gate errors ─────────────────────────────────────────────────

  // Score before criteria locked
  {
    const o = await callTool(server, "candidate_score", { research_id: rid, slug: "dynamodb-aws", scores: { a: 5 } });
    saveFixture("candidate_score", "003-before-criteria", { research_id: rid, slug: "dynamodb-aws", scores: { a: 5 } }, o);
  }

  // Lock criteria without file
  {
    const o = await callTool(server, "criteria_lock", { research_id: rid });
    saveFixture("criteria_lock", "003-no-file", { research_id: rid }, o);
  }

  // Create and lock criteria
  const criteriaDir = path.join(d, ".research", "evaluations");
  fs.mkdirSync(criteriaDir, { recursive: true });
  fs.writeFileSync(path.join(criteriaDir, "decision-criteria.md"),
    "---\nlocked: false\nlocked_date: null\n---\n\n| # | Criterion | Weight |\n|---|-----------|--------|\n| 1 | Speed | 2 |\n| 2 | Cost | 1 |\n");
  await callTool(server, "criteria_lock", { research_id: rid });

  // Score before peer review
  {
    const o = await callTool(server, "candidate_score", { research_id: rid, slug: "dynamodb-aws", scores: { Speed: 8 } });
    saveFixture("candidate_score", "004-before-review", { research_id: rid, slug: "dynamodb-aws", scores: { Speed: 8 } }, o);
  }

  // Peer review
  {
    const o = await callTool(server, "peer_review_log", { research_id: rid, reviewer: "GPT-5.2", findings: ["Looks good", "Needs more data"], notes: "Solid work" });
    saveFixture("peer_review_log", "002-minimal", { research_id: rid, reviewer: "GPT-5.2", findings: ["Looks good", "Needs more data"], notes: "Solid work" }, o);
  }

  // Score with TBD remaining (cockroachdb still has TBD)
  {
    const o = await callTool(server, "candidate_score", { research_id: rid, slug: "cockroachdb", scores: { Speed: 7 } });
    saveFixture("candidate_score", "005-with-tbd", { research_id: rid, slug: "cockroachdb", scores: { Speed: 7 } }, o);
  }

  // Resolve cockroachdb and tidb TBDs
  await callTool(server, "candidate_resolve_claim", { research_id: rid, slug: "cockroachdb", claim_index: 1, result: "Y" });
  await callTool(server, "candidate_resolve_claim", { research_id: rid, slug: "tidb", claim_index: 1, result: "N" });

  // Score all candidates
  {
    const o = await callTool(server, "candidate_score", { research_id: rid, slug: "dynamodb-aws", scores: { Speed: 9, Cost: 2 }, notes: "Fast but expensive" });
    saveFixture("candidate_score", "006-with-notes", { research_id: rid, slug: "dynamodb-aws", scores: { Speed: 9, Cost: 2 }, notes: "Fast but expensive" }, o);
  }
  {
    const o = await callTool(server, "candidate_score", { research_id: rid, slug: "cockroachdb", scores: { Speed: 6, Cost: 4 } });
    saveFixture("candidate_score", "007-cockroachdb", { research_id: rid, slug: "cockroachdb", scores: { Speed: 6, Cost: 4 } }, o);
  }
  {
    const o = await callTool(server, "candidate_score", { research_id: rid, slug: "tidb", scores: { Speed: 7, Cost: 5 } });
    saveFixture("candidate_score", "008-tidb", { research_id: rid, slug: "tidb", scores: { Speed: 7, Cost: 5 } }, o);
  }

  // Generate matrix
  {
    const o = await callTool(server, "scoring_matrix_generate", { research_id: rid });
    saveFixture("scoring_matrix_generate", "002-with-scores", { research_id: rid }, o);
  }

  // Decide
  {
    const o = await callTool(server, "project_decide", { research_id: rid, decision: "Use DynamoDB for edge performance", rationale: "Speed advantage outweighs cost", adr_reference: "ADR-2026-99" });
    saveFixture("project_decide", "002-with-adr", { research_id: rid, decision: "Use DynamoDB for edge performance", rationale: "Speed advantage outweighs cost", adr_reference: "ADR-2026-99" }, o);
  }

  // Status at decided
  {
    const o = await callTool(server, "status", { research_id: rid });
    saveFixture("status", "002-decided", { research_id: rid }, o);
  }

  // Supersede
  {
    const o = await callTool(server, "project_supersede", { research_id: rid, superseded_by: "New evaluation" });
    saveFixture("project_supersede", "002-supersede", { research_id: rid, superseded_by: "New evaluation" }, o);
  }

  // Supersede again (should fail — already superseded)
  {
    const o = await callTool(server, "project_supersede", { research_id: rid, superseded_by: "Again" });
    saveFixture("project_supersede", "003-already-superseded", { research_id: rid, superseded_by: "Again" }, o);
  }

  // Status at superseded
  {
    const o = await callTool(server, "status", { research_id: rid });
    saveFixture("status", "003-superseded", { research_id: rid }, o);
  }

  // ── Bad research_id ───────────────────────────────────────────────────
  {
    const o = await callTool(server, "status", { research_id: "bad-guid" });
    saveFixture("status", "004-bad-guid", { research_id: "bad-guid" }, o);
  }
  {
    const o = await callTool(server, "candidate_list", { research_id: "bad-guid" });
    saveFixture("candidate_list", "003-bad-guid", { research_id: "bad-guid" }, o);
  }

  // Count
  let total = 0;
  for (const dir of fs.readdirSync(FIXTURES_DIR)) {
    const stat = fs.statSync(path.join(FIXTURES_DIR, dir));
    if (!stat.isDirectory()) continue;
    const files = fs.readdirSync(path.join(FIXTURES_DIR, dir)).filter(f => f.endsWith(".json"));
    total += files.length;
    console.log(`  ${dir}: ${files.length} fixtures`);
  }
  console.log(`\nTotal: ${total} golden fixtures captured`);
}

main().catch(err => { console.error(err); process.exit(1); });
