// Contrôle des couvertures par un modèle d'image (voir scripts/controle-couvertures.py et le workflow « Contrôle des couvertures »).
//   node scripts/adulte-images.mjs liste [--limit=3000]   -> JSON des couvertures restant à contrôler : [{ cle: "series/<slug>" | "isbn/<isbn13>", url }]
//   node scripts/adulte-images.mjs decider                -> écrit data/contenu-adulte-images.json à partir de data/couvertures-controle.json
// data/couvertures-controle.json : { maj, vus: { "series/<slug>": [r18, r15], "isbn/<isbn13>": [r18, r15], … } }   (scores entre 0 et 1 ; null = couverture absente)
// Règles : une série dont la couverture est classée « r18 » avec un score ≥ SEUIL est retirée ; une série dont au moins MIN_TOMES couvertures de tomes
// ont été contrôlées et dont la moitié ou plus sont « r18 » l'est aussi. Un tome isolé n'est pas retiré (cela créerait un trou dans la numérotation) : il est listé.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBnf } from './catalogue-bnf.mjs';
import { chargerAdulte } from './adulte.mjs';

export const SEUIL = 0.85;
export const MIN_TOMES = 3;
const CDN = 'https://img.prochaintome.fr/';

/** Décision à partir des scores. bnf : résultat de loadBnf(dir, { tout: true }) ; conserver : Set d'adresses de séries à ne jamais retirer. */
export function decider(vus, bnf, conserver = new Set(), seuil = SEUIL) {
  const r18 = (c) => Array.isArray(vus[c]) && Number(vus[c][0]) >= seuil;
  const series = {}, tomes = {};
  for (const s of bnf.series) {
    if (conserver.has(s.k)) continue;
    const sc = vus[`series/${s.k}`];
    if (r18(`series/${s.k}`)) { series[s.k] = { n: s.n, e: s.e, motif: `couverture de série : r18 ${Number(sc[0]).toFixed(2)}` }; continue; }
    const vus_ = s.v.map((v) => `isbn/${v[1]}`).filter((c) => Array.isArray(vus[c]));
    const flag = vus_.filter(r18);
    if (vus_.length >= MIN_TOMES && flag.length / vus_.length >= 0.5) series[s.k] = { n: s.n, e: s.e, motif: `couvertures de tomes : ${flag.length}/${vus_.length} r18` };
    else for (const c of flag) tomes[c.slice(5)] = { k: s.k, n: s.n, t: Number(vus[c][0]).toFixed(2) };
  }
  return { series, tomes };
}

/** Couvertures à contrôler : séries du catalogue d'abord, puis tomes dont la couverture est dans R2 ; ce qui est déjà vu est ignoré. */
export function aControler(vus, bnf, isbnEnR2, limit = 3000) {
  const out = [];
  for (const s of bnf.series) { const c = `series/${s.k}`; if (!(c in vus)) out.push({ cle: c, url: `${CDN}${c}.webp` }); }
  for (const s of bnf.series) for (const v of s.v) { const c = `isbn/${v[1]}`; if (!(c in vus) && isbnEnR2.has(v[1])) out.push({ cle: c, url: `${CDN}${c}.webp` }); }
  return out.slice(0, limit);
}

const lire = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

function main() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const cmd = process.argv[2];
  const bnf = loadBnf(dir, { tout: true });
  const etat = lire(path.join(dir, 'couvertures-controle.json'), { vus: {} });
  if (cmd === 'liste') {
    const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8)) || 3000;
    const done = new Set(lire(path.join(dir, 'couvertures-isbn.json'), { done: [] }).done || []);
    process.stdout.write(JSON.stringify(aControler(etat.vus || {}, bnf, done, limit)));
  } else if (cmd === 'decider') {
    const conserver = chargerAdulte(dir).conserver;
    const d = decider(etat.vus || {}, bnf, conserver);
    const n = Object.keys(etat.vus || {}).length;
    writeFileSync(path.join(dir, 'contenu-adulte-images.json'), JSON.stringify({ source: 'Modèle de classification d\'images (anime_rating), seuil r18 ' + SEUIL, maj: new Date().toISOString().slice(0, 10), controlees: n, series: d.series, tomes: d.tomes }) + '\n');
    console.log(`${n} couvertures contrôlées : ${Object.keys(d.series).length} séries retirées, ${Object.keys(d.tomes).length} tomes isolés signalés (non retirés).`);
  } else { console.error('Usage : adulte-images.mjs liste|decider'); process.exitCode = 1; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
