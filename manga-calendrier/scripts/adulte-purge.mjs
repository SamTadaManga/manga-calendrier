// Retire de R2 les couvertures des séries et tomes classés adultes (series/<slug>.webp et isbn/<isbn>.webp) et de la liste des couvertures faites.
// Usage : node scripts/adulte-purge.mjs [--dry-run]      Variables : R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// Garde la trace de ce qui a déjà été supprimé (data/adulte-purge.json) pour ne pas recommencer chaque nuit.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from './lib.mjs';
import { loadBnf } from './catalogue-bnf.mjs';
import { chargerAdulte, estAdulte } from './adulte.mjs';
import { r2Client } from './r2.mjs';

/** Clés R2 à supprimer : tout le catalogue complet moins ce que le site affiche encore. */
export function clesAPurger(dir) {
  const cfg = chargerAdulte(dir);
  const tout = loadBnf(dir, { tout: true });
  const visible = loadBnf(dir);
  const gardees = new Set(visible.byIsbn.keys());
  const cles = new Set();
  for (const s of tout.series) {
    if (estAdulte(cfg, { slug: s.k, serie: s.n, editeur: s.e })) { cles.add(`series/${s.k}.webp`); for (const v of s.v) cles.add(`isbn/${v[1]}.webp`); }
    else for (const v of s.v) if (!gardees.has(v[1]) || cfg.isbn.has(v[1])) cles.add(`isbn/${v[1]}.webp`);
  }
  return [...cles].sort();
}

async function main() {
  const P = paths();
  const dry = process.argv.includes('--dry-run');
  const fichier = path.join(P.dataDir, 'adulte-purge.json');
  let etat = { faits: [] };
  try { etat = { faits: [], ...JSON.parse(readFileSync(fichier, 'utf8')) }; } catch {}
  const faits = new Set(etat.faits);
  const reste = clesAPurger(P.dataDir).filter((k) => !faits.has(k));
  console.log(`${reste.length} couvertures adultes à supprimer de R2 (déjà faites : ${faits.size}).`);
  const e = process.env;
  if (dry || !reste.length) { if (dry) console.log(reste.slice(0, 20).join('\n')); return; }
  if (!(e.R2_ACCOUNT_ID && e.R2_BUCKET && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY)) { console.log('Variables R2 absentes : rien à faire.'); return; }
  const r2 = r2Client({ accountId: e.R2_ACCOUNT_ID, bucket: e.R2_BUCKET, accessKey: e.R2_ACCESS_KEY_ID, secretKey: e.R2_SECRET_ACCESS_KEY });
  let ok = 0, ko = 0;
  for (const k of reste) {
    try { await r2.del(k); faits.add(k); ok++; } catch (err) { ko++; if (ko < 5) console.error(`${k} : ${err.message}`); if (ko > 20) break; }
  }
  // La liste des couvertures faites ne doit plus contenir ces tomes (sinon ils seraient considérés comme déjà couverts si le classement change)
  const isbnFaits = new Set([...faits].filter((k) => k.startsWith('isbn/')).map((k) => k.slice(5, 18)));
  try {
    const cf = path.join(P.dataDir, 'couvertures-isbn.json');
    const c = JSON.parse(readFileSync(cf, 'utf8'));
    c.done = (c.done || []).filter((i) => !isbnFaits.has(i));
    writeFileSync(cf, JSON.stringify(c) + '\n');
  } catch {}
  writeFileSync(fichier, JSON.stringify({ maj: new Date().toISOString().slice(0, 10), faits: [...faits].sort() }) + '\n');
  console.log(`${ok} supprimées, ${ko} en erreur.`);
  if (ko) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
