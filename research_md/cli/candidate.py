"""Candidate subcommands: create, list, update, add-claim, resolve-claim, score."""

from __future__ import annotations

import json
from typing import Annotated, Optional

import typer

from .._logic import candidate as _candidate


def register(app: typer.Typer) -> None:
    @app.command("candidate-create")
    def cmd_candidate_create(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        title: Annotated[str, typer.Option(help="Candidate title.")],
        slug: Annotated[
            Optional[str], typer.Option(help="Optional explicit slug.")
        ] = None,
        description: Annotated[
            Optional[str], typer.Option(help="Optional description.")
        ] = None,
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Create a new candidate for evaluation."""
        from ._app import emit

        result = _candidate.candidate_create(
            research_id=research_id,
            title=title,
            slug=slug,
            description=description,
        )
        emit(result, json_mode=json_)

    @app.command("candidate-list")
    def cmd_candidate_list(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """List all candidates with verdict status."""
        from ._app import emit

        result = _candidate.candidate_list(research_id=research_id)
        emit(result, json_mode=json_)

    @app.command("candidate-update")
    def cmd_candidate_update(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        slug: Annotated[str, typer.Option(help="Candidate slug.")],
        verdict: Annotated[Optional[str], typer.Option(help="New verdict.")] = None,
        description: Annotated[
            Optional[str], typer.Option(help="New description.")
        ] = None,
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Update a candidate's verdict and/or description."""
        from ._app import emit

        result = _candidate.candidate_update(
            research_id=research_id,
            slug=slug,
            verdict=verdict,
            description=description,
        )
        emit(result, json_mode=json_)

    @app.command("candidate-add-claim")
    def cmd_candidate_add_claim(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        slug: Annotated[str, typer.Option(help="Candidate slug.")],
        claim: Annotated[str, typer.Option(help="Binary testable claim.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Add a binary testable claim to a candidate's validation checklist."""
        from ._app import emit

        result = _candidate.candidate_add_claim(
            research_id=research_id, slug=slug, claim=claim
        )
        emit(result, json_mode=json_)

    @app.command("candidate-resolve-claim")
    def cmd_candidate_resolve_claim(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        slug: Annotated[str, typer.Option(help="Candidate slug.")],
        claim_index: Annotated[
            int, typer.Option(help="1-based index of the claim to resolve.")
        ],
        result: Annotated[str, typer.Option(help="Y or N.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Mark a validation claim Y or N (clears _TBD_)."""
        from ._app import emit

        out = _candidate.candidate_resolve_claim(
            research_id=research_id, slug=slug, claim_index=claim_index, result=result
        )
        emit(out, json_mode=json_)

    @app.command("candidate-score")
    def cmd_candidate_score(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        slug: Annotated[str, typer.Option(help="Candidate slug.")],
        scores: Annotated[
            str,
            typer.Option(
                "--scores",
                help='JSON object mapping criterion → score, e.g. {"Speed":8,"Cost":7}',
            ),
        ],
        notes: Annotated[str, typer.Option(help="Optional scoring notes.")] = "",
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Score a candidate. Fails if criteria not locked, peer review missing, or _TBD_ items remain."""
        from ._app import emit

        try:
            scores_dict = json.loads(scores)
        except json.JSONDecodeError as e:
            typer.echo(f"--scores is not valid JSON: {e}", err=True)
            raise typer.Exit(code=2)
        if not isinstance(scores_dict, dict):
            typer.echo("--scores must be a JSON object.", err=True)
            raise typer.Exit(code=2)
        result = _candidate.candidate_score(
            research_id=research_id, slug=slug, scores=scores_dict, notes=notes
        )
        emit(result, json_mode=json_)
