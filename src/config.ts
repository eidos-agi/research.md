import * as fs from "fs";
import * as path from "path";

// ── Config types ─────────────────────────────────────────────────────────────

/** Config for a single research project (subproject or standalone). */
export interface ProjectConfig {
  version: string;
  projectName: string;
  created: string;
}

/** Config for a root that contains multiple subprojects. */
export interface RootConfig {
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

// ── Resolution ───────────────────────────────────────────────────────────────

export interface ResolvedProject {
  /** Absolute path to this project's directory (where findings/, candidates/, etc. live). */
  projectRoot: string;
  /** The project config. */
  config: ProjectConfig;
  /** If this project lives under a root, the root path. Null for standalone. */
  rootPath: string | null;
}

/**
 * Find the nearest research-md.json walking up from cwd.
 * Returns the directory containing it, or null.
 */
export function findConfigDir(): string | null {
  const start = process.env.RESEARCH_MD_CWD || process.env.PWD || process.cwd();
  let dir = start;

  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Load a config file from a directory.
 */
export function loadConfig(dir: string): ResearchConfig | null {
  const configPath = path.join(dir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as ResearchConfig;
  } catch {
    return null;
  }
}

/**
 * List all subprojects from a root config.
 */
export function listProjects(rootDir: string): string[] {
  const config = loadConfig(rootDir);
  if (!config || !isRootConfig(config)) return [];
  return config.projects;
}

/**
 * Resolve which project we're operating on.
 *
 * Resolution order:
 * 1. If `projectName` is provided, look for it as a subproject under the root.
 * 2. If cwd is inside a subproject directory, use that.
 * 3. If the config is a standalone project config, use it directly.
 * 4. If the config is a root with projects, return null (must specify).
 */
export function resolveProject(projectName?: string): ResolvedProject | null {
  const configDir = findConfigDir();
  if (!configDir) return null;

  const config = loadConfig(configDir);
  if (!config) return null;

  // Standalone project — no subprojects
  if (isProjectConfig(config)) {
    return {
      projectRoot: configDir,
      config,
      rootPath: null,
    };
  }

  // Root config with subprojects
  if (isRootConfig(config)) {
    // Explicit project name requested
    if (projectName) {
      if (!config.projects.includes(projectName)) return null;
      const subDir = path.join(configDir, projectName);
      const subConfig = loadConfig(subDir);
      if (!subConfig || !isProjectConfig(subConfig)) return null;
      return { projectRoot: subDir, config: subConfig, rootPath: configDir };
    }

    // Try to infer from cwd — are we inside a subproject?
    const cwd = process.env.RESEARCH_MD_CWD || process.env.PWD || process.cwd();
    for (const proj of config.projects) {
      const subDir = path.resolve(configDir, proj);
      if (cwd.startsWith(subDir)) {
        const subConfig = loadConfig(subDir);
        if (subConfig && isProjectConfig(subConfig)) {
          return { projectRoot: subDir, config: subConfig, rootPath: configDir };
        }
      }
    }

    // Can't infer — return null (caller should ask which project)
    return null;
  }

  return null;
}

// ── Saving ───────────────────────────────────────────────────────────────────

export function saveConfig(dir: string, config: ResearchConfig): void {
  const configPath = path.join(dir, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize a standalone research project.
 */
export function initProject(targetDir: string, projectName?: string): void {
  const dirs = ["findings", "candidates", "evaluations"];

  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  const config: ProjectConfig = {
    version: "0.1.0",
    projectName: projectName || path.basename(targetDir),
    created: new Date().toISOString().split("T")[0],
  };

  saveConfig(targetDir, config);
}

/**
 * Initialize a subproject under an existing root.
 * Creates the subproject dir + config, and registers it in the root config.
 */
export function initSubproject(rootDir: string, projectName: string): void {
  const subDir = path.join(rootDir, projectName);
  initProject(subDir, projectName);

  // Update root config
  const rootConfig = loadConfig(rootDir);
  if (rootConfig && isRootConfig(rootConfig)) {
    if (!rootConfig.projects.includes(projectName)) {
      rootConfig.projects.push(projectName);
      saveConfig(rootDir, rootConfig);
    }
  }
}

/**
 * Initialize a root (multi-project container).
 * Does NOT create subproject folders — use initSubproject for each.
 */
export function initRoot(targetDir: string, projects?: string[]): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const config: RootConfig = {
    version: "0.1.0",
    projects: projects || [],
    created: new Date().toISOString().split("T")[0],
  };

  saveConfig(targetDir, config);
}

// ── Compat shim ──────────────────────────────────────────────────────────────

/**
 * Find the project root (legacy compat — returns resolved project root or null).
 */
export function findProjectRoot(): string | null {
  const resolved = resolveProject();
  return resolved?.projectRoot ?? null;
}
