"""Tests for YAML serializer — quoting edge cases and list indentation."""

import os
import tempfile

from research_md.files import write_markdown, read_markdown


def _round_trip(frontmatter, content="\nTest content.\n"):
    """Write and read back, return parsed frontmatter."""
    fp = tempfile.mktemp(suffix=".md")
    try:
        write_markdown(fp, frontmatter, content)
        parsed = read_markdown(fp)
        return parsed.frontmatter
    finally:
        os.unlink(fp)


class TestYamlQuoting:
    def test_string_with_colon_is_quoted(self):
        fm = {"key": "value: with colon"}
        result = _round_trip(fm)
        assert result["key"] == "value: with colon"

    def test_content_hash_round_trips(self):
        fm = {"source": "https://example.com (content_hash:abcd1234)"}
        result = _round_trip(fm)
        assert result["source"] == "https://example.com (content_hash:abcd1234)"

    def test_string_with_brackets(self):
        fm = {"note": "array [1, 2, 3] here"}
        result = _round_trip(fm)
        assert result["note"] == "array [1, 2, 3] here"

    def test_string_with_braces(self):
        fm = {"note": "dict {a: b} here"}
        result = _round_trip(fm)
        assert result["note"] == "dict {a: b} here"

    def test_date_string_quoted(self):
        fm = {"created": "2026-03-29"}
        result = _round_trip(fm)
        assert result["created"] == "2026-03-29"

    def test_plain_string_unquoted(self):
        fm = {"title": "simple title"}
        result = _round_trip(fm)
        assert result["title"] == "simple title"

    def test_string_with_hyphen(self):
        fm = {"title": "foo-bar-baz"}
        result = _round_trip(fm)
        assert result["title"] == "foo-bar-baz"

    def test_multiline_disconfirmation(self):
        fm = {"disconfirmation": "Searched for X.\nFound Y.\nConclusion: holds."}
        result = _round_trip(fm)
        assert "Searched for X." in result["disconfirmation"]
        assert "Found Y." in result["disconfirmation"]


class TestYamlListIndentation:
    def test_simple_list_gets_indented(self):
        """Simple string lists should get gray-matter style '  - item' indentation."""
        fm = {"tags": ["alpha", "beta", "gamma"]}
        fp = tempfile.mktemp(suffix=".md")
        try:
            write_markdown(fp, fm, "\nContent.\n")
            with open(fp) as f:
                raw = f.read()
            assert "  - alpha" in raw
            assert "  - beta" in raw
        finally:
            os.unlink(fp)

    def test_nested_dict_list_round_trips(self):
        """Source entries (list of dicts) must round-trip correctly."""
        fm = {
            "sources": [
                {"text": "https://a.com (content_hash:abc12345)", "tier": "PRIMARY"},
                {"text": "https://b.com (content_hash:def67890)", "tier": "EXPERT"},
            ]
        }
        result = _round_trip(fm)
        assert isinstance(result["sources"], list)
        assert len(result["sources"]) == 2
        assert result["sources"][0]["text"] == "https://a.com (content_hash:abc12345)"
        assert result["sources"][0]["tier"] == "PRIMARY"
        assert result["sources"][1]["tier"] == "EXPERT"

    def test_mixed_frontmatter_round_trips(self):
        """Full finding frontmatter with all field types."""
        fm = {
            "id": "0001",
            "title": "Test finding",
            "status": "open",
            "evidence": "CONFIRMED",
            "sources": [
                {"text": "https://example.com/doc (content_hash:abcd1234)", "tier": "PRIMARY"},
                {"text": "https://other.org/paper (content_hash:efgh5678)", "tier": "EXPERT"},
            ],
            "disconfirmation": "Searched for counter-evidence. Found none.",
            "created": "2026-03-29",
        }
        result = _round_trip(fm)
        assert result["id"] == "0001"
        assert result["evidence"] == "CONFIRMED"
        assert len(result["sources"]) == 2
        assert result["disconfirmation"] == "Searched for counter-evidence. Found none."
        assert result["created"] == "2026-03-29"

    def test_empty_sources_list(self):
        fm = {"sources": []}
        result = _round_trip(fm)
        assert result["sources"] == []

    def test_null_disconfirmation_omitted(self):
        """write_markdown skips None values."""
        fm = {"title": "test", "disconfirmation": None}
        result = _round_trip(fm)
        assert "disconfirmation" not in result
