// Contrôle des couvertures par un modèle d'image (voir scripts/controle-couvertures.py et le workflow « Contrôle des couvertures »).
//   node scripts/adulte-images.mjs liste [--limit=3000]   -> JSON des couvertures restant à contrôler : [{ cle: "series/<slug>" | "isbn/<isbn13>", url }]
//   node scripts/adulte-images.mjs decider                -> écrit data/contenu-adulte-images.json à partir de data/couvertures-controle.json
// data/couvertures-controle.json : { maj, vus: { "series/<slug>": [r18, r15], "isbn/<isbn13>": [r18, r15], … } }   (scores entre 0 et 1 ; null = couverture absente)
// Règle stricte (partenaires d'affiliation : zéro risque, les faux positifs sont acceptés) : une série est retirée dès qu'UNE de ses couvertures
// (couverture de série, couverture d'un tome, couverture du calendrier venue d'un éditeur) est classée « r18 » avec un score ≥ SEUIL.
// Les clés « cal/<série>/<tome> » désignent les couvertures du calendrier, contrôlées à la source (site de l'éditeur).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBnf } from './catalogue-bnf.mjs';
import { chargerAdulte } from './adulte.mjs';
import { loadAllManga, slugify } from './lib.mjs';

export const SEUIL = 0.5;
const CDN = 'https://img.prochaintome.fr/';

/** Décision à partir des scores. bnf : résultat de loadBnf(dir, { tout: true }) ; conserver : Set d'adresses de séries à ne jamais retirer. */
export function decider(vus, bnf, conserver = new Set(), seuil = SEUIL) {
  const r18 = (c) => Array.isArray(vus[c]) && Number(vus[c][0]) >= seuil;
  const series = {};
  const marque = (k, n, e, motif) => { if (!conserver.has(k) && !series[k]) series[k] = { n: n || k, e: e || '', motif }; };
  for (const s of bnf.series) {
    if (r18(`series/${s.k}`)) { marque(s.k, s.n, s.e, `couverture de série : r18 ${Number(vus[`series/${s.k}`][0]).toFixed(2)}`); continue; }
    const c = s.v.map((v) => `isbn/${v[1]}`).find(r18);
    if (c) marque(s.k, s.n, s.e, `couverture du tome ${c.slice(5)} : r18 ${Number(vus[c][0]).toFixed(2)}`);
  }
  const noms = new Map(bnf.series.map((s) => [s.k, s]));
  for (const c of Object.keys(vus)) {
    if (!c.startsWith('cal/') || !r18(c)) continue;
    const k = c.split('/')[1], s = noms.get(k);
    marque(k, s && s.n, s && s.e, `couverture du calendrier (${c.split('/')[2] || '?'}) : r18 ${Number(vus[c][0]).toFixed(2)}`);
  }
  return { series, tomes: {} };
}

/**
 * Couvertures à contrôler : celles du calendrier (adresse de l'éditeur) d'abord, puis les séries du catalogue, puis les tomes dont la couverture est dans R2 ; ce qui est déjà vu est ignoré.
 * calendrier : [{ slug, tome, cover }].
 */
export function aControler(vus, bnf, isbnEnR2, limit = 3000, calendrier = []) {
  const out = [];
  for (const r of calendrier) { const c = `cal/${r.slug}/${r.tome || 0}`; if (r.cover && !(c in vus)) out.push({ cle: c, url: r.cover }); }
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
    const cal = loadAllManga(dir).filter((r) => r.cover && /^https:\/\//.test(r.cover)).map((r) => ({ slug: slugify(r.serie), tome: r.tome, cover: r.cover }));
    process.stdout.write(JSON.stringify(aControler(etat.vus || {}, bnf, done, limit, cal)));
  } else if (cmd === 'decider') {
    const conserver = chargerAdulte(dir).conserver;
    const d = decider(etat.vus || {}, bnf, conserver);
    const n = Object.keys(etat.vus || {}).length;
    writeFileSync(path.join(dir, 'contenu-adulte-images.json'), JSON.stringify({ source: 'Modèle de classification d\'images (anime_rating), seuil r18 ' + SEUIL, maj: new Date().toISOString().slice(0, 10), controlees: n, series: d.series }) + '\n');
    console.log(`${n} couvertures contrôlées : ${Object.keys(d.series).length} séries retirées (seuil r18 ${SEUIL}).`);
  } else { console.error('Usage : adulte-images.mjs liste|decider'); process.exitCode = 1; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
