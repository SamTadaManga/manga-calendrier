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
import { decode } from './collectors.mjs';
import { findGaps, loadExceptions } from './trous.mjs';
import { flat, saveAjouts } from './ajouts-lib.mjs';
import { analyserTexte, chargerAdulte, estAdulte } from './adulte.mjs';

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

/** Contenu du flux -> liste de produits { isbn, pid, nom, serie, tome, img, base } (ISBN-13 valides uniquement). */
export function produitsFlux(texte) {
  const it = lignesCsv(texte);
  const tete = it.next().value || [];
  const col = (nom) => tete.indexOf(nom);
  const iLien = col('aw_deep_link'), iId = col('merchant_product_id'), iIsbn = col('isbn'), iNom = col('product_name'), iImg = col('merchant_image_url'), iDesc = col('description');
  if (iLien < 0 || iId < 0) throw new Error('Flux inattendu : colonnes aw_deep_link et merchant_product_id introuvables.');
  const out = [];
  for (const r of it) {
    const isbn = [r[iId], iIsbn >= 0 ? r[iIsbn] : ''].map((x) => String(x || '').replace(/[^0-9]/g, '')).find((x) => isIsbn13(x));
    if (!isbn) continue;
    const m = String(r[iLien] || '').match(/^https:\/\/www\.awin1\.com\/pclick\.php\?p=(\d{3,20})&a=(\d+)&m=(\d+)$/);
    if (!m) continue;
    const nom = decode(String(iNom >= 0 ? r[iNom] : '')).trim();
    const t = nom.match(/^(.*?)\s+Tome\s*(\d{1,3})$/i);
    const img = String(iImg >= 0 ? r[iImg] : '').match(/^https:\/\/cdn\.cultura\.com\/media\/pim\/([\w./-]+)$/);
    out.push({ desc: decode(String(iDesc >= 0 ? r[iDesc] : '').replace(/<[^>]+>/g, ' ')).slice(0, 1500), isbn, pid: m[1], base: `https://www.awin1.com/pclick.php?a=${m[2]}&m=${m[3]}&p=`, nom, serie: t ? flat(t[1]) : '', tome: t ? String(Number(t[2])) : '', img: img ? img[1] : '' });
  }
  return out;
}

/** Liens directs { base, liens: { isbn13: identifiant produit Awin } } pour les ISBN voulus. */
export function lireFlux(texte, voulus) { return liensDe(produitsFlux(texte), voulus); }
export function liensDe(produits, voulus) {
  let base = '';
  const liens = {};
  for (const p of produits) {
    if (!voulus.has(p.isbn) || liens[p.isbn]) continue;
    if (!base) base = p.base;
    if (p.base !== base) continue;
    liens[p.isbn] = p.pid;
  }
  return { lignes: produits.length, base, liens };
}

const pre = (isbn) => isbn.slice(0, 8); // préfixe éditeur : mêmes 8 premiers chiffres qu'un tome déjà connu de la série

/**
 * Tomes que le catalogue ne connaît pas encore : trous de numérotation (petits et gros) et jusqu'à 3 tomes après le dernier connu.
 * Règle : titre « <série> Tome N » identique à la série, même préfixe d'ISBN que ses tomes connus, un seul candidat.
 */
export function completerCatalogue(produits, bnf, ex, connus) {
  const parTitre = new Map();
  for (const p of produits) if (p.serie) { const k = `${p.serie}|${p.tome}`; (parTitre.get(k) || parTitre.set(k, []).get(k)).push(p); }
  const vus = new Set(connus);
  const trouve = (s, n, pres) => {
    const c = (parTitre.get(`${flat(s.n)}|${n}`) || []).filter((p) => pres.has(pre(p.isbn)) && !vus.has(p.isbn));
    return c.length === 1 ? c[0] : null;
  };
  const out = [];
  const ajoute = (s, n, p, motif) => { vus.add(p.isbn); out.push({ k: s.k, n: s.n, e: s.e, t: String(n), isbn: p.isbn, y: 0, src: 'cultura', motif, statut: 'ok' }); };
  const G = findGaps(bnf.series, () => [], ex);
  const trous = new Set();
  for (const g of [...G.petit, ...G.gros]) {
    const s = bnf.byK.get(g.k), pres = new Set(s.v.map((v) => pre(v[1])));
    trous.add(g.k);
    for (const n of g.miss) { const p = trouve(s, n, pres); if (p) ajoute(s, n, p, 'trou'); }
  }
  for (const s of bnf.series) {
    if (ex.exclus.has(flat(s.e)) || ex.exceptions.get(s.k) === 'tous') continue;
    const mx = Math.max(0, ...s.v.map((v) => Number(v[0]) || 0));
    if (!mx || mx > 100) continue;
    const pres = new Set(s.v.map((v) => pre(v[1])));
    for (let n = mx + 1; n <= mx + 3; n++) { const p = trouve(s, n, pres); if (!p) break; ajoute(s, n, p, 'suite'); }
  }
  return out;
}

/**
 * Contenu adulte du catalogue (descriptions du flux + règles de adulte.mjs) -> { exclure: { slug: {n, e, motif} }, revoir: { slug: {n, e, r: [repères]} } }.
 * Les séries déjà décidées à la main (conserver, séries, labels) ne sont pas reproposées.
 */
export function analyserAdulte(produits, bnfTout, adulte) {
  const parIsbn = new Map(produits.map((p) => [p.isbn, p]));
  const exclure = {}, revoir = {};
  for (const s of bnfTout.series) {
    if (adulte.conserver.has(s.k) || estAdulte(adulte, { slug: s.k, serie: s.n, editeur: s.e })) continue;
    const texte = s.v.map((v) => { const p = parIsbn.get(v[1]); return p ? `${p.nom} ${p.desc}` : ''; }).join(' ');
    const a = analyserTexte(s.n, texte);
    if (a.exclure) exclure[s.k] = { n: s.n, e: s.e, motif: a.exclure };
    else if (a.revoir.length >= 2 || a.revoir.some((r) => ['porno', 'xxx', 'explicite'].includes(r))) revoir[s.k] = { n: s.n, e: s.e, r: a.revoir };
  }
  return { exclure, revoir };
}

/** Images Cultura pour les ISBN du site qui n'ont pas encore de couverture : { isbn: chemin sous cdn.cultura.com/media/pim/ }. */
export function imagesManquantes(produits, voulus, faits) {
  const out = {};
  for (const p of produits) if (p.img && voulus.has(p.isbn) && !faits.has(p.isbn) && !out[p.isbn]) out[p.isbn] = p.img;
  return out;
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
  const produits = produitsFlux(texte);
  const stable = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
  const ecrire = (nom, objet, comparer) => {
    const cible = path.join(dir, nom);
    try { const old = JSON.parse(readFileSync(cible, 'utf8')); if (comparer(old)) return false; } catch {}
    writeFileSync(cible, JSON.stringify(objet) + '\n');
    return true;
  };
  const maj = new Date().toISOString().slice(0, 10);

  // 0. Contenu adulte : les séries repérées par leur description sont retirées du site (data/contenu-adulte-auto.json) ; les cas douteux sont listés pour relecture
  const adulteCfg = chargerAdulte(dir);
  const ana = analyserAdulte(produits, loadBnf(dir, { tout: true }), adulteCfg);
  let ancien = {};
  try { ancien = JSON.parse(readFileSync(path.join(dir, 'contenu-adulte-auto.json'), 'utf8')); } catch {}
  const exclusAuto = Object.fromEntries(Object.entries({ ...(ancien.series || {}), ...ana.exclure }).filter(([k]) => !adulteCfg.conserver.has(k)));
  const aRevoir = Object.fromEntries(Object.entries(ana.revoir).filter(([k]) => !exclusAuto[k]));
  console.log(`Contenu adulte : ${Object.keys(exclusAuto).length} séries retirées automatiquement (${Object.keys(ana.exclure).length} nouvelles), ${Object.keys(aRevoir).length} à relire.`);
  if (!essai) ecrire('contenu-adulte-auto.json', { source: 'Descriptions du flux Cultura et règles de scripts/adulte.mjs', maj, series: exclusAuto, revoir: aRevoir }, (old) => stable(old.series || {}) === stable(exclusAuto) && stable(old.revoir || {}) === stable(aRevoir));

  // 1. Tomes absents du catalogue (avant de compter les liens, pour que les nouveaux ISBN en profitent)
  const bnf = loadBnf(dir);
  const nouveaux = completerCatalogue(produits, bnf, loadExceptions(dir), bnf.byIsbn.keys());
  const trous = nouveaux.filter((a) => a.motif === 'trou').length;
  console.log(`Catalogue : ${trous} trous de numérotation comblés, ${nouveaux.length - trous} tomes suivants ajoutés.`);
  if (!essai && nouveaux.length) console.log(`  ${saveAjouts(dir, nouveaux)} références écrites dans data/catalogue-ajouts.json.`);

  // 2. Liens directs
  const voulus = new Set([...isbnVoulus(dir), ...(essai ? nouveaux.map((a) => a.isbn) : [])]);
  const { lignes, base, liens } = liensDe(produits, voulus);
  const n = Object.keys(liens).length;
  console.log(`Flux : ${lignes} produits. ISBN du site : ${voulus.size}. Liens directs trouvés : ${n} (${Math.round((100 * n) / voulus.size)} %).`);
  if (!BASE_RE.test(base) || n < 1000) { console.error('Bilan trop faible ou adresse inattendue : fichiers de liens et d\'images laissés tels quels.'); process.exitCode = 1; return; }

  // 3. Images pour les couvertures manquantes
  let faits = new Set();
  try { faits = new Set(JSON.parse(readFileSync(path.join(dir, 'couvertures-isbn.json'), 'utf8')).done || []); } catch {}
  const images = imagesManquantes(produits, voulus, faits);
  console.log(`Couvertures : ${Object.keys(images).length} ISBN sans couverture ont une image chez Cultura.`);

  if (essai) { console.log('Essai à blanc : rien écrit.'); return; }
  const tri = Object.fromEntries(Object.entries(liens).sort(([a], [b]) => a.localeCompare(b)));
  const l = ecrire('cultura-liens.json', { source: 'Flux produits Cultura (Awin)', maj, base, liens: tri }, (old) => old.base === base && stable(old.liens) === stable(liens));
  const im = ecrire('cultura-images.json', { source: 'Flux produits Cultura (Awin)', maj, base: 'https://cdn.cultura.com/media/pim/', img: images }, (old) => stable(old.img || {}) === stable(images));
  console.log(`cultura-liens.json : ${l ? 'écrit' : 'inchangé'} ; cultura-images.json : ${im ? 'écrit' : 'inchangé'}.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`Erreur : ${e.message}`); process.exitCode = 1; });
