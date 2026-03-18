#!/usr/bin/env node
"use strict";

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  const targetPath = args[1] || process.env.PWD || process.cwd();
  try {
    const { initProject } = require("../dist/config");
    initProject(targetPath, args[2]);
    console.log(`Research project initialized at ${targetPath}`);
    console.log("\nFolders: findings/ candidates/ decisions/ evaluations/");
    console.log("Config: research-md.json");
    console.log("\nAdd to .mcp.json:");
    console.log('  { "mcpServers": { "research-md": { "command": "npx", "args": ["research-md", "start"] } } }');
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
} else if (command === "start" || !command) {
  try {
    const { startServer } = require("../dist/server");
    startServer().catch((err) => {
      process.stderr.write(`Fatal: ${err.message}\n`);
      process.exit(1);
    });
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\nRun 'npm run build' first.\n`);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: research-md [init [path] | start]");
  process.exit(1);
}
