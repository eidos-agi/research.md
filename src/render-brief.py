#!/usr/bin/env python3
"""
render-brief.py — Convert a research BRIEF.md to a beautiful branded PDF.

Uses pdf_brand.py (research.md's own brand library) for BrandHeader,
AccentBox, StatCard, LayerCard, and branded tables.

Usage:
    python3 render-brief.py BRIEF.md
    python3 render-brief.py BRIEF.md --brand connection-forge
    python3 render-brief.py BRIEF.md --brand-color "#193B2D" --brand-name "My Co"
    python3 render-brief.py BRIEF.md --logo logo.png -o output.pdf
"""

import argparse
import os
import re
import sys
from pathlib import Path

# Import our brand library (same directory)
sys.path.insert(0, str(Path(__file__).parent))
from pdf_brand import (
    Brand, BrandHeader, AccentBox, StatCard, LayerCard,
    tbl, hr, make_footer, USABLE, MARGIN, W, H,
)

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import white
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, CondPageBreak,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER


# Box-drawing characters for diagram detection
BOX_CHARS = set('┌┐└┘├┤┬┴─│╭╮╰╯║═╔╗╚╝╠╣╦╩')


def inline_markup(text, brand):
    """Convert inline markdown to reportlab XML."""
    hex_c = brand.primary.hexval() if hasattr(brand.primary, 'hexval') else "#37474F"
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<b><i>\1</i></b>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    text = re.sub(r'`([^`]+)`', rf'<font face="Courier" size="7" color="{hex_c}">\1</font>', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'<u>\1</u>', text)
    text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    for tag in ['b', 'i', 'u', 'font']:
        text = text.replace(f'&lt;{tag}&gt;', f'<{tag}>')
        text = text.replace(f'&lt;{tag} ', f'<{tag} ')
        text = text.replace(f'&lt;/{tag}&gt;', f'</{tag}>')
    text = re.sub(r'<font([^&]*?)&gt;', r'<font\1>', text)
    return text


def parse_markdown(md_text):
    """Parse markdown into block tokens."""
    blocks = []
    lines = md_text.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if re.match(r'^---+\s*$', line):
            blocks.append({'type': 'hr'})
            i += 1
            continue
        m = re.match(r'^(#{1,4})\s+(.*)', line)
        if m:
            blocks.append({'type': f'h{len(m.group(1))}', 'text': m.group(2).strip()})
            i += 1
            continue
        if re.match(r'^>\s+', line):
            quote_lines = []
            while i < len(lines) and (lines[i].startswith('>') or (lines[i].strip() and quote_lines)):
                quote_lines.append(re.sub(r'^>\s*', '', lines[i]))
                i += 1
            blocks.append({'type': 'blockquote', 'text': ' '.join(quote_lines)})
            continue
        if '|' in line and line.strip().startswith('|'):
            table_lines = []
            while i < len(lines) and '|' in lines[i] and lines[i].strip().startswith('|'):
                table_lines.append(lines[i])
                i += 1
            blocks.append({'type': 'table', 'lines': table_lines})
            continue
        if line.strip().startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1
            blocks.append({'type': 'code', 'text': '\n'.join(code_lines)})
            continue
        m = re.match(r'^(\s*)[-*]\s+(.*)', line)
        if m:
            items = []
            while i < len(lines) and re.match(r'^(\s*)[-*]\s+(.*)', lines[i]):
                bm = re.match(r'^(\s*)[-*]\s+(.*)', lines[i])
                items.append(bm.group(2).strip())
                i += 1
            blocks.append({'type': 'bullets', 'items': items})
            continue
        m = re.match(r'^(\s*)\d+\.\s+(.*)', line)
        if m:
            items = []
            while i < len(lines) and re.match(r'^(\s*)\d+\.\s+(.*)', lines[i]):
                nm = re.match(r'^(\s*)\d+\.\s+(.*)', lines[i])
                items.append(nm.group(2).strip())
                i += 1
            blocks.append({'type': 'numbered', 'items': items})
            continue
        para_lines = []
        while i < len(lines) and lines[i].strip() and not lines[i].startswith('#') \
                and not lines[i].startswith('|') and not re.match(r'^---', lines[i]) \
                and not re.match(r'^[-*]\s+', lines[i]) and not re.match(r'^\d+\.\s+', lines[i]) \
                and not lines[i].startswith('>') and not lines[i].strip().startswith('```'):
            para_lines.append(lines[i])
            i += 1
        if para_lines:
            text = ' '.join(para_lines)
            if text.startswith('**Verdict:**'):
                blocks.append({'type': 'verdict', 'text': text})
            elif text.startswith('**Evidence:**'):
                blocks.append({'type': 'evidence', 'text': text})
            else:
                blocks.append({'type': 'paragraph', 'text': text})
    return blocks


def parse_table_data(table_lines):
    """Parse pipe-delimited table into header + rows."""
    rows = []
    for line in table_lines:
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        rows.append(cells)
    if len(rows) < 2:
        return rows, False
    if all(re.match(r'^[-:]+$', c.strip()) for c in rows[1] if c.strip()):
        return [rows[0]] + rows[2:], True
    return rows, False


def parse_layer_diagram(code_text):
    """Parse ASCII box-drawing layer diagram into structured data."""
    layers = []
    current = None
    for line in code_text.split('\n'):
        stripped = line.strip()
        for ch in BOX_CHARS:
            stripped = stripped.replace(ch, '')
        stripped = stripped.strip()
        if not stripped:
            continue
        m = re.match(r'LAYER\s+(\d+):\s+(.*)', stripped)
        if m:
            if current:
                layers.append(current)
            current = {'number': m.group(1), 'name': m.group(2).strip(),
                       'pattern': '', 'desc_lines': [], 'read_time': ''}
            continue
        if current is None:
            continue
        pm = re.match(r'Pattern:\s+(.*)', stripped)
        if pm:
            current['pattern'] = pm.group(1).strip()
            continue
        rm = re.match(r'Read time:\s+(.*)', stripped)
        if rm:
            current['read_time'] = rm.group(1).strip()
            continue
        if stripped:
            current['desc_lines'].append(stripped)
    if current:
        layers.append(current)
    return layers if layers else None


def validate_design_rules(md_text, md_path):
    """Check markdown against REPORT-DESIGN.md rules. Prints warnings, never blocks."""
    warnings = []
    lines = md_text.split('\n')

    # Rule: Never say "production-ready"
    for i, line in enumerate(lines, 1):
        if 'production-ready' in line.lower():
            warnings.append(f"  Line {i}: Contains 'production-ready' — use 'specification complete' framing")

    # Rule: Headings should be sentences (McKinsey action titles)
    # Check H2/H3 headings — labels like "What It Does" or "Key Findings" are weaker
    # than sentences like "Every field carries a confidence level."
    label_patterns = [
        r'^#{2,3}\s+(What|How|Key|The|All|Complete|Appendix)\s',
    ]
    for i, line in enumerate(lines, 1):
        m = re.match(r'^(#{2,3})\s+(.*)', line)
        if m:
            heading = m.group(2).strip()
            # Heuristic: headings under 5 words without a verb are likely labels
            words = heading.split()
            if len(words) <= 3 and not heading.endswith('.') and not heading.endswith('?'):
                warnings.append(f"  Line {i}: Heading '{heading}' may be a label, not an action title")

    # Rule: No tables in narrative body (only after last --- or in Appendix)
    in_appendix = False
    last_hr_line = 0
    for i, line in enumerate(lines, 1):
        if line.strip().startswith('## Appendix'):
            in_appendix = True
        if re.match(r'^---+\s*$', line):
            last_hr_line = i
    for i, line in enumerate(lines, 1):
        if line.strip().startswith('|') and '|' in line and not in_appendix:
            # Check if this table is before the appendix sections
            is_pre_appendix = True
            for j in range(i, len(lines)):
                if lines[j].strip().startswith('## Appendix'):
                    break
            else:
                is_pre_appendix = False
            # Allow tables that are directly after an Appendix heading
            prev_heading = ''
            for j in range(i - 1, -1, -1):
                if lines[j].strip().startswith('## '):
                    prev_heading = lines[j]
                    break
            if 'Appendix' not in prev_heading and 'Methodology' not in prev_heading:
                # Check if separator line (---|---) — skip those
                if not re.match(r'^\|[-:\s|]+\|$', line.strip()):
                    warnings.append(f"  Line {i}: Table in narrative body — consider moving to appendix")
                    break  # Only warn once about body tables

    # Rule: Staleness / data freshness should appear in header area (first 10 lines)
    header_area = '\n'.join(lines[:15])
    if 'current as of' not in header_area.lower() and 'generated' not in header_area.lower():
        warnings.append("  No data freshness indicator in header area — add 'Data current as of YYYY-MM-DD'")

    # Rule: Bold first sentence per section (inverted pyramid)
    # Check that the first paragraph after each H2 starts with **bold**
    for i, line in enumerate(lines):
        if re.match(r'^##\s+', line) and not line.strip().startswith('## Appendix'):
            # Find next non-empty line that's not a heading
            for j in range(i + 1, min(i + 5, len(lines))):
                content = lines[j].strip()
                if content and not content.startswith('#') and not content.startswith('---'):
                    if not content.startswith('**'):
                        warnings.append(f"  Line {j + 1}: First paragraph after heading doesn't start bold — inverted pyramid rule")
                    break

    if warnings:
        print(f"\n⚠ Design rule warnings for {os.path.basename(md_path)}:", file=sys.stderr)
        for w in warnings:
            print(w, file=sys.stderr)
        print(f"  ({len(warnings)} warning(s) — see REPORT-DESIGN.md)\n", file=sys.stderr)
    else:
        print(f"✓ {os.path.basename(md_path)} passes design rule checks", file=sys.stderr)

    return warnings


def render_brief(md_path, brand, output_path=None):
    """Render BRIEF.md to a beautiful branded PDF."""
    if not os.path.exists(md_path):
        print(f"Error: {md_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(md_path) as f:
        md_text = f.read()

    # Validate design rules before rendering
    validate_design_rules(md_text, md_path)

    if not output_path:
        output_path = os.path.splitext(md_path)[0] + '.pdf'

    styles = brand.styles()
    blocks = parse_markdown(md_text)

    # Extract title from first H1
    title = "Research Brief"
    subtitle = ""
    for b in blocks:
        if b['type'] == 'h1':
            title = b['text'].replace('Research Brief: ', '')
            break

    def build(story):
        # Branded header
        story.append(BrandHeader(brand, title, f"Generated {__import__('datetime').date.today()}"))
        story.append(Spacer(1, 20))

        i = 0
        while i < len(blocks):
            block = blocks[i]
            btype = block['type']

            if btype == 'h1':
                # Skip — handled by BrandHeader
                i += 1

            elif btype == 'h2':
                story.append(CondPageBreak(1.5 * inch))
                story.append(Spacer(1, 8))
                # Check if the next blocks are paragraph + table — keep them together
                # to prevent orphaned headings (e.g. "Design Rules" + intro + table)
                h2_flowables = [
                    HRFlowable(width='100%', thickness=1.5,
                               color=brand.primary, spaceAfter=6, spaceBefore=2),
                    Paragraph(inline_markup(block['text'], brand), styles['h2']),
                ]
                # Peek ahead: paragraph then table?
                if (i + 2 < len(blocks)
                        and blocks[i + 1]['type'] == 'paragraph'
                        and blocks[i + 2]['type'] == 'table'):
                    next_para = blocks[i + 1]
                    next_tbl = blocks[i + 2]
                    h2_flowables.append(
                        Paragraph(inline_markup(next_para['text'], brand), styles['body']))
                    h2_flowables.append(Spacer(1, 4))
                    # Build the table
                    rows_data, has_header = parse_table_data(next_tbl['lines'])
                    if rows_data and has_header and len(rows_data) > 1:
                        num_cols = max(len(r) for r in rows_data)
                        rows_data = [r + [''] * (num_cols - len(r)) for r in rows_data]
                        header_row = [Paragraph(inline_markup(c, brand), styles['cell_header'])
                                      for c in rows_data[0]]
                        body_rows = [[Paragraph(inline_markup(c, brand), styles['cell'])
                                      for c in row] for row in rows_data[1:]]
                        col_w = USABLE / num_cols
                        t = tbl(brand, header_row, body_rows, [col_w] * num_cols)
                        h2_flowables.append(t)
                    story.append(KeepTogether(h2_flowables))
                    story.append(Spacer(1, 10))
                    i += 3  # skip h2 + paragraph + table
                else:
                    story.extend(h2_flowables)
                    i += 1

            elif btype == 'h3':
                story.append(Paragraph(inline_markup(block['text'], brand), styles['h3']))
                i += 1

            elif btype == 'h4':
                # H4 = finding/item header — render as AccentBox for visual distinction
                story.append(Spacer(1, 6))
                story.append(AccentBox(brand, inline_markup(block['text'], brand), bold=True, size=9))
                i += 1

            elif btype == 'hr':
                # HR rules in Connection Forge reports mark layer boundaries — page break
                from reportlab.platypus import PageBreak
                story.append(PageBreak())
                i += 1

            elif btype == 'verdict':
                story.append(AccentBox(brand, inline_markup(block['text'], brand), bold=True, size=10))
                story.append(Spacer(1, 8))
                i += 1

            elif btype == 'evidence':
                # Parse hero metrics from evidence line and render as StatCards
                # e.g. "**Evidence:** 19 findings (14 HIGH, 5 MODERATE) | 5 candidates scored | Peer reviewed: Yes"
                raw = block['text']
                stats = []
                # Total findings
                m_findings = re.search(r'(\d+)\s+findings', raw)
                if m_findings:
                    stats.append((m_findings.group(1), "Findings"))
                # HIGH evidence count
                m_high = re.search(r'(\d+)\s+HIGH', raw)
                if m_high:
                    stats.append((m_high.group(1), "HIGH Evidence"))
                # Candidates
                m_cand = re.search(r'(\d+)\s+candidates', raw)
                if m_cand:
                    stats.append((m_cand.group(1), "Candidates"))
                # Peer reviewed
                m_peer = re.search(r'Peer review(?:ed)?:\s*(Yes|No)', raw, re.IGNORECASE)
                if m_peer:
                    stats.append((m_peer.group(1), "Peer Reviewed"))
                if stats:
                    story.append(StatCard(brand, stats))
                else:
                    story.append(Paragraph(inline_markup(raw, brand), styles['meta']))
                story.append(Spacer(1, 14))
                i += 1

            elif btype == 'blockquote':
                story.append(AccentBox(brand, inline_markup(block['text'], brand), bold=False, size=9))
                story.append(Spacer(1, 4))
                i += 1

            elif btype == 'paragraph':
                text = block['text']
                # Detect "Rationale:" lines — render as accent box
                if text.startswith('**Rationale:**'):
                    story.append(AccentBox(brand, inline_markup(text, brand),
                                           bold=False, size=8,
                                           bg=brand.primary_light,
                                           border=brand.muted,
                                           text_color=brand.dark))
                else:
                    story.append(Paragraph(inline_markup(text, brand), styles['body']))
                story.append(Spacer(1, 2))
                i += 1

            elif btype == 'bullets':
                for item in block['items']:
                    # Detect **title** — body pattern
                    m = re.match(r'^(\*\*[^*]+\*\*)\s*[—–-]\s*(.*)', item)
                    if m:
                        # Title as AccentBox, body as paragraph
                        title_text = m.group(1)
                        body_text = m.group(2)
                        markup = inline_markup(title_text, brand)
                        story.append(AccentBox(brand, markup, bold=True, size=9))
                        if body_text:
                            story.append(Paragraph(inline_markup(body_text, brand), styles['body']))
                        story.append(Spacer(1, 10))
                    else:
                        story.append(Paragraph(
                            f'<bullet>&bull;</bullet> {inline_markup(item, brand)}',
                            styles['bullet']
                        ))
                i += 1

            elif btype == 'numbered':
                for idx, item in enumerate(block['items'], 1):
                    story.append(Paragraph(
                        f'<bullet>{idx}.</bullet> {inline_markup(item, brand)}',
                        styles['bullet']
                    ))
                i += 1

            elif btype == 'code':
                code_text = block['text']
                # Detect layer diagrams
                if any(ch in code_text for ch in BOX_CHARS):
                    layers = parse_layer_diagram(code_text)
                    if layers:
                        cards = []
                        for idx, layer in enumerate(layers):
                            cards.append(LayerCard(
                                brand,
                                number=layer['number'],
                                name=layer['name'],
                                pattern=layer['pattern'],
                                description=' '.join(layer['desc_lines']),
                                read_time=layer['read_time'],
                                is_even=(idx % 2 == 0),
                            ))
                            cards.append(Spacer(1, 4))
                        story.extend(cards)
                        i += 1
                        continue

                # Regular code block
                escaped = code_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                escaped = escaped.replace('\n', '<br/>')
                story.append(Paragraph(escaped, styles['mono']))
                story.append(Spacer(1, 4))
                i += 1

            elif btype == 'table':
                rows_data, has_header = parse_table_data(block['lines'])
                if rows_data and has_header and len(rows_data) > 1:
                    num_cols = max(len(r) for r in rows_data)
                    rows_data = [r + [''] * (num_cols - len(r)) for r in rows_data]
                    header = [Paragraph(inline_markup(c, brand), styles['cell_header'])
                              for c in rows_data[0]]
                    body = [[Paragraph(inline_markup(c, brand), styles['cell'])
                             for c in row] for row in rows_data[1:]]
                    col_w = USABLE / num_cols
                    t = tbl(brand, header, body, [col_w] * num_cols)
                    story.append(Spacer(1, 8))
                    story.append(KeepTogether([t]))
                    story.append(Spacer(1, 10))
                i += 1

            else:
                i += 1

    doc = SimpleDocTemplate(str(output_path), pagesize=letter,
                            leftMargin=MARGIN, rightMargin=MARGIN,
                            topMargin=MARGIN, bottomMargin=0.6 * inch)
    story = []
    build(story)
    footer = make_footer(brand)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"PDF saved: {output_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Render research brief to branded PDF')
    parser.add_argument('brief_path', help='Path to BRIEF.md')
    parser.add_argument('--brand', choices=list(Brand.PRESETS.keys()), default='research')
    parser.add_argument('--brand-color', help='Override primary brand color (hex)')
    parser.add_argument('--brand-name', help='Override brand name')
    parser.add_argument('--logo', help='Path to logo PNG')
    parser.add_argument('--output', '-o', help='Output PDF path')
    args = parser.parse_args()

    brand = Brand.from_preset(args.brand)
    if args.brand_color:
        brand = Brand.from_preset(args.brand, primary=args.brand_color)
    if args.brand_name:
        brand.name = args.brand_name
        brand.footer_text = args.brand_name
    if args.logo:
        brand.logo_path = args.logo

    render_brief(args.brief_path, brand, output_path=args.output)
