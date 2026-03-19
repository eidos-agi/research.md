import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  initProject,
  initRoot,
  initSubproject,
  loadConfig,
  listProjects,
  registerProject,
  resolveByGuid,
  lookupGuid,
} from "../src/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-config-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initProject", () => {
  it("creates folder structure and config", () => {
    initProject(tmpDir, "test-project");

    expect(fs.existsSync(path.join(tmpDir, "findings"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "candidates"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "evaluations"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "research-md.json"))).toBe(true);
  });

  it("generates a UUID in the config", () => {
    initProject(tmpDir, "test-project");
    const config = loadConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.id).toBeDefined();
    expect(config!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("does not create decisions/ directory", () => {
    initProject(tmpDir, "test-project");
    expect(fs.existsSync(path.join(tmpDir, "decisions"))).toBe(false);
  });
});

describe("initRoot + initSubproject", () => {
  it("creates root config with projects array", () => {
    initRoot(tmpDir);
    const config = loadConfig(tmpDir);
    expect(config).not.toBeNull();
    expect("projects" in config!).toBe(true);
    expect((config as any).projects).toEqual([]);
    expect(config!.id).toBeDefined();
  });

  it("initSubproject adds to root projects list", () => {
    initRoot(tmpDir);
    initSubproject(tmpDir, "alpha");
    initSubproject(tmpDir, "beta");

    const config = loadConfig(tmpDir);
    expect((config as any).projects).toEqual(["alpha", "beta"]);

    // Subprojects have their own configs
    const alpha = loadConfig(path.join(tmpDir, "alpha"));
    expect(alpha).not.toBeNull();
    expect((alpha as any).projectName).toBe("alpha");
    expect(alpha!.id).toBeDefined();
  });

  it("initSubproject is idempotent", () => {
    initRoot(tmpDir);
    initSubproject(tmpDir, "alpha");
    initSubproject(tmpDir, "alpha");

    const config = loadConfig(tmpDir);
    expect((config as any).projects).toEqual(["alpha"]);
  });
});

describe("listProjects", () => {
  it("returns empty for standalone project", () => {
    initProject(tmpDir, "standalone");
    expect(listProjects(tmpDir)).toEqual([]);
  });

  it("returns subproject names for root", () => {
    initRoot(tmpDir);
    initSubproject(tmpDir, "one");
    initSubproject(tmpDir, "two");
    expect(listProjects(tmpDir)).toEqual(["one", "two"]);
  });
});

describe("GUID registration and resolution", () => {
  it("registerProject returns id and name", () => {
    initProject(tmpDir, "my-project");
    const info = registerProject(tmpDir);
    expect(info.id).toBeDefined();
    expect(info.projectName).toBe("my-project");
    expect(info.isRoot).toBe(false);
  });

  it("lookupGuid finds registered project", () => {
    initProject(tmpDir, "my-project");
    const info = registerProject(tmpDir);
    expect(lookupGuid(info.id)).toBe(path.resolve(tmpDir));
  });

  it("lookupGuid returns null for unknown GUID", () => {
    expect(lookupGuid("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("resolveByGuid returns project details", () => {
    initProject(tmpDir, "my-project");
    const info = registerProject(tmpDir);
    const resolved = resolveByGuid(info.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.projectRoot).toBe(path.resolve(tmpDir));
    expect(resolved!.config.projectName).toBe("my-project");
  });

  it("registerProject on root also registers subprojects", () => {
    initRoot(tmpDir);
    initSubproject(tmpDir, "sub-a");
    initSubproject(tmpDir, "sub-b");

    const info = registerProject(tmpDir);
    expect(info.isRoot).toBe(true);
    expect(info.projects).toEqual(["sub-a", "sub-b"]);

    // Subproject GUIDs are registered
    const subAConfig = loadConfig(path.join(tmpDir, "sub-a"));
    expect(lookupGuid(subAConfig!.id)).toBe(path.resolve(tmpDir, "sub-a"));

    // Root GUID should not resolve to a project (it's a container)
    const rootResolved = resolveByGuid(info.id);
    expect(rootResolved).toBeNull();

    // Subproject GUID should resolve
    const subResolved = resolveByGuid(subAConfig!.id);
    expect(subResolved).not.toBeNull();
    expect(subResolved!.config.projectName).toBe("sub-a");
  });

  it("throws on path without config", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"));
    expect(() => registerProject(emptyDir)).toThrow("No research-md.json");
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
