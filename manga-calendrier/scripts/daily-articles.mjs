// Génère les articles automatiques du jour à partir des données (sans IA) :
//   - content/auto/anime-AAAA-MM-JJ.md        : épisodes d'anime du jour
//   - content/auto/manga-AAAA-MM-JJ.md        : sorties manga du jour
//   - content/auto/manga-semaine-AAAA-MM-JJ.md : sorties de la semaine (le lundi)
// Les fichiers sont réécrits à chaque exécution : ne les modifie pas à la main (écris tes articles dans content/articles).
import { writeFileSync, mkdirSync } from 'node:fs';
import { readChanges } from './changes.mjs';
import path from 'node:path';
import {
  paths, now, parisKey, parisHM, frDate, frShort, frDayMonth, ucfirst, addDays, weekdayOfKey,
  loadConfig, loadAllManga, readAnime, displayTitle, mangaLabel, euro,
} from './lib.mjs';

const P = paths();
const config = loadConfig(P.config);
const today = process.env.DATE || parisKey(now());
const draft = config.autoPublish === false; // false : les articles auto restent en brouillon jusqu'à validation

mkdirSync(P.autoDir, { recursive: true });
const q = (s) => String(s).replace(/"/g, '\\"');
const created = [];

function writeArticle(name, { title, description }, body) {
  const text = `---\ntitle: "${q(title)}"\ndate: ${today}\ndescription: "${q(description)}"\nauto: true\ndraft: ${draft}\n---\n\n${body.trim()}\n`;
  writeFileSync(path.join(P.autoDir, `${name}.md`), text);
  created.push(name);
}

/* ------------------------------------------------------------------ anime */
const anime = readAnime(P.dataDir);
const eps = anime.episodes
  .map((e) => ({ ...e, date: new Date(e.airingAt * 1000) }))
  .filter((e) => parisKey(e.date) === today)
  .sort((a, b) => a.airingAt - b.airingAt || a.mediaId - b.mediaId);

if (eps.length) {
  const label = (e) => `${displayTitle(e.title)}${e.format === 'MOVIE' ? ' (film)' : ''}`;
  const top = [...eps].sort((a, b) => b.popularity - a.popularity || a.airingAt - b.airingAt).slice(0, 5)
    .sort((a, b) => a.airingAt - b.airingAt);
  const body = [
    `Voici le programme des épisodes d'anime diffusés au Japon le ${frDate(today)}, avec les horaires convertis à l'heure de Paris. La disponibilité en France dépend ensuite des plateformes de streaming.`,
    '',
    '## Les plus populaires du jour',
    '',
    ...top.map((e) => `- **${label(e)}** : épisode ${e.episode}, à ${parisHM(e.date)}`),
    '',
    `## Programme complet (${eps.length} épisodes)`,
    '',
    ...eps.map((e) => `- ${parisHM(e.date)} : **${label(e)}** (épisode ${e.episode})`),
    '',
    'Données de diffusion : [AniList](https://anilist.co).',
  ].join('\n');
  writeArticle(`anime-${today}`, {
    title: `Anime : les épisodes du ${frDate(today)}`,
    description: `${eps.length} épisodes d'anime au programme le ${frDate(today)}, horaires à l'heure de Paris.`,
  }, body);
}

/* ------------------------------------------------------------------ manga */
const manga = loadAllManga(P.dataDir).filter((r) => r.statut !== 'annule');
const STATUT_TXT = {
  confirme: 'date confirmée', annonce: 'date annoncée, non confirmée', paru: 'déjà paru', reporte: 'date modifiée',
};
const line = (r) => {
  const parts = [`**${mangaLabel(r)}**`];
  if (r.prix != null) parts.push(euro(r.prix));
  parts.push(STATUT_TXT[r.statut]);
  let s = `- ${parts.join(' · ')}`;
  if (r.source) s += ` ([source](${r.source}))`;
  if (r.notes) s += `. ${r.notes.replace(/\s+/g, ' ')}`;
  return s;
};
const byPublisher = (rows) => {
  const map = new Map();
  for (const r of rows) {
    const k = r.editeur || 'Autres éditeurs';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()];
};

const todays = manga.filter((r) => r.date === today);
if (todays.length) {
  const body = [
    `Voici les sorties manga prévues en France le ${frDate(today)}.`,
    '',
    ...byPublisher(todays).flatMap(([pub, rows]) => [`## ${pub}`, '', ...rows.map(line), '']),
    'Les dates peuvent changer : consultez la source indiquée pour chaque sortie.',
  ].join('\n');
  writeArticle(`manga-${today}`, {
    title: `Manga : les sorties du ${frDate(today)}`,
    description: `${todays.length} sortie${todays.length > 1 ? 's' : ''} manga prévue${todays.length > 1 ? 's' : ''} en France le ${frDate(today)}.`,
  }, body);
}

if (weekdayOfKey(today) === 1) {
  const end = addDays(today, 6);
  const week = manga.filter((r) => r.date >= today && r.date <= end);
  if (week.length) {
    const days = [...new Set(week.map((r) => r.date))];
    const body = [
      `Voici les sorties manga prévues en France du ${frDate(today)} au ${frDate(end)}.`,
      '',
      ...days.flatMap((d) => [`## ${ucfirst(frDayMonth(d))}`, '', ...week.filter((r) => r.date === d).map((r) => line({ ...r, notes: r.notes })), '']),
      'Les dates peuvent changer : consultez la source indiquée pour chaque sortie.',
    ].join('\n');
    writeArticle(`manga-semaine-${today}`, {
      title: `Manga : les sorties de la semaine du ${frDate(today)}`,
      description: `${week.length} sortie${week.length > 1 ? 's' : ''} manga attendue${week.length > 1 ? 's' : ''} cette semaine en France.`,
    }, body);
  }
}

/* ------------------------------------------------------ changements de date */
{
  const evs = readChanges(path.join(P.dataDir, 'changes.json')).events.filter((e) => e.day === today);
  const name = (e) => `**${e.s}${e.t ? ` tome ${e.t}` : ''}** (${e.e})`;
  const src = (e) => (/^https?:\/\//.test(e.u || '') ? ` ([fiche éditeur](${e.u}))` : '');
  const groups = [
    ['Reportés', evs.filter((e) => e.type === 'date' && e.to > e.from), (e) => `- ${name(e)} : du ${frShort(e.from)} au ${frShort(e.to)}${src(e)}`],
    ['Avancés', evs.filter((e) => e.type === 'date' && e.to < e.from), (e) => `- ${name(e)} : du ${frShort(e.from)} au ${frShort(e.to)}${src(e)}`],
    ['Nouvelles sorties annoncées', evs.filter((e) => e.type === 'nouveau'), (e) => `- ${name(e)} : sortie le ${frShort(e.to)}${src(e)}`],
    ['Retirés du planning', evs.filter((e) => e.type === 'retire'), (e) => `- ${name(e)} : n'apparaît plus au planning de l'éditeur (était prévu le ${frShort(e.from)})${src(e)}`],
  ].filter(([, list]) => list.length);
  if (groups.length) {
    const body = [
      `Voici ce qui a bougé dans les plannings manga des éditeurs le ${frDate(today)}, relevé en comparant leurs pages avec celles de la veille.`,
      '',
      ...groups.flatMap(([title, list, fmt]) => [`## ${title}`, '', ...list.map(fmt), '']),
      'Les éditeurs peuvent corriger leurs dates à tout moment : la fiche de chaque tome fait foi.',
    ].join('\n');
    writeArticle(`manga-changements-${today}`, {
      title: `Manga : ${evs.length} changement${evs.length > 1 ? 's' : ''} dans les plannings du ${frDate(today)}`,
      description: `${evs.length} tome${evs.length > 1 ? 's' : ''} reporté${evs.length > 1 ? 's' : ''}, avancé${evs.length > 1 ? 's' : ''}, annoncé${evs.length > 1 ? 's' : ''} ou retiré${evs.length > 1 ? 's' : ''} des plannings le ${frDate(today)}.`,
    }, body);
  }
}

console.log(created.length ? `Articles générés pour le ${today} : ${created.join(', ')}` : `Aucun article automatique à générer pour le ${today}.`);
