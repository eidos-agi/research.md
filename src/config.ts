import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ── Config types ─────────────────────────────────────────────────────────────

/**
 * Research project lifecycle phases.
 * Each phase is a gate — tools enforce that you can't skip ahead.
 *
 * research    → Gathering findings, creating candidates. Starting state.
 * criteria    → Decision criteria defined. Weights can still change.
 * locked      → Criteria weights frozen. No more weight changes.
 * reviewed    → Peer review logged. Scoring is unblocked.
 * scored      → All candidates scored. Matrix can be generated.
 * decided     → Decision made. Project is complete.
 * superseded  → Decision was overridden by a later project or ADR.
 */
export type ProjectPhase =
  | "research"
  | "criteria"
  | "locked"
  | "reviewed"
  | "scored"
  | "decided"
  | "superseded";

export const PHASE_ORDER: ProjectPhase[] = [
  "research",
  "criteria",
  "locked",
  "reviewed",
  "scored",
  "decided",
  "superseded",
];

export interface PhaseTransition {
  phase: ProjectPhase;
  date: string;
  note?: string;
}

export interface ProjectConfig {
  id: string;
  version: string;
  projectName: string;
  created: string;
  phase: ProjectPhase;
  transitions: PhaseTransition[];
}

export interface RootConfig {
  id: string;
  version: string;
  projects: string[];
  created: string;
}

export type ResearchConfig = ProjectConfig | RootConfig;

const CONFIG_FILENAME = "research-md.json";

function isRootConfig(config: ResearchConfig): config is RootConfig {
  return "projects" in config && Array.isArray((config as RootConfig).projects);
}

function isProjectConfig(config: ResearchConfig): config is ProjectConfig {
  return "projectName" in config;
}

// ── In-memory GUID → path registry ───────────────────────────────────────────
// Each MCP server process maintains its own map. No disk state. No singletons.
// The AI registers a project via project_set, then uses the GUID on every call.

const guidToPath: Map<string, string> = new Map();

/**
 * Register a project path by its GUID. Called by project_set.
 */
export function registerProject(projectPath: string): { id: string; projectName: string; isRoot: boolean; projects: string[] } {
  const absPath = path.resolve(projectPath);
  const config = loadConfig(absPath);
  if (!config) {
    throw new Error(`No research-md.json at ${absPath}. Run 'research-md init' there first.`);
  }
  if (!config.id) {
    throw new Error(`research-md.json at ${absPath} has no 'id' field. Re-run 'research-md init' to generate one.`);
  }

  guidToPath.set(config.id, absPath);

  // Also register subprojects if this is a root
  if (isRootConfig(config)) {
    for (const sub of config.projects) {
      const subDir = path.join(absPath, sub);
      const subConfig = loadConfig(subDir);
      if (subConfig?.id) {
        guidToPath.set(subConfig.id, subDir);
      }
    }
    return { id: config.id, projectName: "(root)", isRoot: true, projects: config.projects };
  }

  return { id: config.id, projectName: (config as ProjectConfig).projectName, isRoot: false, projects: [] };
}

/**
 * Look up a path by GUID. Returns null if not registered.
 */
export function lookupGuid(guid: string): string | null {
  return guidToPath.get(guid) || null;
}

/**
 * List all registered GUIDs and their paths.
 */
export function listRegistered(): Array<{ id: string; path: string }> {
  return Array.from(guidToPath.entries()).map(([id, p]) => ({ id, path: p }));
}

// ── Config loading ───────────────────────────────────────────────────────────

export function loadConfig(dir: string): ResearchConfig | null {
  const configPath = path.join(dir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as ResearchConfig;
  } catch {
    return null;
  }
}

export function listProjects(rootDir: string): string[] {
  const config = loadConfig(rootDir);
  if (!config || !isRootConfig(config)) return [];
  return config.projects;
}

// ── Resolution (explicit path, no detection) ─────────────────────────────────

export interface ResolvedProject {
  projectRoot: string;
  config: ProjectConfig;
  rootPath: string | null;
}

/**
 * Resolve a project from its GUID.
 * The GUID must have been registered via registerProject first.
 */
export function resolveByGuid(guid: string): ResolvedProject | null {
  const projectPath = lookupGuid(guid);
  if (!projectPath || !fs.existsSync(projectPath)) return null;

  const config = loadConfig(projectPath);
  if (!config) return null;

  // Direct hit on a standalone project or subproject
  if (isProjectConfig(config) && config.id === guid) {
    // Check if this is under a root
    const parentDir = path.dirname(projectPath);
    const parentConfig = loadConfig(parentDir);
    const rootPath = parentConfig && isRootConfig(parentConfig) ? parentDir : null;
    return { projectRoot: projectPath, config, rootPath };
  }

  // Direct hit on a root — can't operate on root directly, need a subproject
  if (isRootConfig(config) && config.id === guid) {
    return null; // Caller should use a subproject GUID instead
  }

  return null;
}

// ── Saving ───────────────────────────────────────────────────────────────────

export function saveConfig(dir: string, config: ResearchConfig): void {
  const configPath = path.join(dir, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

// ── Phase transitions ────────────────────────────────────────────────────────

/**
 * Check if a phase transition is valid.
 * Phases must advance forward (or to superseded from any state).
 */
export function canTransition(current: ProjectPhase, target: ProjectPhase): boolean {
  if (target === "superseded") return true; // Can supersede from any phase
  const currentIdx = PHASE_ORDER.indexOf(current);
  const targetIdx = PHASE_ORDER.indexOf(target);
  return targetIdx > currentIdx && targetIdx < PHASE_ORDER.indexOf("superseded");
}

/**
 * Advance a project's phase. Writes to config file.
 * Returns the updated config, or throws if the transition is invalid.
 */
export function advancePhase(
  projectPath: string,
  target: ProjectPhase,
  note?: string
): ProjectConfig {
  const config = loadConfig(projectPath);
  if (!config || !isProjectConfig(config)) {
    throw new Error(`No project config at ${projectPath}`);
  }

  if (config.phase === target) {
    return config; // Already at this phase, no-op
  }

  if (!canTransition(config.phase, target)) {
    const currentIdx = PHASE_ORDER.indexOf(config.phase);
    const nextPhase = PHASE_ORDER[currentIdx + 1];
    throw new Error(
      `Cannot transition from '${config.phase}' to '${target}'. ` +
      `Next valid phase is '${nextPhase}'.`
    );
  }

  const now = new Date().toISOString().split("T")[0];
  config.phase = target;
  config.transitions.push({ phase: target, date: now, ...(note ? { note } : {}) });
  saveConfig(projectPath, config);
  return config;
}

/**
 * Assert a project is at or past a given phase. Throws if not.
 */
export function requirePhase(config: ProjectConfig, minPhase: ProjectPhase, action: string): void {
  const currentIdx = PHASE_ORDER.indexOf(config.phase);
  const requiredIdx = PHASE_ORDER.indexOf(minPhase);
  if (currentIdx < requiredIdx) {
    throw new Error(
      `Cannot ${action} — project is in '${config.phase}' phase. ` +
      `Requires '${minPhase}' or later.`
    );
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initProject(targetDir: string, projectName?: string): void {
  const dirs = ["findings", "candidates", "evaluations"];

  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  const now = new Date().toISOString().split("T")[0];
  const config: ProjectConfig = {
    id: crypto.randomUUID(),
    version: "0.1.0",
    projectName: projectName || path.basename(targetDir),
    created: now,
    phase: "research",
    transitions: [{ phase: "research", date: now }],
  };

  saveConfig(targetDir, config);
}

export function initSubproject(rootDir: string, projectName: string): void {
  const subDir = path.join(rootDir, projectName);
  initProject(subDir, projectName);

  const rootConfig = loadConfig(rootDir);
  if (rootConfig && isRootConfig(rootConfig)) {
    if (!rootConfig.projects.includes(projectName)) {
      rootConfig.projects.push(projectName);
      saveConfig(rootDir, rootConfig);
    }
  }
}

export function initRoot(targetDir: string, projects?: string[]): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const config: RootConfig = {
    id: crypto.randomUUID(),
    version: "0.1.0",
    projects: projects || [],
    created: new Date().toISOString().split("T")[0],
  };

  saveConfig(targetDir, config);
}
