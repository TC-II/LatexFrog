"""The skeleton of a PDF, for comparing against what LatexFrog thinks the document is.

python skel.py <in.pdf> <out.json>

Writes: page count, page labels, the outline (bookmarks: level, title, page) and each page's
text lines (whitespace collapsed). No judgement here: compare.mjs decides what matches.
"""
import json
import re
import sys

import fitz  # PyMuPDF


def main(src: str, dst: str) -> None:
    doc = fitz.open(src)
    pages = []
    for p in doc:
        lines = []
        for ln in p.get_text("text").splitlines():
            ln = re.sub(r"\s+", " ", ln).strip()
            if ln:
                lines.append(ln)
        pages.append(lines)
    labels = []
    try:
        labels = [doc[i].get_label() or "" for i in range(len(doc))]
    except Exception:
        labels = []
    out = {
        "pages": len(doc),
        "labels": labels,
        "toc": [[lvl, title, page] for lvl, title, page in doc.get_toc(simple=True)],
        "text": pages,
    }
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
