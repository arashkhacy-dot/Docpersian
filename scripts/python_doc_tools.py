#!/usr/bin/env python3
"""
DocuShift Python Document Tools
Provides high-fidelity inspection and text-preserving translation bridges
using python-pptx and python-docx for maximum layout and style fidelity.
"""

import sys
import os
import json
import argparse

def process_pptx(input_path, output_path, translations_json=None):
    try:
        from pptx import Presentation
        from pptx.enum.text import PP_ALIGN
    except ImportError:
        print("[ERROR] python-pptx is not installed. Install via: pip3 install python-pptx", file=sys.stderr)
        return False

    prs = Presentation(input_path)
    trans_map = {}
    if translations_json and os.path.exists(translations_json):
        with open(translations_json, 'r', encoding='utf-8') as f:
            trans_map = json.load(f)

    for slide_idx, slide in enumerate(prs.slides, start=1):
        for shape in slide.shapes:
            if shape.has_text_frame:
                for paragraph in shape.text_frame.paragraphs:
                    full_text = "".join(run.text for run in paragraph.runs).strip()
                    if full_text and full_text in trans_map:
                        translated = trans_map[full_text]
                        if paragraph.runs:
                            paragraph.runs[0].text = translated
                            for r in paragraph.runs[1:]:
                                r.text = ""
                        paragraph.alignment = PP_ALIGN.RIGHT

            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        for paragraph in cell.text_frame.paragraphs:
                            full_text = "".join(run.text for run in paragraph.runs).strip()
                            if full_text and full_text in trans_map:
                                translated = trans_map[full_text]
                                if paragraph.runs:
                                    paragraph.runs[0].text = translated
                                    for r in paragraph.runs[1:]:
                                        r.text = ""
                                paragraph.alignment = PP_ALIGN.RIGHT

    prs.save(output_path)
    print(f"[SUCCESS] Processed presentation saved to: {output_path}")
    return True

def process_docx(input_path, output_path, translations_json=None):
    try:
        from docx import Document
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except ImportError:
        print("[ERROR] python-docx is not installed. Install via: pip3 install python-docx", file=sys.stderr)
        return False

    doc = Document(input_path)
    trans_map = {}
    if translations_json and os.path.exists(translations_json):
        with open(translations_json, 'r', encoding='utf-8') as f:
            trans_map = json.load(f)

    for paragraph in doc.paragraphs:
        full_text = paragraph.text.strip()
        if full_text and full_text in trans_map:
            paragraph.text = trans_map[full_text]
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    full_text = paragraph.text.strip()
                    if full_text and full_text in trans_map:
                        paragraph.text = trans_map[full_text]
                        paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    doc.save(output_path)
    print(f"[SUCCESS] Processed Word document saved to: {output_path}")
    return True

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="DocuShift Python Document Tools")
    parser.add_argument("--type", choices=["pptx", "docx"], required=True, help="Document type")
    parser.add_argument("--input", required=True, help="Input document path")
    parser.add_argument("--output", required=True, help="Output document path")
    parser.add_argument("--translations", help="JSON map of original -> translated texts")

    args = parser.parse_args()

    if args.type == "pptx":
        success = process_pptx(args.input, args.output, args.translations)
    elif args.type == "docx":
        success = process_docx(args.input, args.output, args.translations)
    else:
        success = False

    sys.exit(0 if success else 1)
