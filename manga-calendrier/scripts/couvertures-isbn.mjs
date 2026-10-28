// Récupère les couvertures de tomes par ISBN, les réduit en WebP et les range dans R2 sous isbn/<isbn13>.webp.
// Reprend là où il s'est arrêté : data/couvertures-isbn.json garde la liste des ISBN faits et des ISBN introuvables.
// Usage : node scripts/couvertures-isbn.mjs [--limit=2000] [--minutes=300] [--dry-run=dossier]
//   Variables : R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (sans elles : essai à blanc, rien n'est envoyé).
// Sources, dans l'ordre : Amazon.fr (adresse construite avec l'ISBN-10), puis Open Library. 1 requête par seconde au plus.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths, loadAllManga } from './lib.mjs';
import { loadBnf } from './catalogue-bnf.mjs';
import { targets } from './couvertures-lib.mjs';
import { r2Client } from './r2.mjs';

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split('=').slice(1).join('=') : d; };
const LIMIT = Number(arg('limit', 2000));
const DEADLINE = Date.now() + Number(arg('minutes', 300)) * 60000;
const DRY = arg('dry-run', '');
const WIDTH = 400;
const RETRY_DAYS = 90;
const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties; couvertures de tomes)';
const P = paths();
const file = path.join(P.dataDir, 'couvertures-isbn.json');
let state = { maj: '', done: [], absent: {} };
try { state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
const done = new Set(state.done);
const today = new Date().toISOString().slice(0, 10);
const recent = (d) => d && (Date.parse(today) - Date.parse(d)) / 864e5 < RETRY_DAYS;

const env = process.env;
const live = !DRY && env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY;
const r2 = live ? r2Client({ accountId: env.R2_ACCOUNT_ID, bucket: env.R2_BUCKET, accessKey: env.R2_ACCESS_KEY_ID, secretKey: env.R2_SECRET_ACCESS_KEY }) : null;
if (!live && !DRY) { console.error('Variables R2 absentes : indiquez --dry-run=dossier pour un essai à blanc.'); process.exit(1); }
if (DRY) mkdirSync(DRY, { recursive: true });
let sharp;
try { sharp = (await import('sharp')).default; } catch { console.error('Le module sharp est nécessaire : npm i --no-save sharp'); process.exit(1); }

const list = targets({ manga: loadAllManga(P.dataDir).filter((r) => r.statut !== 'annule'), bnf: loadBnf(P.dataDir), skip: (i) => done.has(i) || recent(state.absent[i]) }).slice(0, LIMIT);
console.log(`${list.length} ISBN à traiter (déjà faits : ${done.size}, introuvables récemment : ${Object.keys(state.absent).length}).`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sources = (t) => [
  ...(t.isbn10 ? [`https://m.media-amazon.com/images/P/${t.isbn10}.08.LZZZZZZZ.jpg`] : []),
  `https://covers.openlibrary.org/b/isbn/${t.isbn}-L.jpg?default=false`,
];
async function grab(t) {
  for (const u of sources(t)) {
    await sleep(1000);
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(buf).metadata();
      if (!meta.width || meta.width < 100 || meta.height < 140) continue; // pixel de remplacement ou vignette
      if (meta.height < meta.width) continue; // une couverture de manga est plus haute que large
      return await sharp(buf).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    } catch { /* source suivante */ }
  }
  return null;
}
const save = () => { state.maj = today; state.done = [...done].sort(); writeFileSync(file, JSON.stringify(state) + '\n'); };
let ok = 0, miss = 0, n = 0;
for (const t of list) {
  if (Date.now() > DEADLINE) { console.log('Temps imparti atteint, arrêt propre.'); break; }
  const img = await grab(t);
  if (!img) { state.absent[t.isbn] = today; miss++; }
  else {
    try {
      if (r2) await r2.put(`isbn/${t.isbn}.webp`, img, 'image/webp'); else writeFileSync(path.join(DRY, `${t.isbn}.webp`), img);
      done.add(t.isbn); delete state.absent[t.isbn]; ok++;
    } catch (e) { console.error(`${t.isbn} : ${e.message}`); }
  }
  if (++n % 100 === 0) { save(); console.log(`${n}/${list.length} : ${ok} couvertures, ${miss} introuvables`); }
}
save();
console.log(`Terminé : ${ok} couvertures ${r2 ? 'envoyées dans R2' : 'écrites dans ' + DRY}, ${miss} introuvables. Total en R2 : ${done.size}.`);
