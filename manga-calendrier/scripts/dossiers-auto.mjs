// Dossiers éditoriaux automatiques (sans IA, à partir des données) : un jeu de dossiers pour le mois en cours et le suivant.
//   dossier-nouvelles-series-AAAA-MM : les premiers tomes du mois, avec genres, auteur et résumé de l'éditeur
//   dossier-editions-speciales-AAAA-MM : collectors, coffrets, intégrales, artbooks… avec prix
//   dossier-<editeur>-AAAA-MM : les sorties d'un éditeur (à partir de 4 sorties dans le mois)
//   dossier-a-lire-dune-traite-AAAA-MM : une sélection tournante de séries terminées
// Les fichiers sont réécrits seulement quand leur contenu change. Ne les modifie pas à la main : ils sont dans content/auto/.
// Tout est factuel : rien n'est inventé, un dossier sans matière n'est pas créé.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { paths, now, parisKey, frShort, frMonth, addDays, loadConfig, loadAllManga, euro, slugify, isFirstVolume, mangaLabel } from './lib.mjs';

const P = paths();
const config = loadConfig(P.config);
const today = process.env.DATE || parisKey(now());
const draft = config.autoPublish === false;
mkdirSync(P.autoDir, { recursive: true });

const readJson = (f, d) => { try { return JSON.parse(readFileSync(path.join(P.dataDir, f), 'utf8')); } catch { return d; } };
const adapt = readJson('adaptations.json', {}).series || {};
const SYN = readJson('synopsis.json', {});
const manga = loadAllManga(P.dataDir).filter((r) => r.statut !== 'annule' && r.date);
const mangaSlugs = new Set(manga.map((r) => slugify(r.serie)).filter(Boolean));

// Même liste que TYPES dans build.mjs
const TYPES = [
  ['Collectors', /collector/], ['Coffrets', /coffret|\bbox\b/], ['Intégrales', /int[ée]grale|omnibus/],
  ['Artbooks et guides', /artbook|art book|fanbook|guide ?book|illustrations?/],
  ['Éditions deluxe et prestige', /deluxe|prestige|\bluxe\b|limitée|full color|perfect|tarot/],
  ['Éditions spéciales', /édition originale|edition originale|star [ée]dition|final [ée]dition|nouvelle édition|millenium|rerise|\bremake\b|ultimate/],
];
const typeOf = (r) => { const t = `${r.titre || ''} ${r.serie || ''}`.toLowerCase(); const f = TYPES.find(([, re]) => re.test(t)); return f ? f[0] : null; };
const GENRE_FR = { Action: 'action', Adventure: 'aventure', Comedy: 'comédie', Drama: 'drame', Ecchi: 'ecchi', Fantasy: 'fantasy', Horror: 'horreur', 'Mahou Shoujo': 'magical girl', Mecha: 'mecha', Music: 'musique', Mystery: 'mystère', Psychological: 'psychologique', Romance: 'romance', 'Sci-Fi': 'science-fiction', 'Slice of Life': 'tranche de vie', Sports: 'sport', Supernatural: 'surnaturel', Thriller: 'thriller' };

const q = (s) => String(s).replace(/"/g, '\\"');
const link = (r) => (mangaSlugs.has(slugify(r.serie)) ? `[${r.serie}](/serie/${slugify(r.serie)}/)` : r.serie);
const infoOf = (name) => adapt[slugify(name)]?.i || null;
const genres = (name) => (infoOf(name)?.g || []).map((g) => GENRE_FR[g]).filter(Boolean).slice(0, 3);
const authors = (name) => (infoOf(name)?.au || []).slice(0, 2);
const snippet = (r) => { const t = SYN[r.source]?.t; if (!t) return ''; const s = String(t).replace(/\s+/g, ' ').trim(); if (s.length < 40) return ''; const cut = s.slice(0, 230); return cut.length < s.length ? cut.replace(/\s+\S*$/, '') + '…' : s; };
const facts = (r) => [r.editeur, genres(r.serie).join(', '), authors(r.serie).join(' et ')].filter(Boolean).join(' · ');
const hash = (s) => parseInt(createHash('md5').update(s).digest('hex').slice(0, 8), 16);

let written = 0;
function out(name, date, title, description, body) {
  const f = path.join(P.autoDir, `${name}.md`);
  const text = `---\ntitle: "${q(title)}"\ndate: ${date}\ndescription: "${q(description)}"\nauto: true\ndraft: ${draft}\n---\n\n${body.trim()}\n`;
  if (existsSync(f) && readFileSync(f, 'utf8') === text) return;
  writeFileSync(f, text); written++;
}

const thisMonth = today.slice(0, 7);
const nextMonth = parisKey(new Date(Date.UTC(+thisMonth.slice(0, 4), +thisMonth.slice(5, 7), 1))).slice(0, 7);
const de = (mk) => { const n = frMonth(`${mk}-01`); return /^[aeiouéèêh]/i.test(n) ? `d'${n}` : `de ${n}`; };
const NOTE = (mk) => `Les dates viennent des plannings officiels des éditeurs et peuvent encore bouger : retrouve-les à jour dans le [calendrier manga](/sorties-manga/${slugify(frMonth(`${mk}-01`))}/).`;

for (const mk of [thisMonth, nextMonth]) {
  const rows = manga.filter((r) => r.date.startsWith(mk));
  if (!rows.length) continue;
  const date = `${mk}-01`, name = frMonth(`${mk}-01`);

  /* nouvelles séries */
  const fresh = rows.filter(isFirstVolume).sort((a, b) => a.date.localeCompare(b.date) || a.serie.localeCompare(b.serie, 'fr'));
  if (fresh.length >= 2) {
    const body = [
      `${fresh.length} nouvelles séries démarrent en France en ${name}. Pour chacune : l'éditeur, les genres et l'auteur quand on les connaît, et le résumé de l'éditeur. ${NOTE(mk)}`, '',
      ...fresh.slice(0, 20).flatMap((r) => [`## ${link(r)}`, '', `Tome 1 le ${frShort(r.date).replace(/\.$/, '')}${r.prix != null ? `, ${euro(r.prix)}` : ''}. ${facts(r)}`.trim(), ...(snippet(r) ? ['', `> ${snippet(r)}`] : [])
        , ''].filter((x, i, a) => !(x === '' && a[i - 1] === ''))),
      ...(fresh.length > 20 ? [`… et ${fresh.length - 20} autres sur le [calendrier du mois](/sorties-manga/${slugify(name)}/).`] : []),
    ].join('\n');
    out(`dossier-nouvelles-series-${mk}`, date, `Nouvelles séries manga de ${name} : par où commencer`, `${fresh.length} séries qui démarrent en ${name} en France, avec éditeur, genres, auteur et résumé.`, body);
  }

  /* éditions spéciales */
  const spec = rows.map((r) => [r, typeOf(r)]).filter(([, t]) => t);
  if (spec.length >= 3) {
    const sections = TYPES.map(([t]) => [t, spec.filter(([, x]) => x === t).map(([r]) => r).sort((a, b) => a.date.localeCompare(b.date))]).filter(([, l]) => l.length);
    const body = [
      `${spec.length} éditions spéciales sont annoncées pour ${name} : collectors, coffrets, intégrales, artbooks. Les tirages sont souvent limités : la précommande évite de passer à côté. ${NOTE(mk)} Pour comprendre les différences, lis notre [guide des éditions collector et coffret](/articles/guide-editions-collector-coffret-manga/).`, '',
      ...sections.flatMap(([t, l]) => [`## ${t}`, '', ...l.map((r) => `- **${mangaLabel(r)}** (${r.editeur}) : ${frShort(r.date)}${r.prix != null ? `, ${euro(r.prix)}` : ''} · ${mangaSlugs.has(slugify(r.serie)) ? `[la série](/serie/${slugify(r.serie)}/)` : ''}`.replace(/ · $/, '')), '']),
    ].join('\n');
    out(`dossier-editions-speciales-${mk}`, date, `Éditions collector, coffrets et éditions spéciales manga de ${name}`, `${spec.length} éditions spéciales manga annoncées pour ${name} en France, avec prix et dates.`, body);
  }

  /* par éditeur */
  const pubs = new Map();
  for (const r of rows) if (r.editeur && slugify(r.editeur)) (pubs.get(r.editeur) || pubs.set(r.editeur, []).get(r.editeur)).push(r);
  for (const [pub, l] of pubs) {
    if (l.length < 4) continue;
    l.sort((a, b) => a.date.localeCompare(b.date) || a.serie.localeCompare(b.serie, 'fr'));
    const nf = l.filter(isFirstVolume).length;
    const body = [
      `${pub} publie ${l.length} références manga en ${name}${nf ? `, dont ${nf} nouvelle${nf > 1 ? 's' : ''} série${nf > 1 ? 's' : ''}` : ''}. ${NOTE(mk)}`, '',
      ...l.slice(0, 40).map((r) => `- **${frShort(r.date)}** · ${mangaSlugs.has(slugify(r.serie)) ? `[${mangaLabel(r)}](/serie/${slugify(r.serie)}/)` : mangaLabel(r)}${r.prix != null ? ` · ${euro(r.prix)}` : ''}${isFirstVolume(r) ? ' · nouvelle série' : ''}`),
      ...(l.length > 40 ? ['', `… et ${l.length - 40} autres : voir la [page ${pub}](/editeur/${slugify(pub)}/).`] : []),
      '', `Toutes les sorties de l'éditeur, passées et à venir : [page ${pub}](/editeur/${slugify(pub)}/).`,
    ].join('\n');
    out(`dossier-${slugify(pub)}-${mk}`, date, `${pub} : les sorties manga de ${name}`, `${l.length} sorties manga ${pub} annoncées pour ${name}${nf ? `, dont ${nf} nouvelle${nf > 1 ? 's' : ''} série${nf > 1 ? 's' : ''}` : ''}.`, body);
  }

  /* séries terminées à lire d'une traite (tournante) */
  const done = [...new Set(manga.map((r) => slugify(r.serie)).filter(Boolean))].filter((k) => adapt[k]?.i?.st === 'FINISHED' && adapt[k].i.au?.length)
    .map((k) => ({ k, vols: manga.filter((r) => slugify(r.serie) === k) })).filter((s) => s.vols.length)
    .sort((a, b) => hash(mk + a.k) - hash(mk + b.k)).slice(0, 6);
  if (done.length >= 4) {
    const body = [
      `Des séries dont l'histoire est terminée au Japon, donc sans suite de scénario à attendre (l'édition française peut encore être en cours : vérifie la fiche de la série). Sélection renouvelée chaque mois, d'après les données publiques d'AniList. La suite complète est dans la [sélection des séries terminées](/series-terminees/).`, '',
      ...done.flatMap(({ k, vols }) => { const r = vols[vols.length - 1]; const i = adapt[k].i; const g = (i.g || []).map((x) => GENRE_FR[x]).filter(Boolean).slice(0, 3).join(', ');
        return [`## [${r.serie}](/serie/${k}/)`, '', [r.editeur, g, (i.au || []).slice(0, 2).join(' et '), i.y ? `depuis ${i.y}` : ''].filter(Boolean).join(' · '), '']; }),
    ].join('\n');
    out(`dossier-a-lire-dune-traite-${mk}`, date, `Séries manga terminées à lire d'une traite : la sélection ${de(mk)}`, `${done.length} séries terminées à lire d'une traite, avec éditeur, genres et auteur.`, body);
  }
}
console.log(`Dossiers automatiques : ${written} fichier(s) écrit(s).`);
