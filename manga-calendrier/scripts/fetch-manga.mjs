// Télécharge ton Google Sheets publié en CSV et l'enregistre dans data/manga.csv.
// Fonctionne seulement si le secret MANGA_CSV_URL est défini dans GitHub (voir README). Sinon, ne fait rien.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths, parseCSV, parseMangaCSV } from './lib.mjs';
import { recordStatus } from './status.mjs';
const P0 = paths();
const fail = (msg) => { recordStatus(P0.dataDir, 'Saisie · Google Sheets', { ok: false, note: msg }); console.error(msg); process.exit(1); };

const url = (process.env.MANGA_CSV_URL || '').trim();
if (!url) {
  console.log('MANGA_CSV_URL non défini : data/manga.csv est conservé tel quel.');
  process.exit(0);
}
if (!/^https:\/\//i.test(url)) {
  fail('MANGA_CSV_URL doit commencer par https://');
}

const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'manga-calendrier/1.0' } });
if (!res.ok) {
  fail(`Téléchargement impossible (code ${res.status}). data/manga.csv est conservé.`);
}
const text = (await res.text()).replace(/\r\n/g, '\n');
if (/^\s*<(!doctype|html)/i.test(text)) {
  fail("Le lien renvoie une page web et non un CSV : vérifie que la feuille est « publiée sur le web » au format CSV.");
}
const header = (parseCSV(text)[0] || []).join(' ').toLowerCase();
if (!/date/.test(header) || !/s[ée]rie/.test(header)) {
  fail("Les colonnes « Date » et « Série » sont introuvables : data/manga.csv est conservé.");
}

const P = paths();
const file = path.join(P.dataDir, 'manga.csv');
const out = text.endsWith('\n') ? text : `${text}\n`;
mkdirSync(P.dataDir, { recursive: true });
if (!existsSync(file) || readFileSync(file, 'utf8') !== out) writeFileSync(file, out);
recordStatus(P.dataDir, 'Saisie · Google Sheets', { ok: true, count: parseMangaCSV(out).length });
console.log(`${parseMangaCSV(out).length} sorties manga valides dans data/manga.csv.`);
