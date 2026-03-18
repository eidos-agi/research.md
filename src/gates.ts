import {
  loadDecisionCriteria,
  peerReviewExists,
  listCandidates,
  sectionHasContent,
  ParsedFile,
  AdrFrontmatter,
} from "./files";

export interface GateResult {
  passed: boolean;
  error?: string;
}

/**
 * Gate: criteria must be locked before scoring.
 */
export function gateCriteriaLocked(projectRoot: string): GateResult {
  const criteria = loadDecisionCriteria(projectRoot);
  if (!criteria) {
    return {
      passed: false,
      error:
        "No decision-criteria.md found in evaluations/. Run `init` and add criteria before scoring.",
    };
  }
  if (!criteria.frontmatter.locked) {
    return {
      passed: false,
      error:
        "Decision criteria are not locked. Run `lock_criteria` to freeze weights before scoring.",
    };
  }
  return { passed: true };
}

/**
 * Gate: peer review must exist before scoring.
 */
export function gatePeerReviewExists(projectRoot: string): GateResult {
  if (!peerReviewExists(projectRoot)) {
    return {
      passed: false,
      error:
        "No peer-review.md found in evaluations/. Run `log_peer_review` before scoring.",
    };
  }
  return { passed: true };
}

/**
 * Gate: candidate must not have _TBD_ on any scored criterion.
 */
export function gateCandidateNoTbd(
  projectRoot: string,
  slug: string
): GateResult {
  const candidates = listCandidates(projectRoot);
  const candidate = candidates.find((c) =>
    c.filePath.includes(`/${slug}.md`)
  );

  if (!candidate) {
    return { passed: false, error: `Candidate '${slug}' not found.` };
  }

  if (candidate.content.includes("_TBD_")) {
    return {
      passed: false,
      error: `Candidate '${slug}' has unresolved _TBD_ items in its validation checklist. Resolve all claims before scoring.`,
    };
  }

  return { passed: true };
}

/**
 * Gate: ADR must have Alternatives and Risks sections populated before acceptance.
 */
export function gateAdrReadyForAcceptance(
  adr: ParsedFile<AdrFrontmatter>
): GateResult {
  const hasAlternatives = sectionHasContent(adr.content, "Alternatives Considered");
  const hasRisks = sectionHasContent(adr.content, "Risks");

  const missing: string[] = [];
  if (!hasAlternatives) missing.push("Alternatives Considered");
  if (!hasRisks) missing.push("Risks");

  if (missing.length > 0) {
    return {
      passed: false,
      error: `Cannot accept ADR — the following sections are empty: ${missing.join(", ")}. Fill them in before accepting.`,
    };
  }

  return { passed: true };
}

/**
 * Run all scoring gates. Returns first failure, or passed if all pass.
 */
export function runScoringGates(
  projectRoot: string,
  candidateSlug: string
): GateResult {
  const checks = [
    gateCriteriaLocked(projectRoot),
    gatePeerReviewExists(projectRoot),
    gateCandidateNoTbd(projectRoot, candidateSlug),
  ];

  for (const result of checks) {
    if (!result.passed) return result;
  }

  return { passed: true };
}
