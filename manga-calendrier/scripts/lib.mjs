// Fonctions communes : dates (heure de Paris), CSV, Markdown, calendrier iCal.
// Aucune dépendance externe : tout tourne avec Node 20+ (Node 22 recommandé).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TZ = 'Europe/Paris';

// Chemins (modifiables par variables d'environnement, utile pour les tests)
export function paths() {
  const r = (name, def) => path.resolve(ROOT, process.env[name] || def);
  return {
    config: r('CONFIG_FILE', 'site.config.json'),
    dataDir: r('DATA_DIR', 'data'),
    articlesDir: r('ARTICLES_DIR', 'content/articles'),
    autoDir: r('AUTO_DIR', 'content/auto'),
    outDir: r('OUT_DIR', 'dist'),
  };
}

// "Maintenant" (peut être forcé avec NOW=2026-10-12T07:00:00Z pour les tests)
export const now = () => (process.env.NOW ? new Date(process.env.NOW) : new Date());

export function loadConfig(file) {
  const c = JSON.parse(readFileSync(file, 'utf8'));
  c.legal = c.legal || {};
  return c;
}

/* ------------------------------------------------------------------ dates */
const pad = (n) => String(n).padStart(2, '0');

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function parisParts(date) {
  const o = {};
  for (const p of partsFmt.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, ss: +o.second };
}
export function parisKey(date) {
  const p = parisParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
export function parisHM(date) {
  const p = parisParts(date);
  return `${pad(p.hh)} h ${pad(p.mm)}`;
}
function tzOffsetMs(date) {
  const p = parisParts(date);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(date.getTime() / 1000) * 1000;
}
// Instant (UTC) correspondant à minuit à Paris pour une date "AAAA-MM-JJ"
export function parisMidnight(key) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMs(new Date(guess)));
}
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const weekdayOfKey = (key) => new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = dimanche, 1 = lundi
const keyDate = (key) => new Date(`${key}T12:00:00Z`);
export const frDate = (key) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(keyDate(key));
export const frDayMonth = (key) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(keyDate(key));
export const frShort = (key) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(keyDate(key));
export const frMonth = (key) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(keyDate(key));
export const ucfirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function validYMD(y, mo, d) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
// Accepte AAAA-MM-JJ et JJ/MM/AAAA (export français de Google Sheets / Excel)
export function parseDate(s) {
  s = String(s ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return validYMD(y, +m[2], +m[1]);
  }
  return null;
}

/* -------------------------------------------------------------------- CSV */
function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const delim = detectDelimiter(text.split(/\r?\n/, 1)[0] || '');
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const normHeader = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const FIELDS = [
  ['date', 'date'], ['editeur', 'editeur'], ['serie', 'serie'], ['tome', 'tome'], ['titre', 'titre'],
  ['isbn', 'isbn'], ['prix', 'prix'], ['statut', 'statut'], ['source', 'source'], ['notes', 'notes'],
];

export const STATUT_LABEL = { annonce: 'Annoncé', confirme: 'Confirmé', paru: 'Paru', reporte: 'Reporté', annule: 'Annulé' };
const normStatut = (s) => {
  const n = normHeader(s);
  return n in STATUT_LABEL ? n : 'annonce';
};
const safeHttp = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

// Lit data/manga.csv (colonnes du modèle Google Sheets) et renvoie des sorties propres, triées par date.
export function loadManga(file) {
  if (!existsSync(file)) return [];
  return parseMangaCSV(readFileSync(file, 'utf8'));
}
export function parseMangaCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const idx = {};
  rows[0].forEach((h, i) => {
    const n = normHeader(h);
    for (const [prefix, field] of FIELDS) {
      if (n.startsWith(prefix)) {
        if (!(field in idx)) idx[field] = i;
        break;
      }
    }
  });
  const out = [];
  for (const r of rows.slice(1)) {
    const get = (f) => (idx[f] !== undefined ? String(r[idx[f]] ?? '').trim() : '');
    const date = parseDate(get('date'));
    const serie = get('serie');
    if (!date || !serie || /^exemple\b/i.test(serie)) continue; // ligne vide ou ligne d'exemple du modèle
    const prixNum = parseFloat(get('prix').replace(',', '.').replace(/[^0-9.]/g, ''));
    out.push({
      date, serie,
      editeur: get('editeur'),
      tome: get('tome'),
      titre: get('titre'),
      isbn: get('isbn').replace(/[^0-9Xx]/g, ''),
      prix: Number.isFinite(prixNum) ? prixNum : null,
      statut: normStatut(get('statut')),
      source: safeHttp(get('source')),
      notes: get('notes'),
    });
  }
  const cmp = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true });
  return out.sort((a, b) => cmp(a.date, b.date) || cmp(a.editeur, b.editeur) || cmp(a.serie, b.serie) || cmp(a.tome, b.tome));
}
// Fusionne la saisie manuelle (manga.csv) et la collecte automatique (manga-auto.csv) : la saisie manuelle gagne.
const keyOf = (r) => (r.isbn.length >= 10 ? `i:${r.isbn}` : `s:${slugify(r.serie)}|${r.tome}`);
const altKey = (r) => `s:${slugify(r.serie)}|${r.tome}`;
export function loadAllManga(dir) {
  const manual = loadManga(path.join(dir, 'manga.csv'));
  const auto = loadManga(path.join(dir, 'manga-auto.csv'));
  const taken = new Set(manual.flatMap((r) => (r.tome ? [keyOf(r), altKey(r)] : [keyOf(r)])));
  const seen = new Set();
  const kept = auto.filter((r) => {
    const ks = [keyOf(r), ...(r.tome && !r.titre ? [altKey(r)] : [])];
    if (ks.some((k) => taken.has(k) || seen.has(k))) return false;
    ks.forEach((k) => seen.add(k));
    return true;
  });
  const cmp = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true });
  return [...manual, ...kept].sort((a, b) => cmp(a.date, b.date) || cmp(a.editeur, b.editeur) || cmp(a.serie, b.serie) || cmp(a.tome, b.tome));
}
export const mangaLabel =(r) => `${r.serie}${r.tome ? ` tome ${r.tome}` : ''}`;
export const euro = (n) => `${n.toFixed(2).replace('.', ',')} €`;

/* ------------------------------------------------------------------ anime */
export function readAnime(dir) {
  const f = path.join(dir, 'anime.json');
  if (!existsSync(f)) return { generatedAt: null, episodes: [] };
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.episodes = Array.isArray(j.episodes) ? j.episodes : [];
    return j;
  } catch {
    return { generatedAt: null, episodes: [] };
  }
}
export const displayTitle = (t) => t?.english || t?.romaji || t?.native || 'Titre inconnu';

/* --------------------------------------------------------------- Markdown */
export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const slugify = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function inline(text) {
  let t = esc(text); // tout le HTML saisi est neutralisé
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
    /^(https?:\/\/|\/|#|mailto:)/i.test(url) ? `<a href="${url}" rel="noopener">${label}</a>` : m);
  return t;
}

// Markdown minimal : titres (#), paragraphes, listes (- ou 1.), gras, italique, liens, séparateur (---)
export function markdown(src) {
  const out = [];
  let para = [];
  let list = null;
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushL = () => {
    if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  for (const line of String(src).replace(/\r/g, '').split('\n')) {
    let m;
    if (!line.trim()) { flushP(); flushL(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushP(); flushL();
      const level = m[1].length === 1 ? 2 : m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^---+\s*$/.test(line)) { flushP(); flushL(); out.push('<hr>'); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushP();
      if (!list || list.tag !== 'ul') { flushL(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushP();
      if (!list || list.tag !== 'ol') { flushL(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]);
    } else { flushL(); para.push(line.trim()); }
  }
  flushP(); flushL();
  return out.join('\n');
}

export function parseFrontmatter(text) {
  text = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
      v = v.slice(1, -1).replace(/\\"/g, '"');
    }
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

// Articles : content/articles (rédigés) + content/auto (générés). Les fichiers commençant par _ sont ignorés.
export function loadArticles(dirs, { includeDrafts = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const { data, body } = parseFrontmatter(readFileSync(path.join(dir, f), 'utf8'));
      const date = parseDate(data.date);
      if (!data.title || !date) { console.warn(`⚠ ${f} ignoré : titre ou date manquant(e) dans l'en-tête.`); continue; }
      if (String(data.draft).toLowerCase() === 'true' && !includeDrafts) continue;
      const slug = slugify(f.replace(/\.md$/, ''));
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, title: data.title, date, description: data.description || '', auto: String(data.auto).toLowerCase() === 'true', body });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/* -------------------------------------------------------------------- iCal */
export const icsEscape = (s) =>
  String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { parts.push(cur); cur = ' '; bytes = 1; }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n');
}
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDay = (key) => key.replace(/-/g, '');

// events : { uid, summary, description?, url?, start: Date | 'AAAA-MM-JJ', end?: Date }
export function buildICS({ name, events }) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//manga-calendrier//FR', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(name)}`, 'X-WR-TIMEZONE:Europe/Paris'];
  const stamp = icsUtc(now());
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (typeof e.start === 'string') {
      L.push(`DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(addDays(e.start, 1))}`);
    } else {
      L.push(`DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(e.end || new Date(e.start.getTime() + 24 * 60000))}`);
    }
    L.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) L.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) L.push(`URL:${e.url}`);
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}
