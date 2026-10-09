#!/usr/bin/env python3
"""Regénère scripts/assets/og.png (image de partage 1200x630) : python3 scripts/make-og.py "Prochain Tome" "le calendrier des sorties manga et anime" """
import sys, pathlib
from playwright.sync_api import sync_playwright
here = pathlib.Path(__file__).parent / 'assets'
name = sys.argv[1] if len(sys.argv) > 1 else 'Prochain Tome'
tag = sys.argv[2] if len(sys.argv) > 2 else 'le calendrier des sorties manga et anime'
html = (here / 'og.html').read_text().replace('__NAME__', name).replace('__TAGLINE__', tag)
tmp = here / '_og.html'; tmp.write_text(html)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1200, 'height': 630}); pg.goto(tmp.as_uri()); pg.screenshot(path=str(here / 'og.png')); b.close()
tmp.unlink()
