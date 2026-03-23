import * as fs from "fs";
import * as path from "path";
import { ProjectConfig, ProjectPhase, PHASE_ORDER } from "./config";
import {
  loadDecisionCriteria,
  peerReviewExists,
  listFindings,
  listCandidates,
  extractSection,
} from "./files";

export interface IntegrityIssue {
  severity: "error" | "warning";
  message: string;
}

/**
 * Run integrity checks against a research project.
 * Compares what the phase says vs what the files actually contain.
 * Returns a list of inconsistencies.
 */
export function checkIntegrity(
  projectRoot: string,
  config: ProjectConfig
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const phase = config.phase;
  const phaseIdx = PHASE_ORDER.indexOf(phase);

  // ── Phase vs criteria lock ──────────────────────────────────────────────
  const criteria = loadDecisionCriteria(projectRoot);
  const criteriaLocked = criteria?.frontmatter?.locked === true;

  if (phaseIdx >= PHASE_ORDER.indexOf("locked") && !criteriaLocked) {
    issues.push({
      severity: "error",
      message: `Phase is '${phase}' but decision-criteria.md is not locked. Phase says criteria are frozen but the file disagrees.`,
    });
  }
  if (phaseIdx < PHASE_ORDER.indexOf("locked") && criteriaLocked) {
    issues.push({
      severity: "warning",
      message: `Criteria are locked but phase is '${phase}'. Phase should be 'locked' or later.`,
    });
  }

  // ── Phase vs peer review ──────────────────────────────────────────────
  const hasPeerReview = peerReviewExists(projectRoot);

  if (phaseIdx >= PHASE_ORDER.indexOf("reviewed") && !hasPeerReview) {
    issues.push({
      severity: "error",
      message: `Phase is '${phase}' but no peer-review.md exists. Phase says review happened but the file is missing.`,
    });
  }

  // ── Phase vs decision files ──────────────────────────────────────────
  if (phaseIdx >= PHASE_ORDER.indexOf("decided")) {
    // Check for decision files in decisions/ folder
    const decisionsDir = path.join(projectRoot, ".research", "decisions");
    const decisionFile = path.join(projectRoot, ".research", "DECISION.md");
    let hasDecision = false;
    let hasStaleDecision = false;

    // Check DECISION.md at project root
    if (fs.existsSync(decisionFile)) {
      hasDecision = true;
    }

    // Check decisions/ folder for any decision files
    if (fs.existsSync(decisionsDir)) {
      const decisionFiles = fs.readdirSync(decisionsDir).filter(
        (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md"
      );

      for (const df of decisionFiles) {
        const content = fs.readFileSync(path.join(decisionsDir, df), "utf-8");
        hasDecision = true;

        // Check for stale content indicating the decision wasn't actually written
        const staleMarkers = [
          "_To be written",
          "_To be determined",
          "Under Research",
          "Status: Draft",
        ];

        for (const marker of staleMarkers) {
          if (content.includes(marker)) {
            hasStaleDecision = true;
            issues.push({
              severity: "error",
              message: `Phase is '${phase}' but decisions/${df} contains '${marker}'. The decision file was not updated to reflect the outcome.`,
            });
          }
        }
      }
    }

    if (!hasDecision) {
      issues.push({
        severity: "error",
        message: `Phase is '${phase}' but no decision file found (no DECISION.md and no files in decisions/). Record the decision.`,
      });
    }
  }

  // ── Candidates with no verdict at decided phase ──────────────────────
  if (phaseIdx >= PHASE_ORDER.indexOf("decided")) {
    const candidates = listCandidates(projectRoot);
    const provisional = candidates.filter((c) => c.frontmatter?.verdict === "provisional");
    if (provisional.length > 0) {
      const names = provisional.map((c) => c.frontmatter?.title || "unknown").join(", ");
      issues.push({
        severity: "warning",
        message: `Phase is '${phase}' but ${provisional.length} candidate(s) still have verdict 'provisional': ${names}. Update verdicts to reflect the decision.`,
      });
    }
  }

  // ── TBD items at scored or later ──────────────────────────────────────
  if (phaseIdx >= PHASE_ORDER.indexOf("scored")) {
    const candidates = listCandidates(projectRoot);
    const tbdCount = candidates.reduce((acc, c) => {
      const matches = c.content.match(/_TBD_/g);
      return acc + (matches ? matches.length : 0);
    }, 0);
    if (tbdCount > 0) {
      issues.push({
        severity: "warning",
        message: `Phase is '${phase}' but ${tbdCount} _TBD_ item(s) remain in candidate validation checklists.`,
      });
    }
  }

  // ── No findings at criteria or later ──────────────────────────────────
  if (phaseIdx >= PHASE_ORDER.indexOf("criteria")) {
    const findings = listFindings(projectRoot);
    if (findings.length === 0) {
      issues.push({
        severity: "warning",
        message: `Phase is '${phase}' but no findings have been recorded. Research should produce findings before defining criteria.`,
      });
    }
  }

  // ── No candidates at locked or later ──────────────────────────────────
  if (phaseIdx >= PHASE_ORDER.indexOf("locked")) {
    const candidates = listCandidates(projectRoot);
    if (candidates.length === 0) {
      issues.push({
        severity: "warning",
        message: `Phase is '${phase}' but no candidates exist. Can't score without candidates.`,
      });
    }
  }

  return issues;
}
