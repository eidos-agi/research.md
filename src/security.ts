import * as path from "path";

/**
 * Sanitize a slug to prevent path traversal and injection.
 * Allows alphanumeric, hyphens, and underscores only.
 */
export function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Resolve a file path within the project root, rejecting traversal attempts.
 */
export function safePath(projectRoot: string, ...segments: string[]): string {
  const resolved = path.resolve(projectRoot, ...segments);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(path.resolve(projectRoot))) {
    throw new Error(`Path traversal attempt detected: ${segments.join("/")}`);
  }
  return normalized;
}

/**
 * Zero-pad a number to a fixed width.
 */
export function padId(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}
