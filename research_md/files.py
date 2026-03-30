"""Markdown file I/O, findings, candidates, criteria, peer review, scoring matrix."""

import os
import re
from dataclasses import dataclass
from typing import Any

import yaml

from .security import safe_path

RESEARCH_DIR = ".research"


@dataclass
class ParsedFile:
    frontmatter: dict[str, Any]
    content: str
    filePath: str


# ── YAML formatting to match gray-matter ──────────────────────────────────────


class _GrayMatterDumper(yaml.SafeDumper):
    pass


def _str_representer(dumper: yaml.Dumper, data: str) -> yaml.ScalarNode:
    if re.match(r"^\d{4}-\d{2}-\d{2}$", data):
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="'")
    # Quote strings that would confuse YAML parsers (colons, special chars, multiline)
    if any(
        ch in data
        for ch in (
            ":",
            "{",
            "}",
            "[",
            "]",
            ",",
            "&",
            "*",
            "?",
            "|",
            "-",
            "<",
            ">",
            "=",
            "!",
            "%",
            "@",
            "`",
            "\n",
        )
    ):
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="'")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


_GrayMatterDumper.add_representer(str, _str_representer)


def _none_representer(dumper: yaml.Dumper, data: None) -> yaml.ScalarNode:
    return dumper.represent_scalar("tag:yaml.org,2002:null", "null")


_GrayMatterDumper.add_representer(type(None), _none_representer)


# ── Read / Write ──────────────────────────────────────────────────────────────


def read_markdown(file_path: str) -> ParsedFile:
    with open(file_path) as f:
        raw = f.read()

    if raw.startswith("---\n"):
        end = raw.index("\n---\n", 4)
        fm_str = raw[4:end]
        content = raw[end + 5 :]
        frontmatter = yaml.safe_load(fm_str) or {}
        for k, v in frontmatter.items():
            if hasattr(v, "isoformat"):
                frontmatter[k] = v.isoformat()
    else:
        frontmatter = {}
        content = raw

    return ParsedFile(frontmatter=frontmatter, content=content, filePath=file_path)


def write_markdown(file_path: str, frontmatter: dict[str, Any], content: str) -> None:
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    fm = {k: v for k, v in frontmatter.items() if v is not None}

    fm_str = yaml.dump(
        fm,
        Dumper=_GrayMatterDumper,
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        indent=2,
    )
    # Match gray-matter list indentation for simple lists.
    # For nested structures (dicts-in-lists), YAML's default output is correct.
    lines = fm_str.split("\n")
    fixed = []
    in_nested_list = False
    for i, line in enumerate(lines):
        if line.startswith("- ") and not line.startswith("- {"):
            # Check if next non-empty line is a continuation (dict key at same indent)
            next_lines = [ln for ln in lines[i + 1 : i + 3] if ln.strip()]
            has_nested_keys = any(
                ln.startswith("  ") and not ln.startswith("  -") for ln in next_lines
            )
            if has_nested_keys:
                in_nested_list = True
                fixed.append(line)
            else:
                in_nested_list = False
                fixed.append("  " + line)
        elif in_nested_list and line.startswith("  ") and not line.startswith("- "):
            fixed.append(line)
        else:
            if not line.startswith("  ") and not line.startswith("- "):
                in_nested_list = False
            fixed.append(line)
    fm_str = "\n".join(fixed)

    with open(file_path, "w") as f:
        f.write("---\n")
        f.write(fm_str)
        f.write("---\n")
        f.write(content)
        if content and not content.endswith("\n"):
            f.write("\n")


# ── Findings ──────────────────────────────────────────────────────────────────


def list_findings(project_root: str) -> list[ParsedFile]:
    d = safe_path(project_root, RESEARCH_DIR, "findings")
    if not os.path.exists(d):
        return []
    return [
        read_markdown(os.path.join(d, f))
        for f in sorted(os.listdir(d))
        if f.endswith(".md") and f.lower() != "readme.md"
    ]


def next_finding_id(project_root: str) -> str:
    findings = list_findings(project_root)
    max_n = 0
    for f in findings:
        try:
            n = int(f.frontmatter["id"])
            max_n = max(max_n, n)
        except (ValueError, KeyError):
            pass
    return str(max_n + 1).zfill(4)


def finding_path(project_root: str, id: str, slug: str) -> str:
    return safe_path(project_root, RESEARCH_DIR, "findings", f"{id}-{slug}.md")


# ── Candidates ────────────────────────────────────────────────────────────────


def list_candidates(project_root: str) -> list[ParsedFile]:
    d = safe_path(project_root, RESEARCH_DIR, "candidates")
    if not os.path.exists(d):
        return []
    return [
        read_markdown(os.path.join(d, f))
        for f in sorted(os.listdir(d))
        if f.endswith(".md") and f.lower() != "readme.md"
    ]


def candidate_path(project_root: str, slug: str) -> str:
    return safe_path(project_root, RESEARCH_DIR, "candidates", f"{slug}.md")


# ── Decision Criteria ─────────────────────────────────────────────────────────


def decision_criteria_path(project_root: str) -> str:
    return safe_path(project_root, RESEARCH_DIR, "evaluations", "decision-criteria.md")


def load_decision_criteria(project_root: str) -> ParsedFile | None:
    p = decision_criteria_path(project_root)
    if not os.path.exists(p):
        return None
    return read_markdown(p)


# ── Peer Review ───────────────────────────────────────────────────────────────


def peer_review_path(project_root: str) -> str:
    return safe_path(project_root, RESEARCH_DIR, "evaluations", "peer-review.md")


def peer_review_exists(project_root: str) -> bool:
    return os.path.exists(peer_review_path(project_root))


# ── Scoring Matrix ────────────────────────────────────────────────────────────


def scoring_matrix_path(project_root: str) -> str:
    return safe_path(project_root, RESEARCH_DIR, "evaluations", "scoring-matrix.md")


# ── Section extraction ────────────────────────────────────────────────────────


def extract_section(content: str, heading: str) -> str:
    lines = content.split("\n")
    heading_line = f"## {heading}"
    in_section = False
    section_lines = []

    for line in lines:
        if line.strip() == heading_line:
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section:
            section_lines.append(line)

    return "\n".join(section_lines).strip()


def section_has_content(content: str, heading: str) -> bool:
    text = extract_section(content, heading)
    if not text:
        return False
    stripped = (
        text.replace("_None documented yet._", "")
        .replace("_To be determined._", "")
        .replace("_TBD_", "")
        .strip()
    )
    return len(stripped) > 0
