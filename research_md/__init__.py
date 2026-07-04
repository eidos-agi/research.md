"""research.md — the decision forge. Evidence-graded, phase-gated, peer-reviewed decisions."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("research-md")
except PackageNotFoundError:  # running from source without an install
    __version__ = "0.0.0+unknown"
