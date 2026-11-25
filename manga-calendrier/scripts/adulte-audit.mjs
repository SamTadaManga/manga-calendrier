// Audit du contenu érotique ou pornographique : interroge des bases publiques sur CHAQUE série du site, croise avec nos autres signaux, écrit un CSV à relire.
//
//   node scripts/adulte-audit.mjs auditer [--limite=2500] [--minutes=300] [--sources=anilist,mangaupdates,jikan] [--refaire] [--serie=adresse]
//        Interroge les bases (reprend là où le passage précédent s'est arrêté : les résultats sont gardés dans data/audit-adulte-cache.json), puis écrit les CSV.
//   node scripts/adulte-audit.mjs csv
//        Réécrit seulement les CSV à partir des résultats déjà obtenus (sans internet).
//   node scripts/adulte-audit.mjs appliquer audit-adulte/audit-adulte.csv [audit-adulte/editeurs.csv]
//        Lit la colonne « decision » (retirer / conserver) et écrit audit-adulte/a-ajouter.json : à fusionner dans data/contenu-adulte.json (rubriques series, conserver, editeurs).
//        Ce script ne modifie jamais data/contenu-adulte.json lui-même : ce fichier est tenu à la main.
//
// Sources (publiques, sans clé) : AniList (drapeau « adulte », genre Hentai/Ecchi, étiquettes explicites), MangaUpdates (genres Adult, Hentai, Smut, Ecchi),
// MyAnimeList via Jikan (genres explicites ; facultatif, plus lent). Autres signaux : repères dans le résumé (adulte.mjs), scores des couvertures (modèle d'image), éditeur.
// Une série n'est jamais retirée par ce script : il propose, tu décides.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBnf, yearsOf } from './catalogue-bnf.mjs';
import { chargerAdulte, analyserTexte } from './adulte.mjs';
import { loadAllManga, slugify } from './lib.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ICI, '..', 'data');
const SORTIE = path.join(ICI, '..', 'audit-adulte');
const CACHE = path.join(DATA, 'audit-adulte-cache.json');
const SEUIL_TITRE = 0.85; // ressemblance minimale entre notre titre et celui de la base pour croire à la correspondance

export const flat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, ' ').replace(/&/g, ' et ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Ressemblance entre deux titres, de 0 à 1 (coefficient de Dice sur les mots ; 1 = mêmes mots). */
export function ressemblance(a, b) {
  const A = new Set(flat(a).split(' ').filter(Boolean)), B = new Set(flat(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let k = 0; for (const m of A) if (B.has(m)) k++;
  return (2 * k) / (A.size + B.size);
}

/** Étiquettes AniList qui parlent de sexe explicite (le nom compte, pas la casse). */
export const TAGS_EXPLICITES = ['nudity', 'rape', 'incest', 'prostitution', 'sex toys', 'group sex', 'cunnilingus', 'fellatio', 'masturbation', 'paizuri', 'ahegao', 'bondage', 'exhibitionism', 'bestiality', 'threesome', 'defloration', 'netorare', 'sexual abuse', 'footjob', 'handjob', 'tentacles', 'anal sex'];

/* -------------------------------------------------------------------------- appels aux bases */

const ATTENTE = { anilist: 800, mangaupdates: 450, jikan: 1100 }; // millisecondes entre deux appels vers le même site
const dernier = {};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function cadence(hote) { const d = (dernier[hote] || 0) + (ATTENTE[hote] || 500) - Date.now(); dernier[hote] = Math.max(Date.now(), dernier[hote] || 0) + (ATTENTE[hote] || 500); if (d > 0) await dormir(d); }

/** Requête JSON avec attente imposée, nouvel essai si le site dit d'attendre (429). Renvoie null en cas d'échec (le résultat n'est alors pas gardé). */
async function appeler(hote, url, options, f = fetch) {
  for (let essai = 0; essai < 4; essai++) {
    await cadence(hote);
    try {
      const r = await f(url, { ...options, signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'prochaintome-audit/1.0 (+https://prochaintome.fr)', accept: 'application/json', ...(options?.headers || {}) } });
      if (r.status === 429 || r.status >= 500) { const w = Number(r.headers?.get?.('retry-after')) || 20 * (essai + 1); await dormir(Math.min(w, 90) * 1000); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await dormir(3000 * (essai + 1)); }
  }
  return null;
}

const Q_ANILIST = 'query($s:String){Page(perPage:6){media(search:$s,type:MANGA,sort:SEARCH_MATCH){id siteUrl isAdult format genres title{romaji english native} synonyms tags{name rank}}}}';

/** Un candidat normalisé : { src, id, url, titres, adulte, genres, tags } */
export const lecteurs = {
  anilist: async (nom, f) => {
    const j = await appeler('anilist', 'https://graphql.anilist.co', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: Q_ANILIST, variables: { s: nom } }) }, f);
    if (!j) return undefined;
    return (j.data?.Page?.media || []).map((m) => ({ src: 'anilist', id: m.id, url: m.siteUrl, titres: [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].filter(Boolean), adulte: Boolean(m.isAdult), genres: m.genres || [], tags: (m.tags || []).filter((t) => t.rank >= 50).map((t) => t.name) }));
  },
  mangaupdates: async (nom, f) => {
    const j = await appeler('mangaupdates', 'https://api.mangaupdates.com/v1/series/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ search: nom, stype: 'title', per_page: 6 }) }, f);
    if (!j) return undefined;
    return (j.results || []).map((x) => ({ src: 'mangaupdates', id: x.record?.series_id, url: x.record?.url, titres: [x.record?.title, x.hit_title].filter(Boolean), adulte: false, genres: (x.record?.genres || []).map((g) => g.genre || g).filter(Boolean), tags: [] }));
  },
  jikan: async (nom, f) => {
    const j = await appeler('jikan', `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(nom)}&limit=6&sfw=false`, {}, f);
    if (!j) return undefined;
    return (j.data || []).map((m) => ({ src: 'jikan', id: m.mal_id, url: m.url, titres: [m.title, m.title_english, m.title_japanese, ...(m.titles || []).map((t) => t.title)].filter(Boolean), adulte: (m.explicit_genres || []).some((g) => /hentai/i.test(g.name)), genres: [...(m.genres || []), ...(m.explicit_genres || []), ...(m.themes || [])].map((g) => g.name), tags: [] }));
  },
};

/** Garde le candidat qui ressemble le plus à notre titre. Renvoie { c, sim } ou null. */
export function meilleur(nom, candidats) {
  let best = null;
  for (const c of candidats || []) { const sim = Math.max(0, ...c.titres.map((t) => ressemblance(nom, t))); if (!best || sim > best.sim) best = { c, sim }; }
  return best;
}

/** Ce qu'on garde en mémoire pour une source : le meilleur candidat, sans les détails inutiles. null = rien de comparable. */
export function resume(nom, candidats) {
  const b = meilleur(nom, candidats);
  if (!b || b.sim < 0.5) return null;
  const { c } = b;
  return { id: c.id, url: c.url, titre: c.titres[0], sim: Math.round(b.sim * 100) / 100, adulte: c.adulte, genres: c.genres, tags: c.tags };
}

/* -------------------------------------------------------------------------- jugement */

const aGenre = (r, re) => (r?.genres || []).some((g) => re.test(g));
const sur = (r) => r && r.sim >= SEUIL_TITRE; // correspondance de titre assez sûre pour s'appuyer sur la fiche

/**
 * Jugement à partir de tout ce qu'on sait. e : { a, m, j } (résumés par source), texte : résultat d'analyserTexte, img : [r18, r15] | null, editeurSuspect : booléen.
 * Renvoie { niveau, priorite, signaux, confiance }. Niveaux : porno, erotique, a-verifier, suggestif (ecchi), ras, inconnu.
 */
export function juger(e = {}, texte = { exclure: '', revoir: [] }, img = null, editeurSuspect = false) {
  const signaux = []; const sources = { porno: new Set(), erotique: new Set(), ecchi: new Set() };
  const noter = (n, src, msg) => { sources[n].add(src); signaux.push(`${src} : ${msg}`); };
  for (const [src, r] of [['AniList', e.a], ['MangaUpdates', e.m], ['MyAnimeList', e.j]]) {
    if (!sur(r)) continue;
    if (r.adulte) noter('porno', src, 'classé adulte');
    if (aGenre(r, /^hentai$/i)) noter('porno', src, 'genre Hentai');
    if (aGenre(r, /^(smut|erotica)$/i)) noter('erotique', src, 'genre Smut/Erotica');
    if (src === 'MangaUpdates' && aGenre(r, /^adult$/i)) noter('erotique', src, 'genre Adult');
    const tags = (r.tags || []).filter((t) => TAGS_EXPLICITES.includes(String(t).toLowerCase()));
    if (tags.length >= 2) noter('erotique', src, `étiquettes : ${tags.slice(0, 4).join(', ')}`);
    if (aGenre(r, /^ecchi$/i)) noter('ecchi', src, 'genre Ecchi');
  }
  const trouves = [e.a, e.m, e.j].filter(sur).length;
  if (texte.exclure) signaux.push(`résumé : ${texte.exclure}`);
  if (texte.revoir?.length) signaux.push(`résumé : ${texte.revoir.join(', ')}`);
  const r18 = Array.isArray(img) ? Number(img[0]) || 0 : 0, r15 = Array.isArray(img) ? Number(img[1]) || 0 : 0;
  if (r18 >= 0.2) signaux.push(`couverture : r18 ${r18.toFixed(2)}`);
  if (r15 >= 0.6) signaux.push(`couverture : r15 ${r15.toFixed(2)}`);
  if (editeurSuspect) signaux.push('éditeur à forte part de séries adultes');
  let niveau, priorite;
  if (sources.porno.size || texte.exclure) { niveau = 'porno'; priorite = 100 + 10 * (sources.porno.size - 1); }
  else if (sources.erotique.size) { niveau = 'erotique'; priorite = 70 + 10 * (sources.erotique.size - 1); }
  else if (texte.revoir?.length || r18 >= 0.2 || r15 >= 0.6 || editeurSuspect) { niveau = 'a-verifier'; priorite = 30; }
  else if (sources.ecchi.size) { niveau = 'suggestif'; priorite = 20; }
  else niveau = trouves ? 'ras' : 'inconnu', priorite = 0;
  if (niveau !== 'ras' && niveau !== 'inconnu') {
    priorite += 8 * (texte.revoir?.length || 0) + Math.round(r18 * 30) + Math.round(r15 * 10) + (editeurSuspect ? 12 : 0) + (sources.ecchi.size && niveau !== 'suggestif' ? 5 : 0);
  }
  const confiance = niveau === 'ras' || niveau === 'inconnu' ? '' : (sources.porno.size + sources.erotique.size >= 2 || [e.a, e.m, e.j].filter((r) => r && r.sim >= 0.99).length >= 1 ? 'haute' : 'moyenne');
  return { niveau, priorite: Math.min(priorite, 200), signaux, confiance, trouves };
}

/* -------------------------------------------------------------------------- CSV */

const csvCase = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const versCsv = (colonnes, lignes) => '﻿' + [colonnes.join(';'), ...lignes.map((l) => colonnes.map((c) => csvCase(l[c])).join(';'))].join('\r\n') + '\r\n';
export function lireCsv(texte) {
  const t = String(texte).replace(/^﻿/, ''); const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  const [h, ...corps] = rows.filter((r) => r.some((x) => x !== ''));
  return (h ? corps : []).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}

export const COLONNES = ['decision', 'niveau', 'confiance', 'priorite', 'serie', 'editeur', 'tomes', 'annees', 'signaux', 'page_du_site', 'lien_anilist', 'lien_mangaupdates', 'lien_myanimelist', 'titre_trouve', 'ressemblance', 'image_r18', 'image_r15', 'adresse', 'note'];

/* -------------------------------------------------------------------------- données du site */

const lire = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

/** Toutes les séries encore visibles sur le site : { k, n, e, tomes, annees, texte }. */
export function seriesDuSite(dir = DATA) {
  const bnf = loadBnf(dir);
  const resumes = lire(path.join(dir, 'resumes-catalogue.json'), {}).resumes || {};
  const out = new Map();
  for (const s of bnf.series) { const [a, b] = yearsOf(s); out.set(s.k, { k: s.k, n: s.n, e: s.e || '', tomes: s.v.length, annees: a ? (a === b ? String(a) : `${a}-${b}`) : '', texte: resumes[s.k]?.t || '' }); }
  try { for (const r of loadAllManga(dir)) { const k = slugify(r.serie); if (!k || out.has(k)) continue; out.set(k, { k, n: r.serie, e: r.editeur || '', tomes: 0, annees: '', texte: '' }); } } catch { /* calendrier absent */ }
  return [...out.values()];
}

/** Éditeurs dont une grande part des séries est signalée : { nom, series, signalees, part }. */
export function editeursSuspects(lignes) {
  const m = new Map();
  for (const l of lignes) { if (!l.e) continue; const x = m.get(l.e) || { nom: l.e, series: 0, signalees: 0 }; x.series++; if (['porno', 'erotique'].includes(l.j.niveau)) x.signalees++; m.set(l.e, x); }
  return [...m.values()].map((x) => ({ ...x, part: x.series ? x.signalees / x.series : 0 }));
}
const estSuspect = (x) => x.signalees >= 3 && x.part >= 0.3;

function ligneCsv({ s, e, img, j }, base) {
  const { a, m, j: mal } = e;
  const trouves = [a, m, mal].filter(Boolean).sort((x, y) => y.sim - x.sim);
  return {
    decision: '', niveau: j.niveau, confiance: j.confiance, priorite: j.priorite, serie: s.n, editeur: s.e, tomes: s.tomes, annees: s.annees,
    signaux: j.signaux.join(' | '), page_du_site: `${base}/serie/${s.k}/`, lien_anilist: a?.url || '', lien_mangaupdates: m?.url || '', lien_myanimelist: mal?.url || '',
    titre_trouve: trouves[0]?.titre || '', ressemblance: trouves[0]?.sim ?? '',
    image_r18: Array.isArray(img) ? img[0] : '', image_r15: Array.isArray(img) ? img[1] : '', adresse: s.k, note: '',
  };
}

/** Construit les lignes (triées par priorité) et la liste des éditeurs à forte part de séries signalées. */
export function construire(series, cache, vus = {}) {
  const base = lire(path.join(ICI, '..', 'site.config.json'), {}).siteUrl || 'https://prochaintome.fr';
  const pre = series.map((s) => { const c = cache[s.k] || {}; const e = { a: c.anilist || undefined, m: c.mangaupdates || undefined, j: c.jikan || undefined }; const tx = analyserTexte(s.n, s.texte || ''); const img = vus[`series/${s.k}`] || null; return { s, e, tx, img, j: juger(e, tx, img, false) }; });
  const susp = new Set(editeursSuspects(pre.map((p) => ({ e: p.s.e, j: p.j }))).filter(estSuspect).map((x) => x.nom));
  const lignes = pre.map((p) => ({ s: p.s, e: p.e, img: p.img, j: susp.has(p.s.e) ? juger(p.e, p.tx, p.img, true) : p.j }));
  const rows = lignes.map((l) => ({ ...ligneCsv(l, base), _p: l.j.priorite }));
  rows.sort((x, y) => y._p - x._p || String(x.serie).localeCompare(String(y.serie), 'fr'));
  return { rows, editeurs: editeursSuspects(lignes.map((l) => ({ e: l.s.e, j: l.j }))).sort((x, y) => y.signalees - x.signalees || y.part - x.part) };
}

export function ecrireCsv(series, cache, vus, dir = SORTIE) {
  mkdirSync(dir, { recursive: true });
  const { rows, editeurs } = construire(series, cache, vus);
  const aRevoir = rows.filter((r) => !['ras', 'inconnu'].includes(r.niveau));
  writeFileSync(path.join(dir, 'audit-adulte.csv'), versCsv(COLONNES, aRevoir));
  writeFileSync(path.join(dir, 'audit-adulte-complet.csv'), versCsv(COLONNES, rows));
  const ed = editeurs.filter((x) => x.signalees > 0).map((x) => ({ decision: '', editeur: x.nom, series: x.series, signalees: x.signalees, part: `${Math.round(x.part * 100)} %`, note: '' }));
  writeFileSync(path.join(dir, 'editeurs.csv'), versCsv(['decision', 'editeur', 'series', 'signalees', 'part', 'note'], ed));
  const n = (v) => rows.filter((r) => r.niveau === v).length;
  const resume = { total: rows.length, porno: n('porno'), erotique: n('erotique'), 'a-verifier': n('a-verifier'), suggestif: n('suggestif'), ras: n('ras'), inconnu: n('inconnu') };
  return resume;
}

/** Lit les décisions des CSV et prépare ce qu'il faut ajouter à data/contenu-adulte.json. */
export function appliquer(csvSeries, csvEditeurs = '') {
  const out = { series: {}, conserver: {}, editeurs: [] };
  for (const r of lireCsv(csvSeries)) {
    const d = flat(r.decision), k = String(r.adresse || '').trim();
    if (!/^[a-z0-9-]{1,120}$/.test(k)) continue;
    const motif = `audit ${new Date().toISOString().slice(0, 10)} : ${r.niveau}${r.note ? ` (${r.note})` : ''}`;
    if (['retirer', 'supprimer', 'oui'].includes(d)) out.series[k] = motif;
    else if (['conserver', 'garder', 'non'].includes(d)) out.conserver[k] = r.note ? `audit : ${r.note}` : 'audit : vérifié, série conservée';
  }
  for (const r of lireCsv(csvEditeurs)) if (['retirer', 'supprimer', 'oui'].includes(flat(r.decision)) && r.editeur) out.editeurs.push(r.editeur);
  return out;
}

/* -------------------------------------------------------------------------- passage principal */

export async function auditer({ series, cache, sources, limite, fin, refaire = false, f = fetch, journal = console.log, sauver = () => {} }) {
  const desactive = new Set(); const echecs = {}; let faits = 0;
  const aFaire = series.filter((s) => refaire || sources.some((x) => cache[s.k]?.[x] === undefined));
  journal(`${series.length} séries au total, ${aFaire.length} à interroger, limite ${limite}.`);
  for (const s of aFaire.slice(0, limite)) {
    if (Date.now() > fin) { journal('Durée maximale atteinte : arrêt propre, reprise au prochain passage.'); break; }
    const entree = cache[s.k] || (cache[s.k] = {});
    await Promise.all(sources.filter((x) => !desactive.has(x) && (refaire || entree[x] === undefined)).map(async (x) => {
      const cand = await lecteurs[x](s.n, f);
      if (cand === undefined) { echecs[x] = (echecs[x] || 0) + 1; if (echecs[x] >= 15) { desactive.add(x); journal(`Source ${x} injoignable (15 échecs de suite) : ignorée pour ce passage.`); } return; }
      echecs[x] = 0; entree[x] = resume(s.n, cand);
    }));
    entree.t = new Date().toISOString().slice(0, 10);
    if (++faits % 50 === 0) { sauver(); journal(`${faits} séries interrogées…`); }
  }
  sauver();
  return { faits, desactive: [...desactive] };
}

const arg = (n, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'appliquer') {
    const f = process.argv[3]; if (!f) { console.error('Usage : appliquer audit-adulte/audit-adulte.csv [audit-adulte/editeurs.csv]'); process.exitCode = 1; return; }
    const ed = process.argv[4] || path.join(path.dirname(f), 'editeurs.csv');
    const r = appliquer(readFileSync(f, 'utf8'), existsSync(ed) ? readFileSync(ed, 'utf8') : '');
    mkdirSync(SORTIE, { recursive: true });
    writeFileSync(path.join(SORTIE, 'a-ajouter.json'), JSON.stringify(r, null, 1) + '\n');
    console.log(`À retirer : ${Object.keys(r.series).length} séries, ${r.editeurs.length} éditeurs. À conserver : ${Object.keys(r.conserver).length}. Écrit dans audit-adulte/a-ajouter.json.`);
    return;
  }
  if (cmd !== 'auditer' && cmd !== 'csv') { console.error('Usage : adulte-audit.mjs auditer|csv|appliquer'); process.exitCode = 1; return; }
  let series = seriesDuSite();
  const un = arg('serie'); if (un) series = series.filter((s) => s.k === un);
  const cache = lire(CACHE, {});
  const vus = lire(path.join(DATA, 'couvertures-controle.json'), { vus: {} }).vus || {};
  const sauver = () => { writeFileSync(CACHE, JSON.stringify(cache) + '\n'); };
  if (cmd === 'auditer') {
    const sources = arg('sources', 'anilist,mangaupdates').split(',').filter((x) => lecteurs[x]);
    const limite = Number(arg('limite', '2500')) || 2500, minutes = Number(arg('minutes', '300')) || 300;
    const r = await auditer({ series, cache, sources, limite, fin: Date.now() + minutes * 60000, refaire: process.argv.includes('--refaire'), sauver });
    console.log(`${r.faits} séries interrogées${r.desactive.length ? ` (sources ignorées : ${r.desactive.join(', ')})` : ''}.`);
  }
  const res = ecrireCsv(series, cache, vus);
  console.log(`CSV écrits dans audit-adulte/ : ${JSON.stringify(res)}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
