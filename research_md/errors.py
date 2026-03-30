"""Structured error types for research.md."""

import os
from typing import Any


class ResearchError(Exception):
    def __init__(self, message: str, code: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details


class ResearchValidationError(ResearchError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, "VALIDATION_ERROR", details)


class ResearchGateError(ResearchError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, "GATE_ERROR", details)


class ResearchNotFoundError(ResearchError):
    def __init__(self, entity: str, id: str):
        super().__init__(
            f"{entity} '{id}' not found.", "NOT_FOUND", {"entity": entity, "id": id}
        )


def format_error(err: Exception) -> dict:
    is_debug = bool(os.environ.get("DEBUG"))
    if isinstance(err, ResearchError):
        parts = [f"Error: {err}"]
        if is_debug and err.code:
            parts.append(f"Code: {err.code}")
        if is_debug and err.details:
            import json

            parts.append(f"Details: {json.dumps(err.details)}")
        return {
            "content": [{"type": "text", "text": "\n".join(parts)}],
            "isError": True,
        }
    return {"content": [{"type": "text", "text": f"Error: {err}"}], "isError": True}
