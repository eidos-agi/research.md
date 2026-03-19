#!/usr/bin/env node
"use strict";

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

if (command === "init") {
  const flags = args.slice(1);
  const isRoot = flags.includes("--root");
  const subIdx = flags.indexOf("--subproject");
  const subName = subIdx >= 0 ? flags[subIdx + 1] : null;
  const targetPath = process.env.RESEARCH_MD_CWD || process.env.PWD || process.cwd();

  try {
    if (isRoot) {
      const { initRoot } = require("../dist/config");
      initRoot(targetPath);
      console.log(`Multi-project research root initialized at ${targetPath}`);
      console.log("\nUse: research-md init --subproject <name>");
    } else if (subName) {
      const { initSubproject } = require("../dist/config");
      initSubproject(targetPath, subName);
      console.log(`Subproject '${subName}' initialized at ${targetPath}/${subName}`);
      console.log("\nFolders: findings/ candidates/ evaluations/");
    } else {
      const name = flags[0] && !flags[0].startsWith("--") ? flags[0] : undefined;
      const { initProject } = require("../dist/config");
      initProject(targetPath, name);
      console.log(`Research project initialized at ${targetPath}`);
      console.log("\nFolders: findings/ candidates/ evaluations/");
      console.log("Config: research-md.json");
    }
    console.log("\nAdd to .mcp.json:");
    console.log('  { "mcpServers": { "research-md": { "command": "npx", "args": ["research-md", "mcp", "start"] } } }');
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
} else if (command === "mcp" && subcommand === "start") {
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
} else if (command === "brief") {
  // research-md brief <path-to-BRIEF.md> [--brand <preset>] [--logo <path>] [-o <output.pdf>]
  const briefArgs = args.slice(1);
  const scriptPath = require("path").join(__dirname, "..", "src", "render-brief.py");

  if (briefArgs.length === 0) {
    console.error("Usage: research-md brief <BRIEF.md> [--brand connection-forge|aic|research] [--logo <path>] [-o <output.pdf>]");
    process.exit(1);
  }

  const { execFileSync } = require("child_process");
  try {
    const result = execFileSync("python3", [scriptPath, ...briefArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    process.stdout.write(result);
  } catch (err) {
    if (err.stderr) process.stderr.write(err.stderr);
    if (err.stdout) process.stdout.write(err.stdout);
    process.exit(err.status || 1);
  }
} else {
  console.error(`Unknown command: ${command || "(none)"}`);
  console.error("Usage:");
  console.error("  research-md init [name]              Initialize standalone project");
  console.error("  research-md init --root               Initialize multi-project root");
  console.error("  research-md init --subproject <name>  Add subproject under root");
  console.error("  research-md mcp start                 Start MCP server");
  console.error("  research-md brief <BRIEF.md>          Render brief to branded PDF");
  process.exit(1);
}
