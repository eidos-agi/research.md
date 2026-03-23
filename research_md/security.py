"""Path traversal prevention and slug sanitization."""

import os
import re


def safe_path(root: str, *parts: str) -> str:
    resolved = os.path.normpath(os.path.join(os.path.abspath(root), *parts))
    if not resolved.startswith(os.path.abspath(root)):
        raise ValueError(f"Path traversal attempt detected: {'/'.join(parts)}")
    return resolved


def sanitize_slug(slug: str) -> str:
    s = slug.lower()
    s = re.sub(r"[^a-z0-9\-_]", "-", s)
    s = re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s


def pad_id(n: int, width: int = 4) -> str:
    return str(n).zfill(width)
