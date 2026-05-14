"""Project lifecycle subcommands."""

from __future__ import annotations

from typing import Annotated, Optional

import typer

from .._logic import project as _project


def register(app: typer.Typer) -> None:
    @app.command("project-set")
    def cmd_project_set(
        path: Annotated[str, typer.Argument(help="Path to the research project root.")],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Register a research project for this session."""
        from ._app import emit

        result = _project.project_set(path)
        emit(result, json_mode=json_)

    @app.command("project-get")
    def cmd_project_get(
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Show all registered research projects."""
        from ._app import emit

        result = _project.project_get()
        emit(result, json_mode=json_)

    @app.command("project-init")
    def cmd_project_init(
        path: Annotated[str, typer.Argument(help="Path for the new project.")],
        name: Annotated[Optional[str], typer.Option(help="Project name.")] = None,
        root: Annotated[
            bool, typer.Option(help="Initialize a multi-project root.")
        ] = False,
        subproject: Annotated[
            Optional[str], typer.Option(help="Add a subproject under a root.")
        ] = None,
        question: Annotated[
            Optional[str], typer.Option(help="Research question.")
        ] = None,
        context: Annotated[
            Optional[str], typer.Option(help="Background context.")
        ] = None,
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Initialize a new research project with folder structure and GUID."""
        from ._app import emit

        result = _project.project_init(
            path=path,
            name=name,
            root=root,
            subproject=subproject,
            question=question,
            context=context,
        )
        emit(result, json_mode=json_)

    @app.command("status")
    def cmd_status(
        research_id: Annotated[
            str, typer.Option(help="Project GUID from project_set.")
        ],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Show project health: criteria locked, peer review, TBD count, findings, candidates."""
        from ._app import emit

        result = _project.status(research_id=research_id)
        emit(result, json_mode=json_)

    @app.command("decide")
    def cmd_decide(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        decision: Annotated[str, typer.Option(help="The decision text.")],
        rationale: Annotated[str, typer.Option(help="Decision rationale.")],
        adr_reference: Annotated[
            str, typer.Option(help="Optional ADR reference.")
        ] = "",
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Record a decision. Advances project to 'decided' phase."""
        from ._app import emit

        result = _project.project_decide(
            research_id=research_id,
            decision=decision,
            rationale=rationale,
            adr_reference=adr_reference,
        )
        emit(result, json_mode=json_)

    @app.command("supersede")
    def cmd_supersede(
        research_id: Annotated[str, typer.Option(help="Project GUID.")],
        superseded_by: Annotated[
            str, typer.Option(help="ID of the project that supersedes this one.")
        ],
        json_: Annotated[
            bool, typer.Option("--json", "-J", help="JSON output.")
        ] = False,
    ) -> None:
        """Mark a decided project as superseded by a later decision."""
        from ._app import emit

        result = _project.project_supersede(
            research_id=research_id, superseded_by=superseded_by
        )
        emit(result, json_mode=json_)
