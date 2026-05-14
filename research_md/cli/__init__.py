"""research-md Typer CLI surface.

``research-md <subcommand> [--json] [opts]`` — everything is here. The MCP
server (``research_md.mcp_server``) exposes a single ``help`` tool that
introspects this Typer app.
"""

from ._app import app, main

__all__ = ["app", "main"]
