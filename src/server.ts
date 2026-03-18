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
  ResolvedProject,
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
} from "./files";
import { runScoringGates } from "./gates";
import {
  INIT_REQUIRED_GUIDE,
  WORKFLOW_OVERVIEW,
  RESOURCE_DEFINITIONS,
  INIT_REQUIRED_RESOURCE,
} from "./resources";

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
  research_id: { type: "string", description: "Project GUID from research-md.json 'id' field. Required." },
} as const;

export function createServer(): Server {
  const server = new Server(
    { name: "research-md", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "project_set",
        description: "Register a research project for this session. Call this first — reads the research-md.json at the given path and registers its GUID. Also registers all subprojects if it's a root.",
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
        name: "init",
        description: "Initialize a new research project with folder structure and GUID.",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string", description: "Directory to initialize" },
            name: { type: "string", description: "Project name" },
            root: { type: "boolean", description: "Create a multi-project root" },
            subproject: { type: "string", description: "Create a subproject under this root" },
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
        description: "Log a peer review. Required before scoring.",
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

        case "init": {
          const targetPath = args?.path as string;
          if (!targetPath) throw new ResearchValidationError("'path' is required.");

          if (args?.root) {
            initRoot(targetPath);
            const config = loadConfig(targetPath);
            return { content: [{ type: "text", text: `Multi-project root initialized at ${targetPath}\nID: ${config?.id}\n\nUse init with 'subproject' to add research projects.` }] };
          }

          if (args?.subproject) {
            const subName = args.subproject as string;
            initSubproject(targetPath, subName);
            const subConfig = loadConfig(path.join(targetPath, subName));
            return { content: [{ type: "text", text: `Subproject '${subName}' initialized at ${targetPath}/${subName}\nID: ${subConfig?.id}\n\nFolders: findings/ candidates/ evaluations/` }] };
          }

          initProject(targetPath, args?.name as string | undefined);
          const config = loadConfig(targetPath);
          return { content: [{ type: "text", text: `Research project initialized at ${targetPath}\nID: ${config?.id}\n\nFolders: findings/ candidates/ evaluations/` }] };
        }

        case "status": {
          const { projectRoot: root } = getProject(args?.research_id);
          const findings = listFindings(root);
          const candidates = listCandidates(root);
          const criteria = loadDecisionCriteria(root);
          const hasPeerReview = peerReviewExists(root);
          const tbdCount = candidates.reduce((acc, c) => acc + (c.content.match(/_TBD_/g)?.length || 0), 0);

          const lines = [
            "## Research Project Status",
            "",
            `**Criteria locked:** ${criteria?.frontmatter.locked ? `Yes (${criteria.frontmatter.locked_date})` : "No"}`,
            `**Peer review logged:** ${hasPeerReview ? "Yes" : "No"}`,
            `**TBD items remaining:** ${tbdCount}`,
            "",
            `**Findings (${findings.length}):**`,
            ...findings.map((f) => `  ${f.frontmatter.id} [${f.frontmatter.status}] [${f.frontmatter.evidence}] ${f.frontmatter.title}`),
            "",
            `**Candidates (${candidates.length}):**`,
            ...candidates.map((c) => `  ${c.frontmatter.title} — ${c.frontmatter.verdict}`),
          ];

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
          return { content: [{ type: "text", text: `Decision criteria locked on ${today()}. Weights are now frozen.` }] };
        }

        case "candidate_score": {
          const { projectRoot: root } = getProject(args?.research_id);
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

          return { content: [{ type: "text", text: `Peer review logged by ${reviewer} on ${today()}. Scoring is now unblocked.` }] };
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
