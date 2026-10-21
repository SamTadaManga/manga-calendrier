// Deuxième repérage (lecture seule) : essaie des adresses classiques de planning sur quelques éditeurs
// et montre le contenu des pages Planning d'Ototo et de Taifu. Rien n'est enregistré.
import { robotsAllows } from './collectors.mjs';

const UA = 'manga-calendrier/1.0 (+calendrier de sorties manga ; contact via le site)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITES = {
  Mangetsu: 'https://www.mangetsu.fr',
  Delcourt: 'https://www.delcourt.fr',
  Meian: 'https://www.meian-editions.fr',
  Soleil: 'https://www.soleilmanga.com',
  Ototo: 'https://www.ototo.fr',
  Taifu: 'https://www.taifu-comics.com',
};
const PATHS = ['/planning', '/Planning', '/agenda', '/calendrier', '/sorties', '/prochaines-sorties', '/a-paraitre', '/prochainement',
  '/planning-des-sorties', '/calendrier-des-sorties', '/manga/planning', '/nouveautes', '/meian/planning', '/meian/agenda'];
const DATES = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:er)? (?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?: \d{4})?\b/gi;

async function page(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  return { status: r.status, final: r.url, html: await r.text() };
}
const body = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ');

for (const [name, origin] of Object.entries(SITES)) {
  console.log(`\n=== ${name}`);
  let robots = '';
  try { const r = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA } }); robots = r.ok ? await r.text() : ''; } catch { /* rien */ }
  for (const p of PATHS) {
    if (!robotsAllows(robots, p)) continue;
    await sleep(1500);
    try {
      const { status, final, html } = await page(origin + p);
      if (status !== 200) continue;
      const dates = html.match(DATES) || [];
      const isbn = new Set(html.match(/97[89]\d{10}/g) || []);
      console.log(`  ${origin + p} -> 200 (${final}), ${html.length} octets, ${dates.length} dates, ${isbn.size} ISBN, titre « ${((html.match(/<title>([^<]*)/i) || [])[1] || '').trim().slice(0, 70)} »`);
    } catch (e) { console.log(`  ${origin + p} -> échec (${e.message})`); }
  }
}

for (const url of ['https://www.ototo.fr/Planning', 'https://www.taifu-comics.com/Planning']) {
  console.log(`\n=== Contenu de ${url}`);
  try {
    const { status, final, html } = await page(url);
    console.log(`code ${status}, adresse finale ${final}, ${html.length} octets`);
    const b = body(html);
    const i = b.search(/<body/i);
    console.log(`HTML (nettoyé) : ${b.slice(i < 0 ? 0 : i, (i < 0 ? 0 : i) + 3500)}`);
    const links = [...new Set([...html.matchAll(/\bhref="([^"#]+)"/g)].map((m) => m[1]))].slice(0, 40);
    console.log(`liens : ${links.join(' ')}`);
  } catch (e) { console.log(`échec : ${e.message}`); }
  await sleep(2000);
}
