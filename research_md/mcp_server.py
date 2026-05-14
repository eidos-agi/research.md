"""Razor-thin MCP server for research-md.

Exposes ONE tool: ``help``. Every other operation happens via the CLI
(``research-md project-set``, ``research-md finding-create``, etc.). This is
the CLI-first / razor-thin-MCP shape — see ADR-006 in governor.md/.governor/adr/.

Discovery flow:
  1. Agent calls ``mcp__research-md__help()`` — gets the full command tree.
  2. Agent calls ``mcp__research-md__help(subcommand="finding-create")`` —
     gets the specific subcommand's --help output.
  3. Agent invokes the actual work via Bash:
     ``research-md finding-create ... --json``.
"""

from __future__ import annotations

import asyncio
import io
import sys

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

server = Server("research-md")


HELP_DESCRIPTION = (
    "REQUIRED at session start for any research-md work: returns the full "
    "research-md command tree. Call with no args for the top-level surface, "
    "or with subcommand='<name>' for that subcommand's full --help. All real "
    "work happens via Bash: `research-md <subcommand> [--json] [opts]`. "
    "This MCP server is razor-thin by design."
)


HELP_TOOL = Tool(
    name="help",
    description=HELP_DESCRIPTION,
    inputSchema={
        "type": "object",
        "properties": {
            "subcommand": {
                "type": "string",
                "description": (
                    "Optional subcommand name (e.g. 'project-set', "
                    "'finding-create', 'candidate-score'). When set, returns "
                    "that subcommand's full --help. When omitted, returns the "
                    "top-level command tree."
                ),
            },
        },
    },
)


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [HELP_TOOL]


def _capture_help(argv: list[str]) -> str:
    """Run the Typer app with the given argv, capturing --help stdout."""
    from .cli import app

    buf = io.StringIO()
    real_stdout = sys.stdout
    sys.stdout = buf
    try:
        try:
            app(argv, standalone_mode=False)
        except SystemExit:
            pass
        except Exception as e:
            return f"error rendering help: {type(e).__name__}: {e}"
    finally:
        sys.stdout = real_stdout
    return buf.getvalue()


def _build_top_level_help() -> str:
    """Hand-curated top-level surface description.

    SESSION START framing is explicit; subcommand list is derived from the
    Typer app so it doesn't drift.
    """
    return "\n".join(
        [
            "research-md — The decision forge. Evidence-graded, phase-gated, peer-reviewed decisions.",
            "",
            "USAGE:  research-md <subcommand> [--json] [options]",
            "",
            "SESSION START:",
            "  research-md project-set <path>           # register project, returns research_id",
            "  research-md status --research-id <id>    # one-line health check",
            "",
            "PROJECT LIFECYCLE:",
            "  research-md project-init <path>          # initialize a new project",
            "  research-md project-get                  # list registered projects",
            "  research-md decide                       # record a decision (phase: scored → decided)",
            "  research-md supersede                    # mark a project as superseded",
            "",
            "FINDINGS (evidence ladder):",
            "  research-md finding-create               # create a new finding",
            "  research-md finding-list                 # list all findings",
            "  research-md finding-update               # update status / evidence / sources",
            "",
            "CANDIDATES (options under evaluation):",
            "  research-md candidate-create             # create a new candidate",
            "  research-md candidate-list               # list candidates with verdicts",
            "  research-md candidate-update             # update verdict / description",
            "  research-md candidate-add-claim          # add a binary testable claim",
            "  research-md candidate-resolve-claim      # mark a claim Y/N",
            "  research-md candidate-score              # score a candidate (after peer review)",
            "",
            "DECISION META:",
            "  research-md criteria-lock                # freeze decision criteria weights",
            "  research-md scoring-matrix-generate      # generate the scoring matrix",
            "  research-md peer-review-log              # log a peer review (unblocks scoring)",
            "  research-md brief                        # generate a layered brief",
            "  research-md report                       # generate the full report",
            "",
            "MCP:",
            "  research-md mcp serve                    # boots this MCP server (you're talking to it now)",
            "",
            "DRILL IN:    research-md <subcommand> --help    "
            "OR    mcp__research-md__help(subcommand='<name>')",
            "JSON MODE:   add --json to any subcommand for machine-readable output",
        ]
    )


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name != "help":
        return [TextContent(type="text", text=f"unknown tool: {name!r}")]
    sub = (arguments or {}).get("subcommand")
    if sub:
        text = _capture_help([sub, "--help"])
        if not text.strip():
            text = f"no help available for subcommand {sub!r}"
        return [TextContent(type="text", text=text)]
    return [TextContent(type="text", text=_build_top_level_help())]


async def _main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream, write_stream, server.create_initialization_options()
        )


def run() -> None:
    """Entry point used by ``research-md mcp serve``."""
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        sys.exit(0)
