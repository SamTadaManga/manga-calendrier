// Flux produits Cultura (Awin) -> data/cultura-liens.json : pour chaque ISBN de notre catalogue/calendrier, le lien direct vers la fiche Cultura.
// L'adresse du flux contient une clé : elle vient UNIQUEMENT de la variable d'environnement AWIN_FEED_URL (secret GitHub), jamais écrite ni affichée.
// Usage : AWIN_FEED_URL=... node scripts/cultura-flux.mjs [--essai]      (ou --fichier=flux.csv[.gz] pour un fichier déjà téléchargé)
//   --essai : affiche le bilan sans écrire de fichier.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsbn13 } from './shops.mjs';
import { loadBnf } from './catalogue-bnf.mjs';

const BASE_RE = /^https:\/\/www\.awin1\.com\/pclick\.php\?(?:[a-z]=\d+&)+p=$/;

/** Texte CSV -> lignes (guillemets, doubles guillemets et retours à la ligne dans les champs gérés). */
export function* lignesCsv(texte) {
  let champ = '', ligne = [], q = false;
  const n = texte.length;
  for (let i = 0; i < n; i++) {
    const c = texte[i];
    if (q) {
      if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else q = false; } else champ += c;
    } else if (c === '"') q = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.length > 1 || ligne[0] !== '') yield ligne;
      ligne = [];
    } else champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); yield ligne; }
}

/** Contenu du flux -> { base, liens: { isbn13: identifiant produit Awin } } pour les ISBN voulus. */
export function lireFlux(texte, voulus) {
  const it = lignesCsv(texte);
  const tete = it.next().value || [];
  const col = (nom) => tete.indexOf(nom);
  const iLien = col('aw_deep_link'), iId = col('merchant_product_id'), iIsbn = col('isbn');
  if (iLien < 0 || iId < 0) throw new Error('Flux inattendu : colonnes aw_deep_link et merchant_product_id introuvables.');
  let base = '', lignes = 0;
  const liens = {};
  for (const r of it) {
    lignes++;
    const isbn = [r[iId], iIsbn >= 0 ? r[iIsbn] : ''].map((x) => String(x || '').replace(/[^0-9]/g, '')).find((x) => isIsbn13(x));
    if (!isbn || !voulus.has(isbn) || liens[isbn]) continue;
    const m = String(r[iLien] || '').match(/^https:\/\/www\.awin1\.com\/pclick\.php\?p=(\d{3,20})&a=(\d+)&m=(\d+)$/);
    if (!m) continue;
    const b = `https://www.awin1.com/pclick.php?a=${m[2]}&m=${m[3]}&p=`;
    if (!base) base = b;
    if (b !== base) continue;
    liens[isbn] = m[1];
  }
  return { lignes, base, liens };
}

/** ISBN-13 que le site peut afficher : catalogue + calendrier. */
export function isbnVoulus(dir) {
  const set = new Set(loadBnf(dir).byIsbn.keys());
  for (const f of readdirSync(dir).filter((x) => /^manga.*\.csv$/.test(x))) {
    for (const m of readFileSync(path.join(dir, f), 'utf8').matchAll(/\b97[89]\d{10}\b/g)) if (isIsbn13(m[0])) set.add(m[0]);
  }
  return set;
}

async function main() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const essai = process.argv.includes('--essai');
  const fichier = (process.argv.find((a) => a.startsWith('--fichier=')) || '').slice(10);
  let buf;
  if (fichier) buf = readFileSync(fichier);
  else {
    const url = process.env.AWIN_FEED_URL || '';
    if (!/^https:\/\/productdata\.awin\.com\//.test(url)) { console.log('AWIN_FEED_URL absent ou inattendu : rien à faire.'); return; }
    const r = await fetch(url, { headers: { 'User-Agent': 'manga-calendrier/1.0 (calendrier gratuit de sorties)' }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) { console.error(`Téléchargement du flux refusé (HTTP ${r.status}).`); process.exitCode = 1; return; }
    buf = Buffer.from(await r.arrayBuffer());
  }
  const texte = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8').replace(/^\uFEFF/, '');
  const voulus = isbnVoulus(dir);
  const { lignes, base, liens } = lireFlux(texte, voulus);
  const n = Object.keys(liens).length;
  console.log(`Flux : ${lignes} produits. ISBN du site : ${voulus.size}. Liens directs trouvés : ${n} (${Math.round((100 * n) / voulus.size)} %).`);
  if (!BASE_RE.test(base) || n < 1000) { console.error('Bilan trop faible ou adresse inattendue : fichier laissé tel quel.'); process.exitCode = 1; return; }
  if (essai) { console.log('Essai à blanc : rien écrit.'); return; }
  const cible = path.join(dir, 'cultura-liens.json');
  try { const old = JSON.parse(readFileSync(cible, 'utf8')); if (old.base === base && JSON.stringify(old.liens) === JSON.stringify(Object.fromEntries(Object.entries(liens).sort(([a], [b]) => a.localeCompare(b))))) { console.log('Aucun changement.'); return; } } catch {}
  const tri = Object.fromEntries(Object.entries(liens).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(cible, JSON.stringify({ source: 'Flux produits Cultura (Awin)', maj: new Date().toISOString().slice(0, 10), base, liens: tri }) + '\n');
  console.log('data/cultura-liens.json écrit.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`Erreur : ${e.message}`); process.exitCode = 1; });
