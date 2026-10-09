// Génère le site statique dans dist/ à partir de data/, content/ et site.config.json.
// Commande : node scripts/build.mjs   (aucune dépendance à installer)
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  paths, now, parisKey, parisHM, addDays, frDate, frDayMonth, frShort, frMonth, ucfirst,
  loadConfig, loadAllManga, readAnime, loadArticles, displayTitle, mangaLabel, euro, STATUT_LABEL,
  esc, markdown, buildICS,
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
const NAV = [['/', 'Accueil'], ['/anime/', 'Anime'], ['/manga/', 'Manga'], ['/articles/', 'Articles']];

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
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${esc(config.siteName)}">
<link rel="stylesheet" href="/style.css">
${extraHead}
</head>
<body>
<header class="site-header"><div class="wrap bar"><a class="brand" href="/">${esc(config.siteName)}</a><nav>${nav}</nav></div></header>
<main class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
<p>Horaires des épisodes d'anime : données <a href="https://anilist.co" rel="noopener">AniList</a>. Dates de sortie manga : relevées auprès des sources officielles des éditeurs, susceptibles de changer.</p>
<p>Calendriers à importer : <a href="/manga.ics">manga.ics</a> · <a href="/anime.ics">anime.ics</a> · <a href="/mentions-legales/">Mentions légales</a></p>
</div></footer>
</body>
</html>
`;
}
const page = (pathname, opts) => write(`${pathname.replace(/^\//, '')}index.html`, layout({ ...opts, pathname }));

/* ------------------------------------------------------------- composants */
const badge = (s) => `<span class="badge s-${s}">${STATUT_LABEL[s]}</span>`;

function releaseItem(r, showDate = false) {
  const meta = [
    showDate ? `<span>${esc(frShort(r.date))}</span>` : '',
    r.editeur ? `<span class="pub">${esc(r.editeur)}</span>` : '',
    r.prix != null ? `<span>${euro(r.prix)}</span>` : '',
    badge(r.statut),
    r.source ? `<a href="${esc(r.source)}" rel="noopener nofollow">Source</a>` : '',
  ].filter(Boolean).join('');
  return `<li><div><strong>${esc(mangaLabel(r))}</strong>${r.titre ? ` <span class="muted">« ${esc(r.titre)} »</span>` : ''}</div>`
    + `<div class="meta">${meta}</div>${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ''}</li>`;
}

function episodeItem(e) {
  const t = esc(displayTitle(e.title));
  const url = safeUrl(e.url);
  const title = url ? `<a href="${esc(url)}" rel="noopener nofollow">${t}</a>` : t;
  return `<li><time>${esc(e.time)}</time><span class="t">${title}${e.format === 'MOVIE' ? ' <span class="muted">(film)</span>' : ''}</span><span class="ep">épisode ${esc(e.episode)}</span></li>`;
}

const articleItem = (a) =>
  `<li><a href="/articles/${a.slug}/">${esc(a.title)}</a><span class="muted">${esc(frDate(a.date))}</span>${a.description ? `<p class="notes">${esc(a.description)}</p>` : ''}</li>`;

/* ------------------------------------------------------------------ accueil */
{
  const todayEps = eps.filter((e) => e.key === today);
  const topToday = [...todayEps].sort((a, b) => b.popularity - a.popularity).slice(0, 8).sort((a, b) => a.airingAt - b.airingAt);
  const mangaToday = manga.filter((r) => r.date === today && r.statut !== 'annule');
  const mangaNext = manga.filter((r) => r.date > today && r.statut !== 'annule').slice(0, 8);
  const body = `
<section class="hero">
<h1>Sorties manga et anime</h1>
<p>${esc(config.description)}</p>
</section>
<section>
<h2>Aujourd'hui, ${esc(frDate(today))}</h2>
<div class="grid">
<div class="card">
<h3>Anime à la télévision japonaise</h3>
${todayEps.length
    ? `<ul class="eps">${topToday.map(episodeItem).join('')}</ul><p class="muted">Les ${topToday.length} plus populaires sur ${todayEps.length} épisodes · heure de Paris · <a href="/anime/">programme complet</a></p>`
    : '<p class="muted">Les données apparaîtront après la prochaine mise à jour automatique.</p>'}
</div>
<div class="card">
<h3>Manga en France</h3>
${mangaToday.length
    ? `<ul class="releases">${mangaToday.map((r) => releaseItem(r)).join('')}</ul>`
    : '<p class="muted">Aucune sortie manga enregistrée pour aujourd\'hui.</p>'}
<p class="muted"><a href="/manga/">Calendrier manga</a></p>
</div>
</div>
</section>
${mangaNext.length ? `<section><h2>Prochaines sorties manga</h2><ul class="releases card">${mangaNext.map((r) => releaseItem(r, true)).join('')}</ul></section>` : ''}
<section>
<h2>Derniers articles</h2>
${articles.length ? `<ul class="articles">${articles.slice(0, 6).map(articleItem).join('')}</ul><p><a href="/articles/">Tous les articles</a></p>` : '<p class="muted">Les premiers articles arrivent bientôt.</p>'}
</section>`;
  page('/', { title: config.siteName, description: config.description, body });
}

/* -------------------------------------------------------------------- anime */
{
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const updated = anime.generatedAt ? `${frDate(parisKey(new Date(anime.generatedAt)))} à ${parisHM(new Date(anime.generatedAt))}` : null;
  const sections = days.map((d) => {
    const list = eps.filter((e) => e.key === d);
    return `<section class="day" id="j-${d}"><h2>${esc(ucfirst(frDayMonth(d)))}</h2>${
      list.length ? `<ul class="eps">${list.map(episodeItem).join('')}</ul>` : '<p class="muted">Aucun épisode enregistré.</p>'}</section>`;
  }).join('\n');
  const body = `
<h1>Épisodes d'anime de la semaine</h1>
<p class="lead">Horaires de diffusion au Japon, convertis en heure de Paris. La disponibilité en France dépend des plateformes de streaming et peut différer.</p>
${eps.length ? '<p><input type="search" id="f" placeholder="Filtrer par titre…" aria-label="Filtrer par titre"></p>' : ''}
${eps.length ? sections : '<p class="muted">Les données apparaîtront après la première mise à jour automatique.</p>'}
<p class="muted">${updated ? `Dernière mise à jour : ${esc(updated)}. ` : ''}<a href="/anime.ics">Ajouter à mon agenda (anime.ics)</a></p>
<script>
(function(){var f=document.getElementById('f');if(!f)return;f.addEventListener('input',function(){
var q=f.value.toLowerCase().trim();
document.querySelectorAll('.eps li').forEach(function(li){li.hidden=!!q&&li.textContent.toLowerCase().indexOf(q)<0;});
document.querySelectorAll('.day').forEach(function(s){s.hidden=!!q&&!Array.prototype.some.call(s.querySelectorAll('li'),function(li){return !li.hidden;});});
});})();
</script>`;
  page('/anime/', { title: "Épisodes d'anime de la semaine", description: "Programme des épisodes d'anime de la semaine, horaires à l'heure de Paris.", body });
}

/* -------------------------------------------------------------------- manga */
{
  const since = addDays(today, -7);
  const rows = manga.filter((r) => r.date >= since);
  const months = [];
  for (const r of rows) {
    const mk = r.date.slice(0, 7);
    let m = months.find((x) => x.key === mk);
    if (!m) { m = { key: mk, days: [] }; months.push(m); }
    let d = m.days.find((x) => x.date === r.date);
    if (!d) { d = { date: r.date, items: [] }; m.days.push(d); }
    d.items.push(r);
  }
  const content = months.map((m) => `<section><h2>${esc(ucfirst(frMonth(`${m.key}-01`)))}</h2>${
    m.days.map((d) => `<h3 id="j-${d.date}">${esc(ucfirst(frDayMonth(d.date)))}</h3><ul class="releases card">${d.items.map((r) => releaseItem(r)).join('')}</ul>`).join('')}</section>`).join('\n');
  const body = `
<h1>Calendrier des sorties manga en France</h1>
<p class="lead">Les dates sont relevées auprès des éditeurs. Un statut « annoncé » signale une date pas encore confirmée officiellement.</p>
${rows.length ? content : '<p class="muted">Le calendrier manga sera bientôt alimenté.</p>'}
<p class="muted"><a href="/manga.ics">Ajouter à mon agenda (manga.ics)</a>${siteUrlOk ? ` · adresse à coller dans votre agenda : <code>${esc(base)}/manga.ics</code>` : ''}</p>`;
  page('/manga/', { title: 'Calendrier des sorties manga', description: 'Calendrier des sorties manga en France : dates, éditeurs, prix et statut de chaque tome.', body });
}

/* ----------------------------------------------------------------- articles */
{
  page('/articles/', {
    title: 'Articles',
    description: 'Les actualités et programmes du jour : sorties manga, épisodes d\'anime.',
    body: `<h1>Articles</h1>${articles.length ? `<ul class="articles">${articles.map(articleItem).join('')}</ul>` : '<p class="muted">Aucun article pour le moment.</p>'}`,
  });
  for (const a of articles) {
    const ld = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article', headline: a.title, datePublished: a.date,
      inLanguage: 'fr', ...(siteUrlOk ? { mainEntityOfPage: `${base}/articles/${a.slug}/` } : {}),
    }).replace(/</g, '\\u003c');
    page(`/articles/${a.slug}/`, {
      title: a.title,
      description: a.description || a.title,
      body: `<article><p class="muted">${esc(frDate(a.date))}</p><h1>${esc(a.title)}</h1>\n${markdown(a.body)}</article>\n<p><a href="/articles/">← Tous les articles</a></p>`,
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
write('style.css', `:root{--bg:#fafafa;--fg:#1f2937;--muted:#6b7280;--card:#fff;--line:#e5e7eb;--accent:#4338ca;--ok:#166534;--okbg:#dcfce7;--warn:#9a3412;--warnbg:#ffedd5;--bad:#991b1b;--badbg:#fee2e2;--info:#1e40af;--infobg:#dbeafe;--grey:#374151;--greybg:#f3f4f6}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e5e7eb;--muted:#9ca3af;--card:#171a21;--line:#2a2f3a;--accent:#a5b4fc;--ok:#86efac;--okbg:#14301f;--warn:#fdba74;--warnbg:#3a2412;--bad:#fca5a5;--badbg:#3a1616;--info:#93c5fd;--infobg:#17274a;--grey:#d1d5db;--greybg:#1f232c}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:920px;margin:0 auto;padding:0 16px}
.site-header{border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:5}
.bar{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;justify-content:space-between;padding-top:10px;padding-bottom:10px}
.brand{font-weight:700;text-decoration:none;color:var(--fg)}
nav a{margin-right:14px;text-decoration:none;color:var(--muted)}
nav a[aria-current]{color:var(--accent);font-weight:600}
main{padding-top:20px;padding-bottom:40px}
h1{font-size:1.7rem;line-height:1.25;margin:.4em 0 .5em}
h2{font-size:1.25rem;margin:1.6em 0 .5em}
h3{font-size:1.05rem;margin:1.2em 0 .4em}
.lead{color:var(--muted);margin-top:0}
.muted{color:var(--muted);font-size:.92em}
.hero{padding:14px 0 4px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
.card h3{margin-top:.2em}
ul.releases,ul.eps,ul.articles{list-style:none;margin:0;padding:0}
ul.releases.card{padding:4px 16px}
.releases li{padding:10px 0;border-bottom:1px solid var(--line)}
.releases li:last-child,.eps li:last-child,.articles li:last-child{border-bottom:0}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;font-size:.9em;color:var(--muted)}
.notes{margin:.3em 0 0;font-size:.92em;color:var(--muted)}
.eps li{display:flex;gap:12px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line)}
.eps time{min-width:4.6em;font-variant-numeric:tabular-nums;color:var(--muted)}
.eps .t{flex:1}
.eps .ep{color:var(--muted);font-size:.9em;white-space:nowrap}
.day{margin-bottom:8px}
.articles li{padding:10px 0;border-bottom:1px solid var(--line)}
.articles li a{font-weight:600;margin-right:10px}
.badge{display:inline-block;padding:0 8px;border-radius:999px;font-size:.78rem;font-weight:600}
.s-confirme,.s-paru{background:var(--okbg);color:var(--ok)}
.s-annonce{background:var(--infobg);color:var(--info)}
.s-reporte{background:var(--warnbg);color:var(--warn)}
.s-annule{background:var(--badbg);color:var(--bad)}
.s-paru{background:var(--greybg);color:var(--grey)}
input[type=search]{width:100%;max-width:420px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit}
article{max-width:720px}
article li{margin:.3em 0}
code{background:var(--greybg);padding:1px 5px;border-radius:4px;font-size:.9em}
.site-footer{border-top:1px solid var(--line);padding:18px 0;font-size:.88rem;color:var(--muted)}
@media (max-width:520px){.eps li{flex-wrap:wrap}.eps .ep{width:100%;padding-left:calc(4.6em + 12px)}}
`);

/* ---------------------------------------------------------- avertissements */
console.log(`Site généré dans ${path.relative(process.cwd(), P.outDir) || '.'} : ${written.length} fichiers, ${articles.length} articles, ${manga.length} sorties manga, ${eps.length} épisodes anime.`);
if (!siteUrlOk) console.warn('⚠ siteUrl dans site.config.json est encore à remplacer : pas de sitemap ni d\'adresse canonique.');
const todo = Object.entries(L).filter(([, val]) => !val || /compl[ée]ter/i.test(val)).map(([k]) => k);
if (todo.length) console.warn(`⚠ Mentions légales à compléter dans site.config.json : ${todo.join(', ')}`);
