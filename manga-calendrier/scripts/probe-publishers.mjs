// Outil de repérage (lecture seule) : pour chaque éditeur, regarde robots.txt et la page d'accueil,
// puis liste les liens qui ressemblent à un planning. Rien n'est enregistré ; le résultat s'affiche dans le journal.
// Usage : node scripts/probe-publishers.mjs   (lancé par le workflow manuel « Repérage des éditeurs »)
import { robotsAllows } from './collectors.mjs';

const UA = 'manga-calendrier/1.0 (+calendrier de sorties manga ; contact via le site)';
const SITES = {
  Akata: 'https://www.akata.fr/',
  Mangetsu: 'https://www.mangetsu.fr/',
  'Panini Manga': 'https://www.panini.fr/',
  Kurokawa: 'https://www.kurokawa.fr/',
  Delcourt: 'https://www.delcourt.fr/',
  Tonkam: 'https://www.tonkam.com/',
  Soleil: 'https://www.soleilmanga.com/',
  Meian: 'https://www.meian-editions.fr/',
  Taifu: 'https://www.taifu-comics.com/',
  Crunchyroll: 'https://www.crunchyroll.com/fr/manga',
  Ototo: 'https://www.ototo.fr/',
};
const KEYWORDS = /planning|sorties?|agenda|calendrier|parutions?|prochainement|a-paraitre|nouveaut/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];

for (const [name, url] of Object.entries(SITES)) {
  if (only && name.toLowerCase() !== only.toLowerCase()) continue;
  console.log(`\n=== ${name} (${url})`);
  try {
    const u = new URL(url);
    let robots = '';
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA } });
      robots = r.ok ? await r.text() : '';
      const rules = robots.split('\n').filter((l) => /^(user-agent|disallow|allow|crawl-delay)/i.test(l)).slice(0, 14).join(' | ');
      console.log(`robots.txt : ${r.status}${rules ? ` — ${rules}` : ''}`);
    } catch (e) { console.log(`robots.txt : illisible (${e.message})`); }
    if (!robotsAllows(robots, u.pathname)) { console.log('page d\'accueil interdite par robots.txt : on s\'arrête là.'); continue; }
    await sleep(2000);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
    const html = await res.text();
    console.log(`accueil : code ${res.status}, ${html.length} octets, adresse finale ${res.url}`);
    if (!res.ok) { console.log(`extrait : ${html.replace(/\s+/g, ' ').slice(0, 200)}`); continue; }
    const links = new Map();
    for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (KEYWORDS.test(m[1]) || KEYWORDS.test(text)) {
        let abs; try { abs = new URL(m[1].replace(/&amp;/g, '&'), res.url).href; } catch { continue; }
        if (!links.has(abs)) links.set(abs, text.slice(0, 60));
      }
    }
    if (!links.size) console.log('aucun lien de type planning sur la page d\'accueil');
    for (const [href, text] of [...links].slice(0, 12)) {
      const ok = robotsAllows(robots, new URL(href).pathname);
      console.log(`  ${ok ? 'ok ' : 'INTERDIT'} ${href}  « ${text} »`);
    }
    // Pour chaque lien trouvé (3 au maximum), un aperçu de la structure
    let n = 0;
    for (const [href] of links) {
      if (n >= 3 || !robotsAllows(robots, new URL(href).pathname) || new URL(href).origin !== u.origin) continue;
      n++;
      await sleep(2000);
      const r2 = await fetch(href, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
      const h2 = await r2.text();
      const dates = (h2.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} (?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}\b/gi) || []);
      const isbn = (h2.match(/97[89]\d{10}/g) || []);
      const title = (h2.match(/<title>([^<]*)/i) || [])[1] || '';
      console.log(`\n  -> ${href} : code ${r2.status}, ${h2.length} octets, titre « ${title.trim().slice(0, 80)} », ${dates.length} dates, ${new Set(isbn).size} ISBN`);
      const i = dates.length ? h2.indexOf(dates[0]) : -1;
      if (i >= 0) console.log(`  extrait autour de la première date : ${h2.slice(Math.max(0, i - 250), i + 450).replace(/\s+/g, ' ')}`);
    }
  } catch (e) {
    console.log(`échec : ${e.message}`);
  }
}
