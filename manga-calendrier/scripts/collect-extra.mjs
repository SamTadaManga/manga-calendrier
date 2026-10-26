// Collecte « de complément » pour les éditeurs qui n'ont pas de planning lisible par un script
// (Mangetsu, Delcourt, Tonkam, Panini Manga, Soleil, Meian, Kurokawa, Ototo, Kazé/Crunchyroll).
//
// Piste 1 — Google Books (API publique gratuite) : tomes à venir par éditeur, avec ISBN et date quand elle est connue
//           -> data/manga-extra.csv (fusionné avec les autres sources, la saisie manuelle et les plannings des éditeurs gagnent toujours)
// Piste 2 — flux RSS / Atom des sites des éditeurs : articles d'annonce qui contiennent une date de sortie
//           -> data/annonces-a-verifier.csv (jamais publié sur le site : à relire, puis à recopier dans ton Google Sheets si c'est bon)
//
// Usage : node scripts/collect-extra.mjs      (clé facultative : GOOGLE_BOOKS_API_KEY, évite la limite de requêtes partagée)
// Test hors ligne : EXTRA_FIXTURES=test/fixtures/extra node scripts/collect-extra.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths, now, parisKey, addDays, loadManga } from './lib.mjs';
import { robotsAllows, splitTitle, decode } from './collectors.mjs';
import { recordStatus } from './status.mjs';

const P = paths();
const today = parisKey(now());
const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties; collecte quotidienne légère)';
const FIXTURES = process.env.EXTRA_FIXTURES ? path.resolve(process.env.EXTRA_FIXTURES) : '';
const KEY = process.env.GOOGLE_BOOKS_API_KEY || '';
const MONTHS_AHEAD = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, FIXTURES ? 0 : ms));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_');

let [y, m] = today.split('-').map(Number);
for (let i = 0; i < MONTHS_AHEAD; i++) if (++m > 12) { m = 1; y++; }
const last = `${y}-${String(m).padStart(2, '0')}-31`;

// pure : tous les titres de l'éditeur sont des mangas ; sinon on exige la catégorie « Manga » de Google Books
const PUBLISHERS = [
  { editeur: 'Mangetsu', query: 'Mangetsu', match: /mangetsu/i, pure: true },
  { editeur: 'Tonkam', query: 'Tonkam', match: /tonkam/i, pure: true },
  { editeur: 'Delcourt', query: 'Delcourt', match: /delcourt/i, pure: false },
  { editeur: 'Panini Manga', query: 'Panini', match: /panini/i, pure: false },
  { editeur: 'Soleil', query: 'Soleil', match: /soleil/i, pure: false },
  { editeur: 'Meian', query: 'Meian', match: /meian/i, pure: true },
  { editeur: 'Kurokawa', query: 'Kurokawa', match: /kurokawa/i, pure: true },
  { editeur: 'Ototo', query: 'Ototo', match: /ototo/i, pure: true },
  { editeur: 'Kazé', query: 'Kazé', match: /kaz[ée]|crunchyroll/i, pure: true },
];
const SITES = [
  { editeur: 'Mangetsu', origin: 'https://www.mangetsu.fr' },
  { editeur: 'Soleil', origin: 'https://www.soleilmanga.com' },
  { editeur: 'Meian', origin: 'https://www.meian-editions.fr' },
  { editeur: 'Delcourt', origin: 'https://www.delcourt.fr' },
  { editeur: 'Ototo', origin: 'https://www.ototo.fr' },
];
const FEED_PATHS = ['/feed/', '/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml'];

/* ----------------------------------------------------------- réseau */
const robotsCache = new Map();
async function robotsOf(origin) {
  if (FIXTURES) return '';
  if (!robotsCache.has(origin)) {
    let txt = '';
    try { const r = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA } }); if (r.ok) txt = await r.text(); } catch { /* tout est permis */ }
    robotsCache.set(origin, txt);
  }
  return robotsCache.get(origin);
}
async function fetchText(url, fixtureName, { robots = true } = {}) {
  if (FIXTURES) {
    const f = path.join(FIXTURES, fixtureName);
    return existsSync(f) ? { status: 200, text: readFileSync(f, 'utf8') } : { status: 404, text: '' };
  }
  const u = new URL(url);
  if (robots && !robotsAllows(await robotsOf(u.origin), u.pathname)) return { status: 0, text: '', blocked: true };
  await sleep(1800);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

/* ----------------------------------------------------------- piste 1 : Google Books */
export function booksToRows(json, pub, { first, lastDay }) {
  const out = [];
  for (const it of json?.items || []) {
    const v = it.volumeInfo || {};
    if (!pub.match.test(String(v.publisher || ''))) continue;
    const cats = [].concat(v.categories || []).join(' ');
    if (!pub.pure && !/manga/i.test(cats)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.publishedDate || ''))) continue; // dates incomplètes (année ou mois seuls) ignorées
    if (v.publishedDate < first || v.publishedDate > lastDay) continue;
    const isbn = (v.industryIdentifiers || []).map((x) => (x.type === 'ISBN_13' ? x.identifier : '')).find(Boolean) || '';
    if (!/^97[89]\d{10}$/.test(isbn)) continue;
    let full = decode(v.title || '');
    if (v.subtitle && !/\b(?:tome|t\.?|vol)\s*\d+/i.test(full)) full = `${full} ${decode(v.subtitle)}`;
    const { serie, tome, titre } = splitTitle(full);
    if (!serie) continue;
    out.push({ date: v.publishedDate, editeur: pub.editeur, serie, tome, titre, isbn, prix: null, source: '', cover: '', note: 'Google Books (à vérifier)' });
  }
  return out;
}

const file = path.join(P.dataDir, 'manga-extra.csv');
const previous = existsSync(file) ? loadManga(file) : [];
const HEADER = ['Date de sortie', 'Éditeur', 'Série', 'Tome', 'Titre du tome (facultatif)', 'ISBN-13', 'Prix (€)', 'Statut', 'Source officielle (lien)', 'Vérifié le', 'Couverture (lien)', 'Notes'];
const cell = (v) => { const s = String(v ?? ''); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const result = [];
const report = [];
let quota = false;
for (const pub of PUBLISHERS) {
  let rows = [];
  let seenItems = 0;
  if (!quota) {
    try {
      for (let page = 0; page < 3 && !quota; page++) {
        const url = `https://www.googleapis.com/books/v1/volumes?q=inpublisher:%22${encodeURIComponent(pub.query)}%22&orderBy=newest&printType=books&langRestrict=fr&maxResults=40&startIndex=${page * 40}${KEY ? `&key=${encodeURIComponent(KEY)}` : ''}`;
        const r = await fetchText(url, `google_${slug(pub.editeur)}_${page + 1}.json`, { robots: false });
        if (r.status === 429 || r.status === 403) { quota = true; console.log(`Google Books : limite de requêtes atteinte (code ${r.status}), reprise à la prochaine exécution.`); break; }
        if (r.status !== 200) break;
        const json = JSON.parse(r.text);
        seenItems += (json.items || []).length;
        rows.push(...booksToRows(json, pub, { first: today, lastDay: last }));
        if ((json.items || []).length < 40) break;
      }
    } catch (e) { console.log(`${pub.editeur} : échec Google Books (${e.message})`); }
  }
  const seen = new Set();
  rows = rows.filter((r) => (seen.has(r.isbn) ? false : seen.add(r.isbn)));
  if (rows.length) { result.push(...rows); report.push(`${pub.editeur} : ${rows.length}`); }
  else {
    const old = previous.filter((r) => r.editeur === pub.editeur && r.date >= today);
    result.push(...old.map((r) => ({ ...r, note: r.notes || 'Google Books (à vérifier)' })));
    report.push(`${pub.editeur} : 0 (${seenItems} titres vus, ${old.length} anciennes conservées)`);
  }
}
result.sort((a, b) => a.date.localeCompare(b.date) || a.editeur.localeCompare(b.editeur) || a.serie.localeCompare(b.serie, 'fr'));
const lines = [HEADER.join(',')];
for (const r of result) {
  lines.push([r.date, r.editeur, r.serie, r.tome, r.titre, r.isbn, '', 'Annoncé', r.source, today, r.cover || '', r.note].map(cell).join(','));
}
mkdirSync(P.dataDir, { recursive: true });
const out = lines.join('\n') + '\n';
if (!existsSync(file) || readFileSync(file, 'utf8') !== out) writeFileSync(file, out);
console.log(`Google Books : ${result.length} sorties — ${report.join(' | ')}`);
{
  const fresh = result.filter((r) => r.note === 'Google Books (à vérifier)').length;
  recordStatus(P.dataDir, 'Complément · Google Books', { ok: !quota && result.length > 0, count: result.length, note: quota ? 'limite de requêtes atteinte' : result.length ? '' : 'aucun tome trouvé' });
}

/* ----------------------------------------------------------- piste 2 : flux RSS */
const MOIS = { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 };
const pad = (n) => String(n).padStart(2, '0');
// Cherche « sortie le 15 novembre (2026) » ou « le 15/11/2026 » à côté d'un mot de sortie
export function releaseDate(text, pubKey) {
  const t = decode(String(text).replace(/<[^>]*>/g, ' '));
  const near = /(?:sort(?:ie|ira|iront)|parution|paraîtr?a|paraitra|disponible|en librairie|librairies)[^.!?]{0,80}/gi;
  for (const seg of t.match(near) || []) {
    let m = seg.match(/\b(\d{1,2})(?:er)?\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?/i);
    if (m) {
      const mo = MOIS[m[2].toLowerCase()];
      let yr = m[3] ? Number(m[3]) : Number(pubKey.slice(0, 4)) + (mo < Number(pubKey.slice(5, 7)) ? 1 : 0);
      return `${yr}-${pad(mo)}-${pad(m[1])}`;
    }
    m = seg.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  }
  return null;
}
export function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/g)) {
    const b = m[0];
    const pick = (re) => decode(((b.match(re) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/);
    const link = pick(/<link[^>]*>([^<]+)<\/link>/) || ((b.match(/<link[^>]*\bhref="([^"]+)"/) || [])[1] || '');
    const date = pick(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/);
    const body = (b.match(/<(?:content:encoded|description|summary|content)[^>]*>([\s\S]*?)<\/(?:content:encoded|description|summary|content)>/) || [])[1] || '';
    items.push({ title, link, date, body: body.replace(/<!\[CDATA\[|\]\]>/g, '') });
  }
  return items;
}

const found = [];
const feedReport = [];
for (const site of SITES) {
  let feed = null;
  const candidates = [];
  try {
    const home = await fetchText(`${site.origin}/`, `home_${slug(site.editeur)}.html`);
    for (const l of home.text.matchAll(/<link\b[^>]*type="application\/(?:rss|atom)\+xml"[^>]*>/gi)) {
      const h = (l[0].match(/href="([^"]+)"/) || [])[1];
      if (h) { try { candidates.push(new URL(h.replace(/&amp;/g, '&'), site.origin).href); } catch { /* adresse invalide */ } }
    }
  } catch { /* accueil illisible : on tente les adresses classiques */ }
  for (const p of FEED_PATHS) candidates.push(site.origin + p);
  for (const url of [...new Set(candidates)].slice(0, 8)) {
    try {
      const r = await fetchText(url, `feed_${slug(site.editeur)}.xml`);
      if (r.status === 200 && /<(rss|feed)\b/i.test(r.text.slice(0, 800))) { feed = { url, items: parseFeed(r.text) }; break; }
    } catch { /* adresse suivante */ }
  }
  if (!feed) { feedReport.push(`${site.editeur} : aucun flux`); continue; }
  let withDate = 0;
  for (const it of feed.items) {
    const d = releaseDate(`${it.title}. ${it.body}`, today);
    if (!d || d < today || d > addDays(today, 200)) continue;
    withDate++;
    found.push({ d, editeur: site.editeur, title: it.title, link: it.link, pub: it.date, extract: decode(it.body.replace(/<[^>]*>/g, ' ')).slice(0, 220) });
  }
  feedReport.push(`${site.editeur} : ${feed.items.length} articles, ${withDate} avec une date de sortie (${feed.url})`);
}
found.sort((a, b) => a.d.localeCompare(b.d) || a.editeur.localeCompare(b.editeur));
const review = ['Date de sortie annoncée,Éditeur,Titre de l\'article,Lien,Date de l\'article,Extrait'].concat(
  found.map((r) => [r.d, r.editeur, r.title, r.link, r.pub, r.extract].map(cell).join(',')));
const revFile = path.join(P.dataDir, 'annonces-a-verifier.csv');
const revOut = review.join('\n') + '\n';
if (!existsSync(revFile) || readFileSync(revFile, 'utf8') !== revOut) writeFileSync(revFile, revOut);
console.log(`Flux RSS : ${found.length} annonce(s) avec date — ${feedReport.join(' | ')}`);
recordStatus(P.dataDir, 'Complément · Flux RSS', { ok: feedReport.some((l) => !/aucun flux/.test(l)), count: found.length, note: feedReport.every((l) => /aucun flux/.test(l)) ? 'aucun flux trouvé' : '' });
