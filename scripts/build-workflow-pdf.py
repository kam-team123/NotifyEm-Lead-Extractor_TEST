from html import escape
from pathlib import Path
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "docs/Notifyem_System_Workflow.md")
OUTPUT = ROOT / (sys.argv[2] if len(sys.argv) > 2 else "docs/Notifyem_System_Workflow.pdf")
DOC_LABEL = "USER GUIDE" if "User_Guide" in SOURCE.stem else "OPERATING GUIDE"

INK = colors.HexColor("#17212b")
MUTED = colors.HexColor("#566575")
CYAN = colors.HexColor("#007f96")
PALE = colors.HexColor("#e8f5f7")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="DocTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=25, leading=29, alignment=TA_LEFT, textColor=INK,
    spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Subtitle", parent=styles["Normal"], fontSize=9, leading=13,
    textColor=CYAN, spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=14, leading=18, textColor=CYAN, spaceBefore=13, spaceAfter=6,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyCopy", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9, leading=13, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="BulletCopy", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9, leading=13, textColor=INK, leftIndent=14,
    firstLineIndent=-10, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="NumberCopy", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9, leading=13, textColor=INK, leftIndent=17,
    firstLineIndent=-17, spaceAfter=5,
))


def inline_markup(text: str) -> str:
    safe = escape(text, quote=False)
    safe = re.sub(r"`([^`]+)`", r'<font name="Courier" size="8">\1</font>', safe)
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", safe)


def draw_page(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setStrokeColor(PALE)
    canvas.setLineWidth(1)
    canvas.line(doc.leftMargin, height - 0.52 * inch, width - doc.rightMargin, height - 0.52 * inch)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(CYAN)
    canvas.drawString(doc.leftMargin, height - 0.4 * inch, f"NOTIFYEM  /  {DOC_LABEL}")
    canvas.setStrokeColor(PALE)
    canvas.line(doc.leftMargin, 0.48 * inch, width - doc.rightMargin, 0.48 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 0.32 * inch, "Internal reference  |  October 2026")
    canvas.drawRightString(width - doc.rightMargin, 0.32 * inch, f"{doc.page}")
    canvas.restoreState()


def build_story():
    story = []
    paragraph_lines = []

    def flush_paragraph():
        if paragraph_lines:
            story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), styles["BodyCopy"]))
            paragraph_lines.clear()

    for raw_line in SOURCE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            flush_paragraph()
        elif line.startswith("# "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[2:]), styles["DocTitle"]))
        elif line.startswith("## "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[3:]), styles["Section"]))
        elif line.startswith("- "):
            flush_paragraph()
            story.append(Paragraph("&#8226; " + inline_markup(line[2:]), styles["BulletCopy"]))
        elif re.match(r"\d+\.\s", line):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line), styles["NumberCopy"]))
        else:
            paragraph_lines.append(line)
    flush_paragraph()
    return story


document = SimpleDocTemplate(
    str(OUTPUT), pagesize=letter,
    rightMargin=0.72 * inch, leftMargin=0.72 * inch,
    topMargin=0.72 * inch, bottomMargin=0.68 * inch,
    title=SOURCE.stem.replace("_", " "),
    author="NotifyEm",
)
document.build(build_story(), onFirstPage=draw_page, onLaterPages=draw_page)
print(f"Created {OUTPUT}")