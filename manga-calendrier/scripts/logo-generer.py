"""Génère les logos Prochain Tome en SVG (texte converti en tracés : aucune police requise).
Usage : python3 scripts/logo-generer.py FONT.woff SORTIE_DIR"""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font = TTFont(sys.argv[1]); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
KERN = {('T', 'o'): -9, ('P', 'r'): -2}
def texte(s, size, track=0):
    k = size / upm; x = 0; d = []
    for i, ch in enumerate(s):
        if i: x += KERN.get((s[i - 1], ch), 0)
        g = cmap[ord(ch)]; pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x, 0)))
        d.append(pen.getCommands()); x += gs[g].width * k + track
    return ' '.join(d), x - track
JAUNE, ENCRE, PAPIER = '#ffd21f', '#111111', '#fbfaf6'

def logo(mode, nom, avec_texte=True, fond=None, app=False):
    c = ENCRE if mode == 'clair' else '#f6f4ee'       # encre du site (clair) / crème (sombre)
    pap = PAPIER if mode == 'clair' else '#19191b'
    tp, tw = texte('Prochain', 84, -1)
    mp, mw = texte('Tome', 84, -1)
    # --- pictogramme : calendrier, entête jaune à trame, grille 3x2 dont la case « prochain tome » est jaune
    ic = f'''<g transform="translate(14 20) rotate(-6 80 80)">
<rect x="10" y="10" width="148" height="148" fill="{c}"/>
<rect x="0" y="0" width="148" height="148" fill="{pap}" stroke="{c}" stroke-width="9"/>
<rect x="4.5" y="4.5" width="139" height="42" fill="{JAUNE}"/>
<rect x="4.5" y="4.5" width="139" height="42" fill="url(#trame)"/>
<line x1="4.5" y1="46.5" x2="143.5" y2="46.5" stroke="{c}" stroke-width="8"/>
<rect x="36" y="-14" width="14" height="40" rx="3" fill="{pap}" stroke="{c}" stroke-width="7"/>
<rect x="98" y="-14" width="14" height="40" rx="3" fill="{pap}" stroke="{c}" stroke-width="7"/>
<g fill="{c}"><rect x="20" y="64" width="26" height="22"/><rect x="61" y="64" width="26" height="22"/><rect x="102" y="64" width="26" height="22"/><rect x="20" y="100" width="26" height="22"/><rect x="61" y="100" width="26" height="22"/></g>
<rect x="102" y="100" width="26" height="22" fill="{JAUNE}" stroke="{c}" stroke-width="5"/>
</g>'''
    defs = f'<defs><pattern id="trame" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="1.6" fill="{ENCRE}" fill-opacity=".28"/></pattern></defs>'
    if app:  # icône d'application / favicon : calendrier sur aplat jaune, dans la zone sûre des icônes « maskable »
        w = h = 512
        body = f'<rect width="512" height="512" fill="{JAUNE}"/><rect width="512" height="512" fill="url(#trame)" opacity=".7"/><g transform="translate(121 118) scale(1.5)">{ic}</g>'
    elif not avec_texte:
        w, h = 190, 190
        body = ic
    else:
        x0 = 215; w = x0 + max(tw, mw + 48) + 30; h = 215
        bx, by, bw, bh = x0, 118, mw + 44, 86
        body = ic + f'''
<path d="{tp}" transform="translate({x0} 98)" fill="{c}"/>
<g transform="rotate(-1.6 {bx + bw / 2} {by + bh / 2})">
<rect x="{bx + 8}" y="{by + 8}" width="{bw}" height="{bh}" fill="{c}"/>
<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" fill="{JAUNE}" stroke="{c}" stroke-width="6"/>
<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" fill="url(#trame)"/>
<path d="{mp}" transform="translate({bx + 22} {by + 70})" fill="{ENCRE}"/>
</g>'''
    bg = f'<rect width="{w}" height="{h}" fill="{fond}"/>' if fond else ''
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {int(w)} {int(h)}" role="img" aria-label="Prochain Tome">{defs}{bg}{body}</svg>\n'
    open(os.path.join(out, nom), 'w', encoding='utf8').write(svg)

logo('clair', 'logo-clair.svg'); logo('sombre', 'logo-sombre.svg')
logo('clair', 'icone-clair.svg', False); logo('sombre', 'icone-sombre.svg', False)
logo('clair', 'icone-app.svg', False, app=True)
