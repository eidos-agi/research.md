"""Integration tests — exercise finding_create/finding_update/candidate_create through the server functions."""

import pytest

from research_md.config import init_project, register_project, _guid_to_path
from research_md.server import finding_create, finding_update, candidate_create
from research_md.errors import ResearchGateError


@pytest.fixture
def project(tmp_path):
    """Create a temporary research project and register it."""
    project_path = str(tmp_path)
    init_project(project_path, "test-project", "Test question?", "Test context")
    info = register_project(project_path)
    yield info["id"], project_path
    # Cleanup registered GUID
    _guid_to_path.pop(info["id"], None)


# ── finding_create ───────────────────────────────────────────────────────────


class TestFindingCreate:
    def test_unverified_no_sources_returns_nudge(self, project):
        pid, _ = project
        result = finding_create(pid, "Test claim", "Something is true")
        assert "Finding created" in result
        assert "UNVERIFIED" in result
        assert "WebSearch" in result  # web research nudge

    def test_low_no_sources_returns_nudge(self, project):
        pid, _ = project
        result = finding_create(pid, "Test claim", "Something is true", evidence="LOW")
        assert "WebSearch" in result

    def test_moderate_with_hash_no_nudge(self, project):
        pid, _ = project
        result = finding_create(
            pid, "Test claim", "Something is true",
            evidence="MODERATE",
            source="https://example.com (content_hash:abcd1234)",
        )
        assert "Finding created" in result
        assert "WebSearch" not in result

    def test_high_single_source_blocked(self, project):
        pid, _ = project
        with pytest.raises(ResearchGateError, match="2\\+ independent sources"):
            finding_create(
                pid, "Test claim", "Something is true",
                evidence="HIGH",
                sources=[{"text": "https://a.com (content_hash:abcd1234)", "tier": "PRIMARY"}],
                disconfirmation="Looked for counter-evidence.",
            )

    def test_high_no_disconfirmation_blocked(self, project):
        pid, _ = project
        with pytest.raises(ResearchGateError, match="disconfirmation"):
            finding_create(
                pid, "Test claim", "Something is true",
                evidence="HIGH",
                sources=[
                    {"text": "https://a.com (content_hash:abcd1234)", "tier": "PRIMARY"},
                    {"text": "https://b.com (content_hash:efgh5678)", "tier": "EXPERT"},
                ],
            )

    def test_high_with_everything_succeeds(self, project):
        pid, _ = project
        result = finding_create(
            pid, "Validated claim", "Something is confirmed",
            evidence="HIGH",
            sources=[
                {"text": "https://a.com (content_hash:abcd1234)", "tier": "PRIMARY"},
                {"text": "https://b.com (content_hash:efgh5678)", "tier": "EXPERT"},
            ],
            disconfirmation="Searched 'why X fails' — found nothing contradicting the claim.",
        )
        assert "Finding created" in result
        assert "HIGH" in result

    def test_vendor_only_sources_advisory(self, project):
        pid, _ = project
        result = finding_create(
            pid, "Vendor claim", "Product X is best",
            evidence="LOW",
            sources=[
                {"text": "https://vendor.com/blog (content_hash:abcd1234)", "tier": "VENDOR"},
            ],
        )
        assert "vendor-produced" in result


# ── finding_update ───────────────────────────────────────────────────────────


class TestFindingUpdate:
    def test_upgrade_to_high_without_sources_blocked(self, project):
        pid, _ = project
        finding_create(pid, "Initial claim", "Something", evidence="LOW")
        with pytest.raises(ResearchGateError, match="2\\+ independent sources"):
            finding_update(pid, "1", evidence="HIGH")

    def test_upgrade_to_high_with_sources_and_disconfirmation(self, project):
        pid, _ = project
        finding_create(pid, "Initial claim", "Something", evidence="LOW")
        result = finding_update(
            pid, "1",
            evidence="HIGH",
            sources=[
                {"text": "https://a.com (content_hash:abcd1234)", "tier": "PRIMARY"},
                {"text": "https://b.com (content_hash:efgh5678)", "tier": "EXPERT"},
            ],
            disconfirmation="Searched for counter-evidence, found none relevant.",
        )
        assert "updated" in result

    def test_update_low_no_sources_gets_nudge(self, project):
        pid, _ = project
        finding_create(pid, "Initial claim", "Something")
        result = finding_update(pid, "1", evidence="LOW")
        assert "WebSearch" in result

    def test_add_disconfirmation_to_existing(self, project):
        pid, _ = project
        finding_create(pid, "Claim", "Test", evidence="LOW")
        result = finding_update(pid, "1", disconfirmation="Searched X, found Y.")
        assert "updated" in result


# ── candidate_create ─────────────────────────────────────────────────────────


class TestCandidateCreate:
    def test_first_candidate_gets_landscape_advisory(self, project):
        pid, _ = project
        result = candidate_create(pid, "Option A")
        assert "Candidate created" in result
        assert "first candidate" in result
        assert "landscape" in result

    def test_second_candidate_no_advisory(self, project):
        pid, _ = project
        candidate_create(pid, "Option A")
        result = candidate_create(pid, "Option B")
        assert "Candidate created" in result
        assert "first candidate" not in result
