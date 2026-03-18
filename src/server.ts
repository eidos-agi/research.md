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
  resolveProject,
  findConfigDir,
  loadConfig,
  listProjects,
  initProject,
  initSubproject,
  initRoot,
  ResolvedProject,
} from "./config";
import { sanitizeSlug } from "./security";
import {
  ResearchNotInitializedError,
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
 * Resolve which project to operate on. If the root is multi-project,
 * requires either a project parameter or cwd inference.
 */
function getProject(projectName?: string): ResolvedProject {
  const resolved = resolveProject(projectName);
  if (!resolved) {
    // Check if we found a root but couldn't pick a project
    const configDir = findConfigDir();
    if (configDir) {
      const projects = listProjects(configDir);
      if (projects.length > 0) {
        throw new ResearchValidationError(
          `Multiple projects available: ${projects.join(", ")}. Specify one with the 'project' parameter.`
        );
      }
    }
    throw new ResearchNotInitializedError();
  }
  return resolved;
}

function isInitialized(): boolean {
  return findConfigDir() !== null;
}

// Optional project parameter added to every data tool
const PROJECT_PARAM = {
  project: { type: "string", description: "Subproject name (required if multi-project root)" },
} as const;

export function createServer(): Server {
  const server = new Server(
    { name: "research-md", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // ── Tool definitions ───────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "init",
        description: "Initialize a research project. Use 'root: true' for multi-project container, or 'subproject' to add under an existing root.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory to initialize (defaults to cwd)" },
            name: { type: "string", description: "Project name" },
            root: { type: "boolean", description: "If true, create a multi-project root instead of a single project" },
            subproject: { type: "string", description: "Create a subproject under the current root with this name" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "status",
        description: "Show project health. At a root, shows all subprojects. In a subproject, shows that project's detail.",
        inputSchema: {
          type: "object",
          properties: { ...PROJECT_PARAM },
          additionalProperties: false,
        },
      },
      {
        name: "finding_create",
        description: "Create a new finding with evidence grade and source.",
        inputSchema: {
          type: "object",
          required: ["title", "claim"],
          properties: {
            title: { type: "string", minLength: 1 },
            claim: { type: "string", minLength: 1 },
            evidence: { type: "string", enum: ["HIGH", "MODERATE", "LOW", "UNVERIFIED"] },
            source: { type: "string" },
            ...PROJECT_PARAM,
          },
          additionalProperties: false,
        },
      },
      {
        name: "finding_list",
        description: "List all findings with status and evidence grade.",
        inputSchema: {
          type: "object",
          properties: { ...PROJECT_PARAM },
          additionalProperties: false,
        },
      },
      {
        name: "finding_update",
        description: "Update a finding's status, evidence grade, or claim.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["open", "confirmed", "refuted", "superseded"] },
            evidence: { type: "string", enum: ["HIGH", "MODERATE", "LOW", "UNVERIFIED"] },
            claim: { type: "string" },
            ...PROJECT_PARAM,
          },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_create",
        description: "Create a new candidate for evaluation.",
        inputSchema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1 },
            slug: { type: "string" },
            description: { type: "string" },
            ...PROJECT_PARAM,
          },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_list",
        description: "List all candidates with verdict status.",
        inputSchema: {
          type: "object",
          properties: { ...PROJECT_PARAM },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_add_claim",
        description: "Add a binary testable claim to a candidate's validation checklist.",
        inputSchema: {
          type: "object",
          required: ["slug", "claim"],
          properties: {
            slug: { type: "string", minLength: 1 },
            claim: { type: "string", minLength: 1 },
            ...PROJECT_PARAM,
          },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_resolve_claim",
        description: "Mark a validation claim Y or N (clears _TBD_).",
        inputSchema: {
          type: "object",
          required: ["slug", "claim_index", "result"],
          properties: {
            slug: { type: "string", minLength: 1 },
            claim_index: { type: "number", minimum: 1 },
            result: { type: "string", enum: ["Y", "N"] },
            ...PROJECT_PARAM,
          },
          additionalProperties: false,
        },
      },
      {
        name: "criteria_lock",
        description: "Lock decision criteria, preventing further weight changes.",
        inputSchema: {
          type: "object",
          properties: { ...PROJECT_PARAM },
          additionalProperties: false,
        },
      },
      {
        name: "candidate_score",
        description: "Score a candidate. Fails if criteria not locked, peer review missing, or _TBD_ items remain.",
        inputSchema: {
          type: "object",
          required: ["slug", "scores"],
          properties: {
            slug: { type: "string", minLength: 1 },
            scores: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 10 } },
            notes: { type: "string" },
            ...PROJECT_PARAM,
          },
          additionalProperties: false,
        },
      },
      {
        name: "scoring_matrix_generate",
        description: "Generate evaluations/scoring-matrix.md from locked criteria and candidates.",
        inputSchema: {
          type: "object",
          properties: { ...PROJECT_PARAM },
          additionalProperties: false,
        },
      },
      {
        name: "peer_review_log",
        description: "Log a peer review. Required before scoring.",
        inputSchema: {
          type: "object",
          required: ["reviewer", "findings"],
          properties: {
            reviewer: { type: "string", minLength: 1 },
            findings: { type: "array", items: { type: "string" }, minItems: 1 },
            notes: { type: "string" },
            ...PROJECT_PARAM,
          },
          additionalProperties: false,
        },
      },
    ],
  }));

  // ── Tool handlers ──────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const projectArg = args?.project as string | undefined;

    try {
      switch (name) {
        case "init": {
          const targetPath = (args?.path as string) || process.env.RESEARCH_MD_CWD || process.env.PWD || process.cwd();

          // Init a multi-project root
          if (args?.root) {
            initRoot(targetPath);
            return {
              content: [{ type: "text", text: `Multi-project research root initialized at ${targetPath}\n\nUse init with 'subproject' parameter to add research projects.` }],
            };
          }

          // Init a subproject under an existing root
          if (args?.subproject) {
            const subName = args.subproject as string;
            initSubproject(targetPath, subName);
            return {
              content: [{ type: "text", text: `Subproject '${subName}' initialized at ${targetPath}/${subName}\n\nFolders: findings/ candidates/ evaluations/` }],
            };
          }

          // Init a standalone project
          initProject(targetPath, args?.name as string | undefined);
          return {
            content: [{ type: "text", text: `Research project initialized at ${targetPath}\n\nFolders: findings/ candidates/ evaluations/\nConfig: research-md.json` }],
          };
        }

        case "status": {
          // If at a root with no project specified, show aggregate
          const configDir = findConfigDir();
          if (configDir && !projectArg) {
            const config = loadConfig(configDir);
            if (config && "projects" in config && Array.isArray((config as any).projects)) {
              const projects = (config as any).projects as string[];
              const lines = ["## Research Root Status", "", `**Projects (${projects.length}):**`];

              for (const proj of projects) {
                const resolved = resolveProject(proj);
                if (!resolved) {
                  lines.push(`\n### ${proj} — not initialized`);
                  continue;
                }
                const root = resolved.projectRoot;
                const findings = listFindings(root);
                const candidates = listCandidates(root);
                const criteria = loadDecisionCriteria(root);
                const hasPeerReview = peerReviewExists(root);
                const tbdCount = candidates.reduce((acc, c) => acc + (c.content.match(/_TBD_/g)?.length || 0), 0);

                lines.push(
                  `\n### ${proj}`,
                  `  Criteria locked: ${criteria?.frontmatter.locked ? "Yes" : "No"} | Peer review: ${hasPeerReview ? "Yes" : "No"} | TBD: ${tbdCount}`,
                  `  Findings: ${findings.length} | Candidates: ${candidates.length}`
                );
              }

              return { content: [{ type: "text", text: lines.join("\n") }] };
            }
          }

          // Single project status
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
          const findings = listFindings(root);
          if (findings.length === 0) return { content: [{ type: "text", text: "No findings yet." }] };
          const rows = findings.map((f) => `${f.frontmatter.id} | ${f.frontmatter.status.padEnd(10)} | ${f.frontmatter.evidence.padEnd(10)} | ${f.frontmatter.title}`);
          return { content: [{ type: "text", text: ["ID   | Status     | Evidence   | Title", "---- | ---------- | ---------- | -----", ...rows].join("\n") }] };
        }

        case "finding_update": {
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
          const candidates = listCandidates(root);
          if (candidates.length === 0) return { content: [{ type: "text", text: "No candidates yet." }] };
          const rows = candidates.map((c) => `${c.frontmatter.verdict.padEnd(12)} | ${c.frontmatter.title}`);
          return { content: [{ type: "text", text: ["Verdict       | Title", "------------- | -----", ...rows].join("\n") }] };
        }

        case "candidate_add_claim": {
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
          const slug = args?.slug as string;
          const scores = args?.scores as Record<string, number>;
          const notes = (args?.notes as string) || "";

          const gateResult = runScoringGates(root, slug);
          if (!gateResult.passed) {
            throw new ResearchGateError(gateResult.error!);
          }

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
          const { projectRoot: root } = getProject(projectArg);
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
          const { projectRoot: root } = getProject(projectArg);
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
    if (!isInitialized()) {
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

    // Data resources — try to resolve a project, fall back gracefully
    const resolved = resolveProject();
    if (!resolved) throw new ResearchNotInitializedError();
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
        const text = fs.existsSync(mp) ? fs.readFileSync(mp, "utf-8") : "_Not yet generated. Run `scoring_matrix_generate` after locking criteria._";
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
