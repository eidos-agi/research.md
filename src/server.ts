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

import { findProjectRoot, initProject } from "./config";
import { sanitizeSlug } from "./security";
import {
  listFindings,
  nextFindingId,
  findingPath,
  readMarkdown,
  writeMarkdown,
  listCandidates,
  candidatePath,
  listAdrs,
  nextAdrId,
  adrPath,
  loadDecisionCriteria,
  decisionCriteriaPath,
  peerReviewPath,
  peerReviewExists,
  scoringMatrixPath,
  FindingFrontmatter,
  CandidateFrontmatter,
  AdrFrontmatter,
  DecisionCriteriaFrontmatter,
} from "./files";
import {
  runScoringGates,
  gateAdrReadyForAcceptance,
} from "./gates";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function getRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new Error(
      "No research-md.json found. Run `research-md init` in your research project directory first."
    );
  }
  return root;
}

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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "init",
        description: "Initialize a new research project with folder structure and config.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory to initialize (defaults to cwd)" },
            name: { type: "string", description: "Project name" },
          },
        },
      },
      {
        name: "status",
        description: "Show project health: locked criteria, peer review, TBD count, ADR statuses.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "create_finding",
        description: "Create a new finding with evidence grade and source.",
        inputSchema: {
          type: "object",
          required: ["title", "claim"],
          properties: {
            title: { type: "string" },
            claim: { type: "string" },
            evidence: { type: "string", enum: ["HIGH", "MODERATE", "LOW", "UNVERIFIED"] },
            source: { type: "string" },
          },
        },
      },
      {
        name: "list_findings",
        description: "List all findings with status and evidence grade.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "update_finding",
        description: "Update a finding's status, evidence grade, or claim.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["open", "confirmed", "refuted", "superseded"] },
            evidence: { type: "string", enum: ["HIGH", "MODERATE", "LOW", "UNVERIFIED"] },
            claim: { type: "string" },
          },
        },
      },
      {
        name: "create_candidate",
        description: "Create a new candidate for evaluation.",
        inputSchema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            slug: { type: "string" },
            description: { type: "string" },
          },
        },
      },
      {
        name: "list_candidates",
        description: "List all candidates with verdict status.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "add_validation_claim",
        description: "Add a binary testable claim to a candidate's validation checklist.",
        inputSchema: {
          type: "object",
          required: ["slug", "claim"],
          properties: {
            slug: { type: "string" },
            claim: { type: "string" },
          },
        },
      },
      {
        name: "resolve_validation_claim",
        description: "Mark a validation claim Y or N (clears _TBD_).",
        inputSchema: {
          type: "object",
          required: ["slug", "claim_index", "result"],
          properties: {
            slug: { type: "string" },
            claim_index: { type: "number" },
            result: { type: "string", enum: ["Y", "N"] },
          },
        },
      },
      {
        name: "lock_criteria",
        description: "Lock decision criteria, preventing further weight changes.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "score_candidate",
        description: "Score a candidate. Fails if criteria not locked, peer review missing, or _TBD_ items remain.",
        inputSchema: {
          type: "object",
          required: ["slug", "scores"],
          properties: {
            slug: { type: "string" },
            scores: { type: "object", additionalProperties: { type: "number" } },
            notes: { type: "string" },
          },
        },
      },
      {
        name: "generate_scoring_matrix",
        description: "Generate evaluations/scoring-matrix.md from locked criteria and candidates.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "create_adr",
        description: "Create a new ADR with status 'proposed'.",
        inputSchema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            context: { type: "string" },
          },
        },
      },
      {
        name: "update_adr_status",
        description: "Transition ADR status. Fails promoting to 'accepted' if Alternatives or Risks sections empty.",
        inputSchema: {
          type: "object",
          required: ["id", "status"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["proposed", "accepted", "superseded"] },
          },
        },
      },
      {
        name: "log_peer_review",
        description: "Log a peer review. Required before scoring.",
        inputSchema: {
          type: "object",
          required: ["reviewer", "findings"],
          properties: {
            reviewer: { type: "string" },
            findings: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "init": {
          const targetPath = (args?.path as string) || process.env.PWD || process.cwd();
          initProject(targetPath, args?.name as string | undefined);
          return {
            content: [{ type: "text", text: `Research project initialized at ${targetPath}\n\nFolders: findings/ candidates/ decisions/ evaluations/\nConfig: research-md.json` }],
          };
        }

        case "status": {
          const root = getRoot();
          const findings = listFindings(root);
          const candidates = listCandidates(root);
          const adrs = listAdrs(root);
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
            "",
            `**ADRs (${adrs.length}):**`,
            ...adrs.map((a) => `  ADR-${a.frontmatter.id} [${a.frontmatter.status}] ${a.frontmatter.title}`),
          ];

          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "create_finding": {
          const root = getRoot();
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

        case "list_findings": {
          const root = getRoot();
          const findings = listFindings(root);
          if (findings.length === 0) return { content: [{ type: "text", text: "No findings yet." }] };
          const rows = findings.map((f) => `${f.frontmatter.id} | ${f.frontmatter.status.padEnd(10)} | ${f.frontmatter.evidence.padEnd(10)} | ${f.frontmatter.title}`);
          return { content: [{ type: "text", text: ["ID   | Status     | Evidence   | Title", "---- | ---------- | ---------- | -----", ...rows].join("\n") }] };
        }

        case "update_finding": {
          const root = getRoot();
          const id = (args?.id as string).padStart(4, "0");
          const findings = listFindings(root);
          const finding = findings.find((f) => f.frontmatter.id === id);
          if (!finding) throw new Error(`Finding ${id} not found.`);

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

        case "create_candidate": {
          const root = getRoot();
          const title = args?.title as string;
          const slug = sanitizeSlug((args?.slug as string) || title);
          const description = (args?.description as string) || "_No description provided._";
          const fp = candidatePath(root, slug);

          if (fs.existsSync(fp)) throw new Error(`Candidate '${slug}' already exists.`);

          const frontmatter: CandidateFrontmatter = { title, verdict: "provisional" };
          const content = `\n## What It Is\n\n${description}\n\n## Validation Checklist\n\n- [ ] Claim 1: _TBD_\n\n## Scoring\n\n_Not yet scored._\n`;

          writeMarkdown(fp, frontmatter, content);
          return { content: [{ type: "text", text: `Candidate created: candidates/${slug}.md` }] };
        }

        case "list_candidates": {
          const root = getRoot();
          const candidates = listCandidates(root);
          if (candidates.length === 0) return { content: [{ type: "text", text: "No candidates yet." }] };
          const rows = candidates.map((c) => `${c.frontmatter.verdict.padEnd(12)} | ${c.frontmatter.title}`);
          return { content: [{ type: "text", text: ["Verdict       | Title", "------------- | -----", ...rows].join("\n") }] };
        }

        case "add_validation_claim": {
          const root = getRoot();
          const slug = args?.slug as string;
          const claim = args?.claim as string;
          const fp = candidatePath(root, slug);
          if (!fs.existsSync(fp)) throw new Error(`Candidate '${slug}' not found.`);

          const parsed = readMarkdown<CandidateFrontmatter>(fp);
          const newContent = parsed.content.replace(
            /(## Validation Checklist\n)([\s\S]*?)(## Scoring)/,
            (_, heading, existing, next) => `${heading}${existing.trimEnd()}\n- [ ] ${claim}: _TBD_\n\n${next}`
          );

          writeMarkdown(fp, parsed.frontmatter, newContent);
          return { content: [{ type: "text", text: `Claim added to '${slug}'.` }] };
        }

        case "resolve_validation_claim": {
          const root = getRoot();
          const slug = args?.slug as string;
          const claimIndex = args?.claim_index as number;
          const result = args?.result as "Y" | "N";
          const fp = candidatePath(root, slug);
          if (!fs.existsSync(fp)) throw new Error(`Candidate '${slug}' not found.`);

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

          if (newContent === original) throw new Error(`Claim ${claimIndex} not found or already resolved in '${slug}'.`);

          writeMarkdown(fp, parsed.frontmatter, newContent);
          return { content: [{ type: "text", text: `Claim ${claimIndex} in '${slug}' marked ${result}.` }] };
        }

        case "lock_criteria": {
          const root = getRoot();
          const criteriaFile = decisionCriteriaPath(root);
          if (!fs.existsSync(criteriaFile)) throw new Error("No decision-criteria.md found in evaluations/.");

          const parsed = readMarkdown<DecisionCriteriaFrontmatter>(criteriaFile);
          if (parsed.frontmatter.locked) {
            return { content: [{ type: "text", text: `Criteria already locked on ${parsed.frontmatter.locked_date}.` }] };
          }

          writeMarkdown(criteriaFile, { locked: true, locked_date: today() }, parsed.content);
          return { content: [{ type: "text", text: `Decision criteria locked on ${today()}. Weights are now frozen.` }] };
        }

        case "score_candidate": {
          const root = getRoot();
          const slug = args?.slug as string;
          const scores = args?.scores as Record<string, number>;
          const notes = (args?.notes as string) || "";

          const gateResult = runScoringGates(root, slug);
          if (!gateResult.passed) {
            return { content: [{ type: "text", text: `GATE FAILED: ${gateResult.error}` }], isError: true };
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

        case "generate_scoring_matrix": {
          const root = getRoot();
          const criteria = loadDecisionCriteria(root);
          if (!criteria?.frontmatter.locked) throw new Error("Criteria must be locked before generating scoring matrix.");

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

        case "create_adr": {
          const root = getRoot();
          const title = args?.title as string;
          const context = (args?.context as string) || "_No context provided._";
          const id = nextAdrId(root);
          const slug = sanitizeSlug(title);
          const fp = adrPath(root, id, slug);

          writeMarkdown(fp, { id, title, status: "proposed" as const, date: today() }, `\n## Context\n\n${context}\n\n## Decision\n\n_To be determined._\n\n## Alternatives Considered\n\n_None documented yet._\n\n## Negative / Trade-offs\n\n_None documented yet._\n\n## Risks\n\n_None documented yet._\n\n## Consequences\n\n_None documented yet._\n`);

          return { content: [{ type: "text", text: `ADR created: decisions/${id}-${slug}.md\nStatus: proposed` }] };
        }

        case "update_adr_status": {
          const root = getRoot();
          const id = (args?.id as string).padStart(4, "0");
          const newStatus = args?.status as AdrFrontmatter["status"];
          const adrs = listAdrs(root);
          const adr = adrs.find((a) => a.frontmatter.id === id);
          if (!adr) throw new Error(`ADR ${id} not found.`);

          if (newStatus === "accepted") {
            const gateResult = gateAdrReadyForAcceptance(adr);
            if (!gateResult.passed) {
              return { content: [{ type: "text", text: `GATE FAILED: ${gateResult.error}` }], isError: true };
            }
          }

          writeMarkdown(adr.filePath, { ...adr.frontmatter, status: newStatus }, adr.content);
          return { content: [{ type: "text", text: `ADR ${id} status updated to '${newStatus}'.` }] };
        }

        case "log_peer_review": {
          const root = getRoot();
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
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  // Resources

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: "research://findings/all", name: "All Findings", mimeType: "text/markdown" },
      { uri: "research://candidates/all", name: "All Candidates", mimeType: "text/markdown" },
      { uri: "research://decisions/all", name: "All ADRs", mimeType: "text/markdown" },
      { uri: "research://scoring-matrix", name: "Scoring Matrix", mimeType: "text/markdown" },
      { uri: "research://status", name: "Project Status", mimeType: "text/markdown" },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const root = getRoot();

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
      case "research://decisions/all": {
        const adrs = listAdrs(root);
        const text = adrs.length === 0 ? "_No ADRs yet._" : adrs.map((a) => `# ADR-${a.frontmatter.id}: ${a.frontmatter.title}\n**Status:** ${a.frontmatter.status}\n${a.content}`).join("\n\n---\n\n");
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      }
      case "research://scoring-matrix": {
        const mp = scoringMatrixPath(root);
        const text = fs.existsSync(mp) ? fs.readFileSync(mp, "utf-8") : "_Not yet generated. Run `generate_scoring_matrix` after locking criteria._";
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      }
      case "research://status": {
        const findings = listFindings(root);
        const candidates = listCandidates(root);
        const adrs = listAdrs(root);
        const criteria = loadDecisionCriteria(root);
        const tbdCount = candidates.reduce((acc, c) => acc + (c.content.match(/_TBD_/g)?.length || 0), 0);
        const text = ["# Research Project Status", "", `- Criteria locked: ${criteria?.frontmatter.locked ? "Yes" : "No"}`, `- Peer review: ${peerReviewExists(root) ? "Yes" : "No"}`, `- TBD items: ${tbdCount}`, `- Findings: ${findings.length}`, `- Candidates: ${candidates.length}`, `- ADRs: ${adrs.length}`].join("\n");
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      }
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
