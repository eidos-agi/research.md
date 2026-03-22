"""Project configuration, phase management, and GUID registry."""

import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any

PHASE_ORDER = ["research", "criteria", "locked", "reviewed", "scored", "decided", "superseded"]
CONFIG_DIR = ".research"
CONFIG_FILENAME = "research.json"

_guid_to_path: dict[str, str] = {}


@dataclass
class PhaseTransition:
    phase: str
    date: str
    note: str | None = None


@dataclass
class ProjectConfig:
    id: str
    version: str
    projectName: str
    created: str
    phase: str
    transitions: list[dict[str, Any]]
    question: str | None = None
    context: str | None = None


@dataclass
class RootConfig:
    id: str
    version: str
    projects: list[str]
    created: str


def _is_root(config: dict) -> bool:
    return "projects" in config and isinstance(config.get("projects"), list)


def _is_project(config: dict) -> bool:
    return "projectName" in config


def load_config(dir_path: str) -> dict | None:
    config_path = os.path.join(dir_path, CONFIG_DIR, CONFIG_FILENAME)
    if not os.path.exists(config_path):
        return None
    try:
        with open(config_path) as f:
            return json.load(f)
    except Exception:
        return None


def save_config(dir_path: str, config: dict) -> None:
    config_dir = os.path.join(dir_path, CONFIG_DIR)
    os.makedirs(config_dir, exist_ok=True)
    with open(os.path.join(config_dir, CONFIG_FILENAME), "w") as f:
        json.dump(config, f, indent=2)
        f.write("\n")


def register_project(project_path: str) -> dict:
    abs_path = os.path.abspath(project_path)
    config = load_config(abs_path)
    if not config:
        raise ValueError(f"No .research/research.json at {abs_path}. Call project_init there first.")
    if not config.get("id"):
        raise ValueError(f".research/research.json at {abs_path} has no 'id' field. Re-run project_init to generate one.")

    _guid_to_path[config["id"]] = abs_path

    if _is_root(config):
        for sub in config["projects"]:
            sub_dir = os.path.join(abs_path, sub)
            sub_config = load_config(sub_dir)
            if sub_config and sub_config.get("id"):
                _guid_to_path[sub_config["id"]] = sub_dir
        return {"id": config["id"], "projectName": "(root)", "isRoot": True, "projects": config["projects"]}

    return {
        "id": config["id"],
        "projectName": config.get("projectName", ""),
        "isRoot": False,
        "projects": [],
        "question": config.get("question"),
        "context": config.get("context"),
    }


def list_registered() -> list[dict[str, str]]:
    return [{"id": id, "path": p} for id, p in _guid_to_path.items()]


@dataclass
class ResolvedProject:
    projectRoot: str
    config: dict
    rootPath: str | None


def resolve_by_guid(guid: str) -> ResolvedProject | None:
    project_path = _guid_to_path.get(guid)
    if not project_path or not os.path.exists(project_path):
        return None

    config = load_config(project_path)
    if not config:
        return None

    if _is_project(config) and config.get("id") == guid:
        parent_dir = os.path.dirname(project_path)
        parent_config = load_config(parent_dir)
        root_path = parent_dir if (parent_config and _is_root(parent_config)) else None
        return ResolvedProject(projectRoot=project_path, config=config, rootPath=root_path)

    if _is_root(config) and config.get("id") == guid:
        return None  # Can't operate on root directly

    return None


def can_transition(current: str, target: str) -> bool:
    if target == "superseded":
        return True
    current_idx = PHASE_ORDER.index(current)
    target_idx = PHASE_ORDER.index(target)
    return target_idx > current_idx and target_idx < PHASE_ORDER.index("superseded")


def advance_phase(project_path: str, target: str, note: str | None = None) -> dict:
    config = load_config(project_path)
    if not config or not _is_project(config):
        raise ValueError(f"No project config at {project_path}")

    if config["phase"] == target:
        return config

    if not can_transition(config["phase"], target):
        current_idx = PHASE_ORDER.index(config["phase"])
        next_phase = PHASE_ORDER[current_idx + 1] if current_idx + 1 < len(PHASE_ORDER) else "none"
        raise ValueError(
            f"Cannot transition from '{config['phase']}' to '{target}'. "
            f"Next valid phase is '{next_phase}'."
        )

    now = date.today().isoformat()
    config["phase"] = target
    transition = {"phase": target, "date": now}
    if note:
        transition["note"] = note
    config["transitions"].append(transition)
    save_config(project_path, config)
    return config


def require_phase(config: dict, min_phase: str, action: str) -> None:
    current_idx = PHASE_ORDER.index(config["phase"])
    required_idx = PHASE_ORDER.index(min_phase)
    if current_idx < required_idx:
        raise ValueError(
            f"Cannot {action} — project is in '{config['phase']}' phase. "
            f"Requires '{min_phase}' or later."
        )


def init_project(target_dir: str, project_name: str | None = None, question: str | None = None, context: str | None = None) -> None:
    research_dir = os.path.join(target_dir, CONFIG_DIR)
    for d in ["findings", "candidates", "evaluations"]:
        os.makedirs(os.path.join(research_dir, d), exist_ok=True)

    now = date.today().isoformat()
    config = {
        "id": str(uuid.uuid4()),
        "version": "0.1.0",
        "projectName": project_name or os.path.basename(os.path.abspath(target_dir)),
        "created": now,
        "phase": "research",
        "transitions": [{"phase": "research", "date": now}],
    }
    if question:
        config["question"] = question
    if context:
        config["context"] = context

    save_config(target_dir, config)


def init_subproject(root_dir: str, project_name: str, question: str | None = None, context: str | None = None) -> None:
    sub_dir = os.path.join(root_dir, project_name)
    init_project(sub_dir, project_name, question, context)

    root_config = load_config(root_dir)
    if root_config and _is_root(root_config):
        if project_name not in root_config["projects"]:
            root_config["projects"].append(project_name)
            save_config(root_dir, root_config)


def init_root(target_dir: str, projects: list[str] | None = None) -> None:
    os.makedirs(target_dir, exist_ok=True)
    config = {
        "id": str(uuid.uuid4()),
        "version": "0.1.0",
        "projects": projects or [],
        "created": date.today().isoformat(),
    }
    save_config(target_dir, config)
