export { createServer, startServer } from "./server";
export { findProjectRoot, loadConfig, initProject } from "./config";

if (require.main === module) {
  const { startServer } = require("./server");
  startServer().catch((err: Error) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
