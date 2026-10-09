// Génère le site statique dans dist/ à partir de data/, content/ et site.config.json.
// Commande : node scripts/build.mjs   (aucune dépendance à installer)
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readChanges, keyOf } from './changes.mjs';
import {
  paths, now, parisKey, parisHM, addDays, frDate, frDayMonth, frShort, frMonth, ucfirst,
  loadConfig, loadAllManga, readAnime, loadArticles, displayTitle, mangaLabel, euro, STATUT_LABEL,
  esc, slugify, weekdayOfKey, markdown, buildICS,
} from './lib.mjs';

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
const eps = anime.episodes
  .map((e) => ({ ...e, date: new Date(e.airingAt * 1000) }))
  .map((e) => ({ ...e, key: parisKey(e.date), time: parisHM(e.date) }));
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
const NAV = [['/', 'Accueil'], ['/manga/', 'Manga'], ['/anime/', 'Anime'], ['/series/', 'Séries'], ['/mon-planning/', 'Mon planning'], ['/changements/', 'Changements'], ['/articles/', 'Articles']];
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' fill='%23fff' stroke='%2312131a' stroke-width='3'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%232540e8'/%3E%3C/svg%3E";

function layout({ title, description, pathname, body, noindex = false, extraHead = '' }) {
  const fullTitle = pathname === '/' ? `${config.siteName} : ${config.tagline}` : `${title} | ${config.siteName}`;
  const canonical = siteUrlOk ? `${base}${pathname}` : '';
  const nav = NAV.map(([href, label]) => {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    return `<a href="${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
${noindex || isPrivate ? `<meta name="robots" content="noindex${isPrivate ? ', nofollow' : ''}">` : ''}
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${esc(config.siteName)}">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/style.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#ffd21f">
<link rel="apple-touch-icon" href="/icon-192.png">
${siteUrlOk ? `<link rel="alternate" type="application/rss+xml" title="${esc(config.siteName)}" href="/feed.xml">` : ''}
${extraHead}
</head>
<body>
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="site-header"><div class="wrap bar"><a class="brand" href="/"><span class="mark" aria-hidden="true"></span>${esc(config.siteName)}</a><nav aria-label="Navigation principale">${nav}</nav></div></header>
<main class="wrap" id="contenu">
${body}
</main>
<footer class="site-footer"><div class="wrap">
<p>Horaires des épisodes : <a href="https://anilist.co" rel="noopener">AniList</a>, diffusion japonaise. Dates des mangas : plannings officiels des éditeurs, susceptibles de changer.</p>
<p><a href="/manga.ics">Agenda manga (.ics)</a><a href="/anime.ics">Agenda anime (.ics)</a>${siteUrlOk ? '<a href="/feed.xml">Flux RSS</a>' : ''}<a href="/nouveautes/">Nouveautés</a><a href="/mentions-legales/">Mentions légales</a></p>
</div></footer>
<script src="/suivi.js" defer></script>
<script src="/visite.js" defer></script>
</body>
</html>
`;
}
const page = (pathname, opts) => write(`${pathname.replace(/^\//, '')}index.html`, layout({ ...opts, pathname }));

/* ------------------------------------------------------------- composants */
const SEO_URLS = [];
const PUBS = { glenat: 'Glénat', kana: 'Kana', pika: 'Pika', 'ki-oon': 'Ki-oon', akata: 'Akata' };
const pubKey = (e) => { const k = slugify(e || ''); return k in PUBS ? k : 'autre'; };
const weekday = (k) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`)).replace('.', '');
const dayNum = (k) => String(Number(k.slice(8)));
const wdc = (k) => `wd-${((weekdayOfKey(k) + 6) % 7) + 1}`; // 1 = lundi … 7 = dimanche : une couleur par jour de la semaine
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// « Ryukyu Buccaneer - Tome 01 - Édition collector » -> « Édition collector »
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

const serieLink = (name) => (slugify(name) ? `<a class="slink" href="/serie/${slugify(name)}/">${esc(name)}</a>` : esc(name));

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
  const frame = coverBox(r.cover, `Couverture de ${label}`, 160, 240);
  return `<li class="tile p-${pk}"><a class="tile-cover" href="${esc(r.source || '/manga/')}" ${r.source ? 'rel="noopener nofollow"' : ''} aria-label="${esc(label)} : fiche éditeur">${frame}</a>`
    + `<div class="tile-body"><strong>${esc(r.serie)}</strong>${r.tome ? ` <span class="tome">tome ${esc(r.tome)}</span>` : ''}`
    + `<div class="tile-date"><time datetime="${r.date}">${esc(frShort(r.date))}</time></div><span class="pub">${esc(r.editeur || '')}</span>${isNewSeries(r) ? NEW_BADGE : ''}`
    + `<button type="button" class="follow" data-s="${esc(slugify(r.serie))}" data-n="${esc(r.serie)}" hidden>Suivre</button></div></li>`;
}


const NOT_NEW = /nouvelle [ée]dition|r[ée][ée]dition|collector|int[ée]grale|deluxe|perfect|coffret|[ée]dition|artbook|fanbook|anthologie|\b(guide|pack|box)\b/i;
// « Nouvelle série » : tome 1 d'une série, hors rééditions et éditions spéciales, annoncé ou sorti depuis moins de 15 jours
const isNewSeries = (r) => String(r.tome) === '1' && r.statut !== 'annule' && !NOT_NEW.test(`${r.serie} ${r.titre || ''}`) && r.date >= addDays(today, -14);
const NEW_BADGE = '<span class="badge s-new">★ Nouvelle série</span>';
const PREMIERE_BADGE = '<span class="badge s-new">★ Épisode 1</span>';
const isPremiere = (e) => Number(e.episode) === 1 && e.format !== 'MOVIE';

function coverBox(src, alt, w = 200, h = 300) {
  const img = /^https:\/\//.test(src || '') ? `<img class="cover-img" src="${esc(src)}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  return `<div class="cover" aria-hidden="${img ? 'false' : 'true'}">${img}</div>`;
}
// tuile d'un tome (page de série)
function volTile(r) {
  const pk = pubKey(r.editeur);
  const label = mangaLabel(r);
  const cover = showCovers ? coverBox(r.cover, `Couverture de ${label}`) : '';
  const own = /^\d*$/.test(String(r.tome || '')) && slugify(r.serie) ? `<button type="button" class="own" data-s="${esc(slugify(r.serie))}" data-t="${esc(r.tome || '')}" aria-pressed="false" hidden>Je l'ai</button>` : '';
  const ed = editionOf(r);
  const mv = moves.get(keyOf(r));
  const moved = mv && mv.to === r.date ? `<span class="badge ${mv.to > mv.from ? 's-reporte' : 's-confirme'}">${mv.to > mv.from ? 'Reporté' : 'Avancé'}</span>` : '';
  return `<li class="tile rel vol p-${pk}${r.date < today ? ' past' : ''}">`
    + `${r.source ? `<a class="tile-cover" href="${esc(r.source)}" rel="noopener nofollow" aria-label="${esc(label)} : fiche éditeur">${cover}</a>` : cover}`
    + `<div class="tile-body"><strong>${r.tome ? `Tome ${esc(r.tome)}` : esc(r.serie)}</strong>${ed ? `<span class="ed">${esc(ed)}</span>` : ''}`
    + `<div class="tile-date"><time datetime="${r.date}">${esc(frShort(r.date))}</time></div>`
    + `<span class="pub">${esc(r.editeur || '')}${r.prix != null ? ` · ${esc(euro(r.prix))}` : ''}</span>${isNewSeries(r) ? NEW_BADGE : ''}${moved}${own}</div></li>`;
}

const BADGE_TXT = { confirme: 'Date confirmée', reporte: 'Reporté', annule: 'Annulé' };
function releaseItem(r, showDate = false) {
  const pk = pubKey(r.editeur);
  const ed = editionOf(r);
  const mv = moves.get(keyOf(r));
  const moved = mv && mv.to === r.date ? `<span class="badge ${mv.to > mv.from ? 's-reporte' : 's-confirme'}">${mv.to > mv.from ? 'Reporté' : 'Avancé'} (avant : ${esc(frShort(mv.from))})</span>` : '';
  const badge = moved || (BADGE_TXT[r.statut] ? `<span class="badge s-${r.statut}">${BADGE_TXT[r.statut]}</span>` : '');
  const meta = [
    showDate ? `<time datetime="${r.date}">${esc(frShort(r.date))}</time>` : '',
    `<span class="pub">${esc(r.editeur || 'Éditeur inconnu')}</span>`,
    r.prix != null ? `<span>${euro(r.prix)}</span>` : '',
    isNewSeries(r) ? NEW_BADGE : '',
    badge,
    r.source ? `<a href="${esc(r.source)}" rel="noopener nofollow">Fiche éditeur</a>` : '',
    /^\d*$/.test(String(r.tome || '')) && slugify(r.serie) ? `<button type="button" class="own" data-s="${esc(slugify(r.serie))}" data-t="${esc(r.tome || '')}" aria-pressed="false" hidden>Je l'ai</button>` : '',
  ].filter(Boolean).join('');
  const q = `${r.serie} ${r.tome} ${r.titre} ${r.editeur}`.toLowerCase();
  const alt = `Couverture de ${r.serie}${r.tome ? ` tome ${r.tome}` : ''}`;
  const cover = showCovers ? `<div class="cover" aria-hidden="${r.cover ? 'false' : 'true'}">${r.cover ? `<img class="cover-img" src="${esc(r.cover)}" alt="${esc(alt)}" width="60" height="90" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</div>` : '';
  return `<li class="rel p-${pk}${r.date < today ? ' past' : ''}${showCovers ? ' has-cover' : ''}" data-pub="${pk}" data-q="${esc(q)}" data-d="${r.date}" data-df="${esc(frShort(r.date))}" data-s="${esc(r.serie)}">${cover}<div class="rel-main"><button type="button" class="follow" data-s="${esc(slugify(r.serie))}" data-n="${esc(r.serie)}" hidden>Suivre</button><div class="rel-title"><strong>${serieLink(r.serie)}</strong>${r.tome ? ` <span class="tome">tome ${esc(r.tome)}</span>` : ''}${ed ? ` <span class="ed">${esc(ed)}</span>` : ''}</div>`
    + `<div class="meta">${meta}</div>${r.notes && r.notes !== 'Collecte automatique' ? `<p class="notes">${esc(r.notes)}</p>` : ''}</div></li>`;
}

const STREAM_ICON = { Crunchyroll: 'CR', ADN: 'ADN', Netflix: 'N', 'Prime Video': 'P', 'Disney+': 'D+', Wakanim: 'W' };
const streamChips = (e) => (Array.isArray(e.stream) ? e.stream : [])
  .filter((s) => s && /^https:\/\//.test(s.u || '')).slice(0, 3)
  .map((s) => `<a class="stream s-${esc(slugify(s.n))}" href="${esc(s.u)}" rel="noopener nofollow" target="_blank" title="Regarder sur ${esc(s.n)}" aria-label="Regarder sur ${esc(s.n)}"><svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>${esc(STREAM_ICON[s.n] || s.n.slice(0, 2))}</a>`).join('');

function episodeItem(e) {
  const t = esc(displayTitle(e.title));
  const url = safeUrl(e.url);
  const title = url ? `<a href="${esc(url)}" rel="noopener nofollow">${t}</a>` : t;
  const hasCover = showCovers && /^https:\/\//.test(e.cover || '');
  const thumb = hasCover ? `<span class="ep-cover cover"><img class="cover-img" src="${esc(e.cover)}" alt="Affiche de ${t}" width="96" height="144" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>` : '';
  return `<li class="ep-row${hasCover ? ' has-thumb' : ''}" data-q="${esc(displayTitle(e.title).toLowerCase())}">${thumb}<time>${esc(e.time)}</time><span class="t">${title}${e.format === 'MOVIE' ? ' <span class="muted">film</span>' : ''}</span><span class="ep">épisode ${esc(e.episode)}${isPremiere(e) ? ` ${PREMIERE_BADGE}` : ''}${streamChips(e) ? `<span class="streams">${streamChips(e)}</span>` : ''}</span></li>`;
}

function animeCard(e) {
  const t = esc(displayTitle(e.title));
  const url = safeUrl(e.url);
  const img = /^https:\/\//.test(e.cover || '') ? `<img class="cover-img" src="${esc(e.cover)}" alt="Affiche de ${t}" width="200" height="300" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  const frame = `<div class="cover">${img}</div>`;
  return `<li class="acard" data-q="${esc(displayTitle(e.title).toLowerCase())}">${url ? `<a class="acard-cover" href="${esc(url)}" rel="noopener nofollow" aria-label="${t} : fiche AniList">${frame}</a>` : frame}`
    + `<div class="acard-body"><span class="acard-time">${esc(e.time)}</span><strong>${t}</strong><span class="muted">épisode ${esc(e.episode)}${e.format === 'MOVIE' ? ' · film' : ''}</span>${isPremiere(e) ? PREMIERE_BADGE : ''}${streamChips(e) ? `<span class="streams">${streamChips(e)}</span>` : ''}</div></li>`;
}

const articleItem = (a) =>
  `<li><time class="muted" datetime="${a.date}">${esc(frShort(a.date))}</time><div><a href="/articles/${a.slug}/">${esc(a.title)}</a>${a.description ? `<p class="notes">${esc(a.description)}</p>` : ''}</div></li>`;

const dots = (rows) => [...new Set(rows.map((r) => pubKey(r.editeur)))]
  .map((k) => `<i class="dot p-${k}" title="${esc(PUBS[k] || 'Autres éditeurs')}"></i>`).join('');

/* ------------------------------------------------------------------ accueil */
{
  const todayEps = eps.filter((e) => e.key === today);
  const topToday = [...todayEps].sort((a, b) => b.popularity - a.popularity).slice(0, 8).sort((a, b) => a.airingAt - b.airingAt);
  const live = manga.filter((r) => r.statut !== 'annule');
  const mangaToday = live.filter((r) => r.date === today);
  const mangaNext = live.filter((r) => r.date > today && r.date <= addDays(today, 30)).slice(0, 10);
  const shelf = showCovers ? live.filter((r) => r.date > today && r.cover).slice(0, 12) : [];
  const recent = events.filter((e) => e.day >= addDays(today, -14)).slice(0, 5);
  const newShelf = live.filter((r) => r.date >= today && isNewSeries(r)).slice(0, 8);
  const strip = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
    const m = live.filter((r) => r.date === d);
    const a = eps.filter((e) => e.key === d);
    return `<li class="day-panel ${wdc(d)}${d === today ? ' today' : ''}"><div class="d-head"><span class="d-wd">${esc(d === today ? "aujourd'hui" : weekday(d))}</span><span class="d-num">${dayNum(d)}</span></div>`
      + (m.length ? `<a class="d-line" href="/manga/#j-${d}"><b>${m.length}</b> ${m.length > 1 ? 'mangas' : 'manga'}<span class="dots">${dots(m)}</span></a>` : '<span class="d-line none">Pas de manga</span>')
      + (a.length ? `<a class="d-line" href="/anime/#j-${d}"><b>${a.length}</b> ${a.length > 1 ? 'épisodes' : 'épisode'}</a>` : '<span class="d-line none">Pas d\'épisode</span>')
      + '</li>';
  }).join('');
  const body = `
<section class="week" aria-labelledby="t-week">
<div class="week-head"><h1 id="t-week">Les sorties de la semaine</h1>
<p class="lead">Mangas en France chez Glénat, Kana, Pika, Ki-oon et Akata. Épisodes d'anime diffusés au Japon, à l'heure de Paris.</p>
<p class="updated muted" id="updated" data-t="${esc(updatedIso)}">Mis à jour le ${esc(frDate(parisKey(new Date(updatedIso))))}</p></div>
<div class="since panel" id="since" hidden></div>
<ul class="strip">${strip}</ul>
</section>
<section class="two" aria-label="Aujourd'hui">
<div>
<h2>Manga du ${esc(frDate(today))}</h2>
${mangaToday.length
    ? `<ul class="list panel">${mangaToday.map((r) => releaseItem(r)).join('')}</ul>`
    : '<p class="empty">Aucune sortie manga enregistrée aujourd\'hui. <a href="/manga/">Voir le calendrier</a></p>'}
</div>
<div>
<h2>Anime du jour</h2>
${todayEps.length
    ? `<ul class="list panel eps">${topToday.map(episodeItem).join('')}</ul><p class="muted more">Les ${topToday.length} plus suivis sur ${todayEps.length} épisodes. <a href="/anime/#j-${today}">Programme complet</a></p>`
    : '<p class="empty">Le programme apparaîtra après la prochaine mise à jour automatique.</p>'}
</div>
</section>
${mangaNext.length ? `<section><h2>Prochaines sorties manga</h2>${shelf.length >= 6 ? `<ul class="shelf">${shelf.map(tile).join('')}</ul>` : `<ul class="list panel">${mangaNext.map((r) => releaseItem(r, true)).join('')}</ul>`}<p class="more"><a href="/manga/">Tout le calendrier manga</a></p></section>` : ''}
${newShelf.length ? `<section><h2>Nouvelles séries à découvrir</h2>${showCovers ? `<ul class="shelf">${newShelf.map(tile).join('')}</ul>` : `<ul class="list panel">${newShelf.map((r) => releaseItem(r, true)).join('')}</ul>`}<p class="more"><a href="/nouveautes/">Toutes les nouveautés</a></p></section>` : ''}
${recent.length ? `<section><h2>Derniers changements de date</h2><ul class="list panel">${recent.map(changeItem).join('')}</ul><p class="more"><a href="/changements/">Tous les changements</a></p></section>` : ''}
<section>
<h2>Derniers articles</h2>
${articles.length ? `<ul class="articles">${articles.slice(0, 6).map(articleItem).join('')}</ul><p class="more"><a href="/articles/">Tous les articles</a></p>` : '<p class="empty">Les premiers articles arrivent bientôt.</p>'}
</section>`;
  page('/', { title: config.siteName, description: config.description, body });
}

/* ------------------------------------------------------- filtres (partagés) */
const FILTER_JS = `<script>
(function(){var bar=document.getElementById('filtres');if(!bar)return;bar.hidden=false;
var q=document.getElementById('f'),chips=[].slice.call(bar.querySelectorAll('[data-chip]')),act={},none=document.getElementById('aucun');
function apply(){var t=(q.value||'').toLowerCase().trim(),any=Object.keys(act).length,shown=0;
[].forEach.call(document.querySelectorAll('[data-q]'),function(li){var ok=(!any||!li.dataset.pub||act[li.dataset.pub])&&(!t||li.dataset.q.indexOf(t)>-1);li.hidden=!ok;if(ok)shown++;});
[].forEach.call(document.querySelectorAll('[data-group]'),function(g){g.hidden=![].some.call(g.querySelectorAll('[data-q]'),function(l){return !l.hidden;});});
chips.forEach(function(c){var k=c.dataset.chip;c.setAttribute('aria-pressed',k==='tous'?String(!any):String(!!act[k]));});
if(none)none.hidden=shown>0;}
chips.forEach(function(c){c.addEventListener('click',function(){var k=c.dataset.chip;if(k==='tous')act={};else if(act[k])delete act[k];else act[k]=1;apply();});});
q.addEventListener('input',apply);
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

  const content = monthKeys.map((mk) => {
    const days = [...byDate.keys()].filter((d) => d.startsWith(mk)).sort();
    return `<section class="month" data-group><h2>${esc(ucfirst(frMonth(`${mk}-01`)))}</h2>${grid(mk)}${
      days.map((d) => `<div class="daygroup" data-group><h3 id="j-${d}" class="chip-day ${wdc(d)}">${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h3><ul class="list panel">${byDate.get(d).map((r) => releaseItem(r)).join('')}</ul></div>`).join('')}</section>`;
  }).join('\n');

  const counts = new Map();
  for (const r of rows) counts.set(pubKey(r.editeur), (counts.get(pubKey(r.editeur)) || 0) + 1);
  const order = [...Object.keys(PUBS), 'autre'].filter((k) => counts.has(k));
  const chips = ['<button type="button" class="chip" data-chip="tous" aria-pressed="true">Tous</button>']
    .concat(order.map((k) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="false"><i class="dot p-${k}"></i>${esc(PUBS[k] || 'Autres')} <span class="n">${counts.get(k)}</span></button>`)).join('');

  const body = `
<h1>Calendrier des sorties manga</h1>
<p class="lead">Sorties en France relevées sur les plannings officiels des éditeurs. Les dates peuvent bouger : la fiche de l'éditeur fait foi.</p>
${rows.length ? `<div class="filters" id="filtres" hidden><input type="search" id="f" placeholder="Chercher une série" aria-label="Chercher une série">${chips}</div>
<div class="views" id="vues" role="group" aria-label="Affichage" hidden><span class="muted">Affichage :</span>
<button type="button" class="chip" data-view="jour" aria-pressed="true">Par jour</button><button type="button" class="chip" data-view="editeur" aria-pressed="false">Par éditeur</button><button type="button" class="chip" data-view="serie" aria-pressed="false">Par série</button><button type="button" class="chip jump-today" id="auj">Aujourd'hui</button></div>
<p class="empty" id="aucun" hidden>Aucune sortie ne correspond à ce filtre.</p>
${content}` : '<p class="empty">Le calendrier manga sera bientôt alimenté.</p>'}
<p class="more"><a href="/sorties-manga/">Sorties par mois</a> · <a href="/series/">Toutes les séries</a></p>
<p class="more"><a href="/manga.ics">Ajouter à mon agenda (manga.ics)</a>${siteUrlOk ? `<span class="muted"> Adresse à coller dans l'agenda : <code>${esc(base)}/manga.ics</code></span>` : ''}</p>
${rows.length ? FILTER_JS : ''}`;
  page('/manga/', { title: 'Calendrier des sorties manga', description: 'Calendrier des sorties manga en France : dates, éditeurs (Glénat, Kana, Pika, Ki-oon, Akata), prix et statut de chaque tome.', body });
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
      description: `${plural(rows.length, 'tome', 'tomes')} manga au programme en ${label}${pubsLine(rows)} : dates de sortie, éditeurs et prix.`,
      body: `<h1>Sorties manga de ${esc(label)}</h1>
<p class="lead">${esc(plural(rows.length, 'tome sort', 'tomes sortent'))} en France en ${esc(label)}${esc(pubsLine(rows))}. Les dates viennent des plannings officiels des éditeurs et peuvent bouger.</p>
<p class="legendrow">${legend}</p>
${days.map((d) => `<div class="daygroup"><h2 class="chip-day ${wdc(d)}">${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h2><ul class="list panel">${rows.filter((r) => r.date === d).map((r) => releaseItem(r)).join('')}</ul></div>`).join('\n')}
<p class="chiprow">${nav}<a class="chip" href="/sorties-manga/">Tous les mois</a><a class="chip" href="/manga/">Calendrier</a></p>`,
    });
  }
  page('/sorties-manga/', {
    title: 'Sorties manga par mois',
    description: 'Les sorties manga en France mois par mois : tous les tomes annoncés par Glénat, Kana, Pika, Ki-oon et Akata.',
    body: `<h1>Sorties manga par mois</h1>
<p class="lead">Choisis un mois pour voir tous les tomes annoncés.</p>
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

  for (const S of seriesList) {
    const upcoming = S.rows.filter((r) => r.date >= today);
    const past = S.rows.filter((r) => r.date < today).reverse();
    const n = S.next;
    const lead = n
      ? `${n.tome ? `Le tome ${esc(n.tome)}` : 'Le prochain volume'} de <strong>${esc(S.name)}</strong> sort le <strong>${esc(frDate(n.date))}</strong> en France${n.editeur ? ` chez ${esc(n.editeur)}` : ''}${n.prix != null ? `, au prix de ${esc(euro(n.prix))}` : ''}.${n.statut === 'confirme' ? '' : ' La date peut encore bouger.'}`
      : `Aucun nouveau tome de <strong>${esc(S.name)}</strong> n'est annoncé pour le moment dans les plannings de Glénat, Kana, Pika, Ki-oon et Akata. Suis la série pour la retrouver dans Mon planning.`;
    const coverRow = showCovers ? [...S.rows].reverse().find((r) => r.cover) : null;
    const hero = coverRow ? `<div class="cover series-cover"><img class="cover-img" src="${esc(coverRow.cover)}" alt="Couverture de ${esc(mangaLabel(coverRow))}" width="160" height="240" decoding="async" referrerpolicy="no-referrer"></div>` : '';
    page(`/serie/${S.k}/`, {
      title: `Prochain tome de ${S.name} : date de sortie en France`,
      description: n
        ? `${n.tome ? `Tome ${n.tome}` : 'Prochain volume'} de ${S.name} : sortie le ${frShort(n.date)}${n.editeur ? ` chez ${n.editeur}` : ''}. Tous les tomes annoncés et la date de chaque sortie.`
        : `Date du prochain tome de ${S.name} en France : tomes parus et annonces des éditeurs.`,
      body: `<div class="series-head">${hero}<div>
<h1>Prochain tome de ${esc(S.name)}</h1>
<p class="lead">${lead}</p>
<p><button type="button" class="follow follow-static" data-s="${esc(S.k)}" data-n="${esc(S.name)}" hidden>Suivre</button></p>
<div class="coll panel" data-coll data-s="${esc(S.k)}" hidden></div>
</div></div>
${upcoming.length ? `<h2>À venir</h2><ul class="vgrid">${upcoming.map(volTile).join('')}</ul>` : ''}
${past.length ? `<h2>Déjà parus</h2><ul class="vgrid">${past.map(volTile).join('')}</ul>` : ''}
<p class="more"><a href="/sorties-manga/${monthSlug((n || S.rows[S.rows.length - 1]).date.slice(0, 7))}/">Toutes les sorties du mois</a> · <a href="/series/">Toutes les séries</a></p>`,
    });
  }
  const letters = [...new Set(seriesList.map((S) => (slugify(S.name)[0] || '#').toUpperCase()))].sort();
  const card = (S) => {
    const cr = showCovers ? [...S.rows].reverse().find((r) => r.cover) : null;
    return `<li class="scard p-${pubKey(S.editeur)}" data-q="${esc(S.name.toLowerCase())}"><a class="scard-link" href="/serie/${S.k}/">${showCovers ? coverBox(cr && cr.cover, `Couverture de ${S.name}`) : ''}`
      + `<strong>${esc(S.name)}</strong><span class="muted">${S.next ? `${S.next.tome ? `T${esc(S.next.tome)} · ` : ''}${esc(frShort(S.next.date))}` : 'rien d\'annoncé'}</span></a></li>`;
  };
  const az = letters.map((L) => `<section data-group class="azgroup"><h2>${esc(/\d/.test(L) ? '0-9' : L)}</h2><ul class="sgrid">${seriesList.filter((S) => (slugify(S.name)[0] || '#').toUpperCase() === L).map(card).join('')}</ul></section>`).join('');
  page('/series/', {
    title: 'Toutes les séries manga : prochain tome',
    description: `Date du prochain tome de ${seriesList.length} séries manga publiées en France par Glénat, Kana, Pika, Ki-oon et Akata.`,
    body: `<h1>Séries manga</h1>
<p class="lead">${esc(plural(seriesList.length, 'série suivie', 'séries suivies'))} dans les plannings des éditeurs. Clique sur une série pour voir la date de son prochain tome.</p>
${seriesList.length ? `<div class="filters" id="filtres" hidden><input type="search" id="f" placeholder="Chercher une série" aria-label="Chercher une série"></div>
<p class="empty" id="aucun" hidden>Aucune série ne correspond.</p>${az}${FILTER_JS}` : '<p class="empty">Les séries apparaîtront après la première collecte.</p>'}`,
  });
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
    ? (showCovers ? `<ul class="acards">${premieres.map(animeCard).join('')}</ul>` : `<ul class="list panel eps">${premieres.map(episodeItem).join('')}</ul>`)
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
  page('/mon-planning/', {
    title: 'Mon planning manga',
    description: 'Suis tes séries manga préférées : prochains tomes, budget du mois et agenda personnel.',
    noindex: true,
    body: `<h1>Mon planning</h1>
<p class="lead">Choisis les séries que tu collectionnes : tu vois leurs prochains tomes, ce que ça coûte chaque mois, ce qu'il te reste à acheter, et tu peux les ajouter à ton agenda. Ta liste et ta collection restent dans ton navigateur, rien n'est envoyé.</p>
<div id="suivi-app"><p class="empty">Cette page a besoin de JavaScript pour afficher ton planning.</p></div>`,
  });
}

/* -------------------------------------------------------------- changements */
{
  const days = [...new Set(events.map((e) => e.day))];
  const content = days.map((d) => `<section class="daygroup"><h2>${esc(ucfirst(frDayMonth(d)))}</h2><ul class="list panel">${events.filter((e) => e.day === d).map(changeItem).join('')}</ul></section>`).join('\n');
  const since = changes.since ? `Suivi commencé le ${frDate(changes.since)}.` : '';
  page('/changements/', {
    title: 'Changements de date des sorties manga',
    description: 'Tomes reportés, avancés, nouvellement annoncés ou retirés des plannings des éditeurs, relevés chaque jour.',
    body: `<h1>Changements de date</h1>
<p class="lead">Chaque nuit, le site compare les plannings de Glénat, Kana, Pika, Ki-oon et Akata avec ceux de la veille. Quand un tome est reporté, avancé, annoncé ou disparaît, c'est ici.</p>
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
      list.length ? (showCovers ? `<ul class="acards">${list.map(animeCard).join('')}</ul>` : `<ul class="list panel eps">${list.map(episodeItem).join('')}</ul>`) : '<p class="empty">Aucun épisode enregistré ce jour-là.</p>'}</section>`;
  }).join('\n');
  const body = `
<h1>Épisodes d'anime de la semaine</h1>
<p class="lead">Horaires de diffusion au Japon, convertis en heure de Paris. La disponibilité en France dépend des plateformes de streaming.</p>
${eps.length ? `<nav class="jumps" aria-label="Aller à un jour">${jump}</nav>
<div class="filters" id="filtres" hidden><input type="search" id="f" placeholder="Chercher un anime" aria-label="Chercher un anime"></div>
<p class="empty" id="aucun" hidden>Aucun épisode ne correspond à cette recherche.</p>
${sections}` : '<p class="empty">Les données apparaîtront après la première mise à jour automatique.</p>'}
<p class="more muted">${updated ? `Mis à jour le ${esc(updated)}. ` : ''}<a href="/anime.ics">Ajouter à mon agenda (anime.ics)</a></p>
${eps.length ? FILTER_JS : ''}`;
  page('/anime/', { title: "Épisodes d'anime de la semaine", description: "Programme des épisodes d'anime de la semaine, horaires à l'heure de Paris.", body });
}

/* ----------------------------------------------------------------- articles */
{
  page('/articles/', {
    title: 'Articles',
    description: 'Les actualités et programmes du jour : sorties manga, épisodes d\'anime.',
    body: `<h1>Articles</h1>${articles.length ? `<ul class="articles">${articles.map(articleItem).join('')}</ul>` : '<p class="empty">Aucun article pour le moment.</p>'}`,
  });
  for (const a of articles) {
    const ld = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article', headline: a.title, datePublished: a.date,
      inLanguage: 'fr', ...(siteUrlOk ? { mainEntityOfPage: `${base}/articles/${a.slug}/` } : {}),
    }).replace(/</g, '\\u003c');
    page(`/articles/${a.slug}/`, {
      title: a.title,
      description: a.description || a.title,
      body: `<article class="post"><p class="muted"><time datetime="${a.date}">${esc(frDate(a.date))}</time></p><h1>${esc(a.title)}</h1>\n${markdown(a.body)}</article>\n<p class="more"><a href="/articles/">Tous les articles</a></p>`,
      extraHead: `<script type="application/ld+json">${ld}</script>`,
    });
  }
}

/* -------------------------------------------------------- mentions légales */
const L = config.legal;
{
  const v = (s) => esc(s || 'À compléter');
  page('/mentions-legales/', {
    title: 'Mentions légales',
    description: 'Mentions légales du site.',
    body: `<h1>Mentions légales</h1>
<h2>Éditeur du site</h2>
<p>${v(L.editorName)}<br>Contact : ${v(L.contactEmail)}<br>Directeur de la publication : ${v(L.publicationDirector)}</p>
<h2>Hébergeur</h2>
<p>${v(L.hostName)}<br>${v(L.hostAddress)}</p>
<h2>Données et contenus</h2>
<p>Les horaires des épisodes d'anime proviennent de l'API AniList. Les dates de sortie des mangas sont relevées auprès des sources officielles des éditeurs et peuvent évoluer. Les titres, marques et visuels cités appartiennent à leurs propriétaires respectifs. Ce site n'est affilié à aucun éditeur ni à aucune plateforme.</p>
<h2>Cookies et données personnelles</h2>
<p>Ce site ne dépose pas de cookies et ne collecte pas de données personnelles.${showCovers ? ' Les couvertures des tomes et les affiches d’anime sont affichées depuis les serveurs des éditeurs, de leurs diffuseurs ou d’AniList : en consultant une page qui en contient, votre navigateur leur transmet votre adresse IP, comme pour toute image hébergée ailleurs.' : ''}</p>`,
  });
}

/* ------------------------------------------------------------ fichiers .ics */
{
  const mangaEvents = manga
    .filter((r) => r.date >= addDays(today, -30) && r.statut !== 'annule')
    .map((r) => ({
      uid: `manga-${r.isbn || `${r.date}-${r.serie}-${r.tome}`.replace(/[^A-Za-z0-9-]/g, '')}@${host}`,
      start: r.date,
      summary: `${mangaLabel(r)}${r.editeur ? ` (${r.editeur})` : ''}`,
      description: [STATUT_LABEL[r.statut], r.prix != null ? euro(r.prix) : '', r.notes].filter(Boolean).join(' · '),
      url: r.source || undefined,
    }));
  write('manga.ics', buildICS({ name: `${config.siteName} : manga`, events: mangaEvents }));

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
  const urls = ['/', '/anime/', '/manga/', '/changements/', '/articles/', '/mentions-legales/', ...SEO_URLS, ...articles.map((a) => `/articles/${a.slug}/`)];
  const lastmod = (u) => (u.startsWith('/articles/') && u !== '/articles/' ? articles.find((a) => `/articles/${a.slug}/` === u)?.date : today);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((u) => `<url><loc>${esc(base + u)}</loc><lastmod>${lastmod(u)}</lastmod></url>`).join('\n')}\n</urlset>\n`);
}
write('data/recent.json', JSON.stringify({
  events: events.filter((e) => e.day >= addDays(today, -60)).map((e) => ({ day: e.day, type: e.type, s: e.s, t: e.t, from: e.from, to: e.to })),
  articles: articles.slice(0, 20).map((a) => ({ date: a.date, title: a.title, slug: a.slug })),
}));
for (const f of ['visite.js', 'sw.js', 'icon.svg']) write(f, readFileSync(path.join(SCRIPTS, f === 'icon.svg' ? 'assets' : '.', f), 'utf8'));
for (const f of ['icon-192.png', 'icon-512.png']) write(f, readFileSync(path.join(SCRIPTS, 'assets', f)));
write('manifest.webmanifest', JSON.stringify({
  name: config.siteName, short_name: config.siteName, description: config.description, lang: 'fr',
  start_url: '/', scope: '/', display: 'standalone', background_color: '#f4f1ff', theme_color: '#ffd21f',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
}));
if (siteUrlOk) {
  const items = articles.slice(0, 20).map((a) => `<item><title>${esc(a.title)}</title><link>${esc(`${base}/articles/${a.slug}/`)}</link><guid isPermaLink="true">${esc(`${base}/articles/${a.slug}/`)}</guid><pubDate>${new Date(`${a.date}T07:00:00Z`).toUTCString()}</pubDate><description>${esc(a.description || a.title)}</description></item>`).join('\n');
  write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(config.siteName)}</title><link>${esc(base + '/')}</link><description>${esc(config.description)}</description><language>fr</language>\n${items}\n</channel></rss>\n`);
}
write('_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/sw.js\n  Cache-Control: no-cache\n');
write('style.css', readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'), 'utf8'));

/* ---------------------------------------------------------- avertissements */
console.log(`Site généré dans ${path.relative(process.cwd(), P.outDir) || '.'} : ${written.length} fichiers, ${articles.length} articles, ${manga.length} sorties manga, ${eps.length} épisodes anime.`);
if (isPrivate) console.warn('⚠ Site privé (launched: false) : non indexé par Google. Passe "launched" à true au lancement.');
if (showCovers) console.warn('⚠ Couvertures activées : vérifie l\'autorisation des éditeurs avant le lancement public.');
if (!siteUrlOk) console.warn('⚠ siteUrl dans site.config.json est encore à remplacer : pas de sitemap ni d\'adresse canonique.');
const todo = Object.entries(L).filter(([, val]) => !val || /compl[ée]ter/i.test(val)).map(([k]) => k);
if (todo.length) console.warn(`⚠ Mentions légales à compléter dans site.config.json : ${todo.join(', ')}`);
