// Mise à jour du catalogue à partir du service SRU de la BnF (voir bnf-sru.mjs). À lancer chaque mois (workflow « Catalogue »).
//  1. Nouvelles notices : pour chaque éditeur de manga, les notices créées depuis la dernière mise à jour.
//     Elles entrent si leur titre est celui d'une série connue (catalogue ou calendrier) ou si l'éditeur ne publie que du manga.
//  2. ISBN du calendrier absents du catalogue : un par un, par ISBN (la BnF les a souvent avant la mise en rayon).
// Usage : node scripts/bnf-maj.mjs [--depuis=AAAAMMJJ] [--minutes=45] [--dry-run]
// Écrit data/catalogue-ajouts.json (jamais data/catalogue-bnf.json) et data/bnf-maj.json (date de la dernière mise à jour).
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { paths, loadAllManga, slugify, parisKey, now } from './lib.mjs';
import { loadBnf } from './catalogue-bnf.mjs';
import { sru, cql } from './bnf-sru.mjs';
import { isIsbn13 } from './shops.mjs';
import { saveAjouts, flat, isEditeurManga } from './ajouts-lib.mjs';
import { EDITEURS_EXCLUS } from './trous.mjs';

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`) || a === `--${n}`); return m ? (m.includes('=') ? m.split('=').slice(1).join('=') : 'true') : d; };
const DRY = arg('dry-run', '') === 'true';
const DEADLINE = Date.now() + Number(arg('minutes', 45)) * 60000;
const P = paths();
const stateFile = path.join(P.dataDir, 'bnf-maj.json');
let state = {}; try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
const ymd = (d) => d.replace(/-/g, '');
const defaultSince = () => { const d = new Date(Date.parse(parisKey(now())) - 45 * 864e5); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
// On recule de 7 jours sur la dernière date : une notice peut apparaître avec un peu de retard, les ISBN déjà connus sont écartés de toute façon.
const sinceOf = () => { const s = arg('depuis', ''); if (/^\d{8}$/.test(s)) return s; if (/^\d{8}$/.test(state.derniere || '')) { const t = Date.parse(`${state.derniere.slice(0, 4)}-${state.derniere.slice(4, 6)}-${state.derniere.slice(6)}`) - 7 * 864e5; return new Date(t).toISOString().slice(0, 10).replace(/-/g, ''); } return defaultSince(); };

const BNF = loadBnf(P.dataDir);
const manga = loadAllManga(P.dataDir).filter((r) => r.statut !== 'annule');
const calSlugs = new Set(manga.map((r) => slugify(r.serie)));
const excl = new Set(EDITEURS_EXCLUS.map(flat));
const pubCount = new Map(); // éditeur -> nombre de séries au catalogue
for (const s of BNF.series) if (s.e) pubCount.set(s.e, (pubCount.get(s.e) || 0) + 1);
for (const r of manga) if (r.editeur) pubCount.set(r.editeur, Math.max(pubCount.get(r.editeur) || 0, 15));
const publishers = [...pubCount].filter(([e, n]) => n >= 15 && !excl.has(flat(e))).sort((a, b) => b[1] - a[1]).map(([e]) => e);

const known = new Set(BNF.byIsbn.keys());
const out = []; const log = [];
const take = (a) => { if (known.has(a.isbn)) return false; known.add(a.isbn); out.push(a); return true; };

// --- 1. Nouvelles notices par éditeur
const since = sinceOf();
let seen = 0, skippedMixed = 0, newSeries = 0, errors = 0;
for (const pub of publishers) {
  if (Date.now() > DEADLINE) { log.push(`Temps écoulé avant la fin des éditeurs (arrêt à « ${pub} »).`); break; }
  let notices = [];
  try { notices = await sru(`bib.publisher all "${cql(pub.replace(/[!]/g, ''))}" and bib.creationdate >= "${since}"`, { max: 1000 }); }
  catch (e) { errors++; console.error(`  ${pub} : ${e.message}`); continue; }
  let n = 0;
  for (const x of notices) {
    seen++;
    if (!isIsbn13(x.isbn) || !x.titre || known.has(x.isbn)) continue;
    const k = slugify(x.titre);
    if (!k || k.length > 120) continue;
    const inCat = BNF.byK.get(k), inCal = calSlugs.has(k);
    if (inCat || inCal) { if (take({ k, n: inCat?.n || x.titre, e: inCat?.e || pub, t: x.tome, isbn: x.isbn, y: x.annee, src: 'bnf', statut: 'ok', ...(x.tome ? {} : x.partie ? { l: x.partie.slice(0, 40) } : {}) })) n++; continue; }
    if (isEditeurManga(pub)) { if (take({ k, n: x.titre, e: pub, t: x.tome, isbn: x.isbn, y: x.annee, src: 'bnf', statut: 'ok', ...(x.tome ? {} : x.partie ? { l: x.partie.slice(0, 40) } : {}) })) { n++; newSeries++; } continue; }
    skippedMixed++;
  }
  console.log(`  ${pub} : ${notices.length} notices, ${n} ajoutées.`);
}
log.push(`Notices créées depuis ${since} : ${seen} lues, ${out.length} ajoutées dont ${newSeries} dans de nouvelles séries ; ${skippedMixed} ignorées (série inconnue chez un éditeur qui ne publie pas que du manga).`);

// --- 2. ISBN du calendrier que le catalogue ne connaît pas
const wanted = [...new Map(manga.filter((r) => isIsbn13(r.isbn) && !known.has(r.isbn)).map((r) => [r.isbn, r])).values()];
let found = 0;
for (const r of wanted) {
  if (Date.now() > DEADLINE) { log.push('Temps écoulé avant la fin des ISBN du calendrier.'); break; }
  try {
    const ns = await sru(`bib.isbn all "${r.isbn}"`, { max: 3 });
    const x = ns.find((y) => y.isbn === r.isbn) || ns[0];
    if (x && x.isbn === r.isbn) { const k = slugify(r.serie); if (take({ k, n: BNF.byK.get(k)?.n || r.serie, e: BNF.byK.get(k)?.e || r.editeur || x.editeur, t: String(Number(r.tome) || x.tome || ''), isbn: r.isbn, y: x.annee || Number(String(r.date).slice(0, 4)) || 0, src: 'bnf', statut: 'ok' })) found++; }
  } catch (e) { errors++; if (errors > 20) { log.push('Trop d\'erreurs : arrêt.'); break; } }
}
log.push(`ISBN du calendrier absents du catalogue : ${wanted.length}, retrouvés à la BnF : ${found}.`);
if (errors) log.push(`${errors} requêtes en erreur (voir le journal).`);

if (!DRY) {
  const added = saveAjouts(P.dataDir, out);
  writeFileSync(stateFile, JSON.stringify({ derniere: ymd(parisKey(now())) }) + '\n');
  log.push(`${added} références écrites dans data/catalogue-ajouts.json.`);
} else log.push('Essai à blanc : rien n\'est écrit.');
console.log('\n' + log.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Mise à jour du catalogue (BnF)\n\n${log.map((l) => `- ${l}`).join('\n')}\n`);
if (errors > 20 || (publishers.length && errors >= publishers.length)) process.exit(1);
