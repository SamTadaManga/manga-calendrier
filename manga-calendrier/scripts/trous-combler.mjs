// Cherche les tomes qui manquent dans la numérotation des séries (voir trous.mjs) et complète le catalogue.
//  1. BnF : recherche par titre et éditeur ; un tome n'est retenu que si le titre est exactement celui de la série
//     et si son numéro est l'un de ceux qui manquent. Il entre directement (statut « ok » : c'est le catalogue lui-même).
//  2. Google Books (petits trous seulement, sans clé : quota réduit, l'étape s'arrête d'elle-même si Google refuse) :
//     source moins sûre, donc écrite avec le statut « a-valider » ; elle n'apparaît sur le site qu'après `--accepter`.
// Usage : node scripts/trous-combler.mjs [--max=250] [--minutes=40] [--google=non] [--dry-run]
//         node scripts/trous-combler.mjs --accepter     (valide les ajouts « a-valider » venant de Google Books)
// Écrit data/catalogue-ajouts.json et data/trous-etat.json (dernière recherche par série : on ne repose pas la question avant 60 jours).
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { paths, loadAllManga, slugify, parisKey, now } from './lib.mjs';
import { loadBnf, readAjouts } from './catalogue-bnf.mjs';
import { sru, cql } from './bnf-sru.mjs';
import { findGaps, loadExceptions } from './trous.mjs';
import { isIsbn13 } from './shops.mjs';
import { saveAjouts, majStatut, flat, memeEditeur } from './ajouts-lib.mjs';

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`) || a === `--${n}`); return m ? (m.includes('=') ? m.split('=').slice(1).join('=') : 'true') : d; };
const P = paths();
if (arg('accepter', '') === 'true') {
  const n = majStatut(P.dataDir, (a) => a.statut === 'a-valider' && a.src === 'google', 'ok');
  console.log(`${n} ajouts validés.`);
  process.exit(0);
}
const DRY = arg('dry-run', '') === 'true';
const MAX = Number(arg('max', 250));
const DEADLINE = Date.now() + Number(arg('minutes', 40)) * 60000;
const GOOGLE = arg('google', 'oui') !== 'non';
const today = parisKey(now());
const REPOSE_JOURS = 60;

const stateFile = path.join(P.dataDir, 'trous-etat.json');
let etat = {}; try { etat = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
const recent = (k) => etat[k] && (Date.parse(today) - Date.parse(etat[k])) / 864e5 < REPOSE_JOURS;

const BNF = loadBnf(P.dataDir);
const manga = loadAllManga(P.dataDir).filter((r) => r.statut !== 'annule');
const calNums = new Map();
for (const r of manga) { const k = slugify(r.serie); if (Number(r.tome) > 0) { if (!calNums.has(k)) calNums.set(k, []); calNums.get(k).push(Number(r.tome)); } }
const G = findGaps(BNF.series, (k) => calNums.get(k) || [], loadExceptions(P.dataDir));
const todo = [...G.petit.map((g) => ({ ...g, classe: 'petit' })), ...G.gros.map((g) => ({ ...g, classe: 'gros' }))].filter((g) => !recent(g.k)).slice(0, MAX);

const known = new Set([...BNF.byIsbn.keys(), ...readAjouts(P.dataDir).ajouts.map((a) => a.isbn)]);
const out = []; const log = [];
let bnfFound = 0, googleFound = 0, errors = 0, searched = 0, googleStopped = false;

async function google(g) {
  const key = process.env.GOOGLE_BOOKS_KEY ? `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_KEY)}` : '';
  const q = `intitle:"${cql(g.n)}"${g.e ? ` inpublisher:"${cql(g.e)}"` : ''}`;
  const url = `${process.env.GOOGLE_BOOKS_URL || 'https://www.googleapis.com/books/v1/volumes'}?q=${encodeURIComponent(q)}&langRestrict=fr&printType=books&maxResults=40${key}`;
  await new Promise((r) => setTimeout(r, Number(process.env.BNF_PAUSE ?? 1000)));
  const r = await fetch(url, { headers: { 'User-Agent': 'manga-calendrier/1.0 (calendrier gratuit de sorties)' }, signal: AbortSignal.timeout(30000) });
  if (r.status === 429 || r.status === 403) { googleStopped = true; return []; }
  if (!r.ok) throw new Error(`Google Books ${r.status}`);
  const j = await r.json();
  return (j.items || []).map((it) => it.volumeInfo || {});
}
// Le numéro d'un titre Google : premier nombre qui reste une fois le nom de la série retiré
const numeroDe = (titre, nom) => { const rest = flat(titre).replace(flat(nom), ' '); return (rest.match(/(?:^|\s)(\d{1,3})(?:\s|$)/) || [])[1] || ''; };

for (const g of todo) {
  if (Date.now() > DEADLINE) { log.push(`Temps écoulé : ${todo.indexOf(g)} séries traitées sur ${todo.length}.`); break; }
  searched++;
  const missing = new Set(g.miss);
  try {
    const ns = await sru(`bib.title all "${cql(g.n)}" and bib.publisher all "${cql(String(g.e).replace(/!/g, ''))}"`, { max: 300 });
    for (const x of ns) {
      if (!isIsbn13(x.isbn) || known.has(x.isbn) || slugify(x.titre) !== g.k) continue;
      const t = Number(x.tome);
      if (!t || !missing.has(t)) continue;
      known.add(x.isbn); missing.delete(t); bnfFound++;
      out.push({ k: g.k, n: g.n, e: g.e, t: String(t), isbn: x.isbn, y: x.annee, src: 'bnf', statut: 'ok' });
    }
    if (GOOGLE && !googleStopped && g.classe === 'petit' && missing.size) {
      for (const v of await google(g)) {
        const isbn = (v.industryIdentifiers || []).find((i) => i.type === 'ISBN_13')?.identifier || '';
        if (!isIsbn13(isbn) || known.has(isbn) || !memeEditeur(v.publisher, g.e)) continue;
        if (!flat(v.title).includes(flat(g.n))) continue;
        const t = Number(numeroDe(v.title, g.n));
        if (!t || !missing.has(t)) continue;
        known.add(isbn); missing.delete(t); googleFound++;
        out.push({ k: g.k, n: g.n, e: g.e, t: String(t), isbn, y: Number((v.publishedDate || '').slice(0, 4)) || 0, src: 'google', statut: 'a-valider' });
      }
    }
    etat[g.k] = today;
  } catch (e) { errors++; console.error(`  ${g.n} : ${e.message}`); if (errors > 25) { log.push('Trop d\'erreurs : arrêt.'); break; } }
  if (searched % 25 === 0) console.log(`  ${searched}/${todo.length} séries, ${bnfFound} tomes retrouvés à la BnF, ${googleFound} à valider (Google).`);
}
log.push(`Séries à compléter : ${G.petit.length} petits trous, ${G.gros.length} gros trous ; ${searched} cherchées aujourd'hui (les autres l'ont été il y a moins de ${REPOSE_JOURS} jours ou passeront au prochain lancement).`);
log.push(`Tomes retrouvés à la BnF : ${bnfFound} (ajoutés). Google Books : ${googleFound} à valider${googleStopped ? ' ; Google a refusé les requêtes (quota), étape arrêtée' : ''}.`);
if (errors) log.push(`${errors} séries en erreur (revues au prochain lancement).`);
if (!DRY) {
  const added = saveAjouts(P.dataDir, out);
  writeFileSync(stateFile, JSON.stringify(etat) + '\n');
  log.push(`${added} références écrites dans data/catalogue-ajouts.json.`);
} else log.push('Essai à blanc : rien n\'est écrit.');
console.log('\n' + log.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Trous de numérotation\n\n${log.map((l) => `- ${l}`).join('\n')}\n`);
if (searched && errors > 25) process.exit(1);
