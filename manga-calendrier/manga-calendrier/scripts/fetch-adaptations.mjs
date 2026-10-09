// Cherche, pour chaque série du calendrier manga, si elle a une adaptation animée (API publique AniList)
// et les plateformes de streaming connues. Résultat : data/adaptations.json (mémoire qui se complète d'une exécution à l'autre).
// Politesse : au plus MAX séries par exécution (120 par défaut), ~2 s entre deux requêtes.
//
// Usage normal :  node scripts/fetch-adaptations.mjs
// Test hors ligne : node scripts/fetch-adaptations.mjs --from-file test/mock-adaptations.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths, now, parisKey, addDays, loadAllManga, slugify } from './lib.mjs';
import { streams, sleep } from './anilist.mjs';

const ENDPOINT = 'https://graphql.anilist.co';
const MAX = Number(process.env.MAX_LOOKUPS) || 120;
const FORMATS = ['TV', 'TV_SHORT', 'ONA', 'MOVIE'];
const RANK = { RELEASING: 0, NOT_YET_RELEASED: 1, FINISHED: 2 };
const TITLE = 'title { romaji english native }';
const QUERY = `query ($s: String) {
  Page(perPage: 4) {
    media(search: $s, type: MANGA, sort: SEARCH_MATCH) {
      ${TITLE} synonyms
      relations { edges { relationType node { id type format status siteUrl ${TITLE} externalLinks { site url type isDisabled } } } }
    }
  }
}`;

export const namesOf = (m) => [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].map((t) => slugify(t || '')).filter(Boolean);

// Choisit, parmi les résultats d'une recherche, le manga dont un titre correspond exactement à la série, et en tire ses adaptations animées
export function pickAdaptations(media, slug) {
  const m = (media || []).find((x) => namesOf(x).includes(slug));
  if (!m) return [];
  return (m.relations?.edges || [])
    .filter((e) => e?.relationType === 'ADAPTATION' && e.node?.type === 'ANIME' && FORMATS.includes(e.node.format))
    .map((e) => e.node)
    .sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3))
    .slice(0, 2)
    .map((n) => ({
      id: n.id,
      t: String(n.title?.english || n.title?.romaji || '').slice(0, 200),
      st: n.status || '',
      f: n.format,
      u: /^https:\/\/anilist\.co\//.test(n.siteUrl || '') ? n.siteUrl : '',
      s: streams(n.externalLinks),
    }));
}

async function search(term, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'manga-calendrier/1.0' },
    body: JSON.stringify({ query: QUERY, variables: { s: term } }),
  });
  if (res.status === 429 && attempt <= 3) {
    const wait = (Number(res.headers.get('retry-after')) || 60) * 1000;
    console.log(`Limite de requêtes atteinte, nouvelle tentative dans ${Math.round(wait / 1000)} s…`);
    await sleep(wait);
    return search(term, attempt + 1);
  }
  if (!res.ok) throw new Error(`AniList a répondu avec le code ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Erreur AniList : ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data.Page.media;
}

const P = paths();
const today = parisKey(now());
const file = path.join(P.dataDir, 'adaptations.json');
let state = { series: {} };
try { if (existsSync(file)) state = JSON.parse(readFileSync(file, 'utf8')); } catch { /* fichier abîmé : on repart de zéro */ }
if (!state.series || typeof state.series !== 'object') state.series = {};

const fromIdx = process.argv.indexOf('--from-file');
const mock = fromIdx > -1 ? JSON.parse(readFileSync(process.argv[fromIdx + 1], 'utf8')).responses : null;

// séries du calendrier (hors annulées), celles qui ont une sortie à venir d'abord
const names = new Map(), upcoming = new Set();
for (const r of loadAllManga(P.dataDir)) {
  if (r.statut === 'annule') continue;
  const k = slugify(r.serie);
  if (!k) continue;
  if (!names.has(k)) names.set(k, r.serie);
  if (r.date >= today) upcoming.add(k);
}
const stale = (e) => {
  if (!e) return true;
  const age = e.a?.length ? (e.a.some((x) => x.st !== 'FINISHED') ? 7 : 60) : 21;
  return e.c <= addDays(today, -age);
};
const todo = [...names.keys()].filter((k) => stale(state.series[k]))
  .sort((a, b) => (upcoming.has(b) ? 1 : 0) - (upcoming.has(a) ? 1 : 0) || a.localeCompare(b));

let done = 0, found = 0;
for (const k of todo.slice(0, MAX)) {
  try {
    const media = mock ? (mock[k] || []) : await search(names.get(k));
    const a = pickAdaptations(media, k);
    state.series[k] = { c: today, a };
    done++; if (a.length) found++;
  } catch (e) {
    console.error(`Arrêt anticipé (${e.message}) : le travail déjà fait est conservé.`);
    break;
  }
  if (!mock) await sleep(2200);
}

state.generatedAt = now().toISOString();
mkdirSync(P.dataDir, { recursive: true });
writeFileSync(file, JSON.stringify(state, null, 1) + '\n');
console.log(`${done} série(s) vérifiée(s), ${found} avec adaptation animée ; ${Math.max(0, todo.length - done)} restante(s) pour les prochaines exécutions.`);
