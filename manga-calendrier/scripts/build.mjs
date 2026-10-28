// Génère le site statique dans dist/ à partir de data/, content/ et site.config.json.
// Commande : node scripts/build.mjs   (aucune dépendance à installer)
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readChanges, keyOf } from './changes.mjs';
import { isIsbn13, shopsFrom, buyUrl } from './shops.mjs';
import {
  paths, now, parisKey, parisHM, addDays, frDate, frLongDate, frDayMonth, frShort, frMonth, ucfirst,
  loadConfig, loadAllManga, readAnime, loadArticles, displayTitle, mangaLabel, euro, STATUT_LABEL,
  esc, slugify, weekdayOfKey, markdown, buildICS, isFirstVolume, mangaSlugOf, loadManga, parseCSV,
} from './lib.mjs';
import { readStatus } from './status.mjs';
import { loadBnf, yearsOf } from './catalogue-bnf.mjs';

const P = paths();
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(P.config);
const today = parisKey(now());
const siteUrlOk = /^https?:\/\//.test(config.siteUrl || '') && !/REMPLACE/i.test(config.siteUrl);
const base = siteUrlOk ? config.siteUrl.replace(/\/+$/, '') : '';
const host = siteUrlOk ? new URL(base).hostname : 'manga-calendrier.local';

const showCovers = config.showCovers === true;
const isPrivate = config.launched === false; // site privé : non indexé tant que « launched » n'est pas passé à true
const manga = loadAllManga(P.dataDir);
const anime = readAnime(P.dataDir);
/* Fraîcheur des données (data/status.json, écrit par les collecteurs) */
const STATUS = readStatus(P.dataDir).sources;
const hoursSince = (iso) => (iso ? (now().getTime() - new Date(iso).getTime()) / 36e5 : Infinity);
const agoFr = (iso) => {
  const h = hoursSince(iso);
  if (!Number.isFinite(h)) return 'jamais';
  if (h < 1) return "il y a moins d'une heure";
  if (h < 48) return `il y a ${Math.round(h)} h`;
  return `il y a ${Math.round(h / 24)} jours`;
};
const stampFr = (iso) => (iso ? `${frDate(parisKey(new Date(iso)))} à ${parisHM(new Date(iso))}` : '—');
const ANIME_STALE = !anime.generatedAt || hoursSince(anime.generatedAt) > 30;
const mangaUpdatedIso = Object.entries(STATUS).filter(([k, v]) => k.startsWith('Manga ·') && v.lastSuccess).map(([, v]) => v.lastSuccess).sort().pop() || null;
// Pont anime -> manga : un anime est relié à une série du calendrier si le titre du manga d'origine (AniList) ou celui de l'anime correspond
const SYN_FR = (() => { try { return JSON.parse(readFileSync(path.join(P.dataDir, 'synopsis-fr.json'), 'utf8')); } catch { return {}; } })();
const SYN = (() => { try { return JSON.parse(readFileSync(path.join(P.dataDir, 'synopsis.json'), 'utf8')); } catch { return {}; } })();
const mangaSlugs = new Set(manga.filter((r) => r.statut !== 'annule').map((r) => slugify(r.serie)).filter(Boolean));
const mangaOf = (e) => mangaSlugOf(e, mangaSlugs);
const adaptations = (() => {
  try { return JSON.parse(readFileSync(path.join(P.dataDir, 'adaptations.json'), 'utf8')).series || {}; } catch { return {}; }
})();
const ADAPT_ST = { RELEASING: 'en cours de diffusion', NOT_YET_RELEASED: 'à venir', FINISHED: 'terminé' };
const infoOf = (name) => adaptations[slugify(name)]?.i || null;
const GENRE_FR = { Action: 'Action', Adventure: 'Aventure', Comedy: 'Comédie', Drama: 'Drame', Ecchi: 'Ecchi', Fantasy: 'Fantasy', Horror: 'Horreur', 'Mahou Shoujo': 'Magical girl', Mecha: 'Mecha', Music: 'Musique', Mystery: 'Mystère', Psychological: 'Psychologique', Romance: 'Romance', 'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie', Sports: 'Sport', Supernatural: 'Surnaturel', Thriller: 'Thriller' };
const PUB_ST = { RELEASING: 'En cours de publication', FINISHED: 'Terminée', HIATUS: 'En pause', CANCELLED: 'Arrêtée', NOT_YET_RELEASED: 'À venir' };
const genreSlug = (g) => slugify(GENRE_FR[g] || g);
const GENRE_COUNT = (() => { const m = new Map(); for (const [k, v] of Object.entries(adaptations)) if (mangaSlugs.has(k) && Array.isArray(v?.i?.g)) for (const g of v.i.g) m.set(g, (m.get(g) || 0) + 1); return m; })();
const genreOk = (g) => Boolean(GENRE_FR[g]) && (GENRE_COUNT.get(g) || 0) >= 3; // une page de genre n'existe qu'à partir de 3 séries
const infoBox = (name) => {
  const i = infoOf(name);
  if (!i) return '';
  const rows = [
    ...(() => {
      const sc = i.sc || [], ar = i.ar || [];
      if (sc.length && ar.length && sc.join('|') !== ar.join('|')) return [['Scénario', sc.join(', ')], ['Dessin', ar.join(', ')]];
      return i.au?.length ? [['Auteur' + (i.au.length > 1 ? 's' : ''), i.au.join(', ')]] : [];
    })(),
    i.g?.length ? ['Genres', i.g.map((x) => (genreOk(x) ? `<a href="/genre/${genreSlug(x)}/">${esc(GENRE_FR[x] || x)}</a>` : esc(GENRE_FR[x] || x))).join(', '), true] : null,
    i.st && PUB_ST[i.st] ? ['Publication au Japon', PUB_ST[i.st] + (i.y ? ` (depuis ${i.y})` : '')] : (i.y ? ['Début de la série', String(i.y)] : null),
  ].filter(Boolean);
  return rows.length ? `<dl class="facts">${rows.map(([k, v, raw]) => `<div><dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd></div>`).join('')}</dl><p class="muted facts-src">Données : <a href="https://anilist.co" rel="noopener nofollow">AniList</a></p>` : '';
};
const adaptOf = (name) => (Array.isArray(adaptations[slugify(name)]?.a) ? adaptations[slugify(name)].a : []);
const eps = anime.episodes
  .map((e) => ({ ...e, date: new Date(e.airingAt * 1000) }))
  .map((e) => ({ ...e, key: parisKey(e.date), time: parisHM(e.date), ms: mangaOf(e) }));
const animeSlug = (e) => `${e.mediaId}${slugify(displayTitle(e.title)) ? `-${slugify(displayTitle(e.title))}` : ''}`;
const animeHref = (e) => `/anime/${animeSlug(e)}/`;
const articles = loadArticles([P.articlesDir, P.autoDir], { includeDrafts: process.env.INCLUDE_DRAFTS === '1' })
  .filter((a) => a.date <= today); // un article daté du futur sera publié le jour venu (programmation)

rmSync(P.outDir, { recursive: true, force: true });
const written = [];
const write = (rel, content) => {
  const f = path.join(P.outDir, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, content);
  written.push(rel);
};

/* ----------------------------------------------------------------- layout */
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const NAV = [['/', 'Accueil'], ['/manga/', 'Sorties manga'], ['/anime/', 'Calendrier anime'], ['/series/', 'Séries'], ['/ma-collection/', 'Ma collection'], ['/articles/', 'Actualités']];
// pages rattachées à une entrée du menu (pour la mettre en évidence)
const NAV_ALIAS = { '/mon-planning/': '/ma-collection/', '/mes-animes/': '/anime/', '/changements/': '/articles/', '/genre/': '/series/', '/genres/': '/series/', '/series-terminees/': '/series/', '/serie/': '/series/', '/editeur/': '/manga/', '/editeurs/': '/manga/', '/sorties-manga/': '/manga/', '/semaine/': '/manga/' };

const reportEmail = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(config.legal?.contactEmail || '') ? config.legal.contactEmail : '';
const reportUrl = /^https:\/\//.test(config.reportUrl || '') ? config.reportUrl : '';
const reportLink = (label = 'Signaler une erreur') => reportUrl
  ? `<a href="${esc(reportUrl)}" rel="noopener" target="_blank">${esc(label)}</a>`
  : reportEmail ? `<a href="/signaler/" data-report>${esc(label)}</a>` : '';
// Newsletter : le formulaire envoie l'adresse directement au service d'envoi choisi (MailerLite, Brevo, Buttondown…)
const NL = (() => {
  const n = config.newsletter || {};
  const action = /^https:\/\//.test(n.formAction || '') ? n.formAction : '';
  return { on: !!action, action, field: /^[\w.\[\]-]{1,40}$/.test(n.emailField || '') ? n.emailField : 'email', provider: String(n.provider || '').slice(0, 60), extra: n.hidden && typeof n.hidden === 'object' ? n.hidden : {} };
})();
const nlForm = (id = 'nl') => !NL.on ? '' : `<form class="nl-form" method="post" action="${esc(NL.action)}" target="_blank" rel="noopener">
<label for="${id}-mail" class="sr">Ton adresse e-mail</label>
<input type="email" id="${id}-mail" name="${esc(NL.field)}" placeholder="ton@email.fr" required autocomplete="email">
${Object.entries(NL.extra).filter(([k, v]) => /^[\w.\[\]-]{1,60}$/.test(k) && typeof v === 'string').map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
<button type="submit" class="chip chip-go">Je m'abonne</button>
<p class="muted nl-legal"><label><input type="checkbox" required> J'accepte de recevoir la newsletter de ${esc(config.siteName)} (un e-mail par semaine). Je peux me désabonner à tout moment depuis chaque e-mail. <a href="/mentions-legales/#newsletter">Données personnelles</a></label></p>
</form>`;
const THEME_BOOT = `<script>try{var t=localStorage.getItem('mc-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>`;

const assetV = (f) => { try { return createHash('md5').update(readFileSync(path.join(SCRIPTS, f))).digest('hex').slice(0, 8); } catch { return '0'; } };
const av = (f) => `/${f}?v=${assetV(f)}`;
/* Mesure d'audience : Cloudflare Web Analytics (sans cookie, sans donnée personnelle). Activée si "analytics": { "cloudflareToken": "..." } est dans site.config.json */
const CF_TOKEN = String(config.analytics?.cloudflareToken || '').trim();
const ANALYTICS = /^[a-f0-9]{32}$/i.test(CF_TOKEN)
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${CF_TOKEN}"}'></script>`
  : '';
const clampDesc = (t, max = 158) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); if (x.length <= max) return x; const c = x.slice(0, max - 1); return `${c.slice(0, Math.max(c.lastIndexOf(' '), 60)).replace(/[\s,;:(–-]+$/, '')}…`; };
function layout({ title, description, pathname, body, noindex = false, extraHead = '', image = '' }) {
  description = clampDesc(description);
  const ogImage = /^https:\/\//.test(image) ? image : (siteUrlOk ? `${base}/og.png` : '/og.png');
  // Titre de la page d'accueil court (≈60 caractères max, sinon Google le coupe) ; le nom du site n'est ajouté aux autres pages que s'il tient
  const fullTitle = pathname === '/' ? (`${config.siteName} : ${config.tagline}`.length <= 65 ? `${config.siteName} : ${config.tagline}` : `${config.siteName} : sorties manga en France et épisodes d'anime`) : (`${title} | ${config.siteName}`.length <= 62 ? `${title} | ${config.siteName}` : title);
  const canonical = siteUrlOk ? `${base}${pathname}` : '';
  const nav = NAV.map(([href, label]) => {
    const alias = Object.entries(NAV_ALIAS).find(([k]) => pathname.startsWith(k));
    const active = href === '/' ? pathname === '/' : (pathname.startsWith(href) || (alias && alias[1] === href));
    return `<a href="${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
${THEME_BOOT}
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
${noindex || isPrivate ? `<meta name="robots" content="noindex${isPrivate ? ', nofollow' : ''}">` : ''}
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${esc(config.siteName)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(ogImage)}">
${image ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'}
${image ? '' : `<meta property="og:image:alt" content="${esc(config.siteName)} : ${esc(config.tagline)}">`}
<meta name="twitter:card" content="${image ? 'summary' : 'summary_large_image'}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" href="/favicon-48.png" sizes="48x48">
<link rel="icon" type="image/png" href="/favicon-96.png" sizes="96x96">
<link rel="icon" type="image/svg+xml" href="/icon.svg" sizes="any">
<link rel="preload" href="/fonts/dela-400.woff" as="font" type="font/woff" crossorigin>
<link rel="preload" href="/fonts/zen-400.woff" as="font" type="font/woff" crossorigin>
<link rel="preload" href="/fonts/zen-900.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="${av('style.css')}">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#ffd21f">
<link rel="apple-touch-icon" href="/icon-192.png">
${siteUrlOk ? `<link rel="alternate" type="application/rss+xml" title="${esc(config.siteName)}" href="/feed.xml">` : ''}
${extraHead}
${ANALYTICS}
</head>
<body${pathname === '/404.html' ? ' data-404' : ''}>
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="site-header"><div class="wrap hbar"><a class="brand" href="/"><span class="mark" aria-hidden="true"></span>${esc(config.siteName)}</a><div class="tools"></div><nav aria-label="Navigation principale">${nav}</nav></div></header>
<main class="wrap" id="contenu">
${body}
</main>
<footer class="site-footer"><div class="wrap">
<p>Horaires des épisodes : <a href="https://anilist.co" rel="noopener">AniList</a>, diffusion japonaise. Dates des mangas : plannings officiels des éditeurs, susceptibles de changer.</p>
<p><a href="/manga.ics">Agenda manga (.ics)</a><a href="/anime.ics">Agenda anime (.ics)</a>${siteUrlOk ? '<a href="/feed.xml">Flux RSS</a>' : ''}<a href="/nouveautes/">Nouveautés</a><a href="/changements/">Changements</a><a href="/mes-animes/">Mes animes</a><a href="/mon-planning/">Mon planning</a>${NL.on ? '<a href="/newsletter/">Newsletter</a>' : ''}${reportLink()}<a href="/editeurs/">Éditeurs</a><a href="/genres/">Genres</a><a href="/partager/">Visuels à partager</a><a href="/etat/">État des données</a><a href="/mentions-legales/">Mentions légales</a></p>
</div></footer>
<script src="${av('suivi.js')}" defer></script>
<script src="${av('mesure.js')}" defer></script>
<script src="${av('visite.js')}" defer></script>
<script src="${av('clic.js')}" defer></script>
<script src="${av('recherche.js')}" defer></script>
<script src="${av('theme.js')}" defer></script>
</body>
</html>
`;
}
let searchSeries = [];
let searchCatalogue = [];
let catalogueHub = null;
const letterKey = (k) => { const c = String(k || '')[0] || ''; return /[a-z]/.test(c) ? c : '0-9'; };
function animeNotice() {
  if (!ANIME_STALE) return '';
  if (!anime.generatedAt) return '<p class="notice warn" role="status">Le programme des épisodes n\'a pas encore pu être récupéré. Il apparaîtra dès que la source (AniList) répondra.</p>';
  return `<p class="notice warn" role="status">Le programme n'a pas pu être actualisé depuis ${esc(agoFr(anime.generatedAt))} (source AniList indisponible). Les épisodes affichés viennent de la dernière mise à jour réussie, le ${esc(stampFr(anime.generatedAt))} : les horaires peuvent avoir changé. <a href="/etat/">État des données</a></p>`;
}
const eagerTop = (html) => { let n = 0; return html.replace(/<img class="cover-img"([^>]*?) loading="lazy"/g, (m, a) => (n++ < 2 ? `<img class="cover-img"${a} loading="eager" fetchpriority="high"` : m)); };
const page = (pathname, opts) => write(`${pathname.replace(/^\//, '')}index.html`, eagerTop(layout({ ...opts, pathname })));

/* ------------------------------------------------------------- composants */
const SEO_URLS = [];
const PUBS = { glenat: 'Glénat', kana: 'Kana', pika: 'Pika', 'ki-oon': 'Ki-oon', akata: 'Akata', delcourt: 'Delcourt', soleil: 'Soleil', kaze: 'Kazé', kurokawa: 'Kurokawa', meian: 'Meian', mangetsu: 'Mangetsu', 'panini-manga': 'Panini Manga' };
const pubKey = (e) => { const k = slugify(e || ''); return k in PUBS ? k : 'autre'; };
const weekday = (k) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`)).replace('.', '');
const dayNum = (k) => String(Number(k.slice(8)));
const wdc = (k) => `wd-${((weekdayOfKey(k) + 6) % 7) + 1}`; // 1 = lundi … 7 = dimanche : une couleur par jour de la semaine
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// « Ryukyu Buccaneer - Tome 01 - Édition collector » -> « Édition collector »
const TYPES = [
  ['collector', 'Collector', /collector/],
  ['coffret', 'Coffret', /coffret|\bbox\b/],
  ['integrale', 'Intégrale', /int[ée]grale|omnibus/],
  ['artbook', 'Artbook', /artbook|art book|fanbook|guide ?book|illustrations?/],
  ['deluxe', 'Deluxe et prestige', /deluxe|prestige|\bluxe\b|limitée|full color|perfect|tarot/],
  ['edition', 'Éditions spéciales', /édition originale|edition originale|star [ée]dition|final [ée]dition|nouvelle édition|millenium|rerise|\bremake\b|ultimate/],
];
const pubType = (r) => { const t = `${r.titre || ''} ${r.serie || ''}`.toLowerCase(); const f = TYPES.find(([, , re]) => re.test(t)); return f ? f[0] : 'standard'; };
function editionOf(r) {
  if (!r.titre) return '';
  let t = r.titre.replace(r.serie, '').replace(/^[\s,–-]*(?:tome|t\.?|vol\.?)\s*0*\d+\b/i, '').replace(/^[\s,–:-]+/, '').trim();
  if (t === r.titre.trim() && t.length > 60) t = '';
  return t;
}

const updatedIso = (anime.generatedAt ? new Date(anime.generatedAt) : now()).toISOString();
const changes = readChanges(path.join(P.dataDir, 'changes.json'));
const events = [...changes.events].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
const moves = new Map(); // tome -> dernier changement de date récent
for (const ev of [...changes.events].sort((a, b) => (a.day < b.day ? -1 : 1))) {
  if (ev.type === 'date' && ev.day >= addDays(today, -30)) moves.set(ev.k, ev);
}

const serieLink = (name) => (slugify(name) && mangaSlugs.has(slugify(name)) ? `<a class="slink" href="/serie/${slugify(name)}/">${esc(name)}</a>` : esc(name));

function changeItem(ev) {
  const pk = pubKey(ev.e);
  let cls, label, text;
  if (ev.type === 'date') {
    const later = ev.to > ev.from;
    [cls, label] = later ? ['s-reporte', 'Reporté'] : ['s-confirme', 'Avancé'];
    text = `du ${frShort(ev.from)} au ${frShort(ev.to)}`;
  } else if (ev.type === 'nouveau') {
    [cls, label, text] = ['s-confirme', 'Annoncé', `sortie le ${frShort(ev.to)}`];
  } else {
    [cls, label, text] = ['s-annule', 'Retiré du planning', `était prévu le ${frShort(ev.from)}`];
  }
  return `<li class="rel p-${pk}"><div class="rel-title"><strong>${serieLink(ev.s)}</strong>${ev.t ? ` <span class="tome">tome ${esc(ev.t)}</span>` : ''}</div>`
    + `<div class="meta"><span class="badge ${cls}">${label}</span><span>${esc(text)}</span><span class="pub">${esc(ev.e)}</span>${/^https?:\/\//.test(ev.u || '') ? `<a href="${esc(ev.u)}" rel="noopener nofollow">Fiche éditeur</a>` : ''}</div></li>`;
}

function tile(r) {
  const pk = pubKey(r.editeur);
  const label = `${r.serie}${r.tome ? ` tome ${r.tome}` : ''}`;
  const frame = coverBox(r.cover, `Couverture de ${label}`, 160, 240) + (isNewSeries(r) ? '<span class="cover-flag">★ Nouvelle série</span>' : '');
  const sl = slugify(r.serie) && mangaSlugs.has(slugify(r.serie)) ? `/serie/${slugify(r.serie)}/` : '';
  const cl = sl ? `<a class="tile-cover t-cover" href="${sl}" aria-label="${esc(label)} : page de la série">${frame}</a>` : `<a class="tile-cover t-cover" href="${esc(r.source || '/manga/')}" ${r.source ? 'rel="noopener nofollow"' : ''} aria-label="${esc(label)} : fiche éditeur">${frame}</a>`;
  // Chaque ligne a son emplacement (même vide) : les tuiles d'une même rangée restent alignées
  return `<li class="tile tile-aligned p-${pk}">${cl}`
    + `<div class="tile-body"><div class="t-title"><strong>${sl ? `<a href="${sl}">${esc(r.serie)}</a>` : esc(r.serie)}</strong>${r.tome ? `<span class="tome">tome ${esc(r.tome)}</span>` : ''}</div>`
    + `<div class="t-date"><div class="tile-date"><time datetime="${r.date}">${esc(frShort(r.date))}</time></div></div><div class="t-pub"><span class="pub">${esc(r.editeur || '')}</span></div>`
    + `<div class="t-follow"><button type="button" class="follow" data-s="${esc(slugify(r.serie))}" data-n="${esc(r.serie)}" hidden>Suivre</button></div><div class="t-shops">${buyBox(r, 'sm')}</div></div></li>`;
}

// « Nouvelle série » : tome 1 d'une série, hors rééditions et éditions spéciales, annoncé ou sorti depuis moins de 15 jours
const isNewSeries = (r) => isFirstVolume(r) && r.date >= addDays(today, -14);
const NEW_BADGE = '<span class="badge s-new">★ Nouvelle série</span>';
const PREMIERE_BADGE = '<span class="badge s-new">★ Épisode 1</span>';
const isPremiere = (e) => Number(e.episode) === 1 && e.format !== 'MOVIE';

function coverBox(src, alt, w = 200, h = 300) {
  const img = /^https:\/\//.test(src || '') ? `<img class="cover-img" src="${esc(src)}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  return `<div class="cover" aria-hidden="${img ? 'false' : 'true'}">${img}</div>`;
}
// tuile d'un tome (page de série)
/* Où acheter : un lien par boutique (adresse normale, ou lien d'affiliation si renseigné dans la config) */
const SHOPLIST = shopsFrom(config);
const AFFILIATE_ON = SHOPLIST.some((x) => x.sponsored);
const CART = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M1 1.5h2l1.2 6h5.6l1-4H3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="5" cy="10" r="1" fill="currentColor"/><circle cx="9" cy="10" r="1" fill="currentColor"/></svg>';
const buyBox = (r, size = '') => {
  if (!isIsbn13(r.isbn) || !SHOPLIST.length) return '';
  const verb = r.date > today ? 'Précommander' : 'Acheter';
  const sm = size === 'sm';
  const links = SHOPLIST.map((x) => `<a class="stream shop${size === 'lg' ? ' stream-lg' : ''} s-${esc(x.id)}" data-sh="${esc(x.id)}" data-k="${esc(slugify(r.serie))}" href="${esc(buyUrl(x, r.isbn))}" rel="${x.sponsored ? 'sponsored ' : ''}nofollow noopener" target="_blank" title="${verb} sur ${esc(x.name)}" aria-label="${verb} ${esc(mangaLabel(r))} sur ${esc(x.name)}">${sm ? esc(x.short || x.name) : `${CART}${esc(x.name)}`}</a>`).join('');
  return `<div class="shops${size === 'lg' ? ' shops-lg' : ''}${sm ? ' shops-sm' : ''}">${sm ? '' : `<span class="shops-l">${verb}</span>`}${links}</div>`;
};
/* Goodies : une recherche Amazon sur le nom de la série (résultats affichés par Amazon, rien n'est copié). Désactivable avec "goodies": false */
const AMZ = SHOPLIST.find((x) => x.id === 'amazon');
const GOODIES_ON = Boolean(AMZ) && config.goodies !== false;
/* Produits choisis à la main : data/goodies.csv (colonnes serie;asin). Un produit est tiré au hasard parmi ceux de la série, il change chaque jour. */
const GOODIES = (() => {
  const m = new Map();
  try {
    const t = readFileSync(path.join(P.dataDir, 'goodies.csv'), 'utf8');
    const [head, ...rows] = parseCSV(t);
    const iS = head.findIndex((h) => /^s[ée]rie$/i.test(h.trim())), iA = head.findIndex((h) => /^asin$/i.test(h.trim()));
    if (iS < 0 || iA < 0) return m;
    for (const r of rows) {
      const k = slugify(r[iS] || ''), a = String(r[iA] || '').trim().toUpperCase();
      if (k && /^[A-Z0-9]{10}$/.test(a)) m.set(k, [...new Set([...(m.get(k) || []), a])]);
    }
  } catch { /* pas de fichier : liens de recherche */ }
  return m;
})();
const dayHash = (s) => { let h = 0; for (const c of `${s}|${today}`) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const goodiesBox = (name) => {
  if (!GOODIES_ON || !name) return '';
  const picks = GOODIES.get(slugify(name));
  const direct = picks && picks.length ? `https://www.amazon.fr/dp/${picks[dayHash(name) % picks.length]}${AMZ.tag ? `?tag=${encodeURIComponent(AMZ.tag)}` : ''}` : '';
  const url = direct || `https://www.amazon.fr/s?k=${encodeURIComponent(`${name} goodies`).replace(/%20/g, '+')}${AMZ.tag ? `&tag=${encodeURIComponent(AMZ.tag)}` : ''}`;
  return `<div class="shops shops-lg"><span class="shops-l">Goodies</span><a class="stream shop stream-lg s-goodies" data-sh="goodies" data-k="${esc(slugify(name))}" href="${esc(url)}" rel="${AMZ.sponsored ? 'sponsored ' : ''}nofollow noopener" target="_blank" aria-label="Goodies ${esc(name)} sur Amazon">${CART}Goodies ${esc(name)} sur Amazon</a></div>`;
};
function volTile(r, noBuy = false) {
  const pk = pubKey(r.editeur);
  const label = mangaLabel(r);
  const cover = showCovers ? coverBox(r.cover, `Couverture de ${label}`) : '';
  const own = /^\d*$/.test(String(r.tome || '')) && slugify(r.serie) ? `<button type="button" class="own" data-s="${esc(slugify(r.serie))}" data-t="${esc(r.tome || '')}" aria-pressed="false" hidden>Je l'ai</button>` + `<select class="tst" data-s="${esc(slugify(r.serie))}" data-t="${esc(r.tome || '')}" aria-label="Statut de ce tome" hidden><option value="">Statut…</option><option value="a">À acheter</option><option value="p">Précommandé</option><option value="r">À lire</option><option value="l">Lu</option></select>` : '';
  const ed = editionOf(r);
  const mv = moves.get(keyOf(r));
  const moved = mv && mv.to === r.date ? `<span class="badge ${mv.to > mv.from ? 's-reporte' : 's-confirme'}">${mv.to > mv.from ? 'Reporté' : 'Avancé'}</span>` : '';
  const reli = !moved && r.date >= today ? (r.statut === 'confirme' ? '<span class="badge s-confirme" title="Date vérifiée">Date confirmée</span>' : r.statut === 'annonce' ? '<span class="badge s-estime" title="Date relevée dans le planning de l\'éditeur : elle peut encore bouger">Date estimée</span>' : '') : '';
  return `<li class="tile rel vol p-${pk}${r.date < today ? ' past' : ''}">`
    + `${r.source ? `<a class="tile-cover" href="${esc(r.source)}" rel="noopener nofollow" aria-label="${esc(label)} : fiche éditeur">${cover}</a>` : cover}`
    + `<div class="tile-body"><strong>${r.tome ? `Tome ${esc(r.tome)}` : esc(r.serie)}</strong>${ed ? `<span class="ed">${esc(ed)}</span>` : ''}`
    + `<div class="tile-date"><time datetime="${r.date}">${esc(frShort(r.date))}</time></div>`
    + `<span class="pub">${esc(r.editeur || '')}${r.prix != null ? ` · ${esc(euro(r.prix))}` : ''}</span>${isNewSeries(r) ? NEW_BADGE : ''}${moved}${reli}${own}${noBuy ? '' : buyBox(r)}</div></li>`;
}

const BADGE_TXT = { confirme: 'Date confirmée', reporte: 'Reporté', annule: 'Annulé' };
function releaseItem(r, showDate = false) {
  const pk = pubKey(r.editeur);
  const ed = editionOf(r);
  const mv = moves.get(keyOf(r));
  const moved = mv && mv.to === r.date ? `<span class="badge ${mv.to > mv.from ? 's-reporte' : 's-confirme'}">${mv.to > mv.from ? 'Reporté' : 'Avancé'} (avant : ${esc(frShort(mv.from))})</span>` : '';
  const badge = moved || (BADGE_TXT[r.statut] ? `<span class="badge s-${r.statut}">${BADGE_TXT[r.statut]}</span>` : '');
  const acts = /^\d*$/.test(String(r.tome || '')) && slugify(r.serie) ? `<button type="button" class="own" data-s="${esc(slugify(r.serie))}" data-t="${esc(r.tome || '')}" aria-pressed="false" hidden>Je l'ai</button>` + `<select class="tst" data-s="${esc(slugify(r.serie))}" data-t="${esc(r.tome || '')}" aria-label="Statut de ce tome" hidden><option value="">Statut…</option><option value="a">À acheter</option><option value="p">Précommandé</option><option value="r">À lire</option><option value="l">Lu</option></select>` : '';
  const meta = [
    showDate ? `<time datetime="${r.date}">${esc(frShort(r.date))}</time>` : '',
    `<span class="pub">${esc(r.editeur || 'Éditeur inconnu')}</span>`,
    r.prix != null ? `<span>${euro(r.prix)}</span>` : '',
    isNewSeries(r) ? NEW_BADGE : '',
    badge,
    r.source ? `<a href="${esc(r.source)}" rel="noopener nofollow">Fiche éditeur</a>` : '',
  ].filter(Boolean).join('');
  const q = `${r.serie} ${r.tome} ${r.titre} ${r.editeur}`.toLowerCase();
  const alt = `Couverture de ${r.serie}${r.tome ? ` tome ${r.tome}` : ''}`;
  const cover = showCovers ? `<div class="cover" aria-hidden="${r.cover ? 'false' : 'true'}">${r.cover ? `<img class="cover-img" src="${esc(r.cover)}" alt="${esc(alt)}" width="60" height="90" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</div>` : '';
  const coverLink = cover && slugify(r.serie) ? `<a class="rel-cover" href="/serie/${slugify(r.serie)}/" aria-label="${esc(r.serie)} : page de la série" tabindex="-1">${cover}</a>` : cover;
  return `<li class="rel p-${pk}${r.date < today ? ' past' : ''}${showCovers ? ' has-cover' : ''}" data-pub="${pk}" data-st="${r.date <= today ? 'dispo' : (mv && mv.to === r.date && mv.to > mv.from ? 'reporte' : r.statut)}" data-nw="${isNewSeries(r) ? 1 : 0}" data-ty="${pubType(r)}" data-q="${esc(q)}" data-d="${r.date}" data-df="${esc(frShort(r.date))}" data-s="${esc(r.serie)}">${coverLink}<div class="rel-main"><button type="button" class="follow" data-s="${esc(slugify(r.serie))}" data-n="${esc(r.serie)}" hidden>Suivre</button>${acts ? `<div class="rel-acts">${acts}</div>` : ''}<div class="rel-title"><strong>${serieLink(r.serie)}</strong>${r.tome ? ` <span class="tome">tome ${esc(r.tome)}</span>` : ''}${ed ? ` <span class="ed">${esc(ed)}</span>` : ''}</div>`
    + `<div class="meta">${meta}</div>${buyBox(r)}${adaptLine(r.serie)}${r.notes && r.notes !== 'Collecte automatique' ? `<p class="notes">${esc(r.notes)}</p>` : ''}</div></li>`;
}

const STREAM_ICON = { Crunchyroll: 'CR', ADN: 'ADN', Netflix: 'N', 'Prime Video': 'P', 'Disney+': 'D+', Wakanim: 'W' };
const streamKeys = (e) => {
  const k = (Array.isArray(e.stream) ? e.stream : []).filter((s) => s && /^https:\/\//.test(s.u || '')).map((s) => slugify(s.n));
  return k.length ? k.join(' ') : 'aucune';
};
const afollow = (e) => `<button type="button" class="chip afollow" data-a="${esc(e.mediaId)}" data-n="${esc(displayTitle(e.title))}" aria-pressed="false" hidden>Suivre</button>`;
const bridgeLink = (e) => (e.ms ? `<a class="bridge" href="/serie/${esc(e.ms)}/">Lire le manga</a>` : '');
const streamChips = (e) => (Array.isArray(e.stream) ? e.stream : [])
  .filter((s) => s && /^https:\/\//.test(s.u || '')).slice(0, 3)
  .map((s) => `<a class="stream s-${esc(slugify(s.n))}" href="${esc(s.u)}" rel="noopener nofollow" target="_blank" title="Regarder sur ${esc(s.n)}" aria-label="Regarder sur ${esc(s.n)}"><svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>${esc(STREAM_ICON[s.n] || s.n.slice(0, 2))}</a>`).join('');

// « Adapté en anime » : titre, état, plateformes (ou fiche AniList à défaut)
const adaptLine = (name, max = 1) => adaptOf(name).slice(0, max).map((a) => {
  const links = streamChips({ stream: a.s }) || (/^https:\/\/anilist\.co\//.test(a.u || '') ? `<a class="stream-more" href="${esc(a.u)}" rel="noopener nofollow" target="_blank">fiche AniList</a>` : '');
  return `<p class="adapt"><strong>Adapté en anime</strong> : ${esc(a.t)}${ADAPT_ST[a.st] ? ` <span class="muted">(${ADAPT_ST[a.st]})</span>` : ''}${links ? `<span class="streams">${links}</span>` : ''}</p>`;
}).join('');

function episodeItem(e) {
  const t = esc(displayTitle(e.title));
  const title = `<a href="${esc(animeHref(e))}">${t}</a>`;
  const hasCover = showCovers && /^https:\/\//.test(e.cover || '');
  const thumb = hasCover ? `<a class="ep-cover-link" href="${esc(animeHref(e))}" aria-label="${t} : où regarder" tabindex="-1"><span class="ep-cover cover"><img class="cover-img" src="${esc(e.cover)}" alt="Affiche de ${t}" width="96" height="144" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span></a>` : '';
  return `<li class="ep-row${hasCover ? ' has-thumb' : ''}" data-pub="${esc(streamKeys(e))}" data-q="${esc(displayTitle(e.title).toLowerCase())}">${thumb}<time>${esc(e.time)}</time><span class="t">${title}${e.format === 'MOVIE' ? ' <span class="muted">film</span>' : ''}</span><span class="ep">épisode ${esc(e.episode)}${isPremiere(e) ? ` ${PREMIERE_BADGE}` : ''}${streamChips(e) ? `<span class="streams">${streamChips(e)}</span>` : ''}${bridgeLink(e)} ${afollow(e)}</span></li>`;
}

// Page anime : mêmes lignes que la page manga (barre de couleur, affiche cliquable, Suivre à droite, boutons de streaming alignés)
function animeRow(e) {
  const t = esc(displayTitle(e.title));
  const url = esc(animeHref(e));
  const img = /^https:\/\//.test(e.cover || '') ? `<img class="cover-img" src="${esc(e.cover)}" alt="Affiche de ${t}" width="60" height="90" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  const cover = `<div class="cover" aria-hidden="${img ? 'false' : 'true'}">${img}</div>`;
  const chips = streamChips(e);
  return `<li class="rel anime-row has-cover" data-pub="${esc(streamKeys(e))}" data-q="${esc(displayTitle(e.title).toLowerCase())}">`
    + `<a class="rel-cover" href="${url}" aria-label="${t} : où regarder" tabindex="-1">${cover}</a>`
    + `<div class="rel-main"><button type="button" class="chip afollow" data-a="${esc(e.mediaId)}" data-n="${esc(displayTitle(e.title))}" aria-pressed="false" hidden>Suivre</button>`
    + `<div class="rel-title"><strong><a href="${url}">${t}</a></strong> <span class="tome">épisode ${esc(e.episode)}${e.format === 'MOVIE' ? ' · film' : ''}</span></div>`
    + `<div class="meta"><time>${esc(e.time)}</time>${isPremiere(e) ? PREMIERE_BADGE : ''}${bridgeLink(e)}</div>`
    + `${chips ? `<div class="shops"><span class="shops-l">Regarder</span>${chips}</div>` : ''}</div></li>`;
}

function animeTile(e) {
  const t = esc(displayTitle(e.title));
  const url = esc(animeHref(e));
  return `<li class="tile p-anime"><a class="tile-cover t-cover" href="${url}" aria-label="${t} : où regarder">${coverBox(e.cover, `Affiche de ${displayTitle(e.title)}`, 160, 240)}${isPremiere(e) ? '<span class="cover-flag">★ Épisode 1</span>' : ''}</a>`
    + `<div class="tile-body"><div class="t-title"><strong><a href="${url}">${t}</a></strong><span class="tome">épisode ${esc(e.episode)}${e.format === 'MOVIE' ? ' · film' : ''}</span></div>`
    + `<div class="tile-date"><time>${esc(e.time)}</time></div>${afollow(e)}${streamChips(e) ? `<div class="shops shops-sm t-shops">${streamChips(e)}</div>` : ''}</div></li>`;
}

// Les lignes « → Calendrier manga · Page de la série » des articles automatiques deviennent de vrais boutons
const artHtml = (body) => markdown(body).replace(/<br>→ ((?:<a [^>]*>[^<]*<\/a>(?: · )?)+)/g, (m, links) => `<span class="art-acts">${links.replace(/ · /g, '').replace(/<a /g, '<a class="chip" ')}</span>`);
const KIND_LABEL = { quotidien: 'Quotidien', hebdo: 'Hebdomadaire', mensuel: 'Mensuel', changements: 'Changements', dossier: 'Dossier', redac: 'Rédaction' };
const kindBadge = (a) => `<span class="kind k-${a.kind}">${KIND_LABEL[a.kind] || ''}</span>`;
const articleItem = (a) =>
  `<li><time class="muted" datetime="${a.date}">${esc(frShort(a.date))}</time><div>${kindBadge(a)} <a href="/articles/${a.slug}/">${esc(a.title)}</a>${a.description ? `<p class="notes">${esc(a.description)}</p>` : ''}</div></li>`;

const dots = (rows) => [...new Set(rows.map((r) => pubKey(r.editeur)))]
  .map((k) => `<i class="dot p-${k}" title="${esc(PUBS[k] || 'Autres éditeurs')}"></i>`).join('');

/* ------------------------------------------------------------------ accueil */
{
  const todayEps = eps.filter((e) => e.key === today);
  const topToday = [...todayEps].sort((a, b) => b.popularity - a.popularity).slice(0, showCovers ? 14 : 8).sort((a, b) => a.airingAt - b.airingAt);
  const live = manga.filter((r) => r.statut !== 'annule');
  const mangaToday = live.filter((r) => r.date === today);
  const mangaNext = live.filter((r) => r.date > today && r.date <= addDays(today, 30)).slice(0, 10);
  const shelf = showCovers ? live.filter((r) => r.date > today && r.cover).slice(0, 12) : [];
  const recent = events.filter((e) => e.day >= addDays(today, -14)).slice(0, 5);
  const newShelf = live.filter((r) => r.date >= today && isNewSeries(r)).slice(0, 8);
  const strip = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
    const m = live.filter((r) => r.date === d);
    const a = eps.filter((e) => e.key === d);
    return `<li class="day-panel ${wdc(d)}${d === today ? ' today' : ''}"><div class="d-head"><a class="d-link" href="/semaine/#j-${d}" aria-label="Voir le détail du ${esc(frDate(d))}"><span class="d-wd">${esc(d === today ? "aujourd'hui" : weekday(d))}</span><span class="d-num">${dayNum(d)}</span></a></div>`
      + (m.length ? `<a class="d-line" href="/manga/#j-${d}"><b>${m.length}</b> ${m.length > 1 ? 'mangas' : 'manga'}<span class="dots">${dots(m)}</span></a>` : '<span class="d-line none">Pas de manga</span>')
      + (a.length ? `<a class="d-line" href="/anime/#j-${d}"><b>${a.length}</b> ${a.length > 1 ? 'épisodes' : 'épisode'}</a>` : '<span class="d-line none">Pas d\'épisode</span>')
      + '</li>';
  }).join('');
  const body = `
<section class="week" aria-labelledby="t-week">
<div class="week-head"><h1 id="t-week">Sorties manga et anime, jour par jour</h1>
<p class="lead">Mangas en France chez Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu et Panini Manga. Épisodes d'anime diffusés au Japon, à l'heure de Paris.</p>
<p class="updated muted" id="updated" data-t="${esc(updatedIso)}">Mis à jour le ${esc(frDate(parisKey(new Date(updatedIso))))}</p></div>
<section aria-labelledby="t-days">
<h2 id="t-days">Les sorties de la semaine</h2>
<ul class="strip">${strip}</ul>
<p class="more"><a href="/semaine/">Voir la semaine en détail</a></p>
</section>
<section class="pour-toi" id="pour-toi" aria-labelledby="t-pt" hidden><h2 id="t-pt">Pour toi cette semaine</h2><div id="pt-body"></div></section>
<div class="since panel" id="since" hidden></div>
</section>
<section class="two stack" aria-label="Aujourd'hui">
<div>
<h2>Manga du ${esc(frDate(today))}</h2>
${mangaToday.length
    ? (showCovers ? `<ul class="hscroll" tabindex="0" aria-label="Sorties manga du jour">${mangaToday.map(tile).join('')}</ul>` : `<ul class="list panel">${mangaToday.map((r) => releaseItem(r)).join('')}</ul>`)
    : '<p class="empty">Aucune sortie manga enregistrée aujourd\'hui. <a href="/manga/">Voir le calendrier</a></p>'}
</div>
<div>
<h2>Anime du jour</h2>
${todayEps.length
    ? `${showCovers ? `<ul class="hscroll" tabindex="0" aria-label="Épisodes d'anime du jour">${topToday.map(animeTile).join('')}</ul>` : `<ul class="list panel eps">${topToday.map(episodeItem).join('')}</ul>`}<p class="muted more">Les ${topToday.length} plus suivis sur ${todayEps.length} épisodes. <a href="/anime/#j-${today}">Programme complet</a></p>`
    : (eps.length
      ? '<p class="empty">Aucun épisode n\'est prévu aujourd\'hui. <a href="/anime/">Voir la semaine</a></p>'
      : `<p class="empty">Le programme anime n'est pas disponible pour le moment${anime.generatedAt ? ` (dernière mise à jour réussie : ${esc(agoFr(anime.generatedAt))})` : ''}. Il revient automatiquement dès que la source répond. <a href="/etat/">État des données</a></p>`)}${todayEps.length && ANIME_STALE ? `<p class="muted more">Programme non actualisé depuis ${esc(agoFr(anime.generatedAt))}. <a href="/etat/">Détails</a></p>` : ''}
</div>
</section>
${mangaNext.length ? `<section><h2>Prochaines sorties manga</h2>${shelf.length >= 6 ? `<ul class="shelf">${shelf.map(tile).join('')}</ul>` : `<ul class="list panel">${mangaNext.map((r) => releaseItem(r, true)).join('')}</ul>`}<p class="more"><a href="/manga/">Tout le calendrier manga</a></p></section>` : ''}
${recent.length ? `<section><h2>Derniers changements de date</h2><ul class="list panel">${recent.map(changeItem).join('')}</ul><p class="more"><a href="/changements/">Tous les changements</a></p></section>` : ''}
${newShelf.length ? `<section><h2>Nouvelles séries à découvrir</h2>${showCovers ? `<ul class="shelf">${newShelf.map(tile).join('')}</ul>` : `<ul class="list panel">${newShelf.map((r) => releaseItem(r, true)).join('')}</ul>`}<p class="more"><a href="/nouveautes/">Toutes les nouveautés</a></p></section>` : ''}
${(() => {
    const gs = [...GENRE_COUNT.keys()].filter(genreOk).sort((a, b) => GENRE_COUNT.get(b) - GENRE_COUNT.get(a)).slice(0, 8);
    const guides = articles.filter((a) => a.kind === 'redac').slice(0, 3);
    if (!gs.length && !guides.length) return '';
    return `<section class="selections"><h2>Sélections et recommandations</h2>${gs.length ? `<p class="chiprow">${gs.map((g) => `<a class="chip" href="/genre/${genreSlug(g)}/">${esc(GENRE_FR[g])} <span class="n">${GENRE_COUNT.get(g)}</span></a>`).join('')}<a class="chip" href="/series-terminees/">À lire d'une traite</a><a class="chip" href="/genres/">Tous les genres</a></p>` : ''}${guides.length ? `<ul class="articles">${guides.map(articleItem).join('')}</ul>` : ''}</section>`;
  })()}
${NL.on ? `<section class="nl-home panel"><h2>La newsletter du lundi</h2><p>Les sorties de la semaine dans ta boîte mail : manga, premiers épisodes d'anime, dates qui bougent.</p>${nlForm('nl-home')}</section>` : ''}
<section>
<h2>Derniers articles</h2>
${articles.length ? `<ul class="articles">${articles.slice(0, 6).map(articleItem).join('')}</ul><p class="more"><a href="/articles/">Tous les articles</a></p>` : '<p class="empty">Les premiers articles arrivent bientôt.</p>'}
</section>`;
  page('/', { title: config.siteName, description: config.description, body,
    extraHead: siteUrlOk ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: config.siteName, alternateName: ['ProchainTome', 'prochaintome.fr'], url: `${base}/`, inLanguage: 'fr', publisher: { '@type': 'Organization', name: config.siteName, url: `${base}/`, logo: { '@type': 'ImageObject', url: `${base}/icon-512.png`, width: 512, height: 512 } }, potentialAction: { '@type': 'SearchAction', target: `${base}/recherche/?q={search_term_string}`, 'query-input': 'required name=search_term_string' } }).replace(/</g, '\\u003c')}</script>` : '' });
}

/* ------------------------------------------------------- filtres (partagés) */
const FILTER_JS = `<script>
(function(){var bar=document.getElementById('filtres');if(!bar)return;bar.hidden=false;
var q=document.getElementById('f'),chips=[].slice.call(bar.querySelectorAll('[data-chip]')),act={},none=document.getElementById('aucun');
var at=function(c){return c.dataset.attr||'pub';},nAct=function(){return Object.keys(act).reduce(function(n,a){return n+Object.keys(act[a]).length;},0);};
function okItem(li){var a,keys;for(a in act){keys=Object.keys(act[a]);if(!keys.length)continue;
if(a==='nw'){if(li.dataset.nw!=='1')return false;}
else if(a==='st'){if(!act.st[li.dataset.st])return false;}
else if(a==='ty'){if(!act.ty[li.dataset.ty])return false;}
else if(li.dataset.pub&&!li.dataset.pub.split(' ').some(function(k){return act.pub[k];}))return false;}return true;}
function apply(){var t=(q.value||'').toLowerCase().trim(),any=nAct(),shown=0;
[].forEach.call(document.querySelectorAll('[data-q]'),function(li){var ok=okItem(li)&&(!t||li.dataset.q.indexOf(t)>-1);li.hidden=!ok;if(ok)shown++;});
[].forEach.call(document.querySelectorAll('[data-group]'),function(g){g.hidden=![].some.call(g.querySelectorAll('[data-q]'),function(l){return !l.hidden;});});
chips.forEach(function(c){var k=c.dataset.chip;c.setAttribute('aria-pressed',k==='tous'?String(!any):String(!!(act[at(c)]&&act[at(c)][k])));});
if(none)none.hidden=shown>0;var fc=document.getElementById('fcount');if(fc){fc.textContent=any;fc.hidden=!any;}}
chips.forEach(function(c){c.addEventListener('click',function(){var k=c.dataset.chip,a=at(c);if(k==='tous')act={};else{act[a]=act[a]||{};if(act[a][k])delete act[a][k];else act[a][k]=1;}apply();});});
q.addEventListener('input',apply);
var SK='mc-f:'+location.pathname;
try{var sf=JSON.parse(localStorage.getItem(SK)||'null');if(sf){if(sf.q&&!q.hasAttribute('data-gs'))q.value=sf.q;(sf.a||[]).forEach(function(s){var p=String(s).split(':'),a=p.length>1?p[0]:'pub',k=p.length>1?p[1]:p[0];if(chips.some(function(c){return c.dataset.chip===k&&at(c)===a;})){act[a]=act[a]||{};act[a][k]=1;}});if(sf.q||nAct())apply();}}catch(e){}
var _ap=apply;apply=function(){_ap();try{var a=[];Object.keys(act).forEach(function(x){Object.keys(act[x]).forEach(function(k){a.push(x+':'+k);});});if(!q.value&&!a.length)localStorage.removeItem(SK);else localStorage.setItem(SK,JSON.stringify({q:q.value,a:a}));}catch(e){}};
var vb=document.getElementById('vues'),alt=null,NAMES=${JSON.stringify(PUBS)};
function mk(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e;}
function group(title,cls,items,span){var g=mk('section','daygroup');g.setAttribute('data-group','');var h=mk('h3','chip-day '+cls,title);if(span)h.appendChild(mk('span','now',span));g.appendChild(h);var ul=mk('ul','list panel');items.forEach(function(li){var c=li.cloneNode(true);c.hidden=false;var m=c.querySelector('.meta');if(m&&c.dataset.df){var t=mk('time','',c.dataset.df);t.setAttribute('datetime',c.dataset.d);m.insertBefore(t,m.firstChild);}ul.appendChild(c);});g.appendChild(ul);return g;}
function show(v){
if(alt){alt.remove();alt=null;}
document.body.classList.toggle('view-alt',v!=='jour');
if(v!=='jour'){
var src=[].slice.call(document.querySelectorAll('.month [data-q]')).sort(function(a,b){return a.dataset.d<b.dataset.d?-1:a.dataset.d>b.dataset.d?1:0;});
alt=mk('div','altview');var by={};
if(v==='editeur'){src.forEach(function(li){(by[li.dataset.pub]=by[li.dataset.pub]||[]).push(li);});
Object.keys(NAMES).concat(['autre']).forEach(function(k){if(by[k])alt.appendChild(group(NAMES[k]||'Autres éditeurs','p-'+k,by[k],' '+by[k].length));});}
else{src.forEach(function(li){(by[li.dataset.s]=by[li.dataset.s]||[]).push(li);});
Object.keys(by).sort(function(a,b){return a.localeCompare(b,'fr');}).forEach(function(n){alt.appendChild(group(n,'wd-4',by[n],' '+by[n].length));});}
vb.insertAdjacentElement('afterend',alt);
if(window.mcPaint)window.mcPaint();
}
[].forEach.call(vb.querySelectorAll('[data-view]'),function(b){b.setAttribute('aria-pressed',String(b.dataset.view===v));});
try{localStorage.setItem('mc-vue',v);}catch(e){}
apply();}
if(vb){vb.hidden=false;[].forEach.call(vb.querySelectorAll('[data-view]'),function(b){b.addEventListener('click',function(){show(b.dataset.view);});});
var sv='jour';try{sv=localStorage.getItem('mc-vue')||'jour';}catch(e){}
if(sv!=='jour'&&/^(editeur|serie)$/.test(sv))show(sv);
var aj=document.getElementById('auj');
if(aj)aj.addEventListener('click',function(){
if(document.body.classList.contains('view-alt'))show('jour');
var t=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date()),target=null,hs=document.querySelectorAll('.month h3[id^="j-"]');
for(var i=0;i<hs.length;i++){var g=hs[i].closest('[data-group]');if(hs[i].id.slice(2)>=t&&!(g&&g.hidden)){target=hs[i];break;}}
if(!target){aj.textContent='Rien à venir';setTimeout(function(){aj.textContent="Aujourd'hui";},2000);return;}
var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
target.scrollIntoView({behavior:rm?'auto':'smooth',block:'start'});
target.classList.remove('flash');void target.offsetWidth;target.classList.add('flash');});}
var tpl=document.getElementById('mois-tpl'),pm=document.getElementById('plus-mois'),pb=document.getElementById('plus-btn'),box=document.getElementById('mois-suite');
function loadMore(){if(!tpl||!box)return;box.appendChild(tpl.content.cloneNode(true));tpl.remove();tpl=null;if(pm)pm.remove();
var cur=vb&&vb.querySelector('[data-view][aria-pressed="true"]');var v=cur?cur.dataset.view:'jour';
if(window.mcPaint)window.mcPaint();if(window.mcPaintOwn)window.mcPaintOwn();if(v!=='jour')show(v);else apply();}
if(tpl&&pm){pm.hidden=false;pb.addEventListener('click',loadMore);
var _ap2=apply;apply=function(){if(tpl&&((q.value||'').trim()||nAct())){loadMore();return;}_ap2();};if((q.value||'').trim()||nAct())apply();}
})();
</script>`;

/* -------------------------------------------------------------------- manga */
{
  const since = addDays(today, -7);
  const rows = manga.filter((r) => r.date >= since);
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const monthKeys = [...new Set(rows.map((r) => r.date.slice(0, 7)))];

  const grid = (mk) => {
    const first = `${mk}-01`;
    const lead = (weekdayOfKey(first) + 6) % 7; // lundi = 0
    const cells = Array(lead).fill('<td class="blank"></td>');
    for (let d = first; d.startsWith(mk); d = addDays(d, 1)) {
      const list = byDate.get(d) || [];
      const cls = [wdc(d), d === today ? 'today' : '', d < today ? 'past' : ''].filter(Boolean).join(' ');
      cells.push(list.length
        ? `<td class="${cls}"><a href="#j-${d}" aria-label="${esc(ucfirst(frDayMonth(d)))} : ${plural(list.length, 'sortie', 'sorties')}"><span class="dn">${dayNum(d)}</span><span class="cnt">${list.length}</span><span class="dots">${dots(list)}</span></a></td>`
        : `<td class="${cls}"><span class="dn">${dayNum(d)}</span></td>`);
    }
    while (cells.length % 7) cells.push('<td class="blank"></td>');
    const trs = [];
    for (let i = 0; i < cells.length; i += 7) trs.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
    const heads = [['lun.', 'lundi'], ['mar.', 'mardi'], ['mer.', 'mercredi'], ['jeu.', 'jeudi'], ['ven.', 'vendredi'], ['sam.', 'samedi'], ['dim.', 'dimanche']]
      .map(([s, l], i) => `<th scope="col" abbr="${l}" class="wd-${i + 1}">${s}</th>`).join('');
    return `<table class="cal"><caption class="sr">Calendrier de ${esc(frMonth(first))}</caption><thead><tr>${heads}</tr></thead><tbody>${trs.join('')}</tbody></table>`;
  };

  const mSlug = (mk) => slugify(frMonth(`${mk}-01`));
  const monthHtml = monthKeys.map((mk) => {
    const days = [...byDate.keys()].filter((d) => d.startsWith(mk)).sort();
    return `<section class="month" data-group><h2>${esc(ucfirst(frMonth(`${mk}-01`)))}</h2>${grid(mk)}${
      days.map((d) => `<div class="daygroup" data-group><h3 id="j-${d}" class="chip-day ${wdc(d)}">${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h3><ul class="list panel">${byDate.get(d).map((r) => releaseItem(r)).join('')}</ul></div>`).join('')}</section>`;
  });
  const FIRST_MONTHS = 2;
  const content = monthHtml.slice(0, FIRST_MONTHS).join('\n') + (monthHtml.length > FIRST_MONTHS
    ? `\n<div id="mois-suite"></div><template id="mois-tpl">${monthHtml.slice(FIRST_MONTHS).join('\n')}</template><p class="more" id="plus-mois" hidden><button type="button" class="chip" id="plus-btn">Charger les mois suivants (${esc(monthKeys.slice(FIRST_MONTHS).map((mk) => frMonth(`${mk}-01`)).join(', '))})</button></p><noscript><p class="more">Les mois suivants : ${monthKeys.slice(FIRST_MONTHS).map((mk) => `<a href="/sorties-manga/${mSlug(mk)}/">${esc(frMonth(`${mk}-01`))}</a>`).join(' · ')}</p></noscript>`
    : '');

  const counts = new Map();
  for (const r of rows) counts.set(pubKey(r.editeur), (counts.get(pubKey(r.editeur)) || 0) + 1);
  const order = [...Object.keys(PUBS), 'autre'].filter((k) => counts.has(k));
  const chips = ['<button type="button" class="chip" data-chip="tous" aria-pressed="true">Tous</button>']
    .concat(order.map((k) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="false"><i class="dot p-${k}"></i>${esc(PUBS[k] || 'Autres')} <span class="n">${counts.get(k)}</span></button>`)).join('');

  const stCount = (f) => rows.filter(f).length;
  const stChips = [
    ['dispo', 'Disponible', (r) => r.date <= today],
    ['annonce', 'Annoncé', (r) => r.date > today && r.statut === 'annonce'],
    ['confirme', 'Confirmé', (r) => r.date > today && r.statut === 'confirme'],
    ['reporte', 'Reporté', (r) => r.date > today && (r.statut === 'reporte' || ((m) => m && m.to === r.date && m.to > m.from)(moves.get(keyOf(r))))],
  ].filter(([, , f]) => stCount(f)).map(([k, l, f]) => `<button type="button" class="chip" data-chip="${k}" data-attr="st" aria-pressed="false">${l} <span class="n">${stCount(f)}</span></button>`).join('')
    + (rows.some((r) => isNewSeries(r)) ? `<button type="button" class="chip" data-chip="1" data-attr="nw" aria-pressed="false">Nouvelles séries <span class="n">${rows.filter((r) => isNewSeries(r)).length}</span></button>` : '');
  const tyCount = (k) => rows.filter((r) => pubType(r) === k).length;
  const tyChips = [['standard', 'Tome standard'], ...TYPES.map(([k, l]) => [k, l])].filter(([k]) => tyCount(k)).map(([k, l]) => `<button type="button" class="chip" data-chip="${k}" data-attr="ty" aria-pressed="false">${esc(l)} <span class="n">${tyCount(k)}</span></button>`).join('');
  const allMonths = [...new Set(manga.filter((r) => r.statut !== 'annule' && r.date).map((r) => r.date.slice(0, 7)))].sort();
  const prevM = allMonths.filter((m) => m < monthKeys[0]).pop();
  const curM = monthKeys[0];
  const monthJump = `<p class="monthjump"><label class="muted" for="mj">Mois :</label> <select id="mj" class="sel" onchange="if(this.value)location.href=this.value"><option value="/sorties-manga/" selected>Tous les mois</option>${allMonths.map((mk) => `<option value="/sorties-manga/${mSlug(mk)}/">${esc(frMonth(`${mk}-01`))}</option>`).join('')}</select><noscript> ${allMonths.map((mk) => `<a href="/sorties-manga/${mSlug(mk)}/">${esc(frMonth(`${mk}-01`))}</a>`).join(' · ')}</noscript></p>`;
  const body = `
<h1>Calendrier des sorties manga</h1>
<p class="lead">Sorties en France relevées sur les plannings officiels des éditeurs. Les dates peuvent bouger : la fiche de l'éditeur fait foi.${mangaUpdatedIso ? ` <span class="muted">Mis à jour ${esc(agoFr(mangaUpdatedIso))}. <a href="/etat/">État des données</a></span>` : ''}</p>
${rows.length ? `<div class="filters" id="filtres" hidden><input type="search" id="f" data-gs placeholder="Chercher une série, un anime, un auteur, un éditeur" aria-label="Chercher sur le site" autocomplete="off"><details class="fdet" id="fdet"><summary>Filtres <span class="n" id="fcount" hidden></span></summary><div class="fpanel"><p class="fgrp"><span class="muted fsep">Éditeur</span>${chips}</p>${stChips ? `<p class="fgrp"><span class="muted fsep">Statut</span>${stChips}</p>` : ''}${tyChips.split('data-chip').length > 2 ? `<p class="fgrp"><span class="muted fsep">Type</span>${tyChips}</p>` : ''}</div></details></div>
${monthJump}
<div class="views" id="vues" role="group" aria-label="Affichage" hidden><span class="muted">Affichage :</span>
<button type="button" class="chip" data-view="jour" aria-pressed="true">Par jour</button><button type="button" class="chip" data-view="editeur" aria-pressed="false">Par éditeur</button><button type="button" class="chip" data-view="serie" aria-pressed="false">Par série</button><button type="button" class="chip jump-today" id="auj">Aujourd'hui</button></div>
<p class="empty" id="aucun" hidden>Aucune sortie ne correspond à ce filtre.</p>
${content}` : '<p class="empty">Le calendrier manga sera bientôt alimenté.</p>'}
<p class="more"><a href="/sorties-manga/">Sorties par mois</a> · <a href="/series/">Toutes les séries</a></p>
<p class="more"><a href="/manga.ics">Ajouter à mon agenda (manga.ics)</a>${siteUrlOk ? `<span class="muted"> Adresse à coller dans l'agenda : <code>${esc(base)}/manga.ics</code></span>` : ''}</p>
<p class="more muted">Un agenda par éditeur : ${order.map((k) => `<a href="/agenda/${k}.ics">${esc(PUBS[k] || 'Autres')}</a>`).filter((_, i) => order[i] in PUBS).join(' · ')}</p>
${rows.length ? FILTER_JS : ''}`;
  page('/manga/', { title: 'Calendrier des sorties manga', description: 'Calendrier des sorties manga en France : dates, éditeurs (Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu, Panini Manga), prix et statut de chaque tome.', body });
}


/* Données structurées : liste de tomes (page de mois, d'éditeur) */
const bookLd = (r) => ({ '@type': 'Book', name: mangaLabel(r), ...(slugify(r.serie) && mangaSlugs.has(slugify(r.serie)) ? { url: `${base}/serie/${slugify(r.serie)}/` } : {}),
  ...(isIsbn13(r.isbn) ? { isbn: r.isbn } : {}), datePublished: r.date, inLanguage: 'fr', bookFormat: 'https://schema.org/Paperback',
  ...(r.editeur ? { publisher: { '@type': 'Organization', name: r.editeur } } : {}), ...(showCovers && /^https:\/\//.test(r.cover || '') ? { image: r.cover } : {}) });
const listLd = (rows, url, name, max = 100) => siteUrlOk && rows.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name, url: `${base}${url}`, inLanguage: 'fr',
  mainEntity: { '@type': 'ItemList', numberOfItems: rows.length, itemListElement: rows.slice(0, max).map((r, i) => ({ '@type': 'ListItem', position: i + 1, item: bookLd(r) })) } }).replace(/</g, '\\u003c')}</script>` : '';

/* Titre et description des pages série : le nom, le numéro du tome et la date, les mots que les gens tapent
   (« X tome 12 date de sortie », « prochain tome de X »). Google réécrit parfois : on garde ça court. */
function serieMeta(S, n) {
  const fallbackTitle = `Prochain tome de ${S.name} : date de sortie`;
  if (!n) return { title: fallbackTitle, description: `Date du prochain tome de ${S.name} en France : tomes parus et annonces des éditeurs.` };
  const when = frLongDate(n.date);
  const what = n.tome ? `${S.name} tome ${n.tome}` : S.name;
  let title = `${what} : date de sortie le ${when}`;
  if (title.length > 58) title = `${what} : sortie le ${when}`;
  if (title.length > 62) title = fallbackTitle;
  const pub = n.editeur ? ` chez ${n.editeur}` : '';
  let description = `Prochain tome de ${S.name} : ${n.tome ? `le tome ${n.tome} sort` : 'sortie'} le ${when}${pub}. Dates des tomes suivants, ISBN et où l'acheter.`;
  if (description.length > 155) description = `Prochain tome de ${S.name} : ${n.tome ? `tome ${n.tome}` : 'sortie'} le ${when}${pub}. Toutes les dates de sortie.`;
  if (description.length > 158) description = `${what} : sortie le ${when}${pub}. Toutes les dates de sortie.`;
  return { title, description };
}

/* ------------------------------------------- pages par mois et par série (référencement) */
{
  const live = manga.filter((r) => r.statut !== 'annule' && r.date);
  const monthSlug = (mk) => slugify(frMonth(`${mk}-01`)); // « novembre-2026 »
  const months = [...new Set(live.map((r) => r.date.slice(0, 7)))].sort();
  const byMonth = new Map(months.map((mk) => [mk, live.filter((r) => r.date.startsWith(mk))]));
  const pubsLine = (rows) => {
    const names = [...new Set(rows.map((r) => r.editeur).filter(Boolean))];
    return names.length ? ` chez ${names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0]}` : '';
  };

  // une page par mois
  for (const mk of months) {
    const rows = byMonth.get(mk);
    const label = frMonth(`${mk}-01`);
    const days = [...new Set(rows.map((r) => r.date))].sort();
    const i = months.indexOf(mk);
    const nav = [i > 0 ? `<a class="chip" href="/sorties-manga/${monthSlug(months[i - 1])}/">← ${esc(frMonth(`${months[i - 1]}-01`))}</a>` : '',
      i < months.length - 1 ? `<a class="chip" href="/sorties-manga/${monthSlug(months[i + 1])}/">${esc(frMonth(`${months[i + 1]}-01`))} →</a>` : ''].join('');
    const counts = new Map();
    for (const r of rows) counts.set(pubKey(r.editeur), (counts.get(pubKey(r.editeur)) || 0) + 1);
    const legend = [...counts].map(([k, n]) => `<span class="legend"><i class="dot p-${k}"></i>${esc(PUBS[k] || 'Autres éditeurs')} ${n}</span>`).join('');
    page(`/sorties-manga/${monthSlug(mk)}/`, {
      title: `Sorties manga ${label} : tous les tomes`,
      extraHead: listLd(rows, `/sorties-manga/${monthSlug(mk)}/`, `Sorties manga de ${label}`),
      description: `${plural(rows.length, 'tome', 'tomes')} manga au programme en ${label}${pubsLine(rows)} : dates de sortie, éditeurs et prix.`,
      body: `<h1>Sorties manga de ${esc(label)}</h1>
<p class="lead">${esc(plural(rows.length, 'tome sort', 'tomes sortent'))} en France en ${esc(label)}${esc(pubsLine(rows))}. Les dates viennent des plannings officiels des éditeurs et peuvent bouger.</p>
<p class="legendrow">${legend}</p>
<p class="chiprow" aria-label="Éditeurs">${[...new Set(rows.map((r) => r.editeur).filter((e) => e && slugify(e)))].sort((a, c) => a.localeCompare(c, 'fr')).map((e) => `<a class="chip" href="/editeur/${slugify(e)}/">${esc(e)}</a>`).join('')}</p>
${days.map((d) => `<div class="daygroup"><h2 class="chip-day ${wdc(d)}">${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h2><ul class="list panel">${rows.filter((r) => r.date === d).map((r) => releaseItem(r)).join('')}</ul></div>`).join('\n')}
<p class="chiprow">${nav}<a class="chip" href="/sorties-manga/">Tous les mois</a><a class="chip" href="/manga/">Calendrier</a></p>`,
    });
  }
  page('/sorties-manga/', {
    title: 'Sorties manga par mois',
    description: 'Les sorties manga en France mois par mois : tous les tomes annoncés par Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu et Panini Manga.',
    body: `<h1>Sorties manga par mois</h1>
<p class="lead">Choisis un mois pour voir tous les tomes annoncés.</p>
<p>${months.length ? `${esc(plural(live.length, 'tome', 'tomes'))} au total, répartis sur ${months.length} mois, de ${esc(frMonth(`${months[0]}-01`))} à ${esc(frMonth(`${months[months.length - 1]}-01`))}. ` : ''}Chaque page mensuelle réunit les sorties de Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu et Panini Manga avec leur date, leur prix et un lien vers la fiche de l'éditeur. Les dates viennent des plannings officiels : elles sont marquées « estimées » tant qu'un éditeur ne les a pas confirmées, et les reports sont signalés sur la page <a href="/changements/">Changements</a>.</p>
<p class="chiprow">${months.map((mk) => `<a class="chip" href="/sorties-manga/${monthSlug(mk)}/">${esc(ucfirst(frMonth(`${mk}-01`)))} <span class="n">${byMonth.get(mk).length}</span></a>`).join('')}</p>
<p class="more"><a href="/manga/">Voir le calendrier</a> · <a href="/series/">Parcourir les séries</a></p>`,
  });

  // une page par série
  const seriesMap = new Map();
  for (const r of live) {
    const k = slugify(r.serie);
    if (!k) continue;
    if (!seriesMap.has(k)) seriesMap.set(k, []);
    seriesMap.get(k).push(r);
  }
  const seriesList = [...seriesMap].map(([k, rows]) => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const names = new Map();
    for (const r of rows) names.set(r.serie, (names.get(r.serie) || 0) + 1);
    const name = [...names].sort((a, b) => b[1] - a[1])[0][0];
    return { k, name, rows: sorted, next: sorted.find((r) => r.date >= today) || null, editeur: sorted[sorted.length - 1].editeur };
  }).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  /* ---------------- catalogue complet (BnF) : ≈ 8 000 séries publiées en français, avec leurs tomes et leur couverture hébergée dans R2 */
  const BNF = loadBnf(P.dataDir);
  const COVER_BASE = (() => { const u = typeof config.catalogueCovers === 'string' ? config.catalogueCovers.trim() : ''; return /^https:\/\/[^\s"<>]+$/.test(u) ? u.replace(/\/?$/, '/') : ''; })();
  const COVER_ISBN = new Map(manga.filter((r) => r.isbn && /^https:\/\//.test(r.cover || '')).map((r) => [r.isbn, r.cover]));
  const bnfCover = (c) => (showCovers && COVER_BASE ? `${COVER_BASE}${c.k}.webp` : '');
  for (const S of seriesList) { // une série du calendrier et la même dans le catalogue : même page
    const c = BNF.byK.get(S.k) || S.rows.map((r) => BNF.byIsbn.get(r.isbn)).find(Boolean);
    if (c && !c.page) { c.page = S.k; S.cat = c; }
  }
  const catOnly = BNF.series.filter((c) => !c.page);
  for (const c of catOnly) c.page = c.k;
  const r2img = (c, alt, w, h, cls = 'cover-img') => { const u = bnfCover(c); return u ? `<img class="${cls}" src="${esc(u)}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''; };
  const volRow = (c, v) => ({ serie: c.n, tome: v[0], isbn: v[1], date: v[2] ? `${v[2]}-01-01` : '2000-01-01', editeur: c.e });
  const volLabel = (v) => (v[0] ? `Tome ${v[0]}` : (v[3] || 'Volume'));
  // Un tome = une carte dans un carrousel. Couverture : fichier de l'éditeur si on l'a pour cet ISBN, sinon Open Library
  // (adresse construite avec l'ISBN, chargée par le navigateur) ; sans image, le titre du tome reste affiché.
  // Les autres éditions (réimpressions) sont dans un menu déroulant, sans JavaScript.
  const isbnCover = (isbn) => (showCovers && COVER_ISBN.has(isbn) ? COVER_ISBN.get(isbn) : showCovers && config.isbnCovers ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : '');
  const volList = (c, vols) => {
    const groups = new Map();
    for (const v of vols) { const key = v[0] ? `t${v[0]}` : `l${v[3] || v[1]}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(v); }
    const card = (g) => {
      const eds = [...g].sort((a, b) => b[2] - a[2]);
      const [main, ...rest] = eds;
      const u = isbnCover(main[1]);
      const more = rest.length ? `<details class="cv-ed"><summary>${esc(plural(eds.length, 'édition', 'éditions'))}</summary>${rest.map((v) => `<div class="cv-e"><span class="muted">${v[2] ? `${v[2]} · ` : ''}${esc(v[1])}</span>${buyBox(volRow(c, v), 'sm')}</div>`).join('')}</details>` : '';
      return `<li class="scard vcard${u ? '' : ' vnc'}">${u ? `<div class="cover"><span class="ph" aria-hidden="true">${esc(volLabel(main))}</span><img class="cover-img" src="${esc(u)}" alt="Couverture : ${esc(c.n)}, ${esc(volLabel(main))}" width="200" height="300" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ''}<strong>${esc(volLabel(main))}</strong><span class="muted">${main[2] ? `${main[2]} · ` : ''}ISBN ${esc(main[1])}</span>${buyBox(volRow(c, main), 'sm')}${more}</li>`;
    };
    return `<div class="carousel" role="region" aria-label="Tomes de ${esc(c.n)}" tabindex="0"><ul class="sgrid carousel-track cat-car">${[...groups.values()].map(card).join('')}</ul></div>`;
  };
  const catBox = (S) => {
    if (!S.cat) return '';
    const known = new Set(S.rows.map((r) => r.isbn).filter(Boolean));
    const vols = S.cat.v.filter((v) => !known.has(v[1]));
    return vols.length ? `<h2>Tous les tomes parus en France</h2><p class="muted">${esc(plural(S.cat.v.length, 'tome', 'tomes'))} au catalogue${S.cat.e ? ` (${esc(S.cat.e)})` : ''}. Source : <a href="https://catalogue.bnf.fr" rel="noopener nofollow">BnF</a>.</p>${volList(S.cat, vols)}` : '';
  };

  searchSeries = seriesList.map((S) => ({ n: S.name, u: `/serie/${S.k}/`, d: S.next ? `${S.next.tome ? `tome ${S.next.tome} · ` : ''}${frShort(S.next.date)}` : '', a: [S.editeur, ...((infoOf(S.name) || {}).au || [])].filter(Boolean).join(' '), c: showCovers ? (([...S.rows].reverse().find((r) => /^https:\/\//.test(r.cover || '')) || {}).cover || '') : '', x: [S.editeur, S.rows.filter((r) => r.date >= today).length ? `${S.rows.filter((r) => r.date >= today).length} tome(s) à venir` : 'rien d\'annoncé'].filter(Boolean).join(' · ') }));
  // Séries proches (auteur, genres, éditeur) et articles qui citent la série
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const artText = articles.map((a) => ({ a, t: norm(`${a.title} ${a.body}`) }));
  const relatedBox = (S) => {
    const me = infoOf(S.name) || {};
    const scored = seriesList.filter((o) => o.k !== S.k).map((o) => {
      const oi = infoOf(o.name) || {};
      const au = (me.au || []).filter((x) => (oi.au || []).includes(x)).length;
      const ge = (me.g || []).filter((x) => (oi.g || []).includes(x)).length;
      const sc = au * 4 + ge * 2 + (au || ge ? (o.editeur === S.editeur ? 1 : 0) : 0) + (o.next ? 0.5 : 0);
      return { o, sc, au, ge };
    }).filter((x) => x.au || x.ge >= 2).sort((a, b) => b.sc - a.sc || a.o.name.localeCompare(b.o.name, 'fr')).slice(0, 6);
    const nm = norm(S.name);
    const arts = nm.length >= 5 ? artText.filter((x) => x.t.includes(nm)).slice(0, 3).map((x) => x.a) : [];
    const simCard = ({ o, au }) => {
      const cr = showCovers ? [...o.rows].reverse().find((r) => r.cover) : null;
      return `<li class="scard p-${pubKey(o.editeur)}"><a class="scard-link" href="/serie/${o.k}/">${showCovers ? coverBox(cr && cr.cover, `Couverture de ${o.name}`) : ''}<strong>${esc(o.name)}</strong><span class="muted">${au ? 'Même auteur · ' : ''}${o.next ? `${o.next.tome ? `T${esc(o.next.tome)} · ` : ''}${esc(frShort(o.next.date))}` : esc(o.editeur || '')}</span></a></li>`;
    };
    const sim = scored.length ? `<h2>Si tu aimes ${esc(S.name)}</h2><div class="carousel" role="region" aria-label="Séries proches de ${esc(S.name)}" tabindex="0"><ul class="sgrid carousel-track">${scored.map(simCard).join('')}</ul></div>` : '';
    const art = arts.length ? `<h2>À lire aussi</h2><ul class="articles">${arts.map(articleItem).join('')}</ul>` : '';
    return sim + art;
  };
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const historyBox = (S) => {
    const seen = new Set();
    const evs = (changes.events || []).filter((e) => slugify(e.s) === S.k).filter((e) => { const key = `${e.day}|${e.type}|${e.t}|${e.from || ''}|${e.to || ''}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => b.day.localeCompare(a.day));
    const tl = (e) => (e.t ? `Tome ${esc(e.t)}` : 'Volume spécial');
    const line = (e) => {
      if (e.type === 'date') { const d = daysBetween(e.from, e.to); return `<strong>${tl(e)}</strong> : ${esc(frShort(e.from))} → <strong>${esc(frShort(e.to))}</strong> <span class="badge ${d > 0 ? 's-reporte' : 's-confirme'}">${d > 0 ? 'Reporté' : 'Avancé'} de ${Math.abs(d)} jour${Math.abs(d) > 1 ? 's' : ''}</span>`; }
      if (e.type === 'nouveau') return `<strong>${tl(e)}</strong> ajouté au planning, sortie prévue le ${esc(frShort(e.to))}`;
      return `<strong>${tl(e)}</strong> retiré du planning (sortie qui était prévue le ${esc(frShort(e.from))})`;
    };
    const since = changes.since ? ` Le suivi des changements a commencé le ${esc(frDate(changes.since))}.` : '';
    return `<details class="history"><summary>Historique des dates${evs.length ? ` (${evs.length})` : ''}</summary>${evs.length ? `<ul class="hist">${evs.map((e) => `<li><time class="muted" datetime="${esc(e.day)}">${esc(frShort(e.day))}</time> ${line(e)}</li>`).join('')}</ul>` : '<p class="muted">Aucun changement de date constaté pour cette série.</p>'}<p class="muted">${since.trim()} Les dates « estimées » viennent du planning de l'éditeur ; elles passent en « confirmées » après vérification.</p></details>`;
  };
  for (const S of seriesList) {
    const upcoming = S.rows.filter((r) => r.date >= today);
    const past = S.rows.filter((r) => r.date < today).reverse();
    const n = S.next;
    const lastOut = [...S.rows].reverse().find((r) => r.date < today) || null;
    const buyRow = n && isIsbn13(n.isbn) ? n : ([...S.rows].reverse().find((r) => r.date < today && isIsbn13(r.isbn)) || null);
    const synRow = [n, ...[...S.rows].reverse()].find((r) => r && SYN[r.source]?.t) || null;
    const synBox = synRow ? `<section class="synopsis"><h2>Résumé${synRow.tome ? ` du tome ${esc(synRow.tome)}` : ''}</h2><p>${esc(SYN[synRow.source].t)}</p><p class="muted syn-src">Résumé de l'éditeur · <a href="${esc(synRow.source)}" rel="noopener nofollow" target="_blank">${esc(synRow.editeur || 'Fiche éditeur')}</a></p></section>` : '';
    const lead = n
      ? `${n.tome ? `Le tome ${esc(n.tome)}` : 'Le prochain volume'} de <strong>${esc(S.name)}</strong> sort le <strong>${esc(frDate(n.date))}</strong> en France${n.editeur ? ` chez ${esc(n.editeur)}` : ''}${n.prix != null ? `, au prix de ${esc(euro(n.prix))}` : ''}.${n.statut === 'confirme' ? ' Cette date est confirmée.' : ' Cette date est estimée d\'après le planning de l\'éditeur : elle peut encore bouger.'}`
      : `Aucun nouveau tome de <strong>${esc(S.name)}</strong> n'est annoncé pour le moment dans les plannings de Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu et Panini Manga.${lastOut ? ` Dernier tome paru : ${lastOut.tome ? `tome ${esc(lastOut.tome)}` : 'le volume'} (${esc(frShort(lastOut.date))}).` : ''} Suis la série pour la retrouver dans Mon planning.`;
    const coverRow = showCovers ? [...S.rows].reverse().find((r) => r.cover) : null;
    const hero = coverRow ? `<div class="cover series-cover"><img class="cover-img" src="${esc(coverRow.cover)}" alt="Couverture de ${esc(mangaLabel(coverRow))}" width="160" height="240" decoding="async" referrerpolicy="no-referrer"></div>` : (S.cat && bnfCover(S.cat) ? `<div class="cover series-cover"><span class="ph" aria-hidden="true">${esc(S.name)}</span>${r2img(S.cat, `Couverture de ${S.name}`, 160, 240)}</div>` : '');
    const aeps = eps.filter((e) => e.ms === S.k).sort((a, b) => a.airingAt - b.airingAt);
    const ae = aeps.find((e) => e.date >= now()) || aeps[0];
    const adaptHtml = adaptLine(S.name, 2);
    const airing = ae ? `<p class="adapt"><strong>Prochain épisode</strong> : <a href="/anime/#j-${ae.key}">${esc(displayTitle(ae.title))}</a>, épisode ${esc(ae.episode)} diffusé au Japon le ${esc(frShort(ae.key))} à ${esc(ae.time)} (heure de Paris).</p>` : '';
    const animeBox = adaptHtml || airing ? `<div class="bridge-box panel">${adaptHtml}${airing}</div>` : '';
    const serieLd = siteUrlOk ? `<script type="application/ld+json">${JSON.stringify([
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: 'Séries', item: `${base}/series/` },
        { '@type': 'ListItem', position: 3, name: S.name, item: `${base}/serie/${S.k}/` }] },
      { '@context': 'https://schema.org', '@type': 'ComicSeries', name: S.name, inLanguage: 'fr', url: `${base}/serie/${S.k}/`,
        ...(S.editeur ? { publisher: { '@type': 'Organization', name: S.editeur } } : {}),
        ...((infoOf(S.name) || {}).au?.length ? { author: infoOf(S.name).au.map((x) => ({ '@type': 'Person', name: x })) } : {}),
        ...(() => {
          const live = S.rows.filter((r) => r.statut !== 'annule' && r.date);
          const parts = [...live.filter((r) => r.date < today).slice(-2), ...live.filter((r) => r.date >= today).slice(0, 10)];
          return parts.length ? { hasPart: parts.map((r) => ({ ...bookLd(r), url: `${base}/serie/${S.k}/` })) } : {};
        })() },
    ]).replace(/</g, '\\u003c')}</script>` : '';
    page(`/serie/${S.k}/`, {
      extraHead: serieLd,
      ...serieMeta(S, n),
      image: showCovers ? ([...S.rows].reverse().find((r) => /^https:\/\//.test(r.cover || '')) || {}).cover : '',
      body: `<div class="series-head">${hero}<div>
<h1>Prochain tome de ${esc(S.name)}</h1>
<p class="lead">${lead}</p>
${infoBox(S.name)}
${buyRow ? buyBox(buyRow, 'lg') : ''}
${goodiesBox(S.name)}
${synBox}
${animeBox}
<p><button type="button" class="follow follow-static" data-s="${esc(S.k)}" data-n="${esc(S.name)}" hidden>Suivre</button></p>
<div class="coll panel" data-coll data-s="${esc(S.k)}" hidden></div>
</div></div>
${upcoming.length ? `<h2>À venir</h2><ul class="vgrid">${upcoming.map((r) => volTile(r, r === buyRow)).join('')}</ul>` : ''}
${past.length ? `<h2>Déjà parus</h2><ul class="vgrid">${past.map((r) => volTile(r, r === buyRow)).join('')}</ul>` : ''}
${catBox(S)}
${historyBox(S)}
${relatedBox(S)}
${AFFILIATE_ON && (GOODIES_ON || S.rows.some((r) => isIsbn13(r.isbn))) ? `<p class="muted affil-note">Certains liens d'achat sont des liens d'affiliation : ils ne changent pas le prix pour toi, mais peuvent rapporter une petite commission au site. <a href="/mentions-legales/#affiliation">En savoir plus</a></p>` : ''}
<p class="more">${S.editeur && slugify(S.editeur) ? `<a href="/editeur/${slugify(S.editeur)}/">Autres sorties ${esc(S.editeur)}</a> · ` : ''}<a href="/sorties-manga/${monthSlug((n || S.rows[S.rows.length - 1]).date.slice(0, 7))}/">Toutes les sorties du mois</a> · <a href="/series/">Toutes les séries</a>${reportLink() ? ` · ${reportLink('Une date est fausse ? Signale-le')}` : ''}</p>`,
    });
  }
  /* ------------------------------------------------------------- catalogue : une page par série (hors calendrier), pages par lettre */
  {
    const byName = [...catOnly].sort((a, b) => a.n.localeCompare(b.n, 'fr'));
    const pubKeyOf = (e) => slugify(e || '');
    const trackedPub = (e) => pubs_for_link.has(pubKeyOf(e));
    const pubs_for_link = new Set(manga.filter((r) => r.statut !== 'annule' && r.editeur).map((r) => slugify(r.editeur)));
    const pubLink = (e) => (e ? (trackedPub(e) ? `<a href="/editeur/${slugify(e)}/">${esc(e)}</a>` : esc(e)) : '');
    const idxOf = new Map(byName.map((c, i) => [c.k, i]));
    for (const c of byName) {
      const [y0, y1] = yearsOf(c);
      const years = y0 ? (y0 === y1 ? ` en ${y0}` : ` de ${y0} à ${y1}`) : '';
      const n = c.v.length;
      const others = (c.p || []).length ? ` Aussi publié chez ${(c.p || []).map(esc).join(', ')}.` : '';
      const i = idxOf.get(c.k);
      const same = byName.filter((o, j) => o.e && o.e === c.e && j !== i).slice(0, 0);
      const prev = byName[i - 1], next = byName[i + 1];
      const L = letterKey(c.k);
      const cover = r2img(c, `Couverture de ${c.n}`, 160, 240);
      const hero = cover ? `<div class="cover series-cover"><span class="ph" aria-hidden="true">${esc(c.n)}</span>${cover}</div>` : '';
      const ld = siteUrlOk ? `<script type="application/ld+json">${JSON.stringify([
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Séries', item: `${base}/series/` },
          { '@type': 'ListItem', position: 3, name: c.n, item: `${base}/serie/${c.k}/` }] },
        { '@context': 'https://schema.org', '@type': 'ComicSeries', name: c.n, inLanguage: 'fr', url: `${base}/serie/${c.k}/`, numberOfEpisodes: n,
          ...(c.e ? { publisher: { '@type': 'Organization', name: c.e } } : {}),
          ...(bnfCover(c) ? { image: bnfCover(c) } : {}),
          hasPart: c.v.slice(0, 30).map((v) => ({ '@type': 'Book', name: `${c.n}${v[0] ? ` tome ${v[0]}` : ''}`, isbn: v[1], inLanguage: 'fr', ...(v[2] ? { datePublished: String(v[2]) } : {}), ...(c.e ? { publisher: { '@type': 'Organization', name: c.e } } : {}) })) },
      ]).replace(/</g, '\\u003c')}</script>` : '';
      page(`/serie/${c.k}/`, {
        extraHead: ld,
        title: `${c.n} : tous les tomes en français`,
        description: `${c.n} : ${plural(n, 'tome paru', 'tomes parus')} en France${c.e ? ` chez ${c.e}` : ''}${years}. Liste des tomes, ISBN et où les acheter.`,
        image: bnfCover(c),
        body: `<div class="series-head">${hero}<div>
<h1>${esc(c.n)} : tous les tomes</h1>
<p class="lead"><strong>${esc(c.n)}</strong> compte ${esc(plural(n, 'tome paru', 'tomes parus'))} en France${c.e ? ` chez ${pubLink(c.e)}` : ''}${esc(years)}.${others} Aucune sortie n'est annoncée pour le moment dans nos plannings.</p>
</div></div>
<h2>Les tomes</h2>${volList(c, c.v)}
${AFFILIATE_ON ? `<p class="muted affil-note">Certains liens d'achat sont des liens d'affiliation : ils ne changent pas le prix pour toi, mais peuvent rapporter une petite commission au site. <a href="/mentions-legales/#affiliation">En savoir plus</a></p>` : ''}
<p class="muted facts-src">Liste des tomes : <a href="https://catalogue.bnf.fr" rel="noopener nofollow">catalogue général de la BnF</a> (licence ouverte). Les dates exactes de sortie ne sont connues que pour les séries suivies dans les plannings.</p>
<p class="chiprow">${prev ? `<a class="chip" href="/serie/${prev.k}/">← ${esc(prev.n)}</a>` : ''}${next ? `<a class="chip" href="/serie/${next.k}/">${esc(next.n)} →</a>` : ''}</p>
<p class="more"><a href="/series/lettre/${L}/">Séries en ${esc(L === '0-9' ? '0-9' : L.toUpperCase())}</a> · <a href="/series/">Toutes les séries</a>${c.e && trackedPub(c.e) ? ` · <a href="/editeur/${slugify(c.e)}/">Sorties ${esc(c.e)}</a>` : ''}</p>`,
      });
      if (n >= 3) SEO_URLS.push(`/serie/${c.k}/`);
    }
    // index de recherche : [nom, adresse, éditeur, nombre de tomes]
    searchCatalogue = byName.map((c) => [c.n, c.k, c.e || '', c.v.length]);

    // pages par lettre (240 séries par page)
    const everyone = [
      ...seriesList.map((S) => ({ k: S.k, n: S.name, e: S.editeur, count: S.cat ? Math.max(S.cat.v.length, S.rows.length) : S.rows.length, sub: S.next ? `${S.next.tome ? `T${S.next.tome} · ` : ''}${frShort(S.next.date)}` : '', cover: (([...S.rows].reverse().find((r) => /^https:\/\//.test(r.cover || '')) || {}).cover) || (S.cat ? bnfCover(S.cat) : ''), live: true })),
      ...byName.map((c) => ({ k: c.k, n: c.n, e: c.e, count: c.v.length, sub: '', cover: bnfCover(c), live: false })),
    ].sort((a, b) => a.n.localeCompare(b.n, 'fr'));
    const groups = new Map();
    for (const x of everyone) { const L = letterKey(x.k); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(x); }
    const letterList = [...groups.keys()].sort((a, b) => (a === '0-9' ? -1 : b === '0-9' ? 1 : a.localeCompare(b)));
    const PER = 96;
    const lcard = (x) => `<li class="scard p-${pubKey(x.e)}"><a class="scard-link" href="/serie/${x.k}/"><div class="cover"><span class="ph" aria-hidden="true">${esc(x.n)}</span>${showCovers && x.cover ? `<img class="cover-img" src="${esc(x.cover)}" alt="Couverture de ${esc(x.n)}" width="200" height="300" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div><strong>${esc(x.n)}</strong><span class="muted">${x.sub ? `${esc(x.sub)}` : `${esc(plural(x.count, 'tome', 'tomes'))}${x.e ? ` · ${esc(x.e)}` : ''}`}</span></a></li>`;
    for (const L of letterList) {
      const list = groups.get(L);
      const pages = Math.ceil(list.length / PER);
      const lname = L === '0-9' ? '0-9' : L.toUpperCase();
      for (let pg = 1; pg <= pages; pg++) {
        const url = `/series/lettre/${L}/${pg > 1 ? `${pg}/` : ''}`;
        const slice = list.slice((pg - 1) * PER, pg * PER);
        const nav = `<p class="chiprow" aria-label="Lettres">${letterList.map((l) => `<a class="chip${l === L ? ' on' : ''}" href="/series/lettre/${l}/"${l === L ? ' aria-current="page"' : ''}>${esc(l === '0-9' ? '0-9' : l.toUpperCase())} <span class="n">${groups.get(l).length}</span></a>`).join('')}</p>`;
        const pager = pages > 1 ? `<p class="chiprow" aria-label="Pages">${Array.from({ length: pages }, (_, i) => `<a class="chip${i + 1 === pg ? ' on' : ''}" href="/series/lettre/${L}/${i ? `${i + 1}/` : ''}"${i + 1 === pg ? ' aria-current="page"' : ''}>Page ${i + 1}</a>`).join('')}</p>` : '';
        page(url, {
          title: `Séries manga en ${lname}${pg > 1 ? ` (page ${pg})` : ''} : tous les tomes`,
          description: `${plural(list.length, 'série', 'séries')} manga dont le titre commence par ${lname}, publiées en France : liste des tomes, éditeurs et prochains tomes.`,
          body: `<h1>Séries manga en ${esc(lname)}</h1>
<p class="lead">${esc(plural(list.length, 'série', 'séries'))} publiées en français${pages > 1 ? `, page ${pg} sur ${pages}` : ''}. Les séries avec un prochain tome annoncé affichent sa date.</p>
${nav}<ul class="sgrid">${slice.map(lcard).join('')}</ul>${pager}<p class="more"><a href="/series/">Toutes les séries</a></p>`,
        });
        SEO_URLS.push(url);
      }
    }
    catalogueHub = { letters: letterList.map((l) => ({ l, n: groups.get(l).length })), total: everyone.length };
  }
  const letters = [...new Set(seriesList.map((S) => (slugify(S.name)[0] || '#').toUpperCase()))].sort();
  const card = (S) => {
    const cr = showCovers ? [...S.rows].reverse().find((r) => r.cover) : null;
    return `<li class="scard p-${pubKey(S.editeur)}" data-q="${esc(S.name.toLowerCase())}"><a class="scard-link" href="/serie/${S.k}/">${showCovers ? coverBox(cr && cr.cover, `Couverture de ${S.name}`) : ''}`
      + `<strong>${esc(S.name)}</strong><span class="muted">${S.next ? `${S.next.tome ? `T${esc(S.next.tome)} · ` : ''}${esc(frShort(S.next.date))}` : 'rien d\'annoncé'}</span></a></li>`;
  };
  const az = letters.map((L) => `<section data-group class="azgroup"><h2>${esc(/\d/.test(L) ? '0-9' : L)}</h2><ul class="sgrid">${seriesList.filter((S) => (slugify(S.name)[0] || '#').toUpperCase() === L).map(card).join('')}</ul></section>`).join('');
  page('/series/', {
    title: catalogueHub ? 'Catalogue des séries manga : tous les tomes' : 'Toutes les séries manga : prochain tome',
    description: `Date du prochain tome de ${seriesList.length} séries manga publiées en France par Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu et Panini Manga.`,
    body: `<h1>Séries manga</h1>
<p class="lead">${catalogueHub ? `${esc(plural(catalogueHub.total, 'série', 'séries').replace(/^\d+/, (n) => Number(n).toLocaleString('fr-FR')))} de manga publiées en français, avec la liste de leurs tomes. ` : ''}${esc(plural(seriesList.length, 'série est suivie', 'séries sont suivies'))} dans les plannings des éditeurs : clique dessus pour voir la date de son prochain tome.</p>
${catalogueHub ? `<h2>Tout le catalogue, de A à Z</h2><p class="chiprow" aria-label="Lettres">${catalogueHub.letters.map((x) => `<a class="chip" href="/series/lettre/${x.l}/">${esc(x.l === '0-9' ? '0-9' : x.l.toUpperCase())} <span class="n">${x.n}</span></a>`).join('')}</p><h2>Séries suivies dans les plannings</h2>` : ''}
${seriesList.length ? `<div class="filters" id="filtres" hidden><input type="search" id="f" data-gs placeholder="Chercher une série, un anime, un auteur, un éditeur" aria-label="Chercher sur le site" autocomplete="off"></div>
<p class="empty" id="aucun" hidden>Aucune série ne correspond.</p>${az}${FILTER_JS}` : '<p class="empty">Les séries apparaîtront après la première collecte.</p>'}`,
  });
  /* ------------------------------------------------------------- pages de genres et sélection « séries terminées » (sélections éditoriales construites à partir des données AniList) */
  {
    const infoGenres = (S) => (infoOf(S.name) || {}).g || [];
    const genres = [...GENRE_COUNT.keys()].filter(genreOk).sort((a, b) => GENRE_COUNT.get(b) - GENRE_COUNT.get(a) || genreSlug(a).localeCompare(genreSlug(b)));
    const cards = (list) => `<ul class="sgrid">${list.map(card).join('')}</ul>`;
    const chips = (cur) => `<p class="chiprow">${genres.filter((g) => g !== cur).map((g) => `<a class="chip" href="/genre/${genreSlug(g)}/">${esc(GENRE_FR[g])} <span class="n">${GENRE_COUNT.get(g)}</span></a>`).join('')}</p>`;
    const nextOf = (list) => list.filter((S) => S.next).sort((a, b) => a.next.date.localeCompare(b.next.date)).slice(0, 5);
    for (const g of genres) {
      const list = seriesList.filter((S) => infoGenres(S).includes(g));
      if (list.length < 3) continue;
      const gl = GENRE_FR[g], gs = genreSlug(g);
      const finished = list.filter((S) => (infoOf(S.name) || {}).st === 'FINISHED').length;
      const ongoing = list.filter((S) => (infoOf(S.name) || {}).st === 'RELEASING').length;
      const upc = nextOf(list);
      const intro = `${esc(plural(list.length, 'série', 'séries'))} ${esc(gl.toLowerCase())} ${list.length > 1 ? 'sont suivies' : 'est suivie'} dans les plannings de Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu et Panini Manga${list.filter((S) => S.next).length ? `, dont ${list.filter((S) => S.next).length} avec un prochain tome déjà annoncé` : ''}.${ongoing || finished ? ` ${ongoing ? esc(plural(ongoing, 'série est encore publiée au Japon', 'séries sont encore publiées au Japon')) : ''}${ongoing && finished ? ', ' : ''}${finished ? esc(plural(finished, 'série est terminée', 'séries sont terminées')) + ' (idéal pour lire d\'une traite)' : ''}.` : ''}`;
      const soon = upc.length ? `<h2>Prochaines sorties en ${esc(gl.toLowerCase())}</h2><ul class="related">${upc.map((S) => `<li><a href="/serie/${S.k}/">${esc(S.name)}</a><span class="muted"> · ${S.next.tome ? `tome ${esc(S.next.tome)} · ` : ''}${esc(frShort(S.next.date))} · ${esc(S.editeur || '')}</span></li>`).join('')}</ul>` : '';
      const ld = siteUrlOk ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${base}/` }, { '@type': 'ListItem', position: 2, name: 'Genres', item: `${base}/genres/` }, { '@type': 'ListItem', position: 3, name: gl, item: `${base}/genre/${gs}/` }] }).replace(/</g, '\\u003c')}</script>` : '';
      page(`/genre/${gs}/`, {
        extraHead: ld,
        title: `Mangas ${gl.toLowerCase()} : séries et prochains tomes`,
        description: `${plural(list.length, 'série', 'séries')} manga ${gl.toLowerCase()} publiées en France : date du prochain tome, éditeur et séries terminées à lire d'une traite.`,
        body: `<h1>Mangas ${esc(gl.toLowerCase())}</h1><p class="lead">${intro}</p>${soon}<h2>Toutes les séries ${esc(gl.toLowerCase())}</h2>${cards(list)}<h2>Autres genres</h2>${chips(g)}<p class="muted facts-src">Genres : <a href="https://anilist.co" rel="noopener nofollow">AniList</a>. Les dates viennent des plannings officiels des éditeurs.</p><p class="more"><a href="/genres/">Tous les genres</a> · <a href="/series/">Toutes les séries</a></p>`,
      });
      SEO_URLS.push(`/genre/${gs}/`);
    }
    if (genres.length) {
      page('/genres/', {
        title: 'Genres de manga : séries et prochains tomes',
        description: `Parcours les mangas par genre (${genres.slice(0, 4).map((g) => GENRE_FR[g].toLowerCase()).join(', ')}…) et retrouve la date du prochain tome de chaque série.`,
        body: `<h1>Genres de manga</h1><p class="lead">Choisis un genre pour voir les séries correspondantes, leur éditeur et la date de leur prochain tome.</p><p class="chiprow">${genres.map((g) => `<a class="chip" href="/genre/${genreSlug(g)}/">${esc(GENRE_FR[g])} <span class="n">${GENRE_COUNT.get(g)}</span></a>`).join('')}</p><p class="more"><a href="/series-terminees/">Séries terminées à lire d'une traite</a> · <a href="/series/">Toutes les séries</a></p>`,
      });
      SEO_URLS.push('/genres/');
    }
    const done = seriesList.filter((S) => (infoOf(S.name) || {}).st === 'FINISHED');
    if (done.length >= 5) {
      page('/series-terminees/', {
        title: 'Mangas terminés à lire d\'une traite',
        description: `${plural(done.length, 'série', 'séries')} manga terminées au Japon et publiées en France : lance-toi sans attendre les sorties, avec la date des derniers tomes.`,
        body: `<h1>Mangas terminés à lire d'une traite</h1><p class="lead">${esc(plural(done.length, 'série suivie est terminée', 'séries suivies sont terminées'))} au Japon. Leur histoire est complète : il ne reste, selon les cas, que quelques tomes à paraître en France. ${done.filter((S) => S.next).length ? `${esc(plural(done.filter((S) => S.next).length, 'série a encore un tome annoncé', 'séries ont encore un tome annoncé'))}.` : ''}</p>${cards(done)}<p class="muted facts-src">Statut de publication : <a href="https://anilist.co" rel="noopener nofollow">AniList</a>.</p><p class="more"><a href="/genres/">Parcourir par genre</a> · <a href="/series/">Toutes les séries</a></p>`,
      });
      SEO_URLS.push('/series-terminees/');
    }
  }
  /* ------------------------------------------------------------- pages éditeurs */
  {
    const pubMap = new Map();
    for (const r of manga) if (r.editeur && r.statut !== 'annule') { if (!pubMap.has(r.editeur)) pubMap.set(r.editeur, []); pubMap.get(r.editeur).push(r); }
    const pubs = [...pubMap].map(([name, rows]) => ({ name, k: slugify(name), rows: rows.sort((a, c) => a.date.localeCompare(c.date)) }))
      .filter((p) => p.k).sort((a, c) => c.rows.filter((r) => r.date >= today).length - a.rows.filter((r) => r.date >= today).length || a.name.localeCompare(c.name, 'fr'));
    for (const p of pubs) {
      const up = p.rows.filter((r) => r.date >= today);
      const fresh = up.filter(isFirstVolume);
      const mine = seriesList.filter((S) => S.editeur === p.name);
      const nextDay = up[0] ? frDate(up[0].date) : '';
      const ld = siteUrlOk ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: 'Éditeurs', item: `${base}/editeurs/` },
        { '@type': 'ListItem', position: 3, name: p.name, item: `${base}/editeur/${p.k}/` }] }).replace(/</g, '\\u003c')}</script>` : '';
      page(`/editeur/${p.k}/`, {
        title: `${p.name} : sorties manga et prochains tomes`,
        description: `${plural(up.length, 'sortie à venir', 'sorties à venir')} chez ${p.name}${nextDay ? `, la prochaine le ${nextDay}` : ''}. Calendrier, nouvelles séries et liste des séries publiées.`,
        extraHead: ld + listLd(up, `/editeur/${p.k}/`, `${p.name} : prochaines sorties manga`, 60),
        body: `<h1>${esc(p.name)} : sorties manga</h1>
<p class="lead">${up.length ? `${esc(plural(up.length, 'sortie annoncée', 'sorties annoncées'))} chez ${esc(p.name)}, la prochaine le <strong>${esc(nextDay)}</strong>.` : `Aucune sortie n'est annoncée pour le moment chez ${esc(p.name)} dans nos plannings.`} Les dates viennent des plannings officiels et peuvent changer.</p>
${fresh.length ? `<h2>Nouvelles séries</h2><ul class="list panel">${fresh.slice(0, 12).map((r) => releaseItem(r, true)).join('')}</ul>` : ''}
${up.length ? `<h2>Prochaines sorties</h2><ul class="list panel">${up.slice(0, 40).map((r) => releaseItem(r, true)).join('')}</ul>${up.length > 40 ? `<p class="more muted">${up.length - 40} autres sorties : voir le <a href="/manga/">calendrier complet</a>.</p>` : ''}` : ''}
${(() => { const mk = [...new Set(up.map((r) => r.date.slice(0, 7)))]; return mk.length ? `<h2>Sorties ${esc(p.name)} par mois</h2><p class="chiprow">${mk.map((m) => `<a class="chip" href="/sorties-manga/${slugify(frMonth(`${m}-01`))}/">${esc(ucfirst(frMonth(`${m}-01`)))}</a>`).join('')}</p>` : ''; })()}
${mine.length ? `<h2>Séries ${esc(p.name)} sur le site</h2><ul class="chiprow">${mine.map((S) => `<li><a class="chip" href="/serie/${S.k}/">${esc(S.name)}</a></li>`).join('')}</ul>` : ''}
<p class="more">${p.k in PUBS ? `<a href="/agenda/${p.k}.ics">Ajouter les sorties ${esc(p.name)} à mon agenda</a> · ` : ''}<a href="/editeurs/">Tous les éditeurs</a> · <a href="/manga/">Calendrier manga</a></p>`,
      });
    }
    page('/editeurs/', {
      title: 'Éditeurs de manga : calendriers des sorties',
      description: `Les sorties manga de ${pubs.length} éditeurs français : Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Kazé et d'autres.`,
      body: `<h1>Éditeurs de manga</h1><p class="lead">Le calendrier des sorties de chaque éditeur.</p><p>Chaque page éditeur liste ses prochaines sorties, ses nouvelles séries et toutes les séries que nous suivons chez lui. Les données sont relevées chaque nuit sur les plannings officiels de ${esc(pubs.map((p) => p.name).slice(0, 5).join(', '))}${pubs.length > 5 ? ' et d\'autres éditeurs' : ''}.</p><ul class="sgrid">${pubs.map((p) => `<li class="scard p-${pubKey(p.name)}"><a class="scard-link" href="/editeur/${p.k}/"><strong>${esc(p.name)}</strong><span class="muted">${esc(plural(p.rows.filter((r) => r.date >= today).length, 'sortie à venir', 'sorties à venir'))}</span></a></li>`).join('')}</ul>`,
    });
    SEO_URLS.push('/editeurs/', ...pubs.map((p) => `/editeur/${p.k}/`));
  }

  SEO_URLS.push('/sorties-manga/', '/series/', ...months.map((mk) => `/sorties-manga/${monthSlug(mk)}/`), ...seriesList.map((S) => `/serie/${S.k}/`));
}


/* ------------------------------------------------------------- nouveautés */
{
  const live = manga.filter((r) => r.statut !== 'annule');
  const newManga = live.filter((r) => r.date >= today && isNewSeries(r));
  const premieres = eps.filter(isPremiere).sort((a, b) => a.airingAt - b.airingAt);
  const mangaPart = newManga.length
    ? (showCovers ? `<ul class="shelf">${newManga.map(tile).join('')}</ul>` : `<ul class="list panel">${newManga.map((r) => releaseItem(r, true)).join('')}</ul>`)
    : '<p class="empty">Aucune nouvelle série annoncée pour le moment.</p>';
  const animePart = premieres.length
    ? (showCovers ? `<ul class="list panel eps">${premieres.map(animeRow).join('')}</ul>` : `<ul class="list panel eps">${premieres.map(episodeItem).join('')}</ul>`)
    : '<p class="empty">Aucun premier épisode au programme cette semaine.</p>';
  page('/nouveautes/', {
    title: 'Nouvelles séries manga et premiers épisodes d\'anime',
    description: 'Les nouvelles séries manga qui démarrent en France (tomes 1) et les animes qui lancent leur premier épisode cette semaine.',
    body: `<h1>Nouveautés à découvrir</h1>
<p class="lead">Les séries qui démarrent : tomes 1 annoncés en France et premiers épisodes d'anime de la semaine. Les rééditions et éditions spéciales ne sont pas comptées.</p>
<h2>Nouvelles séries manga</h2>${mangaPart}
<h2>Premiers épisodes d'anime</h2>${animePart}`,
  });
  SEO_URLS.push('/nouveautes/');
}


/* -------------------------------------------------------------- newsletter */
{
  const end = addDays(today, 6);
  const A = (u) => (siteUrlOk ? `${base}${u}` : u);
  const wk = manga.filter((r) => r.statut !== 'annule' && r.date >= today && r.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.serie.localeCompare(b.serie, 'fr'));
  const fresh = wk.filter(isFirstVolume);
  const byMedia = new Map();
  for (const e of eps) if (e.key >= today && e.key <= end && !byMedia.has(e.mediaId)) byMedia.set(e.mediaId, e);
  const premieres = [...byMedia.values()].filter(isPremiere).sort((a, b) => b.popularity - a.popularity).slice(0, 6);
  const topAnime = [...byMedia.values()].sort((a, b) => b.popularity - a.popularity).slice(0, 5);
  const recentChanges = events.filter((e) => e.day >= addDays(today, -7));
  const H = 'margin:22px 0 8px;font:800 18px/1.3 Arial,Helvetica,sans-serif;color:#111;border-bottom:3px solid #ffd21f;padding-bottom:4px';
  const LI = 'margin:0 0 7px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#111';
  const LK = 'color:#111;font-weight:700';
  const ul = (items) => `<ul style="margin:0;padding-left:20px">${items.map((i) => `<li style="${LI}">${i}</li>`).join('')}</ul>`;
  const mItem = (r) => `<a style="${LK}" href="${esc(A(`/serie/${slugify(r.serie)}/`))}">${esc(mangaLabel(r))}</a> <span style="color:#555">(${esc(r.editeur || '')}, ${esc(frShort(r.date))})</span>`;
  const aItem = (e) => `<a style="${LK}" href="${esc(A(`/anime/#j-${e.key}`))}">${esc(displayTitle(e.title))}</a> <span style="color:#555">(épisode ${esc(e.episode)}, ${esc(frShort(e.key))} à ${esc(e.time)})</span>`;
  const sections = [];
  if (fresh.length) sections.push(`<h2 style="${H}">★ Nouvelles séries</h2>${ul(fresh.slice(0, 8).map(mItem))}`);
  if (wk.length) sections.push(`<h2 style="${H}">Manga : ${wk.length} sortie${wk.length > 1 ? 's' : ''} cette semaine</h2>${ul(wk.slice(0, 15).map(mItem))}${wk.length > 15 ? `<p style="${LI}"><a style="${LK}" href="${esc(A('/manga/'))}">Voir les ${wk.length - 15} autres sur le calendrier</a></p>` : ''}`);
  if (premieres.length) sections.push(`<h2 style="${H}">★ Anime : les premiers épisodes</h2>${ul(premieres.map(aItem))}`);
  if (topAnime.length) sections.push(`<h2 style="${H}">Anime : les plus suivis</h2>${ul(topAnime.map(aItem))}`);
  if (recentChanges.length) sections.push(`<h2 style="${H}">Dates qui ont bougé</h2><p style="${LI}">${recentChanges.length} changement${recentChanges.length > 1 ? 's' : ''} relevé${recentChanges.length > 1 ? 's' : ''} cette semaine dans les plannings des éditeurs : <a style="${LK}" href="${esc(A('/changements/'))}">voir le détail</a>.</p>`);
  const digest = sections.length
    ? `<p style="${LI}">Voici ce qui sort du ${esc(frDayMonth(today))} au ${esc(frDayMonth(end))}.</p>${sections.join('')}<p style="${LI};margin-top:22px">Les dates peuvent changer : le calendrier complet est sur <a style="${LK}" href="${esc(A('/'))}">${esc(config.siteName)}</a>.</p>`
    : '<p>Rien à annoncer pour le moment : le prochain numéro se remplira avec les données de la semaine.</p>';
  const subject = `${config.siteName} : la semaine du ${frDayMonth(today)}`;
  const emailDoc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(subject)}</title></head><body style="margin:0;background:#fbfaf6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:3px solid #111"><tr><td style="background:#ffd21f;padding:18px 22px;border-bottom:3px solid #111;font:italic 900 26px Arial,Helvetica,sans-serif;color:#111">${esc(config.siteName)}</td></tr><tr><td style="padding:8px 22px 22px">${digest}</td></tr></table></td></tr></table></body></html>`;
  const body = `<h1>Newsletter</h1>
<p class="lead">Un e-mail par semaine, le lundi : les sorties manga, les premiers épisodes d'anime et les dates qui ont bougé. Gratuit, sans publicité.</p>
${NL.on ? nlForm('nl-page') : '<p class="empty">L\'inscription n\'est pas encore ouverte. Renseigne <code>newsletter.formAction</code> dans site.config.json (voir le README).</p>'}
<h2>Aperçu du prochain numéro</h2>
<div class="panel nl-preview"><p class="muted">Objet : ${esc(subject)}</p>${digest}</div>
<details class="nl-admin"><summary>Pour l'éditeur du site : récupérer l'e-mail</summary>
<p class="muted">Copie le code ci-dessous dans un bloc « HTML personnalisé » de ton outil d'envoi (MailerLite, Brevo, Buttondown…), mets l'objet ci-dessus, envoie-toi un test, puis programme l'envoi. Ce numéro est recalculé à chaque mise à jour du site.</p>
<p><button type="button" class="chip" id="nl-copy">Copier le code de l'e-mail</button> <span class="muted" id="nl-copied" role="status"></span></p>
<textarea id="nl-code" rows="8" readonly>${esc(emailDoc)}</textarea></details>
<script>(function(){var b=document.getElementById('nl-copy'),t=document.getElementById('nl-code'),m=document.getElementById('nl-copied');if(!b)return;b.addEventListener('click',function(){t.select();var ok=false;try{ok=document.execCommand('copy');}catch(e){}if(navigator.clipboard&&!ok){navigator.clipboard.writeText(t.value).then(function(){m.textContent='Copié.';},function(){});return;}m.textContent=ok?'Copié.':'Sélectionne le texte et copie-le à la main.';});})();</script>`;
  page('/newsletter/', {
    title: 'Newsletter', description: `La newsletter hebdomadaire de ${config.siteName} : sorties manga, premiers épisodes d'anime, dates qui bougent.`,
    noindex: !NL.on, body,
  });
  if (NL.on) SEO_URLS.push('/newsletter/');
}

/* ------------------------------------------------------------ mon planning */
{
  const rows = manga.map((r) => ({
    d: r.date, e: r.editeur, s: r.serie, t: r.tome, k: slugify(r.serie), p: r.prix, st: r.statut, u: r.source, i: r.isbn || undefined,
    c: showCovers && r.cover ? r.cover : undefined,
    nw: isNewSeries(r) ? 1 : undefined,
    mv: (() => { const m = moves.get(keyOf(r)); return m && m.to === r.date ? m.from : undefined; })(),
  }));
  write('data/manga.json', JSON.stringify({ generated: today, covers: showCovers, rows }));
  write('suivi.js', readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'suivi.js'), 'utf8'));
  page('/ma-collection/', {
    title: 'Ma collection de mangas',
    description: 'Ta collection de mangas : tomes possédés, manquants, précommandés et à acheter, avec progression par série.',
    noindex: true,
    body: `<h1>Ma collection</h1>
<p class="lead">Retrouve ici toutes tes séries : tomes possédés, manquants, précommandés, à acheter ou à lire, avec ta progression série par série. Tout reste dans ton navigateur, rien n'est envoyé.</p>
<div id="coll-app"><p class="empty">Cette page a besoin de JavaScript pour afficher ta collection.</p></div>
<script src="${av('collection.js')}" defer></script>`,
  });
  page('/mon-planning/', {
    title: 'Mon planning manga',
    description: 'Suis tes séries manga préférées : prochains tomes, budget du mois et agenda personnel.',
    noindex: true,
    body: `<h1>Mon planning</h1>
<p class="muted"><a href="/ma-collection/">Voir ma collection complète</a></p>
<p class="lead">Choisis les séries que tu collectionnes : tu vois leurs prochains tomes, ce que ça coûte chaque mois, ce qu'il te reste à acheter, et tu peux les ajouter à ton agenda. Ta liste et ta collection restent dans ton navigateur, rien n'est envoyé.</p>
<div id="suivi-app"><p class="empty">Cette page a besoin de JavaScript pour afficher ton planning.</p></div>`,
  });
}

/* ---------------------------------------------------------- fiches anime */
const ANIME_PAGES = [];
{
  const byId = new Map();
  for (const e of eps) { if (!byId.has(e.mediaId)) byId.set(e.mediaId, []); byId.get(e.mediaId).push(e); }
  for (const list of byId.values()) {
    list.sort((a, b) => a.airingAt - b.airingAt);
    const e = list.find((x) => x.date >= now()) || list[list.length - 1];
    const t = displayTitle(e.title);
    const streamList = (Array.isArray(e.stream) ? e.stream : []).filter((x) => x && /^https:\/\//.test(x.u || ''));
    const watch = streamList.length
      ? `<div class="watch">${streamList.map((x) => `<a class="stream stream-lg s-${esc(slugify(x.n))}" href="${esc(x.u)}" rel="noopener nofollow" target="_blank"><svg viewBox="0 0 10 10" width="12" height="12" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>Regarder sur ${esc(x.n)}</a>`).join('')}</div><p class="muted">Liens fournis par AniList. La disponibilité en France peut varier selon la plateforme.</p>`
      : `<p class="empty">Aucune plateforme de streaming n'est indiquée pour le moment.</p>`;
    const anilist = /^https:\/\/anilist\.co\//.test(e.url || '') ? `<a href="${esc(e.url)}" rel="noopener nofollow" target="_blank">Fiche AniList</a>` : '';
    const hero = showCovers && /^https:\/\//.test(e.cover || '') ? `<div class="cover series-cover"><img class="cover-img" src="${esc(e.cover)}" alt="Affiche de ${esc(t)}" width="160" height="240" decoding="async" referrerpolicy="no-referrer"></div>` : '';
    const next = list.find((x) => x.date >= now());
    const lead = next
      ? `Prochain épisode de <strong>${esc(t)}</strong> : l'épisode ${esc(next.episode)}, diffusé au Japon le <strong>${esc(frShort(next.key))}</strong> à ${esc(next.time)} (heure de Paris).`
      : `Dernier épisode connu de <strong>${esc(t)}</strong> : l'épisode ${esc(e.episode)}, diffusé au Japon le ${esc(frShort(e.key))} à ${esc(e.time)} (heure de Paris).`;
    const rows = list.map((x) => `<li class="ep-row"><time>${esc(weekday(x.key))} ${esc(dayNum(x.key))}</time><span class="t"><a href="/anime/#j-${x.key}">Jour de diffusion</a></span><span class="ep">épisode ${esc(x.episode)}${isPremiere(x) ? ` ${PREMIERE_BADGE}` : ''} · ${esc(x.time)}</span></li>`).join('');
    const frSyn = SYN_FR[e.mediaId] && SYN_FR[e.mediaId].h === createHash('sha1').update(e.synopsis || '').digest('hex').slice(0, 12) ? SYN_FR[e.mediaId].t : '';
    const synAnime = e.synopsis ? `<section class="synopsis"><h2>Synopsis</h2><p>${esc(frSyn || e.synopsis)}</p><p class="muted syn-src">${frSyn ? 'Synopsis AniList, traduit automatiquement' : 'Synopsis AniList, en anglais'}${anilist ? ` · ${anilist}` : ''}</p></section>` : '';
    const manga = e.ms ? `<p class="adapt"><strong>Adapté d'un manga</strong> : <a href="/serie/${esc(e.ms)}/">voir les prochains tomes</a></p>` : '';
    ANIME_PAGES.push(animeHref(e));
    page(animeHref(e), {
      title: `${t} : où regarder en streaming`,
      description: `Où regarder ${t} en streaming, horaires de diffusion des épisodes (heure de Paris) et lien vers le manga.`,
      image: showCovers ? e.cover : '',
      body: `<div class="series-head">${hero}<div>
<h1>${esc(t)}</h1>
<p class="lead">${lead}</p>
${synAnime}
<h2>Où regarder</h2>
${watch}
${manga}
<p>${afollow(e)} <a href="/mes-animes/">Noter mes épisodes vus</a>${anilist ? ` · ${anilist}` : ''}</p>
</div></div>
<h2>Épisodes de la semaine</h2>
<ul class="list panel eps">${rows}</ul>
<p class="more"><a href="/anime/">Tous les animes de la semaine</a>${reportLink() ? ` · ${reportLink('Une info est fausse ? Signale-la')}` : ''}</p>`,
    });
  }
}

write('anime-vus.js', readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'anime-vus.js'), 'utf8'));
page('/mes-animes/', {
  title: 'Mes animes',
  description: 'Note les épisodes d\u2019anime que tu as vus, de tel à tel épisode, et vois ce qu\u2019il te reste à rattraper.',
  noindex: true,
  body: `<h1>Mes animes</h1>
<p class="lead">Note les épisodes que tu as vus (de tel épisode à tel épisode) et vois ce qu'il te reste à rattraper. Les animes que tu suis avec le bouton « Suivre » apparaissent ici. Tout reste dans ton navigateur, rien n'est envoyé nulle part.</p>
<div id="vus-app"><p class="empty">Cette page a besoin de JavaScript pour afficher ta liste.</p></div>
<script src="${av('anime-vus.js')}" defer></script>`,
});

/* -------------------------------------------------------------- changements */
{
  const days = [...new Set(events.map((e) => e.day))];
  const content = days.map((d) => `<section class="daygroup"><h2>${esc(ucfirst(frDayMonth(d)))}</h2><ul class="list panel">${events.filter((e) => e.day === d).map(changeItem).join('')}</ul></section>`).join('\n');
  const since = changes.since ? `Suivi commencé le ${frDate(changes.since)}.` : '';
  page('/changements/', {
    title: 'Changements de date des sorties manga',
    description: 'Tomes reportés, avancés, nouvellement annoncés ou retirés des plannings des éditeurs, relevés chaque jour.',
    body: `<h1>Changements de date</h1>
<p class="lead">Chaque nuit, le site compare les plannings de Glénat, Kana, Pika, Ki-oon, Akata, Delcourt, Soleil, Kazé, Kurokawa, Meian, Mangetsu et Panini Manga avec ceux de la veille. Quand un tome est reporté, avancé, annoncé ou disparaît, c'est ici.</p>
${events.length ? content : `<p class="empty">Aucun changement détecté pour le moment. ${esc(since)} Cette page se remplit quand un éditeur modifie son planning.</p>`}
<p class="more muted">${events.length ? esc(since) : ''}</p>`,
  });
}

/* -------------------------------------------------------------------- anime */
{
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const updated = anime.generatedAt ? `${frDate(parisKey(new Date(anime.generatedAt)))} à ${parisHM(new Date(anime.generatedAt))}` : null;
  const jump = days.map((d) => {
    const n = eps.filter((e) => e.key === d).length;
    return `<a class="jump ${wdc(d)}${d === today ? ' today' : ''}" href="#j-${d}"><span class="d-wd">${esc(weekday(d))}</span><span class="d-num">${dayNum(d)}</span><span class="cnt">${n}</span></a>`;
  }).join('');
  const sections = days.map((d) => {
    const list = eps.filter((e) => e.key === d);
    return `<section class="day" id="j-${d}" data-group><h2 class="chip-day ${wdc(d)}">${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h2>${
      list.length ? (showCovers ? `<ul class="list panel eps">${list.map(animeRow).join('')}</ul>` : `<ul class="list panel eps">${list.map(episodeItem).join('')}</ul>`) : '<p class="empty">Aucun épisode enregistré ce jour-là.</p>'}</section>`;
  }).join('\n');
  const platCount = new Map();
  for (const e of eps) for (const k of streamKeys(e).split(' ')) platCount.set(k, (platCount.get(k) || 0) + 1);
  const platOrder = [...Object.entries(STREAM_ICON).map(([n]) => [slugify(n), n]), ['aucune', 'Autres']].filter(([k]) => platCount.has(k));
  const platChips = platOrder.length > 1
    ? ['<button type="button" class="chip" data-chip="tous" aria-pressed="true">Tous</button>']
      .concat(platOrder.map(([k, n]) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="false"><i class="dot sp-${k}"></i>${esc(n)} <span class="n">${platCount.get(k)}</span></button>`)).join('')
    : '';
  const body = `
<h1>Épisodes d'anime de la semaine</h1>
<p class="lead">Horaires de diffusion au Japon, convertis en heure de Paris. La disponibilité en France dépend des plateformes de streaming.</p>
<p class="chiprow"><a class="chip" href="/anime/saison/">Anime de la saison</a><a class="chip" href="/semaine/">La semaine en détail</a></p>
${animeNotice()}
${eps.length ? `<nav class="jumps" aria-label="Aller à un jour">${jump}</nav>
<div class="filters" id="filtres" hidden><input type="search" id="f" data-gs placeholder="Chercher une série, un anime, un auteur, un éditeur" aria-label="Chercher sur le site" autocomplete="off">${platChips}</div>
<p class="empty" id="aucun" hidden>Aucun épisode ne correspond à cette recherche.</p>
${sections}` : '<p class="empty">Les données apparaîtront après la première mise à jour automatique.</p>'}
<p class="more muted">${updated ? `Mis à jour le ${esc(updated)}. ` : ''}<a href="/anime/saison/">Anime de la saison</a> · <a href="/anime.ics">Ajouter à mon agenda (anime.ics)</a></p>
${eps.length ? FILTER_JS : ''}`;
  page('/anime/', { title: "Épisodes d'anime de la semaine", description: "Programme des épisodes d'anime de la semaine, horaires à l'heure de Paris.", body });
}

/* ------------------------------------------------------------ anime par saison */
{
  const SAISON = (() => { try { return JSON.parse(readFileSync(path.join(P.dataDir, 'saison.json'), 'utf8')); } catch { return null; } })();
  const SEASON_FR = { WINTER: 'Hiver', SPRING: 'Printemps', SUMMER: 'Été', FALL: 'Automne' };
  const ST_SEASON = { RELEASING: 'En cours', NOT_YET_RELEASED: 'À venir', FINISHED: 'Terminé' };
  const FORMAT_FR = { TV: 'Série TV', TV_SHORT: 'Format court', ONA: 'Web', MOVIE: 'Film' };
  const GENRES_ANIME = { ...GENRE_FR, Comedy: 'Comédie' };
  const internal = new Map();
  for (const e of eps) if (!internal.has(e.mediaId)) internal.set(e.mediaId, animeHref(e));
  const card = (a) => {
    const href = internal.get(a.id) || a.u;
    const dt = a.d && a.d[1] ? `${a.d[2] ? `${a.d[2]} ` : ''}${['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][a.d[1]]} ${a.d[0]}` : '';
    const chips = streamChips({ stream: a.s });
    const title = href ? `<a href="${esc(href)}"${internal.has(a.id) ? '' : ' rel="noopener nofollow" target="_blank"'}>${esc(a.t)}</a>` : esc(a.t);
    return `<li class="rel anime-row${showCovers && a.c ? ' has-cover' : ''}" data-q="${esc(a.t.toLowerCase())}">${showCovers && a.c ? `<div class="cover"><img class="cover-img" src="${esc(a.c)}" alt="Affiche de ${esc(a.t)}" width="60" height="90" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>` : ''}<div class="rel-main"><div class="rel-title"><strong>${title}</strong></div><div class="meta"><span>${esc(FORMAT_FR[a.f] || '')}${a.n ? ` · ${a.n} épisode${a.n > 1 ? 's' : ''}` : ''}</span>${dt ? `<span>${a.st === 'RELEASING' || a.st === 'FINISHED' ? 'Débuté' : 'Prévu'} : ${esc(dt)}</span>` : ''}${ST_SEASON[a.st] ? `<span class="badge">${ST_SEASON[a.st]}</span>` : ''}${a.g?.length ? `<span class="muted">${esc(a.g.map((x) => GENRES_ANIME[x] || x).join(', '))}</span>` : ''}</div>${chips ? `<div class="streams">${chips}</div>` : ''}</div></li>`;
  };
  const sections = (SAISON?.seasons || []).map((s) => `<section class="art-sec" id="s-${s.season.toLowerCase()}-${s.year}"><h2>${SEASON_FR[s.season]} ${s.year}</h2><ul class="list panel eps">${s.items.map(card).join('')}</ul></section>`).join('');
  const nav = (SAISON?.seasons || []).length > 1 ? `<nav class="kind-nav" aria-label="Saisons">${SAISON.seasons.map((s) => `<a href="#s-${s.season.toLowerCase()}-${s.year}">${SEASON_FR[s.season]} ${s.year}</a>`).join('')}</nav>` : '';
  page('/anime/saison/', {
    title: 'Anime de la saison',
    description: 'Les anime de la saison en cours et de la suivante : formats, dates de début, plateformes de streaming.',
    body: `<h1>Anime de la saison</h1><p class="lead">Les séries les plus suivies de la saison en cours et de la suivante. Dates de début au Japon ; la disponibilité en France dépend des plateformes. <a href="/anime/">Programme de la semaine</a></p>${nav}${sections || '<p class="empty">La liste des saisons apparaîtra après la prochaine mise à jour automatique.</p>'}<p class="muted">Données : <a href="https://anilist.co" rel="noopener nofollow">AniList</a>.</p>`,
  });
  SEO_URLS.push('/anime/saison/');
}

/* ------------------------------------------------------------ état des données */
{
  const SOURCE_NOTE = {
    'Anime · AniList': 'Programme des épisodes (8 jours)',
    'Saisie · Google Sheets': 'Tes sorties saisies à la main',
  };
  const verdict = (v) => {
    const h = hoursSince(v.lastSuccess);
    if (!v.lastSuccess) return ['bad', 'Jamais réussi'];
    if (v.ok && h <= 36) return ['ok', 'À jour'];
    if (h > 72) return ['bad', 'En retard'];
    if (!v.ok) return ['warn', 'Dernier passage en échec, données conservées'];
    return ['warn', 'À vérifier'];
  };
  const names = Object.keys(STATUS);
  const rowsHtml = names.map((n) => {
    const v = STATUS[n];
    const [cls, label] = verdict(v);
    return `<tr><th scope="row">${esc(n)}${SOURCE_NOTE[n] ? `<small>${esc(SOURCE_NOTE[n])}</small>` : ''}</th><td><span class="badge b-${cls}">${esc(label)}</span>${v.note ? `<small>${esc(v.note)}</small>` : ''}</td><td>${esc(agoFr(v.lastSuccess))}<small>${esc(stampFr(v.lastSuccess))}</small></td><td>${v.lastSuccessCount ?? '—'}</td></tr>`;
  }).join('');

  // Contrôles qualité sur les données réellement utilisées par le site
  const files = ['manga.csv', 'manga-auto.csv'].map((f) => ({ f, rows: loadManga(path.join(P.dataDir, f)) }));
  const byIsbn = new Map();
  for (const { f, rows } of files) for (const r of rows) if (r.isbn.length >= 10) { if (!byIsbn.has(r.isbn)) byIsbn.set(r.isbn, []); byIsbn.get(r.isbn).push({ f, r }); }
  const lbl = (r) => `${r.serie}${r.tome ? ` t. ${r.tome}` : ''}`;
  const issues = [];
  const divergent = [...byIsbn.values()].filter((l) => new Set(l.map((x) => x.r.date)).size > 1);
  issues.push(['Dates différentes selon la source pour un même ISBN', divergent.map((l) => `${lbl(l[0].r)} : ${l.map((x) => `${frShort(x.r.date)} (${x.f.replace('.csv', '')})`).join(' / ')}`)]);
  issues.push(['ISBN invalide (clé de contrôle incorrecte)', manga.filter((r) => r.isbn && !isIsbn13(r.isbn)).map((r) => `${lbl(r)} : ${r.isbn}`)]);
  issues.push(['Sortie passée de plus de 7 jours encore marquée « annoncée » ou « confirmée »', manga.filter((r) => r.date < addDays(today, -7) && (r.statut === 'annonce' || r.statut === 'confirme')).map((r) => `${lbl(r)} : ${frShort(r.date)}`)]);
  const dupMap = new Map();
  for (const r of manga) { const k = `${slugify(r.serie)}|${r.tome}|${r.titre ? slugify(r.titre) : ''}`; if (r.tome) dupMap.set(k, [...(dupMap.get(k) || []), r]); }
  issues.push(['Même série et même tome présents plusieurs fois', [...dupMap.values()].filter((l) => l.length > 1).map((l) => `${lbl(l[0])} : ${l.map((r) => frShort(r.date)).join(', ')}`)]);
  const recentPubs = new Set(manga.filter((r) => r.date >= addDays(today, -90) && r.editeur).map((r) => r.editeur));
  issues.push(['Éditeur sans aucune sortie dans les 30 prochains jours', [...recentPubs].filter((e) => !manga.some((r) => r.editeur === e && r.date >= today && r.date <= addDays(today, 30))).sort()]);
  const issueHtml = issues.map(([t, l]) => `<li>${l.length ? `<strong>${esc(t)}</strong> <span class="badge b-warn">${l.length}</span><ul>${l.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}${l.length > 8 ? `<li class="muted">… et ${l.length - 8} autre(s)</li>` : ''}</ul>` : `${esc(t)} <span class="badge b-ok">aucun</span>`}</li>`).join('');

  page('/etat/', {
    title: 'État des données',
    description: 'Dernière mise à jour réussie de chaque source du site (plannings des éditeurs, programme anime) et contrôles de qualité.',
    body: `<h1>État des données</h1>
<p class="lead">Le site se met à jour chaque nuit. Cette page montre, pour chaque source, la dernière fois où elle a répondu correctement. Quand une source échoue, le site garde ses dernières données valides et ne les remplace jamais par du vide.</p>
${names.length ? `<h2>Sources</h2><div class="tbl-wrap"><table class="status-table"><thead><tr><th scope="col">Source</th><th scope="col">État</th><th scope="col">Dernière réussite</th><th scope="col">Éléments</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` : '<p class="empty">Aucune mise à jour enregistrée pour le moment. Le tableau se remplit après la prochaine exécution automatique.</p>'}
<h2>Contrôles de qualité</h2>
<ul class="checks">${issueHtml}</ul>
<h2>Comment lire les statuts d'une sortie</h2>
<ul>
<li><strong>Annoncé</strong> (affiché « Date estimée » sur les fiches) : date relevée dans un planning officiel, susceptible de bouger.</li>
<li><strong>Confirmé</strong> (« Date confirmée ») : date vérifiée à la main.</li>
<li><strong>Reporté</strong> : la date a changé depuis la dernière annonce (voir <a href="/changements/">Changements</a>).</li>
<li><strong>Paru</strong> : le tome est sorti. Aucune date n'est inventée : sans confirmation de l'éditeur, le tome n'apparaît pas.</li>
</ul>`,
  });
}

/* ------------------------------------------------------- semaine en détail */
{
  const live = manga.filter((r) => r.statut !== 'annule');
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const sec = days.map((d) => {
    const m = live.filter((r) => r.date === d);
    const a = eps.filter((e) => e.key === d).sort((x, y) => y.popularity - x.popularity);
    const top = a.slice(0, 6).sort((x, y) => x.airingAt - y.airingAt);
    return `<section class="daygroup" id="j-${d}"><h2 class="chip-day ${wdc(d)}">${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h2>
<div class="two"><div><h3>Manga</h3>${m.length ? `<ul class="list panel">${m.map((r) => releaseItem(r)).join('')}</ul>` : '<p class="empty">Aucune sortie enregistrée.</p>'}</div>
<div><h3>Anime</h3>${a.length ? `<ul class="list panel eps">${top.map(showCovers ? animeRow : episodeItem).join('')}</ul><p class="muted more">${top.length < a.length ? `Les ${top.length} plus suivis sur ${a.length} épisodes. ` : ''}<a href="/anime/#j-${d}">Programme complet</a></p>` : '<p class="empty">Aucun épisode au programme.</p>'}</div></div></section>`;
  }).join('\n');
  page('/semaine/', {
    title: 'Les sorties des 7 prochains jours',
    description: 'Jour par jour pendant une semaine : sorties manga en France et épisodes d\'anime, horaires à l\'heure de Paris.',
    body: `<h1>La semaine en détail</h1><p class="lead">Les sept prochains jours, manga et anime côte à côte. ${animeNotice() ? '' : ''}Les dates peuvent changer : la fiche de l'éditeur fait foi.</p>${animeNotice()}<nav class="kind-nav" aria-label="Jours">${days.map((d) => `<a href="#j-${d}">${esc(d === today ? "Aujourd'hui" : ucfirst(weekday(d)) + ' ' + dayNum(d))}</a>`).join('')}</nav>${sec}`,
  });
  SEO_URLS.push('/semaine/');
}

/* ------------------------------------------------------- visuels à partager */
{
  // Données des visuels à partager (mois, sélections) : calculées ici pour que l'image se dessine sans calcul lourd dans le navigateur
  const live = manga.filter((r) => r.statut !== 'annule' && r.date);
  const months = [...new Set(live.filter((r) => r.date.slice(0, 7) >= today.slice(0, 7)).map((r) => r.date.slice(0, 7)))].sort().slice(0, 3).map((mk) => {
    const rows = live.filter((r) => r.date.startsWith(mk)).sort((a, b) => a.date.localeCompare(b.date) || a.serie.localeCompare(b.serie, 'fr'));
    const pubs = new Map(); for (const r of rows) if (r.editeur) pubs.set(r.editeur, (pubs.get(r.editeur) || 0) + 1);
    const days = new Map(); for (const r of rows) days.set(r.date, (days.get(r.date) || 0) + 1);
    const busy = [...days].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const label = (r) => `${r.serie}${r.tome ? ` T${r.tome}` : ''}`;
    return {
      k: mk, label: frMonth(`${mk}-01`), total: rows.length,
      fresh: rows.filter(isFirstVolume).map((r) => ({ s: r.serie, e: r.editeur || '', d: r.date })),
      special: rows.filter((r) => pubType(r) !== 'standard').map((r) => ({ s: label(r), e: r.editeur || '', d: r.date, ty: (TYPES.find(([k]) => k === pubType(r)) || [, ''])[1] })),
      pubs: [...pubs].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => ({ e, n })),
      busy: busy ? { d: busy[0], n: busy[1] } : null,
    };
  });
  const lastPub = new Map(); for (const r of live) if (r.editeur) lastPub.set(slugify(r.serie), r.editeur);
  const nameOf = new Map(); for (const r of live) nameOf.set(slugify(r.serie), r.serie);
  const infos = [...nameOf].map(([k, name]) => ({ k, s: name, e: lastPub.get(k) || '', i: adaptations[k]?.i })).filter((x) => x.i && x.k);
  const finished = infos.filter((x) => x.i.st === 'FINISHED' && x.i.au?.length)
    .map((x) => ({ s: x.s, e: x.e, g: (x.i.g || []).map((g) => GENRE_FR[g]).filter(Boolean).slice(0, 2), au: x.i.au[0] })).sort((a, b) => a.s.localeCompare(b.s, 'fr')).slice(0, 80);
  const genres = [...GENRE_COUNT].filter(([g]) => genreOk(g)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => ({
    g: GENRE_FR[g], items: infos.filter((x) => x.i.g?.includes(g)).map((x) => ({ s: x.s, e: x.e })).sort((a, b) => a.s.localeCompare(b.s, 'fr')).slice(0, 40),
  }));
  write('data/partage.json', JSON.stringify({ generated: today, months, finished, genres }));
}
page('/partager/', {
  title: 'Visuels à partager',
  description: 'Génère une image prête à poster : sorties manga de la semaine et du mois, nouvelles séries, changements de date, anime, sélections.',
  body: `<h1>Visuels à partager</h1>
<p class="lead">Choisis un visuel, un format et télécharge l'image à poster sur Instagram, TikTok ou Pinterest. Elle est dessinée dans ton navigateur à partir des données du jour.</p>
<div id="partage-app"><p class="empty">Cette page a besoin de JavaScript pour créer les images.</p></div>
<script src="${av('partager.js')}" defer></script>
<h2>À quoi servent ces visuels ?</h2>
<p>Plusieurs modèles sont proposés : les sorties de la semaine, le bilan du mois, les nouvelles séries à surveiller, les changements de date, l'anime de la semaine et des sélections (séries à lire d'une traite, genre du moment). Chaque image est créée dans ton navigateur à partir des données du jour, aux formats carré (Instagram), vertical (TikTok, Stories) ou portrait (Pinterest). Un texte d'accompagnement est proposé avec l'image ; pense à citer le site quand tu la partages.</p>`,
});
SEO_URLS.push('/partager/');

/* ------------------------------------------------------- page de recherche */
page('/recherche/', {
  title: 'Recherche',
  description: 'Chercher une série manga, un anime ou un article.',
  noindex: true,
  body: `<h1>Recherche</h1>
<form class="home-search" action="/recherche/" method="get" role="search"><input type="search" name="q" id="rq" placeholder="Chercher une série, un anime, un article" aria-label="Recherche" autocomplete="off"><button class="btn" type="submit">Chercher</button></form>
<div id="rres" aria-live="polite"></div>
<noscript><p>La recherche a besoin de JavaScript. Tu peux parcourir la <a href="/series/">liste des séries</a> ou les <a href="/articles/">articles</a>.</p></noscript>
<script src="${av('resultats.js')}" defer></script>`,
});

/* ----------------------------------------------------------------- articles */
{
  const SECTIONS = [
    ['mensuel', 'Les sorties du mois', 'Tous les tomes annoncés pour le mois, par date.', 6],
    ['hebdo', 'Les rendez-vous de la semaine', 'Un récapitulatif chaque lundi : sorties manga et épisodes d\'anime des sept prochains jours.', 8],
    ['quotidien', 'Le programme du jour', 'Publié chaque matin : ce qui sort aujourd\'hui en manga et en anime.', 10],
    ['changements', 'Changements de dates', 'Reports, avancées, annonces et retraits relevés dans les plannings des éditeurs.', 6],
    ['dossier', 'Dossiers du mois', 'Nouvelles séries, éditions spéciales, sorties par éditeur et séries à lire d\'une traite, mis à jour automatiquement.', 8],
    ['redac', 'Dossiers et actualités', '', 20],
  ];
  const groups = SECTIONS.map(([k, t, d, n]) => ({ k, t, d, n, list: articles.filter((a) => a.kind === k) })).filter((g) => g.list.length);
  const nav = groups.length > 1 ? `<div class="filters" id="art-filtre" hidden><label class="p-lab"><span>Type d'article</span><select id="art-type"><option value="">Tous les types (${articles.length})</option>${groups.map((g) => `<option value="${g.k}">${esc(g.t)} (${g.list.length})</option>`).join('')}</select></label></div><noscript><nav class="kind-nav" aria-label="Types d'articles">${groups.map((g) => `<a href="#t-${g.k}">${esc(g.t)}</a>`).join('')}</nav></noscript><script>document.addEventListener('DOMContentLoaded',function(){var f=document.getElementById('art-filtre'),s=document.getElementById('art-type');if(!f||!s)return;f.hidden=false;var secs=[].slice.call(document.querySelectorAll('.art-sec'));function ap(){secs.forEach(function(e){e.hidden=!!s.value&&e.id!=='t-'+s.value;});try{history.replaceState(null,'',s.value?'#t-'+s.value:location.pathname);}catch(e){}}s.addEventListener('change',ap);var h=location.hash.replace('#t-','');if(h&&[].some.call(s.options,function(o){return o.value===h;})){s.value=h;}ap();});</script>` : '';
  const sectionHtml = groups.map((g) => `<section class="art-sec" id="t-${g.k}"><h2>${esc(g.t)}</h2>${g.d ? `<p class="muted">${esc(g.d)}</p>` : ''}<ul class="articles">${g.list.slice(0, g.n).map(articleItem).join('')}</ul>${g.list.length > g.n ? `<details class="older"><summary>Voir les ${g.list.length - g.n} plus anciens</summary><ul class="articles">${g.list.slice(g.n).map(articleItem).join('')}</ul></details>` : ''}</section>`).join('');
  page('/articles/', {
    title: 'Articles',
    description: 'Programme du jour, récapitulatifs de la semaine et du mois : sorties manga et épisodes d\'anime.',
    body: `<h1>Articles</h1>${nav}${articles.length ? sectionHtml : '<p class="empty">Aucun article pour le moment.</p>'}`,
  });
  for (const a of articles) {
    const ld = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article', headline: a.title, datePublished: a.date,
      inLanguage: 'fr', ...(siteUrlOk ? { mainEntityOfPage: `${base}/articles/${a.slug}/` } : {}),
    }).replace(/</g, '\\u003c');
    page(`/articles/${a.slug}/`, {
      title: a.title,
      description: (a.description || a.title).length < 70 ? `${a.description || a.title} Dates, horaires et fiches de chaque série sur ${config.siteName}.` : (a.description || a.title),
      body: `<article class="post"><p class="muted">${kindBadge(a)} <time datetime="${a.date}">${esc(frDate(a.date))}</time></p><h1>${esc(a.title)}</h1>\n${artHtml(a.body)}</article>\n<p class="more"><a href="/articles/">Tous les articles</a></p>`,
      extraHead: `<script type="application/ld+json">${ld}</script>`,
    });
  }
}

/* -------------------------------------------------------- mentions légales */
const L = config.legal;
if (reportEmail && !reportUrl) {
  page('/signaler/', {
    title: 'Signaler une erreur',
    description: 'Une date, un titre ou un horaire est faux ? Dis-le nous.',
    noindex: true,
    body: `<h1>Signaler une erreur</h1>
<p class="lead">Une date de sortie, un titre ou un horaire est faux ? Décris-le ci-dessous : le message est prêt à envoyer, tu choisis ta messagerie.</p>
<div class="rep" data-mail="${esc(reportEmail)}" hidden>
<label for="rep-page">Page concernée</label>
<input id="rep-page" type="text" autocomplete="off">
<label for="rep-msg">Ce qui est faux (série, tome, date attendue, source si tu en as une)</label>
<textarea id="rep-msg" rows="6"></textarea>
<div class="rep-btns">
<a class="btn" id="rep-gmail" target="_blank" rel="noopener">Envoyer avec Gmail</a>
<a class="btn" id="rep-outlook" target="_blank" rel="noopener">Envoyer avec Outlook</a>
<a class="btn" id="rep-mailto">Application mail de l'appareil</a>
<button type="button" class="btn" id="rep-copy">Copier le message</button>
</div>
<p class="muted" id="rep-ok" role="status"></p>
</div>
<noscript><p>Écris-nous à <a href="mailto:${esc(reportEmail)}">${esc(reportEmail)}</a> en indiquant la page et ce qui est faux.</p></noscript>
<p class="muted">Adresse de contact : ${esc(reportEmail)}. Ton message n'est envoyé que si tu valides l'envoi dans ta propre messagerie ; ce site ne le reçoit pas et ne garde rien.</p>
<script>
(function(){var r=document.querySelector('.rep');if(!r)return;r.hidden=false;
var to=r.getAttribute('data-mail'),pg=document.getElementById('rep-page'),msg=document.getElementById('rep-msg'),ok=document.getElementById('rep-ok');
var q=new URLSearchParams(location.search).get('p')||'';
pg.value=q&&/^\\/[\\w\\-\\/.#?=&%]*$/.test(q)?location.origin+q:'';
var sub='Erreur signalée';
function body(){return 'Page : '+(pg.value||'(non précisée)')+'\\n\\nCe qui est faux :\\n'+msg.value;}
function upd(){var b=encodeURIComponent(body()),s=encodeURIComponent(sub);
document.getElementById('rep-gmail').href='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(to)+'&su='+s+'&body='+b;
document.getElementById('rep-outlook').href='https://outlook.live.com/mail/0/deeplink/compose?to='+encodeURIComponent(to)+'&subject='+s+'&body='+b;
document.getElementById('rep-mailto').href='mailto:'+to+'?subject='+s+'&body='+b;}
pg.addEventListener('input',upd);msg.addEventListener('input',upd);upd();
document.getElementById('rep-copy').addEventListener('click',function(){var t='À : '+to+'\\nObjet : '+sub+'\\n\\n'+body();
function done(m){ok.textContent=m;}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){done('Message copié.');},function(){done('Copie impossible : sélectionne le texte à la main.');});}
else{msg.select();done('Sélectionne et copie le texte.');}});
})();
</script>`,
  });
}

{
  const v = (s) => esc(s || 'À compléter');
  page('/mentions-legales/', {
    title: 'Mentions légales',
    description: `Mentions légales de ${config.siteName} : éditeur du site, hébergement, données personnelles, mesure d'audience et liens d'affiliation.`,
    body: `<h1>Mentions légales</h1>
<h2>Éditeur du site</h2>
<p>${v(L.editorName)}<br>Contact : ${v(L.contactEmail)}<br>Directeur de la publication : ${v(L.publicationDirector)}</p>
<h2>Hébergeur</h2>
<p>${v(L.hostName)}<br>${v(L.hostAddress)}</p>
<h2>Données et contenus</h2>
<p>Les horaires des épisodes d'anime proviennent de l'API AniList. Les dates de sortie des mangas sont relevées auprès des sources officielles des éditeurs et peuvent évoluer. Les titres, marques et visuels cités appartiennent à leurs propriétaires respectifs. Ce site n'est affilié à aucun éditeur ni à aucune plateforme.</p>
<h2>Cookies et données personnelles</h2>
<p>Ce site ne dépose pas de cookies.${ANALYTICS ? ' La fréquentation est aussi mesurée avec Cloudflare Web Analytics, un outil sans cookie qui ne crée aucun profil individuel : il compte les pages vues, les pays et les navigateurs de façon agrégée, sans stocker d’adresse IP.' : ''}</p>
<h2 id="mesure">Mesure d'audience</h2>
<p>Pour savoir quelles pages sont utiles, le site mesure sa fréquentation avec son propre outil, sans cookie et sans transmettre de données à des tiers. Pour chaque page vue sont enregistrés : la page, le site d'où tu viens, le pays (déduit par l'hébergeur), le type d'appareil, le navigateur et le système, le temps passé sur la page et la part de la page parcourue, ainsi que les termes tapés dans la recherche du site. Ton adresse IP n'est jamais enregistrée : elle sert seulement, le jour même, à calculer une empreinte anonyme qui permet de compter les visiteurs uniques ; la clé de calcul est détruite chaque jour, si bien qu'il devient impossible de relier une visite à une personne ou à une autre journée. Ces données servent uniquement à produire des statistiques pour l'éditeur du site et sont supprimées au bout de 13 mois. Rien n'est mesuré si ton navigateur envoie « Ne pas me suivre ». Tu peux aussi <a href="/?mesure=non" rel="nofollow">refuser la mesure sur cet appareil</a> (et <a href="/?mesure=oui" rel="nofollow">l'accepter à nouveau</a>).</p>
${showCovers ? '<p>Les couvertures des tomes et les affiches d’anime sont affichées depuis les serveurs des éditeurs, de leurs diffuseurs ou d’AniList : en consultant une page qui en contient, votre navigateur leur transmet votre adresse IP, comme pour toute image hébergée ailleurs.</p>' : ''}
${AFFILIATE_ON ? `<h2 id="affiliation">Liens d'affiliation</h2>
<p>Certains liens d'achat (${esc(SHOPLIST.filter((x) => x.sponsored).map((x) => x.name).join(', '))}) sont des liens d'affiliation : si tu achètes après avoir cliqué, le site peut percevoir une commission, sans que le prix change pour toi. Ces liens sont signalés sur les pages concernées et n'influencent pas les dates ni les informations publiées. Pour savoir quels liens sont utiles, le site compte les clics sur les boutons d'achat de façon anonyme : seuls la boutique, la série, la page et le jour sont enregistrés, sans cookie, sans adresse IP et sans identifiant. Rien n'est compté si ton navigateur envoie « Ne pas me suivre ».</p>
${SHOPLIST.some((x) => x.id === 'amazon' && x.sponsored) ? `<p>En tant que Partenaire Amazon, je réalise un bénéfice sur les achats remplissant les conditions requises.</p>
` : ''}` : ''}${NL.on ? `
<h2 id="newsletter">Newsletter</h2>
<p>Si vous vous abonnez à la newsletter, votre adresse e-mail est transmise${NL.provider ? ` à ${esc(NL.provider)}` : ' au service d’envoi'} qui envoie les messages pour le compte de ${v(L.editorName)}. Elle sert uniquement à l’envoi du récapitulatif hebdomadaire et est conservée jusqu’à votre désabonnement, possible à tout moment depuis chaque e-mail. Vous pouvez demander l’accès, la rectification ou la suppression de vos données à ${v(L.contactEmail)}.</p>` : ''}`,
  });
}

/* ------------------------------------------------------------ fichiers .ics */
{
  const icsRows = manga.filter((r) => r.date >= addDays(today, -30) && r.statut !== 'annule');
  const mangaEvents = icsRows
    .map((r) => ({
      uid: `manga-${r.isbn || `${r.date}-${r.serie}-${r.tome}`.replace(/[^A-Za-z0-9-]/g, '')}@${host}`,
      start: r.date,
      summary: `${mangaLabel(r)}${r.editeur ? ` (${r.editeur})` : ''}`,
      description: [STATUT_LABEL[r.statut], r.prix != null ? euro(r.prix) : '', r.notes].filter(Boolean).join(' · '),
      url: r.source || undefined,
    }));
  write('manga.ics', buildICS({ name: `${config.siteName} : manga`, events: mangaEvents }));
  for (const [k, label] of Object.entries(PUBS)) {
    const evs = mangaEvents.filter((_, i) => pubKey(icsRows[i].editeur) === k);
    if (evs.length) write(`agenda/${k}.ics`, buildICS({ name: `${config.siteName} : ${label}`, events: evs }));
  }

  const animeEvents = eps.map((e) => ({
    uid: `anime-${e.mediaId}-${e.episode}@${host}`,
    start: e.date,
    end: new Date(e.date.getTime() + 24 * 60000),
    summary: `${displayTitle(e.title)} : épisode ${e.episode}`,
    description: 'Diffusion japonaise. La disponibilité en France dépend des plateformes.',
    url: safeUrl(e.url) || undefined,
  }));
  write('anime.ics', buildICS({ name: `${config.siteName} : anime`, events: animeEvents }));
}

/* ------------------------------------------------------- SEO et divers */
write('404.html', layout({
  title: 'Page introuvable', description: 'Page introuvable.', pathname: '/404.html', noindex: true,
  body: '<h1>Page introuvable</h1><p>Cette page n\'existe pas. <a href="/">Retour à l\'accueil</a>.</p>',
}));
write('robots.txt', isPrivate ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n${siteUrlOk ? `Sitemap: ${base}/sitemap.xml\n` : ''}`);
if (siteUrlOk && !isPrivate) {
  const urls = ['/', '/anime/', '/manga/', '/changements/', '/articles/', '/etat/', '/mentions-legales/', ...SEO_URLS, ...ANIME_PAGES, ...articles.map((a) => `/articles/${a.slug}/`)];
  const lastmod = (u) => (u.startsWith('/articles/') && u !== '/articles/' ? articles.find((a) => `/articles/${a.slug}/` === u)?.date : today);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((u) => `<url><loc>${esc(base + u)}</loc><lastmod>${lastmod(u)}</lastmod></url>`).join('\n')}\n</urlset>\n`);
}
write('data/anime-week.json', JSON.stringify({
  generated: today,
  eps: eps.map((e) => ({
    id: e.mediaId, t: displayTitle(e.title), e: e.episode, at: e.airingAt, f: e.format === 'MOVIE' ? 1 : undefined,
    p: isPremiere(e) ? 1 : undefined, ms: e.ms || undefined,
    s: (Array.isArray(e.stream) ? e.stream : []).filter((x) => x && /^https:\/\//.test(x.u || '')).slice(0, 3).map((x) => ({ n: x.n, u: x.u })),
  })),
}));
write('data/recent.json', JSON.stringify({
  events: events.filter((e) => e.day >= addDays(today, -60)).map((e) => ({ day: e.day, type: e.type, s: e.s, t: e.t, from: e.from, to: e.to })),
  articles: articles.slice(0, 20).map((a) => ({ date: a.date, title: a.title, slug: a.slug })),
}));
{
  const seenA = new Set(), animeIdx = [];
  for (const e of eps) {
    if (seenA.has(e.mediaId)) continue;
    seenA.add(e.mediaId);
    const names = [e.title?.english, e.title?.romaji, e.title?.native].filter(Boolean);
    animeIdx.push({ n: displayTitle(e.title), u: `/anime/#j-${e.key}`, d: `${frShort(e.key)} · ${e.time}`, a: names.join(' '), c: showCovers && /^https:\/\//.test(e.cover || '') ? e.cover : '', x: `Épisode ${e.episode} · ${frShort(e.key)} à ${e.time}` });
  }
  write('data/search.json', JSON.stringify({
    series: searchSeries,
    catalogue: searchCatalogue,
    anime: animeIdx,
    articles: articles.map((a) => ({ n: a.title, u: `/articles/${a.slug}/`, d: frShort(a.date), x: a.description || '' })),
  }));
}
for (const f of ['collection.js', 'mesure.js', 'visite.js', 'clic.js', 'recherche.js', 'resultats.js', 'partager.js', 'theme.js', 'sw.js', 'icon.svg']) write(f, readFileSync(path.join(SCRIPTS, f === 'icon.svg' ? 'assets' : '.', f), 'utf8'));
for (const f of ['icon-192.png', 'icon-512.png', 'og.png', 'favicon.ico', 'favicon-48.png', 'favicon-96.png']) write(f, readFileSync(path.join(SCRIPTS, 'assets', f)));
write('manifest.webmanifest', JSON.stringify({
  name: config.siteName, short_name: config.siteName, description: config.description, lang: 'fr',
  start_url: '/', scope: '/', display: 'standalone', background_color: '#f4f1ff', theme_color: '#ffd21f',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
}));
if (siteUrlOk) {
  const items = articles.slice(0, 20).map((a) => `<item><title>${esc(a.title)}</title><link>${esc(`${base}/articles/${a.slug}/`)}</link><guid isPermaLink="true">${esc(`${base}/articles/${a.slug}/`)}</guid><pubDate>${new Date(`${a.date}T07:00:00Z`).toUTCString()}</pubDate><description>${esc(a.description || a.title)}</description></item>`).join('\n');
  write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(config.siteName)}</title><link>${esc(base + '/')}</link><description>${esc(config.description)}</description><language>fr</language>\n${items}\n</channel></rss>\n`);
}
write('_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/sw.js\n  Cache-Control: no-cache\n/data/*\n  Cache-Control: no-cache\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/favicon*\n  Cache-Control: public, max-age=86400\n/icon*\n  Cache-Control: public, max-age=86400\n');
for (const f of ['dela-400', 'zen-400', 'zen-700', 'zen-900']) write(`fonts/${f}.woff`, readFileSync(path.join(SCRIPTS, 'assets', 'fonts', `${f}.woff`)));
write('fonts/LICENSE.txt', readFileSync(path.join(SCRIPTS, 'assets', 'fonts', 'LICENSE.txt'), 'utf8'));
write('style.css', readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'), 'utf8'));

/* ---------------------------------------------------------- avertissements */
console.log(`Site généré dans ${path.relative(process.cwd(), P.outDir) || '.'} : ${written.length} fichiers, ${articles.length} articles, ${manga.length} sorties manga, ${eps.length} épisodes anime.`);
if (isPrivate) console.warn('⚠ Site privé (launched: false) : non indexé par Google. Passe "launched" à true au lancement.');
if (showCovers) console.warn('⚠ Couvertures activées : vérifie l\'autorisation des éditeurs avant le lancement public.');
if (!siteUrlOk) console.warn('⚠ siteUrl dans site.config.json est encore à remplacer : pas de sitemap ni d\'adresse canonique.');
const todo = Object.entries(L).filter(([, val]) => !val || /compl[ée]ter/i.test(val)).map(([k]) => k);
if (todo.length) console.warn(`⚠ Mentions légales à compléter dans site.config.json : ${todo.join(', ')}`);
