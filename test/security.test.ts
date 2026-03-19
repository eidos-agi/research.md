import { describe, it, expect } from "vitest";
import { sanitizeSlug, safePath } from "../src/security";

describe("sanitizeSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(sanitizeSlug("My Research Topic")).toBe("my-research-topic");
  });

  it("strips special characters", () => {
    expect(sanitizeSlug("What's the 'best' option?")).toBe("what-s-the-best-option");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeSlug("too---many---hyphens")).toBe("too-many-hyphens");
  });

  it("trims leading/trailing hyphens", () => {
    expect(sanitizeSlug("--trimmed--")).toBe("trimmed");
  });

  it("handles empty string", () => {
    expect(sanitizeSlug("")).toBe("");
  });
});

describe("safePath", () => {
  it("resolves valid paths within root", () => {
    const result = safePath("/home/user/project", "findings", "0001-test.md");
    expect(result).toBe("/home/user/project/findings/0001-test.md");
  });

  it("rejects path traversal", () => {
    expect(() =>
      safePath("/home/user/project", "..", "..", "etc", "passwd")
    ).toThrow("Path traversal");
  });

  it("rejects traversal via encoded segments", () => {
    expect(() =>
      safePath("/home/user/project", "findings/../../etc")
    ).toThrow("Path traversal");
  });
});
