export { createServer, startServer } from "./server";
export { initProject, initRoot, initSubproject, loadConfig, registerProject } from "./config";
export { ResearchError, ResearchValidationError, ResearchGateError, ResearchNotFoundError } from "./errors";

if (require.main === module) {
  const { startServer } = require("./server");
  startServer().catch((err: Error) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
