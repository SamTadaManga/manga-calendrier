// IndexNow : prévient Bing et les moteurs compatibles (dont ceux qui alimentent ChatGPT et d'autres assistants) que des pages viennent de changer.
// À lancer après le déploiement (workflow « Déploiement Cloudflare »). Clé publique par conception : scripts/assets/indexnow-key.txt, servie à /<clé>.txt.
// Pages envoyées : accueil, semaine, calendriers, changements, mois en cours et suivant, et les séries dont une date a bougé ces 2 derniers jours.
// Usage : node scripts/indexnow.mjs [--essai]      (--essai : affiche la liste sans rien envoyer)
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'prochaintome.fr';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const mois = (d) => `${slugify(MOIS[d.getUTCMonth()])}-${d.getUTCFullYear()}`;

export function urlsAEnvoyer({ dossier = path.join(ROOT, 'dist'), events = [], maintenant = new Date() } = {}) {
  const urls = ['/', '/semaine/', '/manga/', '/anime/', '/changements/', '/sorties-manga/'];
  const suivant = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
  urls.push(`/sorties-manga/${mois(maintenant)}/`, `/sorties-manga/${mois(suivant)}/`);
  const depuis = new Date(maintenant.getTime() - 2 * 864e5).toISOString().slice(0, 10);
  for (const e of events) if (e.day >= depuis && e.s) { const k = slugify(e.s); if (k) urls.push(`/serie/${k}/`); }
  const uniques = [...new Set(urls)];
  return uniques.filter((u) => u.length < 200 && (!dossier || existsSync(path.join(dossier, u, 'index.html')))).map((u) => `https://${HOST}${u}`);
}

async function main() {
  const cle = readFileSync(path.join(ROOT, 'scripts/assets/indexnow-key.txt'), 'utf8').trim();
  if (!/^[a-f0-9]{16,128}$/.test(cle)) throw new Error('Clé IndexNow invalide.');
  let events = [];
  try { events = JSON.parse(readFileSync(path.join(ROOT, 'data/changes.json'), 'utf8')).events || []; } catch { /* pas de changements connus */ }
  const urlList = urlsAEnvoyer({ events });
  console.log(`IndexNow : ${urlList.length} adresses.`);
  if (process.argv.includes('--essai')) { console.log(urlList.join('\n')); return; }
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: HOST, key: cle, keyLocation: `https://${HOST}/${cle}.txt`, urlList }), signal: AbortSignal.timeout(30000) });
  console.log(`Réponse : HTTP ${r.status}${r.status === 200 || r.status === 202 ? ' (accepté)' : ''}.`);
  if (r.status >= 400 && r.status !== 429) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`Erreur : ${e.message}`); process.exitCode = 1; });
