// Publication quotidienne sur les réseaux : choisit les sorties, dessine les visuels, publie là où les identifiants existent,
// et prépare un dossier prêt à publier à la main (TikTok, ou tout autre réseau sans identifiants).
// Usage : node scripts/social.mjs [--kinds=auto|jour,semaine,nouveautes] [--platforms=bluesky,x,instagram,pinterest]
//         [--date=AAAA-MM-JJ] [--out=social-out] [--dry-run] [--force]
// --dry-run : dessine les images et écrit les textes, ne publie rien. --force : republie même si c'est déjà fait.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths, loadAllManga, readAnime, loadConfig, parisKey, now, weekdayOfKey } from './lib.mjs';
import { compose } from './social-contenu.mjs';
import { jobs, render } from './social-visuels.mjs';
import { postBluesky, postX, postInstagram, postPinterest, blueskyReady, xReady, instagramReady, pinterestReady } from './social-publier.mjs';
import { r2Client } from './r2.mjs';

const arg = (n, d = '') => { const m = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); return m ? (m.includes('=') ? m.split('=').slice(1).join('=') : 'true') : d; };
const P = paths();
const config = loadConfig(P.config);
const today = arg('date') || parisKey(now());
const DRY = arg('dry-run') === 'true', FORCE = arg('force') === 'true';
const OUT = path.resolve(arg('out', 'social-out'));
const env = process.env;
const site = config.siteUrl || 'https://prochaintome.fr';

const wd = weekdayOfKey(today); // 0 = dimanche
const requested = arg('kinds', 'auto');
const kinds = requested === 'auto' ? ['jour', ...(wd === 1 ? ['semaine'] : []), ...(wd === 4 ? ['nouveautes'] : [])] : requested.split(',');
const ALL = ['bluesky', 'x', 'instagram', 'pinterest'];
const want = arg('platforms') ? arg('platforms').split(',') : ALL;
const READY = { bluesky: blueskyReady(env), x: xReady(env), instagram: instagramReady(env), pinterest: pinterestReady(env) };

const logFile = path.join(P.dataDir, 'social-posted.json');
let posted = {}; try { posted = JSON.parse(readFileSync(logFile, 'utf8')); } catch {}

const manga = loadAllManga(P.dataDir), anime = readAnime(P.dataDir);
const imgBase = (env.SOCIAL_IMG_BASE || (config.catalogueCovers ? new URL(config.catalogueCovers).origin : '')).replace(/\/+$/, '');
const r2 = env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY ? r2Client({ accountId: env.R2_ACCOUNT_ID, bucket: env.R2_BUCKET, accessKey: env.R2_ACCESS_KEY_ID, secretKey: env.R2_SECRET_ACCESS_KEY }) : null;
let failures = 0;

for (const kind of kinds) {
  const data = compose({ kind, today, manga, anime, site });
  if (!data) { console.log(`[${kind}] rien à publier aujourd'hui.`); continue; }
  const dir = path.join(OUT, data.key);
  mkdirSync(dir, { recursive: true });
  console.log(`[${kind}] ${data.total} sorties, ${data.items.length} visuels à dessiner…`);
  const files = await render(jobs(data), dir);
  const byName = Object.fromEntries(files.map((f) => [f.name, f]));
  const buf = (n) => readFileSync(byName[n].file);
  const carousel = (fmt) => files.filter((f) => f.name.startsWith(`${fmt}-`)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  writeFileSync(path.join(dir, 'textes.md'), `# ${data.key}\n\n## Bluesky\n\n${data.text.bluesky}\n\n## X\n\n${data.text.x}\n\n## Instagram (carrousel instagram-*.jpg)\n\n${data.text.instagram}\n\n## TikTok (photos tiktok-*.jpg, mode diaporama)\n\n${data.text.tiktok}\n\n## Pinterest (pinterest.jpg)\n\nTitre : ${data.text.pinterest.title}\n\nDescription : ${data.text.pinterest.description}\n\nLien : ${data.text.pinterest.link}\n`);

  const done = (p) => posted[data.key]?.[p];
  const mark = (p, id) => { posted[data.key] = { ...(posted[data.key] || {}), [p]: { at: new Date().toISOString(), id: id || '' } }; };
  const upload = async () => {
    if (!r2 || !imgBase) throw new Error('adresse publique des images (R2) indisponible : secrets R2 et catalogueCovers requis');
    const urls = {};
    for (const f of files) { await r2.put(`social/${data.key}/${f.name}.jpg`, readFileSync(f.file), 'image/jpeg', 'public, max-age=86400'); urls[f.name] = `${imgBase}/social/${data.key}/${f.name}.jpg`; }
    return urls;
  };
  let urls = null;
  for (const p of want.filter((x) => ALL.includes(x))) {
    if (!READY[p]) { console.log(`  ${p} : identifiants absents, ignoré.`); continue; }
    if (done(p) && !FORCE) { console.log(`  ${p} : déjà publié.`); continue; }
    if (DRY) { console.log(`  ${p} : essai à blanc, non publié.`); continue; }
    try {
      let res;
      if (p === 'bluesky') res = await postBluesky({ text: data.text.bluesky, link: data.text.blueskyLink, images: [{ buf: buf('bluesky-x'), alt: data.alt, w: 1200, h: 675 }] }, env);
      if (p === 'x') res = await postX({ text: data.text.x, images: [{ buf: buf('bluesky-x') }] }, env);
      if (p === 'instagram') { urls ??= await upload(); res = await postInstagram({ caption: data.text.instagram, urls: carousel('instagram').map((f) => urls[f.name]) }, env); }
      if (p === 'pinterest') { urls ??= await upload(); res = await postPinterest({ ...data.text.pinterest, alt: data.alt, url: urls.pinterest }, env); }
      mark(p, res?.id); console.log(`  ${p} : publié.`);
    } catch (e) { failures++; console.error(`  ${p} : ÉCHEC — ${e.message}`); }
  }
}
const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
for (const k of Object.keys(posted)) if (k.slice(-10) < cutoff) delete posted[k]; // on ne garde que 90 jours
if (!DRY) { mkdirSync(path.dirname(logFile), { recursive: true }); writeFileSync(logFile, JSON.stringify(posted, null, 1) + '\n'); }
if (failures) process.exit(1);
