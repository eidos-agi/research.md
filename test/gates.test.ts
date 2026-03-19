import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { initProject } from "../src/config";
import { writeMarkdown } from "../src/files";
import {
  gateCriteriaLocked,
  gatePeerReviewExists,
  gateCandidateNoTbd,
  runScoringGates,
} from "../src/gates";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-test-"));
  initProject(tmpDir, "test-project");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("gateCriteriaLocked", () => {
  it("fails when decision-criteria.md does not exist", () => {
    const result = gateCriteriaLocked(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("No decision-criteria.md");
  });

  it("fails when criteria are not locked", () => {
    writeMarkdown(
      path.join(tmpDir, "evaluations", "decision-criteria.md"),
      { locked: false, locked_date: null },
      "\n## Decision Criteria\n\n| # | Criterion | Weight |\n"
    );
    const result = gateCriteriaLocked(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("not locked");
  });

  it("passes when criteria are locked", () => {
    writeMarkdown(
      path.join(tmpDir, "evaluations", "decision-criteria.md"),
      { locked: true, locked_date: "2026-03-18" },
      "\n## Decision Criteria\n\n| # | Criterion | Weight |\n"
    );
    const result = gateCriteriaLocked(tmpDir);
    expect(result.passed).toBe(true);
  });
});

describe("gatePeerReviewExists", () => {
  it("fails when peer-review.md does not exist", () => {
    const result = gatePeerReviewExists(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("No peer-review.md");
  });

  it("passes when peer-review.md exists", () => {
    fs.writeFileSync(
      path.join(tmpDir, "evaluations", "peer-review.md"),
      "# Peer Review\n"
    );
    const result = gatePeerReviewExists(tmpDir);
    expect(result.passed).toBe(true);
  });
});

describe("gateCandidateNoTbd", () => {
  it("fails when candidate not found", () => {
    const result = gateCandidateNoTbd(tmpDir, "nonexistent");
    expect(result.passed).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("fails when candidate has _TBD_ items", () => {
    writeMarkdown(
      path.join(tmpDir, "candidates", "acme.md"),
      { title: "Acme", verdict: "provisional" as const },
      "\n## Validation Checklist\n\n- [ ] Works: _TBD_\n"
    );
    const result = gateCandidateNoTbd(tmpDir, "acme");
    expect(result.passed).toBe(false);
    expect(result.error).toContain("_TBD_");
  });

  it("passes when all claims resolved", () => {
    writeMarkdown(
      path.join(tmpDir, "candidates", "acme.md"),
      { title: "Acme", verdict: "provisional" as const },
      "\n## Validation Checklist\n\n- [x] Works: Y\n"
    );
    const result = gateCandidateNoTbd(tmpDir, "acme");
    expect(result.passed).toBe(true);
  });
});

describe("runScoringGates", () => {
  it("fails on first unmet gate", () => {
    const result = runScoringGates(tmpDir, "acme");
    expect(result.passed).toBe(false);
    // First gate to fail is criteria locked
    expect(result.error).toContain("decision-criteria.md");
  });

  it("checks all gates in sequence", () => {
    // Lock criteria
    writeMarkdown(
      path.join(tmpDir, "evaluations", "decision-criteria.md"),
      { locked: true, locked_date: "2026-03-18" },
      "\n## Decision Criteria\n"
    );
    // No peer review yet
    const result = runScoringGates(tmpDir, "acme");
    expect(result.passed).toBe(false);
    expect(result.error).toContain("peer-review.md");
  });

  it("passes when all gates met", () => {
    // Lock criteria
    writeMarkdown(
      path.join(tmpDir, "evaluations", "decision-criteria.md"),
      { locked: true, locked_date: "2026-03-18" },
      "\n## Decision Criteria\n"
    );
    // Add peer review
    fs.writeFileSync(
      path.join(tmpDir, "evaluations", "peer-review.md"),
      "# Peer Review\n"
    );
    // Add candidate with no TBD
    writeMarkdown(
      path.join(tmpDir, "candidates", "acme.md"),
      { title: "Acme", verdict: "provisional" as const },
      "\n## Validation Checklist\n\n- [x] Works: Y\n"
    );

    const result = runScoringGates(tmpDir, "acme");
    expect(result.passed).toBe(true);
  });
});
