"""Typer root + shared output formatter.

Each subcommand module exposes a ``register(app)`` function that adds its
commands. The CLI is the primary substrate; the MCP server wraps it.
"""

from __future__ import annotations

import json as _json

import typer

app = typer.Typer(
    name="research-md",
    help="research.md — the decision forge. Evidence-graded, phase-gated, peer-reviewed decisions.",
    no_args_is_help=True,
    add_completion=False,
)


@app.callback()
def _root_callback() -> None:
    """Auto-register any research project rooted at or above CWD before each command."""
    from .._logic._session import boot_from_cwd

    boot_from_cwd()


def emit(result, *, json_mode: bool) -> None:
    """Print a result. JSON mode dumps; otherwise the original string is preserved."""
    if json_mode:
        typer.echo(_json.dumps(result, indent=2, default=str))
        return
    if isinstance(result, str):
        typer.echo(result)
    elif isinstance(result, (dict, list)):
        typer.echo(_json.dumps(result, indent=2, default=str))
    else:
        typer.echo(str(result))


# Wire subcommands. Imports are local so `research-md --help` boots fast and
# doesn't pull MCP/pyyaml into argument-parsing-only paths.
def _wire() -> None:
    from . import candidate as _candidate_cmd
    from . import finding as _finding_cmd
    from . import mcp as _mcp_cmd
    from . import project as _project_cmd
    from . import research as _research_cmd

    _project_cmd.register(app)
    _finding_cmd.register(app)
    _candidate_cmd.register(app)
    _research_cmd.register(app)
    app.add_typer(_mcp_cmd.app, name="mcp", help="MCP server operations.")


_wire()


def main() -> None:
    """Console-script entry point (`research-md`)."""
    app()
