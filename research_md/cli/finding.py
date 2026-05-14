"""Finding subcommands: create, list, update."""

from __future__ import annotations

import json
from typing import Annotated, Optional

import typer

from .._logic import finding as _finding


def _parse_sources(raw: Optional[str]) -> Optional[list[dict]]:
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        typer.echo(f"--sources is not valid JSON: {e}", err=True)
        raise typer.Exit(code=2)
    if not isinstance(parsed, list):
        typer.echo("--sources must be a JSON array of source objects.", err=True)
        raise typer.Exit(code=2)
    return parsed


def register(app: typer.Typer) -> None:
    @app.command("finding-create")
    def cmd_finding_create(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        title: Annotated[str, typer.Option(help="Short title for the finding.")],
        claim: Annotated[str, typer.Option(help="The factual claim.")],
        evidence: Annotated[
            str,
            typer.Option(help="CONFIRMED | REASONED | LOW | UNVERIFIED."),
        ] = "UNVERIFIED",
        source: Annotated[
            str,
            typer.Option(help="Legacy single-source string. Prefer --sources."),
        ] = "unspecified",
        sources: Annotated[
            Optional[str],
            typer.Option(
                "--sources",
                help='JSON array: [{"text": "url (content_hash:...)", "tier": "PRIMARY|EXPERT|SECONDARY|VENDOR"}]',
            ),
        ] = None,
        disconfirmation: Annotated[
            Optional[str],
            typer.Option(help="What you searched to disprove and what you found."),
        ] = None,
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Create a new finding with evidence grade and source."""
        from ._app import emit

        result = _finding.finding_create(
            research_id=research_id,
            title=title,
            claim=claim,
            evidence=evidence,
            source=source,
            sources=_parse_sources(sources),
            disconfirmation=disconfirmation,
        )
        emit(result, json_mode=json_)

    @app.command("finding-list")
    def cmd_finding_list(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """List all findings with status and evidence grade."""
        from ._app import emit

        result = _finding.finding_list(research_id=research_id)
        emit(result, json_mode=json_)

    @app.command("finding-update")
    def cmd_finding_update(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        id: Annotated[str, typer.Option(help='Finding ID (e.g. "0001" or "1").')],
        status: Annotated[
            Optional[str],
            typer.Option(help="open | confirmed | refuted | superseded."),
        ] = None,
        evidence: Annotated[
            Optional[str],
            typer.Option(help="CONFIRMED | REASONED | LOW | UNVERIFIED."),
        ] = None,
        claim: Annotated[
            Optional[str], typer.Option(help="Updated claim text.")
        ] = None,
        sources: Annotated[
            Optional[str],
            typer.Option(
                "--sources",
                help="Replace sources with this JSON array.",
            ),
        ] = None,
        disconfirmation: Annotated[
            Optional[str],
            typer.Option(help="Disconfirmation search notes."),
        ] = None,
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Update a finding's status, evidence grade, claim, sources, or disconfirmation."""
        from ._app import emit

        result = _finding.finding_update(
            research_id=research_id,
            id=id,
            status=status,
            evidence=evidence,
            claim=claim,
            sources=_parse_sources(sources),
            disconfirmation=disconfirmation,
        )
        emit(result, json_mode=json_)
