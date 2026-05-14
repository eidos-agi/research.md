"""Research-meta subcommands: criteria-lock, scoring-matrix, peer-review, brief, report."""

from __future__ import annotations

import json
from typing import Annotated, Optional

import typer

from .._logic import research as _research


def register(app: typer.Typer) -> None:
    @app.command("criteria-lock")
    def cmd_criteria_lock(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Lock decision criteria, preventing further weight changes."""
        from ._app import emit

        result = _research.criteria_lock(research_id=research_id)
        emit(result, json_mode=json_)

    @app.command("scoring-matrix-generate")
    def cmd_scoring_matrix_generate(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Generate evaluations/scoring-matrix.md from locked criteria and candidates."""
        from ._app import emit

        result = _research.scoring_matrix_generate(research_id=research_id)
        emit(result, json_mode=json_)

    @app.command("peer-review-log")
    def cmd_peer_review_log(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        reviewer: Annotated[str, typer.Option(help="Peer reviewer name.")],
        findings: Annotated[
            str,
            typer.Option(
                "--findings",
                help='JSON array of finding ID strings, e.g. ["0001","0002"].',
            ),
        ],
        attestations: Annotated[
            Optional[str],
            typer.Option(
                "--attestations",
                help='JSON object mapping finding_id → attestation, e.g. {"0001":"REPLICATED"}.',
            ),
        ] = None,
        notes: Annotated[str, typer.Option(help="Optional review notes.")] = "",
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Log a peer review. Required before scoring."""
        from ._app import emit

        try:
            findings_list = json.loads(findings)
        except json.JSONDecodeError as e:
            typer.echo(f"--findings is not valid JSON: {e}", err=True)
            raise typer.Exit(code=2)
        atts: Optional[dict] = None
        if attestations is not None:
            try:
                atts = json.loads(attestations)
            except json.JSONDecodeError as e:
                typer.echo(f"--attestations is not valid JSON: {e}", err=True)
                raise typer.Exit(code=2)
        result = _research.peer_review_log(
            research_id=research_id,
            reviewer=reviewer,
            findings=findings_list,
            attestations=atts,
            notes=notes,
        )
        emit(result, json_mode=json_)

    @app.command("brief")
    def cmd_brief(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        audience: Annotated[
            str, typer.Option(help="Target audience for the brief.")
        ] = "general",
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Generate a layered research brief from a completed project."""
        from ._app import emit

        result = _research.research_brief(research_id=research_id, audience=audience)
        emit(result, json_mode=json_)

    @app.command("report")
    def cmd_report(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Generate a FULL research report from a completed project."""
        from ._app import emit

        result = _research.research_report(research_id=research_id)
        emit(result, json_mode=json_)
