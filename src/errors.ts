export class ResearchError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ResearchError";
    this.code = code;
    this.details = details;
  }
}

export class ResearchValidationError extends ResearchError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ResearchValidationError";
  }
}

export class ResearchGateError extends ResearchError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "GATE_ERROR", details);
    this.name = "ResearchGateError";
  }
}

export class ResearchNotFoundError extends ResearchError {
  constructor(entity: string, id: string) {
    super(`${entity} '${id}' not found.`, "NOT_FOUND", { entity, id });
    this.name = "ResearchNotFoundError";
  }
}

export class ResearchNotInitializedError extends ResearchError {
  constructor() {
    super(
      "No research-md.json found. Run `research-md init` in your research project directory first.",
      "NOT_INITIALIZED"
    );
    this.name = "ResearchNotInitializedError";
  }
}

/**
 * Format an error for MCP tool response.
 * In debug mode, includes error code and details.
 */
export function formatError(err: unknown): { content: Array<{ type: string; text: string }>; isError: true } {
  const isDebug = !!process.env.DEBUG;

  if (err instanceof ResearchError) {
    const parts = [`Error: ${err.message}`];
    if (isDebug && err.code) parts.push(`Code: ${err.code}`);
    if (isDebug && err.details) parts.push(`Details: ${JSON.stringify(err.details)}`);
    return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
