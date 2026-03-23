import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { safePath } from "./security";

/** All artifact directories live under .research/ alongside config. */
const RESEARCH_DIR = ".research";

export interface FindingFrontmatter {
  id: string;
  title: string;
  status: "open" | "confirmed" | "refuted" | "superseded";
  evidence: "HIGH" | "MODERATE" | "LOW" | "UNVERIFIED";
  sources: number;
  created: string;
}

export interface CandidateFrontmatter {
  title: string;
  verdict: "provisional" | "recommended" | "eliminated";
}

export interface DecisionCriteriaFrontmatter {
  locked: boolean;
  locked_date: string | null;
}

export interface ParsedFile<T> {
  frontmatter: T;
  content: string;
  filePath: string;
}

// ── Read / Write ────────────────────────────────────────────────────────────

export function readMarkdown<T>(filePath: string): ParsedFile<T> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  return {
    frontmatter: parsed.data as T,
    content: parsed.content,
    filePath,
  };
}

export function writeMarkdown<T extends object>(
  filePath: string,
  frontmatter: T,
  content: string
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const output = matter.stringify(content, frontmatter);
  fs.writeFileSync(filePath, output);
}

// ── Findings ────────────────────────────────────────────────────────────────

export function listFindings(projectRoot: string): ParsedFile<FindingFrontmatter>[] {
  const dir = safePath(projectRoot, RESEARCH_DIR, "findings");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => readMarkdown<FindingFrontmatter>(path.join(dir, f)));
}

export function nextFindingId(projectRoot: string): string {
  const findings = listFindings(projectRoot);
  const max = findings.reduce((acc, f) => {
    const n = parseInt(f.frontmatter.id, 10);
    return isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return String(max + 1).padStart(4, "0");
}

export function findingPath(projectRoot: string, id: string, slug: string): string {
  return safePath(projectRoot, RESEARCH_DIR, "findings", `${id}-${slug}.md`);
}

// ── Candidates ───────────────────────────────────────────────────────────────

export function listCandidates(projectRoot: string): ParsedFile<CandidateFrontmatter>[] {
  const dir = safePath(projectRoot, RESEARCH_DIR, "candidates");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => readMarkdown<CandidateFrontmatter>(path.join(dir, f)));
}

export function candidatePath(projectRoot: string, slug: string): string {
  return safePath(projectRoot, RESEARCH_DIR, "candidates", `${slug}.md`);
}

// ── Decision Criteria ────────────────────────────────────────────────────────

export function decisionCriteriaPath(projectRoot: string): string {
  return safePath(projectRoot, RESEARCH_DIR, "evaluations", "decision-criteria.md");
}

export function loadDecisionCriteria(
  projectRoot: string
): ParsedFile<DecisionCriteriaFrontmatter> | null {
  const p = decisionCriteriaPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  return readMarkdown<DecisionCriteriaFrontmatter>(p);
}

// ── Peer Review ───────────────────────────────────────────────────────────────

export function peerReviewPath(projectRoot: string): string {
  return safePath(projectRoot, RESEARCH_DIR, "evaluations", "peer-review.md");
}

export function peerReviewExists(projectRoot: string): boolean {
  return fs.existsSync(peerReviewPath(projectRoot));
}

// ── Scoring Matrix ────────────────────────────────────────────────────────────

export function scoringMatrixPath(projectRoot: string): string {
  return safePath(projectRoot, RESEARCH_DIR, "evaluations", "scoring-matrix.md");
}

// ── Section extraction ────────────────────────────────────────────────────────

/**
 * Extract the text content of a named markdown section (## Heading).
 * Returns empty string if section not found.
 */
export function extractSection(content: string, heading: string): string {
  const lines = content.split("\n");
  const headingLine = `## ${heading}`;
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (line.trim() === headingLine) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) {
      break;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join("\n").trim();
}

/**
 * Check if a markdown section has meaningful content (not just placeholder text).
 */
export function sectionHasContent(content: string, heading: string): boolean {
  const text = extractSection(content, heading);
  if (!text) return false;
  const stripped = text
    .replace(/_None documented yet\./g, "")
    .replace(/_To be determined\./g, "")
    .replace(/_TBD_/g, "")
    .trim();
  return stripped.length > 0;
}
