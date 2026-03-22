"""Replay all 72 golden fixtures against the Python research_md port.

Two independent lifecycle runs matching the two capture scripts:
1. capture-fixtures.mjs — the "happy path" lifecycle
2. capture-edge-cases.mjs — edge cases, errors, boundary conditions

Each run gets a fresh temp dir with its own project state.
"""

import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research_md.config import init_project, register_project, _guid_to_path, load_config
from research_md.server import (
    project_init, project_set, project_get, status,
    finding_create, finding_list, finding_update,
    candidate_create, candidate_list, candidate_update,
    candidate_add_claim, candidate_resolve_claim,
    criteria_lock, candidate_score, scoring_matrix_generate,
    peer_review_log, project_decide, project_supersede,
    research_brief, research_report,
)

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

FN_MAP = {
    "project_init": project_init,
    "project_set": project_set,
    "project_get": project_get,
    "status": status,
    "finding_create": finding_create,
    "finding_list": finding_list,
    "finding_update": finding_update,
    "candidate_create": candidate_create,
    "candidate_list": candidate_list,
    "candidate_update": candidate_update,
    "candidate_add_claim": candidate_add_claim,
    "candidate_resolve_claim": candidate_resolve_claim,
    "criteria_lock": criteria_lock,
    "candidate_score": candidate_score,
    "scoring_matrix_generate": scoring_matrix_generate,
    "peer_review_log": peer_review_log,
    "project_decide": project_decide,
    "project_supersede": project_supersede,
    "research_brief": research_brief,
    "research_report": research_report,
}


def norm(text):
    text = re.sub(r"/var/folders/[^\s]+", "<TMP>", text)
    text = re.sub(r"/tmp/[^\s]+", "<TMP>", text)
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<GUID>", text)
    # Normalize PDF status lines (TS generates PDF, Python doesn't)
    text = re.sub(r"\nPDF: .*$", "", text, flags=re.MULTILINE)
    return text


def load_fixture(tool_name, fixture_id):
    fp = os.path.join(FIXTURES_DIR, tool_name, f"{fixture_id}.json")
    if not os.path.exists(fp):
        return None
    with open(fp) as f:
        return json.load(f)


def call_tool(tool_name, args):
    fn = FN_MAP.get(tool_name)
    if not fn:
        return f"Unknown tool: {tool_name}"
    try:
        return fn(**args)
    except Exception as e:
        return f"Error: {e}"


def verify(tool_name, fixture_id, args, label=""):
    fixture = load_fixture(tool_name, fixture_id)
    if not fixture:
        return None, "SKIP", "fixture not found"

    actual = call_tool(tool_name, args)
    expected = fixture["output"]["content"][0]["text"] if fixture["output"].get("content") else ""

    a, e = norm(actual), norm(expected)
    if a == e:
        return True, "PASS", ""
    else:
        return False, "FAIL", f"exp: {e[:120]}\nact: {a[:120]}"


def main():
    passed = 0
    failed = 0
    skipped = 0
    errors = []

    # ══════════════════════════════════════════════════════════════════════
    # RUN 1: Happy path lifecycle (from capture-fixtures.mjs)
    # ══════════════════════════════════════════════════════════════════════
    print("═══ RUN 1: Happy Path Lifecycle ═══\n")

    # project_init with question
    _guid_to_path.clear()
    d1 = tempfile.mkdtemp(prefix="rmd-v1-")
    ok, status_str, detail = verify("project_init", "001-with-question",
        {"path": d1, "name": "test-research", "question": "What is the best approach?", "context": "We need to decide on architecture."})
    print(f"  {'✓' if ok else '✗'} project_init/001-with-question")
    if ok: passed += 1
    else: failed += 1; errors.append(("project_init/001-with-question", detail))

    # project_init without question
    d1b = tempfile.mkdtemp(prefix="rmd-v1b-")
    ok, _, detail = verify("project_init", "002-no-question", {"path": d1b})
    print(f"  {'✓' if ok else '✗'} project_init/002-no-question")
    if ok: passed += 1
    else: failed += 1; errors.append(("project_init/002-no-question", detail))

    # Full lifecycle project
    _guid_to_path.clear()
    proj = tempfile.mkdtemp(prefix="rmd-v1-life-")
    init_project(proj, "lifecycle-test", "Which database should we use?", "Evaluating Postgres vs SQLite for our MCP server data.")
    register_project(proj)
    rid = list(_guid_to_path.keys())[0]

    # project_set
    ok, _, detail = verify("project_set", "001-happy-path", {"path": proj})
    print(f"  {'✓' if ok else '✗'} project_set/001-happy-path")
    if ok: passed += 1
    else: failed += 1; errors.append(("project_set/001-happy-path", detail))

    # project_get (skip — depends on exact registration state from capture)
    print(f"  ~ project_get/001-with-projects (SKIP — stateful)")
    skipped += 1

    # Findings
    lifecycle_findings = [
        ("finding_create", "001-low-evidence", {"research_id": rid, "title": "Postgres handles concurrent writes better", "claim": "Postgres WAL-based concurrency handles 10x more concurrent writes than SQLite.", "evidence": "LOW", "source": "Team experience"}),
        ("finding_create", "002-unverified", {"research_id": rid, "title": "SQLite is zero-config", "claim": "SQLite requires no server process, no configuration, and works out of the box."}),
        ("finding_create", "003-high-with-hash", {"research_id": rid, "title": "Postgres benchmarks", "claim": "Official benchmarks show 50k TPS.", "evidence": "HIGH", "source": "postgresql.org (content_hash:abc12345)"}),
        ("finding_create", "004-high-no-hash-error", {"research_id": rid, "title": "Should fail", "claim": "No hash provided.", "evidence": "HIGH", "source": "some blog"}),
        ("finding_list", "001-with-findings", {"research_id": rid}),
        ("finding_update", "001-update-status", {"research_id": rid, "id": "0001", "status": "confirmed", "evidence": "MODERATE"}),
    ]

    for tool, fid, args in lifecycle_findings:
        ok, _, detail = verify(tool, fid, args)
        print(f"  {'✓' if ok else '✗'} {tool}/{fid}")
        if ok: passed += 1
        else: failed += 1; errors.append((f"{tool}/{fid}", detail))

    # Candidates
    lifecycle_candidates = [
        ("candidate_create", "001-with-description", {"research_id": rid, "title": "PostgreSQL", "description": "Full-featured relational database"}),
        ("candidate_create", "002-with-slug", {"research_id": rid, "title": "SQLite", "slug": "sqlite"}),
        ("candidate_create", "003-duplicate-error", {"research_id": rid, "title": "SQLite", "slug": "sqlite"}),
        ("candidate_list", "001-with-candidates", {"research_id": rid}),
        ("candidate_update", "001-update-verdict", {"research_id": rid, "slug": "postgresql", "verdict": "recommended"}),
        ("candidate_add_claim", "001-add-claim", {"research_id": rid, "slug": "postgresql", "claim": "Handles >10k concurrent connections"}),
        ("candidate_resolve_claim", "001-resolve-yes", {"research_id": rid, "slug": "postgresql", "claim_index": 1, "result": "Y"}),
        ("candidate_resolve_claim", "002-resolve-no", {"research_id": rid, "slug": "postgresql", "claim_index": 1, "result": "N"}),
    ]

    for tool, fid, args in lifecycle_candidates:
        ok, _, detail = verify(tool, fid, args)
        print(f"  {'✓' if ok else '✗'} {tool}/{fid}")
        if ok: passed += 1
        else: failed += 1; errors.append((f"{tool}/{fid}", detail))

    # Resolve sqlite TBD (needed for scoring later)
    call_tool("candidate_resolve_claim", {"research_id": rid, "slug": "sqlite", "claim_index": 1, "result": "Y"})

    # Set up criteria file
    criteria_dir = os.path.join(proj, ".research", "evaluations")
    os.makedirs(criteria_dir, exist_ok=True)
    with open(os.path.join(criteria_dir, "decision-criteria.md"), "w") as f:
        f.write("---\nlocked: false\nlocked_date: null\n---\n\n# Decision Criteria\n\n| # | Criterion | Weight |\n|---|-----------|--------|\n| 1 | Performance | 3 |\n| 2 | Simplicity | 2 |\n| 3 | Ecosystem | 1 |\n")

    lifecycle_phase = [
        ("criteria_lock", "001-lock", {"research_id": rid}),
        ("criteria_lock", "002-already-locked", {"research_id": rid}),
        ("status", "001-mid-project", {"research_id": rid}),
        ("peer_review_log", "001-with-attestations", {"research_id": rid, "reviewer": "Gemini 2.5 Pro", "findings": ["Postgres concurrency claim is well-supported", "SQLite simplicity is obvious but understated"], "attestations": {"0003": "ATTESTED"}, "notes": "Solid research. Consider adding latency benchmarks."}),
        ("candidate_score", "001-score-postgres", {"research_id": rid, "slug": "postgresql", "scores": {"Performance": 9, "Simplicity": 5, "Ecosystem": 8}, "notes": "Strong all-around"}),
        ("candidate_score", "002-score-sqlite", {"research_id": rid, "slug": "sqlite", "scores": {"Performance": 4, "Simplicity": 10, "Ecosystem": 5}, "notes": "Simple but limited"}),
        ("scoring_matrix_generate", "001-generate", {"research_id": rid}),
        ("project_decide", "001-decide", {"research_id": rid, "decision": "Use PostgreSQL for the MCP server database.", "rationale": "Higher performance under concurrent load outweighs SQLite simplicity. Ecosystem support is also stronger.", "adr_reference": "ADR-2026-42"}),
        ("research_brief", "001-generate", {"research_id": rid, "audience": "engineering team"}),
        ("research_report", "001-generate", {"research_id": rid}),
        ("project_supersede", "001-supersede", {"research_id": rid, "superseded_by": "ADR-2026-99: Switch to DuckDB"}),
    ]

    for tool, fid, args in lifecycle_phase:
        ok, _, detail = verify(tool, fid, args)
        print(f"  {'✓' if ok else '✗'} {tool}/{fid}")
        if ok: passed += 1
        else: failed += 1; errors.append((f"{tool}/{fid}", detail))

    # Error cases
    ok, _, detail = verify("project_set", "002-not-found", {"path": "/nonexistent"})
    print(f"  {'✓' if ok else '✗'} project_set/002-not-found")
    if ok: passed += 1
    else: failed += 1; errors.append(("project_set/002-not-found", detail))

    ok, _, detail = verify("finding_create", "005-bad-research-id", {"research_id": "bad-guid", "title": "Fail", "claim": "Fail"})
    print(f"  {'✓' if ok else '✗'} finding_create/005-bad-research-id")
    if ok: passed += 1
    else: failed += 1; errors.append(("finding_create/005-bad-research-id", detail))

    # ══════════════════════════════════════════════════════════════════════
    # RUN 2: Edge cases (from capture-edge-cases.mjs)
    # ══════════════════════════════════════════════════════════════════════
    print("\n═══ RUN 2: Edge Cases ═══\n")

    # project_init without context
    d2a = tempfile.mkdtemp(prefix="rmd-v2a-")
    ok, _, detail = verify("project_init", "003-no-context-warnings", {"path": d2a, "name": "no-question-test"})
    print(f"  {'✓' if ok else '✗'} project_init/003-no-context-warnings")
    if ok: passed += 1
    else: failed += 1; errors.append(("project_init/003-no-context-warnings", detail))

    # project_get empty (need fresh guid map)
    # Skip — depends on exact session state
    print(f"  ~ project_get/002-empty-session (SKIP — stateful)")
    skipped += 1

    # Edge case project
    _guid_to_path.clear()
    edge = tempfile.mkdtemp(prefix="rmd-v2-edge-")
    init_project(edge, "edge-cases", "Edge testing?", "Boundary conditions")
    register_project(edge)
    rid2 = list(_guid_to_path.keys())[0]

    edge_fixtures = [
        # Finding edges
        ("finding_create", "006-empty-title", {"research_id": rid2, "title": "", "claim": "empty title test"}),
        ("finding_create", "007-long-title", {"research_id": rid2, "title": "x" * 300, "claim": "long"}),
        ("finding_create", "008-unicode", {"research_id": rid2, "title": "データベース比較", "claim": "Japanese test"}),
        ("finding_create", "009-moderate-no-hash", {"research_id": rid2, "title": "Mod no hash", "claim": "test", "evidence": "MODERATE", "source": "blog"}),
        ("finding_create", "010-moderate-with-hash", {"research_id": rid2, "title": "Mod with hash", "claim": "test", "evidence": "MODERATE", "source": "blog (content_hash:12345678)"}),
        ("finding_update", "002-not-found", {"research_id": rid2, "id": "9999", "status": "confirmed"}),
        ("finding_update", "003-update-claim", {"research_id": rid2, "id": "0001", "claim": "Updated claim"}),
        ("finding_update", "004-update-evidence", {"research_id": rid2, "id": "0001", "evidence": "LOW"}),
        ("finding_list", "002-after-updates", {"research_id": rid2}),
        # Candidate edges
        ("candidate_create", "004-custom-slug", {"research_id": rid2, "title": "DynamoDB", "slug": "dynamodb-aws"}),
        ("candidate_create", "005-with-description", {"research_id": rid2, "title": "CockroachDB", "description": "Distributed SQL database"}),
        ("candidate_create", "006-minimal", {"research_id": rid2, "title": "TiDB"}),
        ("candidate_update", "002-not-found", {"research_id": rid2, "slug": "nonexistent", "verdict": "eliminated"}),
        ("candidate_update", "003-eliminate", {"research_id": rid2, "slug": "tidb", "verdict": "eliminated"}),
        ("candidate_update", "004-update-description", {"research_id": rid2, "slug": "cockroachdb", "description": "Updated: Global SQL with geo-partitioning"}),
        ("candidate_add_claim", "002-second-claim", {"research_id": rid2, "slug": "dynamodb-aws", "claim": "Supports DynamoDB Streams"}),
        ("candidate_add_claim", "003-third-claim", {"research_id": rid2, "slug": "dynamodb-aws", "claim": "Sub-10ms reads at P99"}),
        ("candidate_resolve_claim", "003-resolve-first", {"research_id": rid2, "slug": "dynamodb-aws", "claim_index": 1, "result": "Y"}),
        ("candidate_resolve_claim", "004-resolve-second", {"research_id": rid2, "slug": "dynamodb-aws", "claim_index": 1, "result": "N"}),
        ("candidate_resolve_claim", "005-resolve-third", {"research_id": rid2, "slug": "dynamodb-aws", "claim_index": 1, "result": "Y"}),
        ("candidate_resolve_claim", "006-not-found", {"research_id": rid2, "slug": "nonexistent", "claim_index": 1, "result": "Y"}),
        ("candidate_resolve_claim", "007-bad-index", {"research_id": rid2, "slug": "cockroachdb", "claim_index": 99, "result": "Y"}),
        ("candidate_list", "002-after-changes", {"research_id": rid2}),
        # Phase gate errors
        ("candidate_score", "003-before-criteria", {"research_id": rid2, "slug": "dynamodb-aws", "scores": {"a": 5}}),
        ("criteria_lock", "003-no-file", {"research_id": rid2}),
    ]

    for tool, fid, args in edge_fixtures:
        ok, _, detail = verify(tool, fid, args)
        print(f"  {'✓' if ok else '✗'} {tool}/{fid}")
        if ok: passed += 1
        else: failed += 1; errors.append((f"{tool}/{fid}", detail))

    # Create and lock criteria for edge project
    criteria_dir2 = os.path.join(edge, ".research", "evaluations")
    os.makedirs(criteria_dir2, exist_ok=True)
    with open(os.path.join(criteria_dir2, "decision-criteria.md"), "w") as f:
        f.write("---\nlocked: false\nlocked_date: null\n---\n\n| # | Criterion | Weight |\n|---|-----------|--------|\n| 1 | Speed | 2 |\n| 2 | Cost | 1 |\n")
    call_tool("criteria_lock", {"research_id": rid2})

    edge_phase = [
        ("candidate_score", "004-before-review", {"research_id": rid2, "slug": "dynamodb-aws", "scores": {"Speed": 8}}),
        ("peer_review_log", "002-minimal", {"research_id": rid2, "reviewer": "GPT-5.2", "findings": ["Looks good", "Needs more data"], "notes": "Solid work"}),
        ("candidate_score", "005-with-tbd", {"research_id": rid2, "slug": "cockroachdb", "scores": {"Speed": 7}}),
    ]

    for tool, fid, args in edge_phase:
        ok, _, detail = verify(tool, fid, args)
        print(f"  {'✓' if ok else '✗'} {tool}/{fid}")
        if ok: passed += 1
        else: failed += 1; errors.append((f"{tool}/{fid}", detail))

    # Resolve remaining TBDs
    call_tool("candidate_resolve_claim", {"research_id": rid2, "slug": "cockroachdb", "claim_index": 1, "result": "Y"})
    call_tool("candidate_resolve_claim", {"research_id": rid2, "slug": "tidb", "claim_index": 1, "result": "N"})

    edge_scoring = [
        ("candidate_score", "006-with-notes", {"research_id": rid2, "slug": "dynamodb-aws", "scores": {"Speed": 9, "Cost": 2}, "notes": "Fast but expensive"}),
        ("candidate_score", "007-cockroachdb", {"research_id": rid2, "slug": "cockroachdb", "scores": {"Speed": 6, "Cost": 4}}),
        ("candidate_score", "008-tidb", {"research_id": rid2, "slug": "tidb", "scores": {"Speed": 7, "Cost": 5}}),
        ("scoring_matrix_generate", "002-with-scores", {"research_id": rid2}),
        ("project_decide", "002-with-adr", {"research_id": rid2, "decision": "Use DynamoDB for edge performance", "rationale": "Speed advantage outweighs cost", "adr_reference": "ADR-2026-99"}),
        ("status", "002-decided", {"research_id": rid2}),
        ("project_supersede", "002-supersede", {"research_id": rid2, "superseded_by": "New evaluation"}),
        ("project_supersede", "003-already-superseded", {"research_id": rid2, "superseded_by": "Again"}),
        ("status", "003-superseded", {"research_id": rid2}),
    ]

    for tool, fid, args in edge_scoring:
        ok, _, detail = verify(tool, fid, args)
        print(f"  {'✓' if ok else '✗'} {tool}/{fid}")
        if ok: passed += 1
        else: failed += 1; errors.append((f"{tool}/{fid}", detail))

    # Bad GUID errors
    ok, _, detail = verify("status", "004-bad-guid", {"research_id": "bad-guid"})
    print(f"  {'✓' if ok else '✗'} status/004-bad-guid")
    if ok: passed += 1
    else: failed += 1; errors.append(("status/004-bad-guid", detail))

    ok, _, detail = verify("candidate_list", "003-bad-guid", {"research_id": "bad-guid"})
    print(f"  {'✓' if ok else '✗'} candidate_list/003-bad-guid")
    if ok: passed += 1
    else: failed += 1; errors.append(("candidate_list/003-bad-guid", detail))

    # ══════════════════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════════════════
    total = passed + failed + skipped
    print(f"\n{'='*60}")
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped out of {total}")
    print(f"Pass rate: {passed / (passed + failed) * 100:.1f}%" if (passed + failed) else "")

    if errors:
        print(f"\nFailed ({len(errors)}):")
        for name, detail in errors:
            print(f"\n  {name}:")
            for line in detail.split("\n"):
                print(f"    {line}")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
