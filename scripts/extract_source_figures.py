"""Render named pages from the retrieved science PDFs. Figures stay tied to the paper."""

from __future__ import annotations

from pathlib import Path

import fitz

ROOT = Path("/Users/mayongning/Documents/Codex/2026-06-07/files-mentioned-by-the-user-ks")
MATERIALS = ROOT / "science_poc" / "materials"
OUT = ROOT / "LearningGuide" / "public" / "science-sources"

# 1-based page numbers from the local extracts / PDF viewer.
PAGES = {
    "gw/jeevanjee_2022_climate_sensitivity_chalkboard.pdf": {
        "fig1_rce_cartoon": [2],
        "eq_forcing_feedback": [4],
    },
    "gw/ipcc_ar6_wg1_ch07.pdf": {
        "energy_budget": [1, 2, 3],
    },
    "qc/preskill_2018_nisq.pdf": {
        "front": [1, 2],
    },
    "qc/vandersypen_2005_nmr_qc_rmp_arxiv.pdf": {
        "bloch_or_levels": [1, 2, 3, 4, 5, 6],
    },
    "ep/bjornstad_2020_seir.pdf": {
        "sir_eq_and_fig": [7, 8],
    },
    "ep/weissman_2020_sir.pdf": {
        "r0_figure": [1, 2, 3],
    },
    "al/acemoglu_restrepo_2019_nber_w25684.pdf": {
        "fig1_tasks": [7, 8],
    },
    "pp/goodman_bacon_2018_did.pdf": {
        "fig1_timing": [7, 8],
    },
}


def render(pdf: Path, pages: list[int], dest_dir: Path, stem: str) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf)
    for page_no in pages:
        if page_no < 1 or page_no > doc.page_count:
            print(f"skip {pdf.name} p{page_no} (count={doc.page_count})")
            continue
        page = doc.load_page(page_no - 1)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        out = dest_dir / f"{stem}_p{page_no}.png"
        pix.save(out)
        print(f"wrote {out.relative_to(ROOT)} {pix.width}x{pix.height}")
    doc.close()


def main() -> None:
    for rel, jobs in PAGES.items():
        pdf = MATERIALS / rel
        pack = rel.split("/")[0]
        for stem, pages in jobs.items():
            render(pdf, pages, OUT / pack / "_pages", stem)


if __name__ == "__main__":
    main()
