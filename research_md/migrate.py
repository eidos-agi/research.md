"""research-md-migrate — sweep consumer configs to v0.5.0 (CLI-first razor-thin MCP).

Collapses all ``mcp__research-md__*`` allowlist entries to the single
``mcp__research-md__help`` and ensures ``Bash(research-md:*)`` is present.
Run inside a project directory or pass --root to sweep a tree.

Dry-run by default; pass --apply to actually rewrite.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Plan:
    project_root: Path
    actions: list[tuple[str, str]]

    def add(self, description: str, detail: str = "") -> None:
        self.actions.append((description, detail))

    def is_empty(self) -> bool:
        return not self.actions


def plan_for_project(project_root: Path) -> Plan:
    plan = Plan(project_root, [])

    settings = project_root / ".claude" / "settings.local.json"
    if settings.is_file():
        try:
            data = json.loads(settings.read_text())
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            allow = data.get("permissions", {}).get("allow", [])
            research_entries = [
                e
                for e in allow
                if isinstance(e, str) and e.startswith("mcp__research-md__")
            ]
            already_help = any(e == "mcp__research-md__help" for e in allow)
            bash_pattern_present = any(
                isinstance(e, str) and e.startswith("Bash(research-md") for e in allow
            )
            if research_entries and (not already_help or len(research_entries) > 1):
                plan.add(
                    f"collapse {len(research_entries)} mcp__research-md__* allowlist entries → "
                    "single mcp__research-md__help (CLI-first; v0.5.0)"
                )
            if not bash_pattern_present:
                plan.add("add Bash(research-md:*) to allowlist (CLI-first)")

    return plan


def apply_plan(plan: Plan) -> None:
    project_root = plan.project_root
    settings = project_root / ".claude" / "settings.local.json"
    if not settings.is_file():
        return
    try:
        data = json.loads(settings.read_text())
    except json.JSONDecodeError:
        return
    if not isinstance(data, dict):
        return

    allow = data.get("permissions", {}).get("allow", [])
    new_allow = [
        e
        for e in allow
        if not (isinstance(e, str) and e.startswith("mcp__research-md__"))
    ]
    changed = len(allow) != len(new_allow)
    if not any(e == "mcp__research-md__help" for e in new_allow):
        new_allow.append("mcp__research-md__help")
        changed = True
    if not any(
        isinstance(e, str) and e.startswith("Bash(research-md") for e in new_allow
    ):
        new_allow.append("Bash(research-md:*)")
        changed = True
    if changed:
        data.setdefault("permissions", {})["allow"] = new_allow
        settings.write_text(json.dumps(data, indent=2))


def find_projects(root: Path) -> list[Path]:
    found = []
    seen: set[Path] = set()
    for settings in root.rglob(".claude/settings.local.json"):
        parent = settings.parent.parent
        if parent in seen:
            continue
        try:
            content = settings.read_text()
        except OSError:
            continue
        if "research-md" in content:
            seen.add(parent)
            found.append(parent)
    return sorted(found)


def main() -> int:
    p = argparse.ArgumentParser(
        prog="research-md-migrate",
        description="Migrate consumer configs to research-md v0.5.0 (CLI-first razor-thin MCP).",
    )
    p.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Sweep all .claude/settings.local.json under this root. Default: just the current directory.",
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Actually rewrite. Without this, runs as a dry-run.",
    )
    args = p.parse_args()

    if args.root:
        if not args.root.is_dir():
            print(f"--root {args.root} is not a directory", file=sys.stderr)
            return 2
        projects = find_projects(args.root)
        if not projects:
            print(f"No consumers of research-md under {args.root}.")
            return 0
        print(f"Found {len(projects)} consumer(s) under {args.root}.\n")
    else:
        cwd = Path.cwd()
        if not (cwd / ".claude" / "settings.local.json").is_file():
            print(f"No .claude/settings.local.json in {cwd}. Nothing to migrate.")
            print("Use --root to sweep a directory tree.")
            return 0
        projects = [cwd]

    plans = [plan_for_project(p) for p in projects]
    nonempty = [pl for pl in plans if not pl.is_empty()]

    if not nonempty:
        print("Nothing to migrate.")
        return 0

    for plan in nonempty:
        print(f"\n=== {plan.project_root} ===")
        for desc, _ in plan.actions:
            print(f"  • {desc}")

    if not args.apply:
        print(f"\n(dry-run; pass --apply to rewrite {len(nonempty)} project(s))")
        return 0

    for plan in nonempty:
        apply_plan(plan)
        print(f"migrated: {plan.project_root}")

    print(f"\nDone. Migrated {len(nonempty)} project(s).")
    print(
        "Restart any active Claude Code sessions so they pick up the collapsed MCP server."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
