import * as fs from "fs";
import * as path from "path";

export interface ResearchConfig {
  version: string;
  projectName: string;
  created: string;
}

const CONFIG_FILENAME = "research-md.json";
const DEFAULT_CONFIG: ResearchConfig = {
  version: "0.1.0",
  projectName: "research",
  created: new Date().toISOString().split("T")[0],
};

/**
 * Find the project root by walking up from cwd looking for research-md.json.
 * Falls back to PWD env var, then process.cwd().
 */
export function findProjectRoot(): string | null {
  const start = process.env.PWD || process.cwd();
  let dir = start;

  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: use PWD/cwd if a research/ subdirectory exists
  if (fs.existsSync(path.join(start, "findings"))) {
    return start;
  }

  return null;
}

export function loadConfig(projectRoot: string): ResearchConfig {
  const configPath = path.join(projectRoot, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as ResearchConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(projectRoot: string, config: ResearchConfig): void {
  const configPath = path.join(projectRoot, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function initProject(projectRoot: string, projectName?: string): void {
  const dirs = [
    "findings",
    "candidates",
    "decisions",
    "evaluations",
  ];

  for (const dir of dirs) {
    const fullPath = path.join(projectRoot, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  const config: ResearchConfig = {
    ...DEFAULT_CONFIG,
    projectName: projectName || path.basename(projectRoot),
    created: new Date().toISOString().split("T")[0],
  };

  saveConfig(projectRoot, config);
}
