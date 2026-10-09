// Récupère le programme des épisodes d'anime des 8 prochains jours via l'API publique AniList
// et l'écrit dans data/anime.json. On ne garde que la fenêtre utile (pas d'archive, pas de collecte en masse).
//
// Usage normal :  node scripts/fetch-anime.mjs
// Test hors ligne : node scripts/fetch-anime.mjs --from-file test/mock-anilist.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths, now, parisKey, parisMidnight, addDays } from './lib.mjs';

const ENDPOINT = 'https://graphql.anilist.co';
const DAYS_AHEAD = 8;
const ALLOWED_COUNTRIES = ['JP']; // anime japonais ; ajoute 'CN', 'KR' pour d'autres pays
const MAX_PAGES = 30;

const QUERY = `query ($page: Int, $from: Int, $to: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      airingAt
      episode
      media { id format countryOfOrigin isAdult popularity siteUrl title { romaji english native } }
    }
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(page, from, to, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'manga-calendrier/1.0' },
    body: JSON.stringify({ query: QUERY, variables: { page, from, to } }),
  });
  if (res.status === 429 && attempt <= 3) {
    const wait = (Number(res.headers.get('retry-after')) || 60) * 1000;
    console.log(`Limite de requêtes atteinte, nouvelle tentative dans ${Math.round(wait / 1000)} s…`);
    await sleep(wait);
    return request(page, from, to, attempt + 1);
  }
  if (!res.ok) throw new Error(`AniList a répondu avec le code ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Erreur AniList : ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data.Page;
}

const P = paths();
const startKey = parisKey(now());
const from = Math.floor(parisMidnight(startKey).getTime() / 1000);
const to = Math.floor(parisMidnight(addDays(startKey, DAYS_AHEAD)).getTime() / 1000);

const fileIdx = process.argv.indexOf('--from-file');
const fromFile = fileIdx > -1;
let raw = [];
if (fromFile) {
  raw = JSON.parse(readFileSync(process.argv[fileIdx + 1], 'utf8')).data.Page.airingSchedules;
} else {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = await request(page, from, to);
    raw.push(...p.airingSchedules);
    if (!p.pageInfo.hasNextPage) break;
    await sleep(1500);
  }
}

const seen = new Set();
const episodes = raw
  .filter((x) => x.media && !x.media.isAdult && ALLOWED_COUNTRIES.includes(x.media.countryOfOrigin)
    && x.media.format !== 'MUSIC' && x.airingAt >= from && x.airingAt < to)
  .map((x) => ({
    airingAt: x.airingAt,
    episode: x.episode,
    mediaId: x.media.id,
    title: { romaji: x.media.title?.romaji || '', english: x.media.title?.english || '', native: x.media.title?.native || '' },
    format: x.media.format || '',
    popularity: x.media.popularity ?? 0,
    url: x.media.siteUrl || '',
  }))
  .filter((e) => {
    const k = `${e.mediaId}-${e.episode}-${e.airingAt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })
  .sort((a, b) => a.airingAt - b.airingAt || a.mediaId - b.mediaId);

if (!fromFile && episodes.length === 0) {
  console.error('Aucun épisode reçu : data/anime.json est conservé tel quel.');
  process.exit(1);
}

mkdirSync(P.dataDir, { recursive: true });
const text = '{\n'
  + `"generatedAt": ${JSON.stringify(now().toISOString())},\n`
  + `"rangeFrom": ${JSON.stringify(new Date(from * 1000).toISOString())},\n`
  + `"rangeTo": ${JSON.stringify(new Date(to * 1000).toISOString())},\n`
  + '"source": "AniList",\n'
  + '"episodes": [\n' + episodes.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n}\n';
writeFileSync(path.join(P.dataDir, 'anime.json'), text);
console.log(`${episodes.length} épisodes enregistrés (du ${startKey} pour ${DAYS_AHEAD} jours).`);
