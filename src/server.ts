import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";

import {
  resolveByGuid,
  loadConfig,
  listProjects,
  initProject,
  initSubproject,
  initRoot,
  registerProject,
  lookupGuid,
  listRegistered,
  advancePhase,
  requirePhase,
  ResolvedProject,
  ProjectPhase,
  PHASE_ORDER,
} from "./config";
import { sanitizeSlug } from "./security";
import {
  ResearchNotFoundError,
  ResearchGateError,
  ResearchValidationError,
  formatError,
} from "./errors";
import {
  listFindings,
  nextFindingId,
  findingPath,
  readMarkdown,
  writeMarkdown,
  listCandidates,
  candidatePath,
  loadDecisionCriteria,
  decisionCriteriaPath,
  peerReviewPath,
  peerReviewExists,
  scoringMatrixPath,
  FindingFrontmatter,
  CandidateFrontmatter,
  DecisionCriteriaFrontmatter,
  extractSection,
} from "./files";
import { runScoringGates } from "./gates";
import {
  INIT_REQUIRED_GUIDE,
  WORKFLOW_OVERVIEW,
  RESOURCE_DEFINITIONS,
  INIT_REQUIRED_RESOURCE,
} from "./resources";
import { checkIntegrity } from "./integrity";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Resolve a project from its research_id (GUID).
 * If the GUID is missing or unknown, fails with a helpful error telling the AI how to get it.
 */
function getProject(researchId: unknown): ResolvedProject {
  if (!researchId || typeof researchId !== "string") {
    throw new ResearchValidationError(
      "Missing required parameter: research_id. " +
      "Read the project's research-md.json file to find the 'id' field (a UUID). " +
      "If the project hasn't been registered this session, call `project_set` with its path first."
    );
  }

  // Check if registered
  const projectPath = lookupGuid(researchId);
  if (!projectPath) {
    throw new ResearchValidationError(
      `Unknown research_id '${researchId}'. This project hasn't been registered in this session. ` +
      "Call `project_set` with the project's path to register it. " +
      "The research_id is the 'id' field in the project's research-md.json."
    );
  }

  const resolved = resolveByGuid(researchId);
  if (!resolved) {
    // Check if this is a root GUID
    const config = loadConfig(projectPath);
    if (config && "projects" in config) {
      const projects = (config as any).projects as string[];
      throw new ResearchValidationError(
        `research_id '${researchId}' points to a multi-project root, not a specific project. ` +
        `Use the research_id of one of its subprojects: ${projects.join(", ")}. ` +
        "Read each subproject's research-md.json to find its id."
      );
    }
    throw new ResearchNotFoundError("Project", researchId);
  }

  return resolved;
}

// research_id parameter — required on every data tool
const RID = {
  research_id: { type: "string", description: "Project GUID from .research/research.json 'id' field. Required." },
} as const;

export function createServer(): Server {
  const server = new Server(
    { name: "research-md", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: `research.md is the decision forge — evidence-graded, phase-gated, peer-reviewed decisions.

Use it when a question has consequences: architecture choices, technology selections, strategic bets, anything that will become a contract in visionlog. Do not make consequential decisions in conversation. Run them through research.md so the evidence is recorded, the criteria are locked, and the decision is reviewable by any future agent or human.

Call project_set first to register the project GUID for this session. Every subsequent tool call takes that GUID.

The trilogy:
- research.md: decide with evidence — this is where decisions are earned
- visionlog: records the decision as an ADR and contract — what all execution must honor
- forge.md: executes tasks within those contracts

The flow is one-way: research.md feeds visionlog, visionlog feeds forge.md. A decision skipped here is a contract that was never earned.`,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "project_set",
        description: "Register a research project for this session. Call this first — reads .research/research.json at the given path and registers its GUID. Also registers all subprojects if it's a root.",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string", description: "Absolute path to the research project or multi-project root" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "project_get",
        description: "Show all registered research projects in this session.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "project_init",
        description: "Initialize a new research project with folder structure and GUID. IMPORTANT: Always provide question and context — they are stored in .research/research.json so any future session can understand the research without prior conversation history.",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string", description: "Directory to initialize" },
            name: { type: "string", description: "Project name" },
            root: { type: "boolean", description: "Create a multi-project root" },
            subproject: { type: "string", description: "Create a subproject under this root" },
            question: { type: "string", description: "The research question — what are we trying to answer? One or two sentences." },
            context: { type: "string", description: "Full research brief. Be comprehensive: background, motivation, constraints, what we already know, what systems/artifacts are involved, who cares about the outcome, and what 'done' looks like. This should be long enough that a cold-start session can pick up the research without any prior conversation." },
          },
          additionalProperties: false,
        },
      },
      {
        name: "status",
        description: "Show project health: criteria locked, peer review, TBD count, findings, candidates.",
        inputSchema: {
          type: "object",
          required: ["research_id"],
          properties: { ...RID },
          additionalProperties: false,
        },
      },
      {
        name: "finding_create",
        description: "Create a new finding with evidence grade and source.",
        inputSchema: {
          type: "object",
          required: ["research_id", "title", "claim"],
          properties: {
            ...RID,
            title: { type: "string", minLength: 1 },
            claim: { type: "string", minLength: 1 },
            evidence: { type: "string", enum: ["HIGH", "MODERATE", "LOW", "UNVERIFIED"] },
            source: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "finding_list",
        description: "List all findings with status and evidence grade.",
        inputSchema: {
          type: "object",
          required: ["research_id"],
          properties: { ...RID },
          additionalProperties: false,
        },
      },
      {
        name: "finding_update",
        description: "Update a finding's status, evidence grade, or claim.",
        inputSchema: {
          type: "object",
          required: ["research_id", "id"],
          properties: {
            ...RID,
            id: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["open", "confirmed", "refuted", "superseded"] },
            evidence: { type: "string", enum: ["HIGH", "MODERATE", "LOW", "UNVERIFIED"] },
            claim: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_create",
        description: "Create a new candidate for evaluation.",
        inputSchema: {
          type: "object",
          required: ["research_id", "title"],
          properties: {
            ...RID,
            title: { type: "string", minLength: 1 },
            slug: { type: "string" },
            description: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_list",
        description: "List all candidates with verdict status.",
        inputSchema: {
          type: "object",
          required: ["research_id"],
          properties: { ...RID },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_update",
        description: "Update a candidate's verdict and/or description.",
        inputSchema: {
          type: "object",
          required: ["research_id", "slug"],
          properties: {
            ...RID,
            slug: { type: "string", description: "Candidate slug (filename without .md)" },
            verdict: { type: "string", enum: ["provisional", "recommended", "eliminated"] },
            description: { type: "string", description: "Replace the 'What It Is' section content" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_add_claim",
        description: "Add a binary testable claim to a candidate's validation checklist.",
        inputSchema: {
          type: "object",
          required: ["research_id", "slug", "claim"],
          properties: {
            ...RID,
            slug: { type: "string", minLength: 1 },
            claim: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_resolve_claim",
        description: "Mark a validation claim Y or N (clears _TBD_).",
        inputSchema: {
          type: "object",
          required: ["research_id", "slug", "claim_index", "result"],
          properties: {
            ...RID,
            slug: { type: "string", minLength: 1 },
            claim_index: { type: "number", minimum: 1 },
            result: { type: "string", enum: ["Y", "N"] },
          },
          additionalProperties: false,
        },
      },
      {
        name: "criteria_lock",
        description: "Lock decision criteria, preventing further weight changes.",
        inputSchema: {
          type: "object",
          required: ["research_id"],
          properties: { ...RID },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_score",
        description: "Score a candidate. Fails if criteria not locked, peer review missing, or _TBD_ items remain.",
        inputSchema: {
          type: "object",
          required: ["research_id", "slug", "scores"],
          properties: {
            ...RID,
            slug: { type: "string", minLength: 1 },
            scores: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 10 } },
            notes: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "scoring_matrix_generate",
        description: "Generate evaluations/scoring-matrix.md from locked criteria and candidates.",
        inputSchema: {
          type: "object",
          required: ["research_id"],
          properties: { ...RID },
          additionalProperties: false,
        },
      },
      {
        name: "peer_review_log",
        description: "Log a peer review. Required before scoring. Advances project to 'reviewed' phase.",
        inputSchema: {
          type: "object",
          required: ["research_id", "reviewer", "findings"],
          properties: {
            ...RID,
            reviewer: { type: "string", minLength: 1 },
            findings: { type: "array", items: { type: "string" }, minItems: 1 },
            notes: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "project_decide",
        description: "Record a decision. Advances project to 'decided' phase. Requires 'scored' phase or later.",
        inputSchema: {
          type: "object",
          required: ["research_id", "decision", "rationale"],
          properties: {
            ...RID,
            decision: { type: "string", minLength: 1, description: "The decision statement" },
            rationale: { type: "string", minLength: 1, description: "Why this decision was made" },
            adr_reference: { type: "string", description: "Reference to the ADR documenting this decision (e.g. ADR-2026-28)" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "project_supersede",
        description: "Mark a decided project as superseded by a later decision.",
        inputSchema: {
          type: "object",
          required: ["research_id", "superseded_by"],
          properties: {
            ...RID,
            superseded_by: { type: "string", minLength: 1, description: "What supersedes this (ADR reference or new project)" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "research_brief",
        description: "Generate a layered research brief from a completed (decided) project. Produces a 7-layer document: one-liner, key findings, scoring matrix summary, decision, situational playbook, evidence summary, and methodology. Designed for sharing with stakeholders who weren't in the room.",
        inputSchema: {
          type: "object",
          required: ["research_id"],
          properties: {
            ...RID,
            audience: { type: "string", description: "Who will read this brief (e.g., 'CEO', 'engineering team', 'new hire'). Affects which layers are emphasized." },
          },
          additionalProperties: false,
        },
      },
      {
        name: "research_report",
        description: "Generate a FULL research report from a completed project. Unlike research_brief (which truncates to top findings), the report includes ALL findings, ALL candidates with full descriptions and scoring details, the complete scoring matrix, and every section unabridged. Produces REPORT.md and REPORT.pdf.",
        inputSchema: {
          type: "object",
          required: ["research_id"],
          properties: {
            ...RID,
          },
          additionalProperties: false,
        },
      },
    ],
  }));

  // ── Tool handlers ──────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "project_set": {
          const projectPath = args?.path as string;
          if (!projectPath) throw new ResearchValidationError("'path' is required.");
          const info = registerProject(projectPath);

          const lines = [`Registered: ${projectPath}`, `ID: ${info.id}`, `Name: ${info.projectName}`];
          if (info.question) lines.push(`\n**Question:** ${info.question}`);
          if (info.context) lines.push(`\n**Context:**\n${info.context}`);
          if (info.isRoot) {
            lines.push(`\nThis is a multi-project root with ${info.projects.length} subproject(s).`);
            lines.push("Subprojects also registered. Read each subproject's research-md.json for its research_id.");
            lines.push(`\nSubprojects: ${info.projects.join(", ")}`);
          }
          lines.push("\nUse the 'id' field as research_id on all subsequent tool calls.");

          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "project_get": {
          const registered = listRegistered();
          if (registered.length === 0) {
            return { content: [{ type: "text", text: "No projects registered this session. Use `project_set` with a project path." }] };
          }
          const lines = registered.map((r) => `${r.id} → ${r.path}`);
          return { content: [{ type: "text", text: ["Registered projects:", "", ...lines].join("\n") }] };
        }

        case "project_init": {
          const targetPath = args?.path as string;
          if (!targetPath) throw new ResearchValidationError("'path' is required.");

          if (args?.root) {
            initRoot(targetPath);
            const config = loadConfig(targetPath);
            return { content: [{ type: "text", text: `Multi-project root initialized at ${targetPath}\nID: ${config?.id}\n\nUse init with 'subproject' to add research projects.` }] };
          }

          if (args?.subproject) {
            const subName = args.subproject as string;
            initSubproject(targetPath, subName, args?.question as string | undefined, args?.context as string | undefined);
            const subConfig = loadConfig(path.join(targetPath, subName));
            const subWarnings: string[] = [];
            if (!args?.question) subWarnings.push("WARNING: No research question provided.");
            if (!args?.context) subWarnings.push("WARNING: No context brief provided.");
            return { content: [{ type: "text", text: `Subproject '${subName}' initialized at ${targetPath}/${subName}\nID: ${subConfig?.id}\n\nFolders: findings/ candidates/ evaluations/${subWarnings.length ? "\n\n" + subWarnings.join("\n") : ""}` }] };
          }

          initProject(targetPath, args?.name as string | undefined, args?.question as string | undefined, args?.context as string | undefined);
          const config = loadConfig(targetPath);
          const warnings: string[] = [];
          if (!args?.question) warnings.push("WARNING: No research question provided. Future sessions won't know what this research is about.");
          if (!args?.context) warnings.push("WARNING: No context brief provided. Future sessions will lack the background needed to continue this research.");
          return { content: [{ type: "text", text: `Research project initialized at ${targetPath}\nID: ${config?.id}\n\nFolders: findings/ candidates/ evaluations/${warnings.length ? "\n\n" + warnings.join("\n") : ""}` }] };
        }

        case "status": {
          const { projectRoot: root, config: projectConfig } = getProject(args?.research_id);
          const findings = listFindings(root);
          const candidates = listCandidates(root);
          const criteria = loadDecisionCriteria(root);
          const hasPeerReview = peerReviewExists(root);
          const tbdCount = candidates.reduce((acc, c) => acc + (c.content.match(/_TBD_/g)?.length || 0), 0);

          const lines = [
            `## ${projectConfig.projectName} — Research Status`,
            "",
            ...(projectConfig.question ? [`**Question:** ${projectConfig.question}`, ""] : []),
            ...(projectConfig.context ? [`**Context:**`, projectConfig.context, ""] : []),
            `**Phase:** ${projectConfig.phase}`,
            `**Criteria locked:** ${criteria?.frontmatter.locked ? `Yes (${criteria.frontmatter.locked_date})` : "No"}`,
            `**Peer review logged:** ${hasPeerReview ? "Yes" : "No"}`,
            `**TBD items remaining:** ${tbdCount}`,
            "",
            `**Findings (${findings.length}):**`,
            ...findings.map((f) => `  ${f.frontmatter.id} [${f.frontmatter.status}] [${f.frontmatter.evidence}] ${f.frontmatter.title}`),
            "",
            `**Candidates (${candidates.length}):**`,
            ...candidates.map((c) => `  ${c.frontmatter.title} — ${c.frontmatter.verdict}`),
            "",
            "**Phase history:**",
            ...projectConfig.transitions.map((t) => `  ${t.date} → ${t.phase}${t.note ? ` (${t.note})` : ""}`),
          ];

          // Integrity checks
          const issues = checkIntegrity(root, projectConfig);
          if (issues.length > 0) {
            lines.push("", "**Integrity issues:**");
            for (const issue of issues) {
              const icon = issue.severity === "error" ? "ERROR" : "WARNING";
              lines.push(`  [${icon}] ${issue.message}`);
            }
          } else {
            lines.push("", "**Integrity:** All checks passed.");
          }

          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "finding_create": {
          const { projectRoot: root } = getProject(args?.research_id);
          const title = args?.title as string;
          const claim = args?.claim as string;
          const evidence = (args?.evidence as FindingFrontmatter["evidence"]) || "UNVERIFIED";
          const source = (args?.source as string) || "unspecified";
          const id = nextFindingId(root);
          const slug = sanitizeSlug(title);
          const fp = findingPath(root, id, slug);

          const frontmatter: FindingFrontmatter = { id, title, status: "open", evidence, sources: source === "unspecified" ? 0 : 1, created: today() };
          const content = `\n## Claim\n\n${claim}\n\n## Supporting Evidence\n\n> **Evidence: [${evidence}]** — ${source}, retrieved ${today()}\n\n## Caveats\n\nNone identified yet.\n`;

          writeMarkdown(fp, frontmatter, content);
          return { content: [{ type: "text", text: `Finding created: findings/${id}-${slug}.md\nID: ${id} | Evidence: ${evidence}` }] };
        }

        case "finding_list": {
          const { projectRoot: root } = getProject(args?.research_id);
          const findings = listFindings(root);
          if (findings.length === 0) return { content: [{ type: "text", text: "No findings yet." }] };
          const rows = findings.map((f) => `${f.frontmatter.id} | ${f.frontmatter.status.padEnd(10)} | ${f.frontmatter.evidence.padEnd(10)} | ${f.frontmatter.title}`);
          return { content: [{ type: "text", text: ["ID   | Status     | Evidence   | Title", "---- | ---------- | ---------- | -----", ...rows].join("\n") }] };
        }

        case "finding_update": {
          const { projectRoot: root } = getProject(args?.research_id);
          const id = (args?.id as string).padStart(4, "0");
          const findings = listFindings(root);
          const finding = findings.find((f) => f.frontmatter.id === id);
          if (!finding) throw new ResearchNotFoundError("Finding", id);

          const updated: FindingFrontmatter = { ...finding.frontmatter };
          if (args?.status) updated.status = args.status as FindingFrontmatter["status"];
          if (args?.evidence) updated.evidence = args.evidence as FindingFrontmatter["evidence"];

          let content = finding.content;
          if (args?.claim) {
            content = content.replace(/## Claim\n\n[\s\S]*?\n\n## Supporting/, `## Claim\n\n${args.claim}\n\n## Supporting`);
          }

          writeMarkdown(finding.filePath, updated, content);
          return { content: [{ type: "text", text: `Finding ${id} updated.` }] };
        }

        case "candidate_create": {
          const { projectRoot: root } = getProject(args?.research_id);
          const title = args?.title as string;
          const slug = sanitizeSlug((args?.slug as string) || title);
          const description = (args?.description as string) || "_No description provided._";
          const fp = candidatePath(root, slug);

          if (fs.existsSync(fp)) throw new ResearchValidationError(`Candidate '${slug}' already exists.`);

          const frontmatter: CandidateFrontmatter = { title, verdict: "provisional" };
          const content = `\n## What It Is\n\n${description}\n\n## Validation Checklist\n\n- [ ] Claim 1: _TBD_\n\n## Scoring\n\n_Not yet scored._\n`;

          writeMarkdown(fp, frontmatter, content);
          return { content: [{ type: "text", text: `Candidate created: candidates/${slug}.md` }] };
        }

        case "candidate_list": {
          const { projectRoot: root } = getProject(args?.research_id);
          const candidates = listCandidates(root);
          if (candidates.length === 0) return { content: [{ type: "text", text: "No candidates yet." }] };
          const rows = candidates.map((c) => `${c.frontmatter.verdict.padEnd(12)} | ${c.frontmatter.title}`);
          return { content: [{ type: "text", text: ["Verdict       | Title", "------------- | -----", ...rows].join("\n") }] };
        }

        case "candidate_update": {
          const { projectRoot: root } = getProject(args?.research_id);
          const slug = args?.slug as string;
          const fp = candidatePath(root, slug);
          if (!fs.existsSync(fp)) throw new ResearchNotFoundError("Candidate", slug);

          const parsed = readMarkdown<CandidateFrontmatter>(fp);
          const updated: CandidateFrontmatter = { ...parsed.frontmatter };
          if (args?.verdict) updated.verdict = args.verdict as CandidateFrontmatter["verdict"];

          let content = parsed.content;
          if (args?.description) {
            content = content.replace(
              /(## What It Is\n\n)[\s\S]*?\n\n(## )/,
              `$1${args.description}\n\n$2`
            );
          }

          writeMarkdown(fp, updated, content);
          const changes: string[] = [];
          if (args?.verdict) changes.push(`verdict → ${args.verdict}`);
          if (args?.description) changes.push("description updated");
          return { content: [{ type: "text", text: `Candidate '${slug}' updated: ${changes.join(", ")}.` }] };
        }

        case "candidate_add_claim": {
          const { projectRoot: root } = getProject(args?.research_id);
          const slug = args?.slug as string;
          const claim = args?.claim as string;
          const fp = candidatePath(root, slug);
          if (!fs.existsSync(fp)) throw new ResearchNotFoundError("Candidate", slug);

          const parsed = readMarkdown<CandidateFrontmatter>(fp);
          const newContent = parsed.content.replace(
            /(## Validation Checklist\n)([\s\S]*?)(## Scoring)/,
            (_, heading, existing, next) => `${heading}${existing.trimEnd()}\n- [ ] ${claim}: _TBD_\n\n${next}`
          );

          writeMarkdown(fp, parsed.frontmatter, newContent);
          return { content: [{ type: "text", text: `Claim added to '${slug}'.` }] };
        }

        case "candidate_resolve_claim": {
          const { projectRoot: root } = getProject(args?.research_id);
          const slug = args?.slug as string;
          const claimIndex = args?.claim_index as number;
          const result = args?.result as "Y" | "N";
          const fp = candidatePath(root, slug);
          if (!fs.existsSync(fp)) throw new ResearchNotFoundError("Candidate", slug);

          const parsed = readMarkdown<CandidateFrontmatter>(fp);
          let count = 0;
          const original = parsed.content;
          const newContent = parsed.content.replace(
            /- \[ \] (.+?): _TBD_/g,
            (match, claimText) => {
              count++;
              return count === claimIndex ? `- [${result === "Y" ? "x" : " "}] ${claimText}: ${result}` : match;
            }
          );

          if (newContent === original) throw new ResearchNotFoundError("Claim", String(claimIndex));

          writeMarkdown(fp, parsed.frontmatter, newContent);
          return { content: [{ type: "text", text: `Claim ${claimIndex} in '${slug}' marked ${result}.` }] };
        }

        case "criteria_lock": {
          const { projectRoot: root } = getProject(args?.research_id);
          const criteriaFile = decisionCriteriaPath(root);
          if (!fs.existsSync(criteriaFile)) throw new ResearchNotFoundError("File", "evaluations/decision-criteria.md");

          const parsed = readMarkdown<DecisionCriteriaFrontmatter>(criteriaFile);
          if (parsed.frontmatter.locked) {
            return { content: [{ type: "text", text: `Criteria already locked on ${parsed.frontmatter.locked_date}.` }] };
          }

          writeMarkdown(criteriaFile, { locked: true, locked_date: today() }, parsed.content);
          advancePhase(root, "locked", "Criteria weights frozen");
          return { content: [{ type: "text", text: `Decision criteria locked on ${today()}. Weights are now frozen. Phase → locked` }] };
        }

        case "candidate_score": {
          const { projectRoot: root, config: projectConfig } = getProject(args?.research_id);
          requirePhase(projectConfig, "reviewed", "score candidates");

          const slug = args?.slug as string;
          const scores = args?.scores as Record<string, number>;
          const notes = (args?.notes as string) || "";

          const gateResult = runScoringGates(root, slug);
          if (!gateResult.passed) throw new ResearchGateError(gateResult.error!);

          const fp = candidatePath(root, slug);
          const parsed = readMarkdown<CandidateFrontmatter>(fp);
          const total = Object.values(scores).reduce((a, b) => a + b, 0);
          const scoreLines = Object.entries(scores).map(([c, s]) => `| ${c} | ${s}/10 |`).join("\n");
          const scoringSection = `\n## Scores\n\n| Criterion | Score |\n|-----------|-------|\n${scoreLines}\n| **Total** | **${total}** |\n${notes ? `\n**Notes:** ${notes}\n` : ""}`;

          const newContent = parsed.content.replace(/## Scoring[\s\S]*/, `## Scoring${scoringSection}`);
          writeMarkdown(fp, parsed.frontmatter, newContent);

          // Advance to scored phase (idempotent if already scored)
          try { advancePhase(root, "scored", `Scored candidate: ${slug}`); } catch { /* already at scored or later */ }

          return { content: [{ type: "text", text: `Scored '${slug}'. Total: ${total}\n${Object.entries(scores).map(([k, v]) => `  ${k}: ${v}`).join("\n")}` }] };
        }

        case "scoring_matrix_generate": {
          const { projectRoot: root } = getProject(args?.research_id);
          const criteria = loadDecisionCriteria(root);
          if (!criteria?.frontmatter.locked) throw new ResearchGateError("Criteria must be locked before generating scoring matrix.");

          const candidates = listCandidates(root);
          const matrixPath = scoringMatrixPath(root);

          const criteriaRows = criteria.content
            .split("\n")
            .filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("Criterion") && !l.includes("Weight"))
            .map((line) => {
              const cols = line.split("|").filter(Boolean).map((s) => s.trim());
              return { num: cols[0] || "", name: cols[1] || "", weight: cols[2] || "1" };
            })
            .filter((r) => r.name && r.name !== "_TBD_");

          const header = criteriaRows.map((c) => c.name).join(" | ");
          const dashes = criteriaRows.map(() => "---").join("|");

          const candidateRows = candidates.map((c) => {
            const scoreMatches = [...c.content.matchAll(/\| (.+?) \| (\d+)\/10 \|/g)];
            const scoreMap: Record<string, number> = {};
            for (const m of scoreMatches) scoreMap[m[1].trim()] = parseInt(m[2], 10);
            const scores = criteriaRows.map((cr) => scoreMap[cr.name] ?? "–");
            const total = criteriaRows.reduce((acc, cr) => acc + (scoreMap[cr.name] ?? 0), 0);
            return `| ${c.frontmatter.title} | ${scores.join(" | ")} | **${total}** |`;
          }).join("\n");

          const matrixContent = [
            "# Scoring Matrix",
            "",
            `_Generated ${today()} — criteria locked ${criteria.frontmatter.locked_date}_`,
            "",
            "## Criteria",
            "",
            "| # | Criterion | Weight |",
            "|---|-----------|--------|",
            ...criteriaRows.map((c) => `| ${c.num} | ${c.name} | ${c.weight} |`),
            "",
            "## Scores",
            "",
            `| Candidate | ${header} | **Total** |`,
            `|-----------|${dashes}|-----------|`,
            candidateRows,
          ].join("\n");

          fs.writeFileSync(matrixPath, matrixContent + "\n");
          return { content: [{ type: "text", text: "Scoring matrix generated at evaluations/scoring-matrix.md" }] };
        }

        case "peer_review_log": {
          const { projectRoot: root } = getProject(args?.research_id);
          const reviewer = args?.reviewer as string;
          const findings = args?.findings as string[];
          const notes = (args?.notes as string) || "";
          const fp = peerReviewPath(root);

          const content = ["# Peer Review", "", `**Reviewer:** ${reviewer}`, `**Date:** ${today()}`, "", "## Findings", "", ...findings.map((f) => `- ${f}`), ...(notes ? ["", "## Notes", "", notes] : [])].join("\n");

          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.writeFileSync(fp, content + "\n");
          advancePhase(root, "reviewed", `Peer review by ${reviewer}`);

          return { content: [{ type: "text", text: `Peer review logged by ${reviewer} on ${today()}. Scoring is now unblocked. Phase → reviewed` }] };
        }

        case "project_decide": {
          const { projectRoot: root, config: projectConfig } = getProject(args?.research_id);
          requirePhase(projectConfig, "scored", "record a decision");

          const decision = args?.decision as string;
          const rationale = args?.rationale as string;
          const adrRef = (args?.adr_reference as string) || "";

          // Find existing decision file(s) in decisions/ and update them
          const decisionsDir = path.join(root, "decisions");
          let updatedFiles: string[] = [];

          if (fs.existsSync(decisionsDir)) {
            const decisionFiles = fs.readdirSync(decisionsDir).filter(
              (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md"
            );

            for (const df of decisionFiles) {
              const fp = path.join(decisionsDir, df);
              let content = fs.readFileSync(fp, "utf-8");
              let changed = false;

              // Update status line
              if (content.includes("Under Research") || content.includes("Status: Draft")) {
                content = content.replace(/Under Research/g, "Decided");
                content = content.replace(/Status: Draft/g, "Status: Decided");
                changed = true;
              }

              // Fill in Decision section if it has placeholder
              if (content.includes("_To be written after scoring matrix is complete._") ||
                  content.includes("_To be written after decision is made._")) {
                content = content.replace(
                  /## Decision\n\n_To be written[^_]*_/,
                  `## Decision\n\n${decision}${adrRef ? `\n\nSee ${adrRef} for the full decision record.` : ""}`
                );
                changed = true;
              }

              // Fill in Consequences section if it has placeholder
              if (content.includes("_To be written after decision is made._")) {
                content = content.replace(
                  /## Consequences\n\n_To be written[^_]*_/,
                  `## Consequences\n\n${rationale}`
                );
                changed = true;
              }

              // Update date
              content = content.replace(/\*\*Date:\*\*\s*_TBD_/, `**Date:** ${today()}`);

              if (changed) {
                fs.writeFileSync(fp, content);
                updatedFiles.push(df);
              }
            }
          }

          // Also write DECISION.md as canonical summary
          const summaryContent = [
            "# Decision",
            "",
            `**Date:** ${today()}`,
            `**Status:** Decided`,
            ...(adrRef ? [`**ADR:** ${adrRef}`] : []),
            "",
            "## Decision",
            "",
            decision,
            "",
            "## Rationale",
            "",
            rationale,
          ].join("\n");

          const decisionPath = path.join(root, "DECISION.md");
          fs.writeFileSync(decisionPath, summaryContent + "\n");

          advancePhase(root, "decided", decision.substring(0, 100));

          const response = [`Decision recorded. Phase → decided`, ""];
          if (updatedFiles.length > 0) {
            response.push(`Updated existing decision files: ${updatedFiles.join(", ")}`);
          }
          response.push(`Wrote DECISION.md`);
          response.push("", decision);

          return { content: [{ type: "text", text: response.join("\n") }] };
        }

        case "project_supersede": {
          const { projectRoot: root, config: projectConfig } = getProject(args?.research_id);
          requirePhase(projectConfig, "decided", "supersede a decision");

          const supersededBy = args?.superseded_by as string;
          advancePhase(root, "superseded", `Superseded by ${supersededBy}`);

          return { content: [{ type: "text", text: `Project marked as superseded by ${supersededBy}. Phase → superseded` }] };
        }

        case "research_brief": {
          const { projectRoot: root, config: projectConfig } = getProject(args?.research_id);
          const audience = (args?.audience as string) || "general";
          const findings = listFindings(root);
          const candidates = listCandidates(root);
          const criteria = loadDecisionCriteria(root);
          const hasPeerReview = peerReviewExists(root);

          // Read DECISION.md if it exists
          const decisionPath = path.join(root, "DECISION.md");
          const decisionContent = fs.existsSync(decisionPath)
            ? fs.readFileSync(decisionPath, "utf-8")
            : "";

          // Read scoring matrix if it exists
          const matrixPath = scoringMatrixPath(root);
          const matrixContent = fs.existsSync(matrixPath)
            ? fs.readFileSync(matrixPath, "utf-8")
            : "";

          // Count evidence grades
          const highFindings = findings.filter(f => f.frontmatter.evidence === "HIGH");
          const modFindings = findings.filter(f => f.frontmatter.evidence === "MODERATE");

          // Extract candidate scores from their content
          const candidateScores: Array<{ title: string; total: number; verdict: string }> = [];
          for (const c of candidates) {
            const totalMatch = c.content.match(/\*\*Total\*\*.*?\*\*(\d+)\*\*/);
            const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
            candidateScores.push({ title: c.frontmatter.title, total, verdict: c.frontmatter.verdict });
          }
          candidateScores.sort((a, b) => b.total - a.total);

          const brief: string[] = [];

          // ── LAYER 1: One-liner (BLUF) ──
          brief.push(`# Research Brief: ${projectConfig.projectName}`);
          brief.push("");
          brief.push(`*Generated ${today()} by research.md*`);
          brief.push("");

          if (projectConfig.question) {
            brief.push(`> **Question:** ${projectConfig.question}`);
            brief.push("");
          }

          // One-liner verdict
          if (decisionContent) {
            const decisionLines = decisionContent.split("\n");
            const decisionStatement = decisionLines.find(l => l.startsWith("## Decision"));
            const decisionIdx = decisionLines.indexOf(decisionStatement || "");
            if (decisionIdx >= 0) {
              // Get the paragraph after "## Decision"
              for (let i = decisionIdx + 1; i < decisionLines.length; i++) {
                const line = decisionLines[i].trim();
                if (line && !line.startsWith("#") && !line.startsWith("*")) {
                  brief.push(`**Verdict:** ${line}`);
                  brief.push("");
                  break;
                }
              }
            }
          }

          brief.push(`**Evidence:** ${findings.length} findings (${highFindings.length} HIGH, ${modFindings.length} MODERATE) | ${candidates.length} candidates scored | Peer reviewed: ${hasPeerReview ? "Yes" : "No"}`);
          brief.push("");

          // ── LAYER 2: Key Findings ──
          brief.push("---");
          brief.push("");
          brief.push("## Key Findings");
          brief.push("");

          // Show HIGH findings first, then MODERATE
          for (const f of highFindings.slice(0, 8)) {
            brief.push(`- **${f.frontmatter.title}** — ${extractSection(f.content, "Claim").split("\n")[0] || ""}`);
          }
          if (highFindings.length > 8) {
            brief.push(`- *...and ${highFindings.length - 8} more HIGH-evidence findings*`);
          }
          if (modFindings.length > 0) {
            brief.push(`- *Plus ${modFindings.length} MODERATE-evidence findings (see full report)*`);
          }
          brief.push("");

          // ── LAYER 3: Scoring Summary ──
          if (candidateScores.length > 0) {
            brief.push("---");
            brief.push("");
            brief.push("## Candidates Evaluated");
            brief.push("");
            brief.push("| Rank | Candidate | Score | Verdict |");
            brief.push("|------|-----------|-------|---------|");
            for (let i = 0; i < candidateScores.length; i++) {
              const c = candidateScores[i];
              brief.push(`| ${i + 1} | ${c.title} | ${c.total} | ${c.verdict} |`);
            }
            brief.push("");
          }

          // ── LAYER 4: Decision ──
          if (decisionContent) {
            brief.push("---");
            brief.push("");
            brief.push("## Decision");
            brief.push("");
            // Extract the Decision and Rationale sections
            const decisionText = extractSection(decisionContent, "Decision");
            const rationaleText = extractSection(decisionContent, "Rationale");
            if (decisionText) brief.push(decisionText);
            if (rationaleText) {
              brief.push("");
              brief.push("**Rationale:** " + rationaleText.split("\n")[0]);
            }
            brief.push("");
          }

          // ── LAYER 5: Situational Playbook (if scoring matrix has one) ──
          if (matrixContent.includes("Playbook") || matrixContent.includes("playbook")) {
            brief.push("---");
            brief.push("");
            // Extract everything from "Playbook" or "Interpretation" heading onward
            const playbookText = extractSection(matrixContent, "The Situational Playbook")
              || extractSection(matrixContent, "Interpretation");
            if (playbookText) {
              brief.push("## How to Apply");
              brief.push("");
              brief.push(playbookText);
              brief.push("");
            }
          }

          // ── LAYER 6: Design Rules (if they exist in matrix) ──
          const rulesText = extractSection(matrixContent, "Design Rules (from behavioral science research)")
            || extractSection(matrixContent, "Design Rules");
          if (rulesText) {
            brief.push("---");
            brief.push("");
            brief.push("## Design Rules");
            brief.push("");
            brief.push(rulesText);
            brief.push("");
          }

          // ── LAYER 7: Methodology ──
          brief.push("---");
          brief.push("");
          brief.push("## Methodology");
          brief.push("");
          brief.push(`- **Project:** ${projectConfig.projectName}`);
          brief.push(`- **Phase:** ${projectConfig.phase}`);
          brief.push(`- **Created:** ${projectConfig.created}`);
          brief.push(`- **Findings:** ${findings.length} (${highFindings.length} HIGH, ${modFindings.length} MODERATE)`);
          brief.push(`- **Candidates:** ${candidates.length} evaluated`);
          brief.push(`- **Criteria:** ${criteria ? "Locked" : "Not defined"}`);
          brief.push(`- **Peer review:** ${hasPeerReview ? "Logged" : "Not logged"}`);
          brief.push("");

          // Timeline
          if (projectConfig.transitions.length > 0) {
            brief.push("### Timeline");
            brief.push("");
            for (const t of projectConfig.transitions) {
              brief.push(`- ${t.date}: ${t.phase}${t.note ? ` — ${t.note}` : ""}`);
            }
            brief.push("");
          }

          // Context (if exists)
          if (projectConfig.context) {
            brief.push("### Research Context");
            brief.push("");
            brief.push(projectConfig.context);
            brief.push("");
          }

          brief.push("---");
          brief.push("");
          brief.push("*Generated by [research.md](https://github.com/eidos-agi/research.md) — structured research workflow for AI-augmented decision making.*");

          // Write to file
          const briefPath = path.join(root, "BRIEF.md");
          fs.writeFileSync(briefPath, brief.join("\n") + "\n");

          // Auto-generate PDF alongside BRIEF.md
          let pdfStatus = "";
          try {
            const renderScript = path.join(__dirname, "..", "src", "render-brief.py");
            if (fs.existsSync(renderScript)) {
              const { execFileSync } = require("child_process");
              const pdfPath = path.join(root, "BRIEF.pdf");
              execFileSync("python3", [renderScript, briefPath, "--brand", "research", "-o", pdfPath], {
                stdio: ["pipe", "pipe", "pipe"],
                encoding: "utf-8",
                timeout: 15000,
              });
              pdfStatus = `\nPDF: BRIEF.pdf generated alongside BRIEF.md`;
            }
          } catch (pdfErr: any) {
            pdfStatus = `\nPDF: Could not generate (${pdfErr.message || "python3/reportlab not available"}). Run manually: research-md brief ${briefPath}`;
          }

          return { content: [{ type: "text", text: `Research brief generated: BRIEF.md (${brief.length} lines)\n\n7 layers: One-liner → Key Findings → Candidates → Decision → Playbook → Design Rules → Methodology\n\nAudience: ${audience}${pdfStatus}` }] };
        }

        case "research_report": {
          const { projectRoot: root, config: projectConfig } = getProject(args?.research_id);
          const findings = listFindings(root);
          const candidates = listCandidates(root);
          const criteria = loadDecisionCriteria(root);
          const hasPeerReview = peerReviewExists(root);

          // Read DECISION.md if it exists
          const decisionPath = path.join(root, "DECISION.md");
          const decisionContent = fs.existsSync(decisionPath)
            ? fs.readFileSync(decisionPath, "utf-8")
            : "";

          // Read scoring matrix if it exists
          const matrixPath = scoringMatrixPath(root);
          const matrixContent = fs.existsSync(matrixPath)
            ? fs.readFileSync(matrixPath, "utf-8")
            : "";

          // Group findings by evidence grade
          const highFindings = findings.filter(f => f.frontmatter.evidence === "HIGH");
          const modFindings = findings.filter(f => f.frontmatter.evidence === "MODERATE");
          const lowFindings = findings.filter(f => f.frontmatter.evidence === "LOW");
          const unverifiedFindings = findings.filter(f => f.frontmatter.evidence === "UNVERIFIED");

          const report: string[] = [];
          const sections: string[] = [];

          // ── SECTION 1: Title + Question + Verdict ──
          report.push(`# Research Report: ${projectConfig.projectName}`);
          report.push("");
          report.push(`*Full report generated ${today()} by research.md*`);
          report.push("");

          if (projectConfig.question) {
            report.push(`> **Question:** ${projectConfig.question}`);
            report.push("");
          }

          // Verdict from DECISION.md
          if (decisionContent) {
            const decisionLines = decisionContent.split("\n");
            const decisionStatement = decisionLines.find(l => l.startsWith("## Decision"));
            const decisionIdx = decisionLines.indexOf(decisionStatement || "");
            if (decisionIdx >= 0) {
              for (let i = decisionIdx + 1; i < decisionLines.length; i++) {
                const line = decisionLines[i].trim();
                if (line && !line.startsWith("#") && !line.startsWith("*")) {
                  report.push(`**Verdict:** ${line}`);
                  report.push("");
                  break;
                }
              }
            }
          }
          sections.push("Title + Question + Verdict");

          // ── SECTION 2: Evidence Summary ──
          report.push(`**Evidence:** ${findings.length} findings (${highFindings.length} HIGH, ${modFindings.length} MODERATE, ${lowFindings.length} LOW, ${unverifiedFindings.length} UNVERIFIED) | ${candidates.length} candidates scored | Peer reviewed: ${hasPeerReview ? "Yes" : "No"}`);
          report.push("");
          sections.push("Evidence Summary");

          // ── SECTION 3: ALL Findings (grouped by evidence grade) ──
          report.push("---");
          report.push("");
          report.push("## All Findings");
          report.push("");

          const renderFindingGroup = (label: string, group: typeof findings) => {
            if (group.length === 0) return;
            report.push(`### ${label} Evidence (${group.length})`);
            report.push("");
            for (const f of group) {
              const claim = extractSection(f.content, "Claim") || "";
              const source = f.frontmatter.sources ? `${f.frontmatter.sources} source(s)` : "no sources";
              report.push(`#### ${f.frontmatter.id}: ${f.frontmatter.title}`);
              report.push("");
              report.push(`**Evidence:** ${f.frontmatter.evidence} | **Status:** ${f.frontmatter.status} | **Sources:** ${source}`);
              report.push("");
              if (claim) {
                report.push(claim);
                report.push("");
              }
            }
          };

          renderFindingGroup("HIGH", highFindings);
          renderFindingGroup("MODERATE", modFindings);
          renderFindingGroup("LOW", lowFindings);
          renderFindingGroup("UNVERIFIED", unverifiedFindings);
          sections.push(`All Findings (${findings.length})`);

          // ── SECTION 4: ALL Candidates (full details) ──
          if (candidates.length > 0) {
            report.push("---");
            report.push("");
            report.push("## All Candidates");
            report.push("");

            for (const c of candidates) {
              report.push(`### ${c.frontmatter.title}`);
              report.push("");
              report.push(`**Verdict:** ${c.frontmatter.verdict}`);
              report.push("");

              // "What It Is" section from candidate file
              const whatItIs = extractSection(c.content, "What It Is");
              if (whatItIs) {
                report.push("**What It Is**");
                report.push("");
                report.push(whatItIs);
                report.push("");
              }

              // Scoring details from the candidate file
              const scoring = extractSection(c.content, "Scoring");
              if (scoring) {
                report.push("**Scoring**");
                report.push("");
                report.push(scoring);
                report.push("");
              }

              // Total score
              const totalMatch = c.content.match(/\*\*Total\*\*.*?\*\*(\d+)\*\*/);
              if (totalMatch) {
                report.push(`**Total Score: ${totalMatch[1]}**`);
                report.push("");
              }
            }
            sections.push(`All Candidates (${candidates.length})`);
          }

          // ── SECTION 5: Complete Scoring Matrix ──
          if (matrixContent) {
            report.push("---");
            report.push("");
            report.push("## Complete Scoring Matrix");
            report.push("");
            report.push(matrixContent);
            report.push("");
            sections.push("Complete Scoring Matrix");
          }

          // ── SECTION 6: Decision (full) ──
          if (decisionContent) {
            report.push("---");
            report.push("");
            report.push("## Decision");
            report.push("");
            const decisionText = extractSection(decisionContent, "Decision");
            const rationaleText = extractSection(decisionContent, "Rationale");
            if (decisionText) {
              report.push(decisionText);
              report.push("");
            }
            if (rationaleText) {
              report.push("### Rationale");
              report.push("");
              report.push(rationaleText);
              report.push("");
            }
            sections.push("Decision");
          }

          // ── SECTION 7: Playbook / How to Apply ──
          if (matrixContent.includes("Playbook") || matrixContent.includes("playbook")) {
            const playbookText = extractSection(matrixContent, "The Situational Playbook")
              || extractSection(matrixContent, "Interpretation");
            if (playbookText) {
              report.push("---");
              report.push("");
              report.push("## How to Apply");
              report.push("");
              report.push(playbookText);
              report.push("");
              sections.push("How to Apply");
            }
          }

          // ── SECTION 8: Design Rules ──
          const rulesText = extractSection(matrixContent, "Design Rules (from behavioral science research)")
            || extractSection(matrixContent, "Design Rules");
          if (rulesText) {
            report.push("---");
            report.push("");
            report.push("## Design Rules");
            report.push("");
            report.push(rulesText);
            report.push("");
            sections.push("Design Rules");
          }

          // ── SECTION 9: Methodology ──
          report.push("---");
          report.push("");
          report.push("## Methodology");
          report.push("");
          report.push(`- **Project:** ${projectConfig.projectName}`);
          report.push(`- **Phase:** ${projectConfig.phase}`);
          report.push(`- **Created:** ${projectConfig.created}`);
          report.push(`- **Findings:** ${findings.length} (${highFindings.length} HIGH, ${modFindings.length} MODERATE, ${lowFindings.length} LOW, ${unverifiedFindings.length} UNVERIFIED)`);
          report.push(`- **Candidates:** ${candidates.length} evaluated`);
          report.push(`- **Criteria:** ${criteria ? "Locked" : "Not defined"}`);
          report.push(`- **Peer review:** ${hasPeerReview ? "Logged" : "Not logged"}`);
          report.push("");

          // Timeline
          if (projectConfig.transitions.length > 0) {
            report.push("### Timeline");
            report.push("");
            for (const t of projectConfig.transitions) {
              report.push(`- ${t.date}: ${t.phase}${t.note ? ` — ${t.note}` : ""}`);
            }
            report.push("");
          }

          // Context
          if (projectConfig.context) {
            report.push("### Research Context");
            report.push("");
            report.push(projectConfig.context);
            report.push("");
          }

          report.push("---");
          report.push("");
          report.push("*Generated by [research.md](https://github.com/eidos-agi/research.md) — structured research workflow for AI-augmented decision making.*");
          sections.push("Methodology");

          // Write REPORT.md
          const reportPath = path.join(root, "REPORT.md");
          fs.writeFileSync(reportPath, report.join("\n") + "\n");

          // Auto-generate PDF alongside REPORT.md
          let pdfStatus = "";
          try {
            const renderScript = path.join(__dirname, "..", "src", "render-brief.py");
            if (fs.existsSync(renderScript)) {
              const { execFileSync } = require("child_process");
              const pdfPath = path.join(root, "REPORT.pdf");
              execFileSync("python3", [renderScript, reportPath, "--brand", "research", "-o", pdfPath], {
                stdio: ["pipe", "pipe", "pipe"],
                encoding: "utf-8",
                timeout: 15000,
              });
              pdfStatus = `\nPDF: REPORT.pdf generated alongside REPORT.md`;
            }
          } catch (pdfErr: any) {
            pdfStatus = `\nPDF: Could not generate (${pdfErr.message || "python3/reportlab not available"}). Run manually: research-md brief ${reportPath}`;
          }

          return { content: [{ type: "text", text: `Full research report generated: REPORT.md (${report.length} lines)\n\nSections: ${sections.join(" → ")}\n\nIncludes ALL ${findings.length} findings and ALL ${candidates.length} candidates (untruncated).${pdfStatus}` }] };
        }

        default:
          throw new ResearchValidationError(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return formatError(err);
    }
  });

  // ── Resources ──────────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const registered = listRegistered();
    if (registered.length === 0) {
      return { resources: [INIT_REQUIRED_RESOURCE] };
    }
    return { resources: [...RESOURCE_DEFINITIONS] };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "research://init-required") {
      return { contents: [{ uri, mimeType: "text/markdown", text: INIT_REQUIRED_GUIDE }] };
    }
    if (uri === "research://workflow/overview") {
      return { contents: [{ uri, mimeType: "text/markdown", text: WORKFLOW_OVERVIEW }] };
    }

    // Data resources use the first registered project (resources don't take params)
    const registered = listRegistered();
    if (registered.length === 0) {
      return { contents: [{ uri, mimeType: "text/markdown", text: "No projects registered. Use `project_set` first." }] };
    }

    const resolved = resolveByGuid(registered[0].id);
    if (!resolved) {
      return { contents: [{ uri, mimeType: "text/markdown", text: "Active project could not be resolved." }] };
    }
    const root = resolved.projectRoot;

    switch (uri) {
      case "research://findings/all": {
        const findings = listFindings(root);
        const text = findings.length === 0 ? "_No findings yet._" : findings.map((f) => `# ${f.frontmatter.id}: ${f.frontmatter.title}\n**Status:** ${f.frontmatter.status} | **Evidence:** ${f.frontmatter.evidence}\n${f.content}`).join("\n\n---\n\n");
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      }
      case "research://candidates/all": {
        const candidates = listCandidates(root);
        const text = candidates.length === 0 ? "_No candidates yet._" : candidates.map((c) => `# ${c.frontmatter.title}\n**Verdict:** ${c.frontmatter.verdict}\n${c.content}`).join("\n\n---\n\n");
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      }
      case "research://scoring-matrix": {
        const mp = scoringMatrixPath(root);
        const text = fs.existsSync(mp) ? fs.readFileSync(mp, "utf-8") : "_Not yet generated._";
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      }
      case "research://status": {
        const findings = listFindings(root);
        const candidates = listCandidates(root);
        const criteria = loadDecisionCriteria(root);
        const tbdCount = candidates.reduce((acc, c) => acc + (c.content.match(/_TBD_/g)?.length || 0), 0);
        const text = ["# Research Project Status", "", `- Criteria locked: ${criteria?.frontmatter.locked ? "Yes" : "No"}`, `- Peer review: ${peerReviewExists(root) ? "Yes" : "No"}`, `- TBD items: ${tbdCount}`, `- Findings: ${findings.length}`, `- Candidates: ${candidates.length}`].join("\n");
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      }
      default:
        throw new ResearchNotFoundError("Resource", uri);
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
