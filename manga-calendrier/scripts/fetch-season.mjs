// Anime de la saison en cours et de la suivante (API publique AniList) → data/saison.json
// Une requête par saison, sans clé. En cas d'échec, le fichier existant est conservé.
// Test hors ligne : node scripts/fetch-season.mjs --from-file test/mock-season.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { streams } from './anilist.mjs';
import { recordStatus } from './status.mjs';
import { paths, now, parisKey } from './lib.mjs';

const ENDPOINT = 'https://graphql.anilist.co';
const QUERY = `query ($season: MediaSeason, $year: Int) {
  Page(perPage: 50) {
    media(season: $season, seasonYear: $year, type: ANIME, countryOfOrigin: "JP", isAdult: false, sort: POPULARITY_DESC) {
      id format status episodes popularity siteUrl coverImage { large } genres
      title { romaji english native } startDate { year month day }
      externalLinks { site url type isDisabled }
    }
  }
}`;
const FORMATS = ['TV', 'TV_SHORT', 'ONA', 'MOVIE'];
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

export function seasonOf(key) {
  const m = Number(key.slice(5, 7)), y = Number(key.slice(0, 4));
  return { season: SEASONS[Math.floor((m - 1) / 3)], year: y };
}
export function nextSeason({ season, year }) {
  const i = SEASONS.indexOf(season);
  return i === 3 ? { season: 'WINTER', year: year + 1 } : { season: SEASONS[i + 1], year };
}

export function pickSeason(media) {
  return (media || [])
    .filter((m) => m && FORMATS.includes(m.format) && Number.isInteger(m.id))
    .slice(0, 40)
    .map((m) => ({
      id: m.id,
      t: String(m.title?.english || m.title?.romaji || m.title?.native || '').slice(0, 200),
      f: m.format,
      st: m.status || '',
      n: Number.isInteger(m.episodes) ? m.episodes : 0,
      d: m.startDate?.year ? [m.startDate.year, m.startDate.month || 0, m.startDate.day || 0] : null,
      u: /^https:\/\/anilist\.co\//.test(m.siteUrl || '') ? m.siteUrl : '',
      c: /^https:\/\/[a-z0-9.-]*anilist\.co\//i.test(m.coverImage?.large || '') ? m.coverImage.large : '',
      g: (m.genres || []).filter((x) => /^[A-Za-z' -]{2,30}$/.test(x)).slice(0, 3),
      s: streams(m.externalLinks),
    }))
    .filter((x) => x.t);
}

async function request(vars, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'manga-calendrier/1.0' },
    body: JSON.stringify({ query: QUERY, variables: vars }),
  });
  if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt === 1) {
    console.log(`AniList a répondu ${res.status}, nouvelle tentative dans 30 s…`);
    await new Promise((r) => setTimeout(r, 30000));
    return request(vars, 2);
  }
  if (!res.ok) throw new Error(`AniList a répondu avec le code ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Erreur AniList : ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data.Page.media;
}

const P = paths();
const file = path.join(P.dataDir, 'saison.json');
const fromIdx = process.argv.indexOf('--from-file');
const mock = fromIdx > -1 ? JSON.parse(readFileSync(process.argv[fromIdx + 1], 'utf8')) : null;

const cur = seasonOf(parisKey(now()));
const wanted = [cur, nextSeason(cur)];
let old = { seasons: [] };
try { if (existsSync(file)) old = JSON.parse(readFileSync(file, 'utf8')); } catch { /* repart de zéro */ }

const seasons = [];
let failure = '';
for (const w of wanted) {
  try {
    const media = mock ? (mock[`${w.season}-${w.year}`] || []) : await request(w);
    const items = pickSeason(media);
    if (items.length) seasons.push({ ...w, items });
    else throw new Error('aucun anime renvoyé');
  } catch (e) {
    failure = e.message;
    const keep = (old.seasons || []).find((s) => s.season === w.season && s.year === w.year);
    console.log(`Saison ${w.season} ${w.year} : ${e.message}${keep ? ' (données précédentes conservées)' : ''}`);
    if (keep) seasons.push(keep);
  }
  if (!mock) await new Promise((r) => setTimeout(r, 2500));
}
const total = seasons.reduce((n, s) => n + s.items.length, 0);
if (seasons.length) {
  mkdirSync(P.dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ generatedAt: now().toISOString(), seasons }, null, 1) + '\n');
}
console.log(`Saisons : ${seasons.map((s) => `${s.season} ${s.year} (${s.items.length})`).join(', ') || 'aucune'}`);
recordStatus(P.dataDir, 'Anime · Saisons AniList', { ok: !failure && total > 0, count: total, note: failure });
