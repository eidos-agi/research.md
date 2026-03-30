"""Tests for evidence gathering gates — triangulation, disconfirmation, vendor advisory."""

import pytest
from research_md.gates import (
    gate_confirmed_triangulation,
    gate_confirmed_disconfirmation,
    gate_reasoned_has_source,
    gate_vendor_only_advisory,
    run_evidence_gates,
)


# ── gate_confirmed_triangulation ─────────────────────────────────────────────


class TestTriangulationGate:
    def test_high_with_two_sources_passes(self):
        fm = {
            "evidence": "CONFIRMED",
            "sources": [
                {"text": "source1 (content_hash:abc12345)", "tier": "PRIMARY"},
                {"text": "source2 (content_hash:def67890)", "tier": "EXPERT"},
            ],
        }
        assert gate_confirmed_triangulation(fm)["passed"] is True

    def test_high_with_one_source_fails(self):
        fm = {
            "evidence": "CONFIRMED",
            "sources": [{"text": "source1 (content_hash:abc12345)", "tier": "PRIMARY"}],
        }
        result = gate_confirmed_triangulation(fm)
        assert result["passed"] is False
        assert "2+ independent sources" in result["error"]

    def test_high_with_zero_sources_fails(self):
        fm = {"evidence": "CONFIRMED", "sources": []}
        result = gate_confirmed_triangulation(fm)
        assert result["passed"] is False

    def test_high_with_legacy_numeric_one_fails(self):
        fm = {"evidence": "CONFIRMED", "sources": 1}
        result = gate_confirmed_triangulation(fm)
        assert result["passed"] is False

    def test_high_with_legacy_numeric_two_passes(self):
        fm = {"evidence": "CONFIRMED", "sources": 2}
        result = gate_confirmed_triangulation(fm)
        assert result["passed"] is True

    def test_moderate_skips_gate(self):
        fm = {"evidence": "REASONED", "sources": []}
        assert gate_confirmed_triangulation(fm)["passed"] is True

    def test_low_skips_gate(self):
        fm = {"evidence": "LOW", "sources": 0}
        assert gate_confirmed_triangulation(fm)["passed"] is True

    def test_unverified_skips_gate(self):
        fm = {"evidence": "UNVERIFIED"}
        assert gate_confirmed_triangulation(fm)["passed"] is True


# ── gate_confirmed_disconfirmation ───────────────────────────────────────────


class TestDisconfirmationGate:
    def test_high_with_disconfirmation_passes(self):
        fm = {"evidence": "CONFIRMED", "disconfirmation": "Searched for X, found Y."}
        assert gate_confirmed_disconfirmation(fm)["passed"] is True

    def test_high_without_disconfirmation_fails(self):
        fm = {"evidence": "CONFIRMED", "disconfirmation": None}
        result = gate_confirmed_disconfirmation(fm)
        assert result["passed"] is False
        assert "disconfirmation search" in result["error"]

    def test_high_with_empty_disconfirmation_fails(self):
        fm = {"evidence": "CONFIRMED", "disconfirmation": "   "}
        result = gate_confirmed_disconfirmation(fm)
        assert result["passed"] is False

    def test_high_with_missing_disconfirmation_key_fails(self):
        fm = {"evidence": "CONFIRMED"}
        result = gate_confirmed_disconfirmation(fm)
        assert result["passed"] is False

    def test_moderate_skips_gate(self):
        fm = {"evidence": "REASONED", "disconfirmation": None}
        assert gate_confirmed_disconfirmation(fm)["passed"] is True

    def test_low_skips_gate(self):
        fm = {"evidence": "LOW"}
        assert gate_confirmed_disconfirmation(fm)["passed"] is True


# ── gate_vendor_only_advisory ────────────────────────────────────────────────


class TestVendorAdvisory:
    def test_all_vendor_sources_warns(self):
        fm = {
            "sources": [
                {"text": "vendor blog", "tier": "VENDOR"},
                {"text": "vendor whitepaper", "tier": "VENDOR"},
            ],
        }
        result = gate_vendor_only_advisory(fm)
        assert result is not None
        assert "vendor-produced" in result

    def test_mixed_sources_no_warning(self):
        fm = {
            "sources": [
                {"text": "vendor blog", "tier": "VENDOR"},
                {"text": "academic paper", "tier": "PRIMARY"},
            ],
        }
        assert gate_vendor_only_advisory(fm) is None

    def test_no_vendor_sources_no_warning(self):
        fm = {
            "sources": [
                {"text": "RFC spec", "tier": "PRIMARY"},
                {"text": "expert analysis", "tier": "EXPERT"},
            ],
        }
        assert gate_vendor_only_advisory(fm) is None

    def test_empty_sources_no_warning(self):
        fm = {"sources": []}
        assert gate_vendor_only_advisory(fm) is None

    def test_legacy_numeric_sources_no_warning(self):
        fm = {"sources": 2}
        assert gate_vendor_only_advisory(fm) is None

    def test_no_sources_key_no_warning(self):
        fm = {}
        assert gate_vendor_only_advisory(fm) is None


# ── run_evidence_gates ───────────────────────────────────────────────────────


class TestRunEvidenceGates:
    def test_high_with_everything_passes(self):
        fm = {
            "evidence": "CONFIRMED",
            "sources": [
                {"text": "s1 (content_hash:abc12345)", "tier": "PRIMARY"},
                {"text": "s2 (content_hash:def67890)", "tier": "EXPERT"},
            ],
            "disconfirmation": "Searched for counter-evidence, found none.",
        }
        assert run_evidence_gates(fm)["passed"] is True

    def test_high_missing_sources_fails_first(self):
        fm = {
            "evidence": "CONFIRMED",
            "sources": [{"text": "s1", "tier": "PRIMARY"}],
            "disconfirmation": "Searched for counter-evidence.",
        }
        result = run_evidence_gates(fm)
        assert result["passed"] is False
        assert "2+ independent sources" in result["error"]

    def test_high_missing_disconfirmation_fails(self):
        fm = {
            "evidence": "CONFIRMED",
            "sources": [
                {"text": "s1", "tier": "PRIMARY"},
                {"text": "s2", "tier": "EXPERT"},
            ],
            "disconfirmation": None,
        }
        result = run_evidence_gates(fm)
        assert result["passed"] is False
        assert "disconfirmation" in result["error"]

    def test_reasoned_with_source_passes(self):
        fm = {"evidence": "REASONED", "sources": [{"text": "s1", "tier": "PRIMARY"}], "disconfirmation": None}
        assert run_evidence_gates(fm)["passed"] is True

    def test_reasoned_without_source_fails(self):
        fm = {"evidence": "REASONED", "sources": [], "disconfirmation": None}
        result = run_evidence_gates(fm)
        assert result["passed"] is False
        assert "REASONED" in result["error"]

    def test_unverified_always_passes(self):
        fm = {"evidence": "UNVERIFIED"}
        assert run_evidence_gates(fm)["passed"] is True


# ── gate_reasoned_has_source ─────────────────────────────────────────────────


class TestReasonedGate:
    def test_reasoned_with_source_passes(self):
        fm = {"evidence": "REASONED", "sources": [{"text": "s1 (content_hash:abc12345)", "tier": "PRIMARY"}]}
        assert gate_reasoned_has_source(fm)["passed"] is True

    def test_reasoned_without_source_fails(self):
        fm = {"evidence": "REASONED", "sources": []}
        result = gate_reasoned_has_source(fm)
        assert result["passed"] is False
        assert "at least 1 source" in result["error"]

    def test_reasoned_with_legacy_numeric_one_passes(self):
        fm = {"evidence": "REASONED", "sources": 1}
        assert gate_reasoned_has_source(fm)["passed"] is True

    def test_reasoned_with_legacy_numeric_zero_fails(self):
        fm = {"evidence": "REASONED", "sources": 0}
        result = gate_reasoned_has_source(fm)
        assert result["passed"] is False

    def test_low_skips_gate(self):
        fm = {"evidence": "LOW", "sources": []}
        assert gate_reasoned_has_source(fm)["passed"] is True

    def test_unverified_skips_gate(self):
        fm = {"evidence": "UNVERIFIED"}
        assert gate_reasoned_has_source(fm)["passed"] is True

    def test_confirmed_skips_gate(self):
        fm = {"evidence": "CONFIRMED", "sources": []}
        assert gate_reasoned_has_source(fm)["passed"] is True
