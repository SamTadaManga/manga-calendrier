// Génère le site statique dans dist/ à partir de data/, content/ et site.config.json.
// Commande : node scripts/build.mjs   (aucune dépendance à installer)
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  paths, now, parisKey, parisHM, addDays, frDate, frDayMonth, frShort, frMonth, ucfirst,
  loadConfig, loadAllManga, readAnime, loadArticles, displayTitle, mangaLabel, euro, STATUT_LABEL,
  esc, slugify, weekdayOfKey, markdown, buildICS,
} from './lib.mjs';

const P = paths();
const config = loadConfig(P.config);
const today = parisKey(now());
const siteUrlOk = /^https?:\/\//.test(config.siteUrl || '') && !/REMPLACE/i.test(config.siteUrl);
const base = siteUrlOk ? config.siteUrl.replace(/\/+$/, '') : '';
const host = siteUrlOk ? new URL(base).hostname : 'manga-calendrier.local';

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
const NAV = [['/', 'Accueil'], ['/manga/', 'Manga'], ['/anime/', 'Anime'], ['/articles/', 'Articles']];
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' fill='%23fff' stroke='%2312131a' stroke-width='3'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%232540e8'/%3E%3C/svg%3E";

function layout({ title, description, pathname, body, noindex = false, extraHead = '' }) {
  const fullTitle = pathname === '/' ? config.siteName : `${title} | ${config.siteName}`;
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
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${esc(config.siteName)}">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/style.css">
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
<p><a href="/manga.ics">Agenda manga (.ics)</a><a href="/anime.ics">Agenda anime (.ics)</a><a href="/mentions-legales/">Mentions légales</a></p>
</div></footer>
</body>
</html>
`;
}
const page = (pathname, opts) => write(`${pathname.replace(/^\//, '')}index.html`, layout({ ...opts, pathname }));

/* ------------------------------------------------------------- composants */
const PUBS = { glenat: 'Glénat', kana: 'Kana', pika: 'Pika', 'ki-oon': 'Ki-oon' };
const pubKey = (e) => { const k = slugify(e || ''); return k in PUBS ? k : 'autre'; };
const weekday = (k) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`)).replace('.', '');
const dayNum = (k) => String(Number(k.slice(8)));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// « Ryukyu Buccaneer - Tome 01 - Édition collector » -> « Édition collector »
function editionOf(r) {
  if (!r.titre) return '';
  let t = r.titre.replace(r.serie, '').replace(/^[\s,–-]*(?:tome|t\.?|vol\.?)\s*0*\d+\b/i, '').replace(/^[\s,–:-]+/, '').trim();
  if (t === r.titre.trim() && t.length > 60) t = '';
  return t;
}

const BADGE_TXT = { confirme: 'Date confirmée', reporte: 'Reporté', annule: 'Annulé' };
function releaseItem(r, showDate = false) {
  const pk = pubKey(r.editeur);
  const ed = editionOf(r);
  const badge = BADGE_TXT[r.statut] ? `<span class="badge s-${r.statut}">${BADGE_TXT[r.statut]}</span>` : '';
  const meta = [
    showDate ? `<time datetime="${r.date}">${esc(frShort(r.date))}</time>` : '',
    `<span class="pub">${esc(r.editeur || 'Éditeur inconnu')}</span>`,
    r.prix != null ? `<span>${euro(r.prix)}</span>` : '',
    badge,
    r.source ? `<a href="${esc(r.source)}" rel="noopener nofollow">Fiche éditeur</a>` : '',
  ].filter(Boolean).join('');
  const q = `${r.serie} ${r.tome} ${r.titre} ${r.editeur}`.toLowerCase();
  return `<li class="rel p-${pk}${r.date < today ? ' past' : ''}" data-pub="${pk}" data-q="${esc(q)}"><div class="rel-title"><strong>${esc(r.serie)}</strong>${r.tome ? ` <span class="tome">tome ${esc(r.tome)}</span>` : ''}${ed ? ` <span class="ed">${esc(ed)}</span>` : ''}</div>`
    + `<div class="meta">${meta}</div>${r.notes && r.notes !== 'Collecte automatique' ? `<p class="notes">${esc(r.notes)}</p>` : ''}</li>`;
}

function episodeItem(e) {
  const t = esc(displayTitle(e.title));
  const url = safeUrl(e.url);
  const title = url ? `<a href="${esc(url)}" rel="noopener nofollow">${t}</a>` : t;
  return `<li class="ep-row" data-q="${esc(displayTitle(e.title).toLowerCase())}"><time>${esc(e.time)}</time><span class="t">${title}${e.format === 'MOVIE' ? ' <span class="muted">film</span>' : ''}</span><span class="ep">épisode ${esc(e.episode)}</span></li>`;
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
  const strip = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
    const m = live.filter((r) => r.date === d);
    const a = eps.filter((e) => e.key === d);
    return `<li class="day-panel${d === today ? ' today' : ''}"><div class="d-head"><span class="d-wd">${esc(d === today ? "aujourd'hui" : weekday(d))}</span><span class="d-num">${dayNum(d)}</span></div>`
      + (m.length ? `<a class="d-line" href="/manga/#j-${d}"><b>${m.length}</b> ${m.length > 1 ? 'mangas' : 'manga'}<span class="dots">${dots(m)}</span></a>` : '<span class="d-line none">Pas de manga</span>')
      + (a.length ? `<a class="d-line" href="/anime/#j-${d}"><b>${a.length}</b> ${a.length > 1 ? 'épisodes' : 'épisode'}</a>` : '<span class="d-line none">Pas d\'épisode</span>')
      + '</li>';
  }).join('');
  const body = `
<section class="week" aria-labelledby="t-week">
<div class="week-head"><h1 id="t-week">Les sorties de la semaine</h1>
<p class="lead">Mangas en France chez Glénat, Kana, Pika et Ki-oon. Épisodes d'anime diffusés au Japon, à l'heure de Paris.</p></div>
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
${mangaNext.length ? `<section><h2>Prochaines sorties manga</h2><ul class="list panel">${mangaNext.map((r) => releaseItem(r, true)).join('')}</ul><p class="more"><a href="/manga/">Tout le calendrier manga</a></p></section>` : ''}
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
q.addEventListener('input',apply);})();
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
      const cls = [d === today ? 'today' : '', d < today ? 'past' : ''].filter(Boolean).join(' ');
      cells.push(list.length
        ? `<td class="${cls}"><a href="#j-${d}" aria-label="${esc(ucfirst(frDayMonth(d)))} : ${plural(list.length, 'sortie', 'sorties')}"><span class="dn">${dayNum(d)}</span><span class="cnt">${list.length}</span><span class="dots">${dots(list)}</span></a></td>`
        : `<td class="${cls}"><span class="dn">${dayNum(d)}</span></td>`);
    }
    while (cells.length % 7) cells.push('<td class="blank"></td>');
    const trs = [];
    for (let i = 0; i < cells.length; i += 7) trs.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
    const heads = [['lun.', 'lundi'], ['mar.', 'mardi'], ['mer.', 'mercredi'], ['jeu.', 'jeudi'], ['ven.', 'vendredi'], ['sam.', 'samedi'], ['dim.', 'dimanche']]
      .map(([s, l]) => `<th scope="col" abbr="${l}">${s}</th>`).join('');
    return `<table class="cal"><caption class="sr">Calendrier de ${esc(frMonth(first))}</caption><thead><tr>${heads}</tr></thead><tbody>${trs.join('')}</tbody></table>`;
  };

  const content = monthKeys.map((mk) => {
    const days = [...byDate.keys()].filter((d) => d.startsWith(mk)).sort();
    return `<section class="month" data-group><h2>${esc(ucfirst(frMonth(`${mk}-01`)))}</h2>${grid(mk)}${
      days.map((d) => `<div class="daygroup" data-group><h3 id="j-${d}">${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h3><ul class="list panel">${byDate.get(d).map((r) => releaseItem(r)).join('')}</ul></div>`).join('')}</section>`;
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
<p class="empty" id="aucun" hidden>Aucune sortie ne correspond à ce filtre.</p>
${content}` : '<p class="empty">Le calendrier manga sera bientôt alimenté.</p>'}
<p class="more"><a href="/manga.ics">Ajouter à mon agenda (manga.ics)</a>${siteUrlOk ? `<span class="muted"> Adresse à coller dans l'agenda : <code>${esc(base)}/manga.ics</code></span>` : ''}</p>
${rows.length ? FILTER_JS : ''}`;
  page('/manga/', { title: 'Calendrier des sorties manga', description: 'Calendrier des sorties manga en France : dates, éditeurs (Glénat, Kana, Pika, Ki-oon), prix et statut de chaque tome.', body });
}

/* -------------------------------------------------------------------- anime */
{
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const updated = anime.generatedAt ? `${frDate(parisKey(new Date(anime.generatedAt)))} à ${parisHM(new Date(anime.generatedAt))}` : null;
  const jump = days.map((d) => {
    const n = eps.filter((e) => e.key === d).length;
    return `<a class="jump${d === today ? ' today' : ''}" href="#j-${d}"><span class="d-wd">${esc(weekday(d))}</span><span class="d-num">${dayNum(d)}</span><span class="cnt">${n}</span></a>`;
  }).join('');
  const sections = days.map((d) => {
    const list = eps.filter((e) => e.key === d);
    return `<section class="day" id="j-${d}" data-group><h2>${esc(ucfirst(frDayMonth(d)))}${d === today ? ' <span class="now">aujourd\'hui</span>' : ''}</h2>${
      list.length ? `<ul class="list panel eps">${list.map(episodeItem).join('')}</ul>` : '<p class="empty">Aucun épisode enregistré ce jour-là.</p>'}</section>`;
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
<p>Ce site ne dépose pas de cookies et ne collecte pas de données personnelles.</p>`,
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
write('robots.txt', `User-agent: *\nAllow: /\n${siteUrlOk ? `Sitemap: ${base}/sitemap.xml\n` : ''}`);
if (siteUrlOk) {
  const urls = ['/', '/anime/', '/manga/', '/articles/', '/mentions-legales/', ...articles.map((a) => `/articles/${a.slug}/`)];
  const lastmod = (u) => (u.startsWith('/articles/') && u !== '/articles/' ? articles.find((a) => `/articles/${a.slug}/` === u)?.date : today);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((u) => `<url><loc>${esc(base + u)}</loc><lastmod>${lastmod(u)}</lastmod></url>`).join('\n')}\n</urlset>\n`);
}
write('_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');
write('style.css', readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'), 'utf8'));

/* ---------------------------------------------------------- avertissements */
console.log(`Site généré dans ${path.relative(process.cwd(), P.outDir) || '.'} : ${written.length} fichiers, ${articles.length} articles, ${manga.length} sorties manga, ${eps.length} épisodes anime.`);
if (!siteUrlOk) console.warn('⚠ siteUrl dans site.config.json est encore à remplacer : pas de sitemap ni d\'adresse canonique.');
const todo = Object.entries(L).filter(([, val]) => !val || /compl[ée]ter/i.test(val)).map(([k]) => k);
if (todo.length) console.warn(`⚠ Mentions légales à compléter dans site.config.json : ${todo.join(', ')}`);
