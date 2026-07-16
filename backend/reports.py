"""
Report export — real PDF generation via reportlab (already a dependency;
no new package needed), plus the existing Excel export in app.py. A report
freezes a snapshot of its source (a corpus narrative, or a drafting
workspace's evidence set) at build time, so is_stale() can tell you
truthfully whether the underlying evidence has moved since — not a fake
"Stale" label, an actual comparison against what's in the DB right now.
"""

import os
import time

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

import db
import evidence as evidence_mod

REPORTS_DIR = os.path.join(os.path.dirname(__file__), "generated_reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

_styles = getSampleStyleSheet()
_styles.add(ParagraphStyle("ReportTitle", parent=_styles["Title"], fontSize=22, spaceAfter=6))
_styles.add(ParagraphStyle("ReportDek", parent=_styles["Normal"], fontSize=11, textColor=colors.HexColor("#4a4a52"), spaceAfter=18))
_styles.add(ParagraphStyle("SectionHead", parent=_styles["Heading2"], fontSize=14, spaceBefore=16, spaceAfter=6))
_styles.add(ParagraphStyle("Body", parent=_styles["Normal"], fontSize=10.5, leading=15, spaceAfter=8))
_styles.add(ParagraphStyle("Caveat", parent=_styles["Normal"], fontSize=9.5, textColor=colors.HexColor("#9a6412"), leftIndent=10, spaceAfter=4))
_styles.add(ParagraphStyle("Meta", parent=_styles["Normal"], fontSize=9, textColor=colors.HexColor("#8a8a95"), spaceAfter=14))


def _build_narrative_pdf(story: list, narrative: dict):
    story.append(Paragraph(narrative["thesis"], _styles["ReportTitle"]))
    story.append(Paragraph(f"Status: {narrative['status']} &nbsp;&middot;&nbsp; "
                            f"{len(narrative['dashboards'])} dashboards", _styles["Meta"]))
    for d in narrative["dashboards"]:
        story.append(Paragraph(f"{d['title']}: {d['question']}", _styles["SectionHead"]))
        story.append(Paragraph(d["take"], _styles["Body"]))
        for p in d["panels"]:
            if p.get("title"):
                story.append(Paragraph(f"<b>{p['title']}</b>", _styles["Body"]))
            if p.get("narrative"):
                story.append(Paragraph(p["narrative"], _styles["Body"]))
            stats = p.get("stats") or {}
            if stats:
                rows = [[k, str(v)] for k, v in list(stats.items())[:10]]
                t = Table([["Statistic", "Value"]] + rows, colWidths=[220, 220])
                t.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f3f6")),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#ebebef")),
                    ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]))
                story.append(t)
                story.append(Spacer(1, 8))
            for c in (p.get("caveats") or []):
                story.append(Paragraph(f"&#9888; {c}", _styles["Caveat"]))


def _build_workspace_pdf(story: list, ws: dict):
    story.append(Paragraph(ws["title"], _styles["ReportTitle"]))
    story.append(Paragraph(ws.get("thesis") or "", _styles["ReportDek"]))
    story.append(Paragraph(f"Audience: {ws['audience']} &nbsp;&middot;&nbsp; Lens: {ws['lens']} "
                            f"&nbsp;&middot;&nbsp; Status: {ws['status']}", _styles["Meta"]))
    for b in ws.get("blocks") or []:
        if b.get("type") in ("title",):
            continue
        story.append(Paragraph(b.get("text", ""), _styles["Body"]))
    if ws.get("evidence_ids"):
        story.append(Paragraph("Evidence", _styles["SectionHead"]))
        for ev in evidence_mod.get_bulk(ws["evidence_ids"]):
            story.append(Paragraph(f"<b>[{ev['kind']}]</b> {ev['claim']}", _styles["Body"]))
            for lim in (ev.get("limitations") or []):
                story.append(Paragraph(f"&#9888; {lim}", _styles["Caveat"]))


def generate_pdf(sid: str, source_type: str, source_id: str) -> dict:
    if source_type == "narrative":
        narrative = db.get_narrative(source_id)
        if narrative is None:
            return {"status": "error", "error": "unknown narrative"}
        name = narrative["thesis"][:70]
        snapshot = {"status": narrative["status"]}
    elif source_type == "workspace":
        ws = db.get_workspace(source_id)
        if ws is None:
            return {"status": "error", "error": "unknown workspace"}
        name = ws["title"]
        snapshot = {"evidence_ids": sorted(ws["evidence_ids"]), "status": ws["status"]}
    else:
        return {"status": "error", "error": f"unknown source_type {source_type!r}"}

    rid = db.new_id("rpt")
    file_path = os.path.join(REPORTS_DIR, f"{rid}.pdf")
    doc = SimpleDocTemplate(file_path, pagesize=LETTER, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
    story = []
    if source_type == "narrative":
        _build_narrative_pdf(story, narrative)
    else:
        _build_workspace_pdf(story, ws)
    doc.build(story)

    row = db.create_report(sid, name, "pdf", source_type, source_id, snapshot, file_path)
    return {"status": "ok", "report": row}


def is_stale(report: dict) -> bool:
    if report["source_type"] != "workspace":
        return False  # corpus narratives are immutable once generated
    ws = db.get_workspace(report["source_id"])
    if ws is None:
        return True
    snap = report["source_snapshot"]
    return sorted(ws["evidence_ids"]) != snap.get("evidence_ids", []) or ws["status"] != snap.get("status")


def list_for_session(sid: str) -> list:
    rows = db.list_reports(sid)
    for r in rows:
        r["stale"] = is_stale(r)
    return rows
