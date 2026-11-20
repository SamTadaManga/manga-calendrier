// Flux produits Ludum (https://www.ludum.fr/flux-mangas-ludum, public, mis à jour chaque jour vers 5 h)
//   -> data/ludum-liens.json  : lien direct vers la fiche Ludum de chaque tome disponible,
//   -> data/ludum-images.json : images pour les couvertures manquantes (utilisées seulement si « autorise » vaut true, voir ci-dessous),
//   -> data/catalogue-ajouts.json : tomes absents du catalogue (trous de numérotation et tomes suivants).
// Aucune clé : l'adresse du flux est publique. Elle peut être remplacée par la variable LUDUM_FEED_URL (doit rester sur https://www.ludum.fr/).
// Usage : node scripts/ludum-flux.mjs [--essai]      (ou --fichier=flux.csv pour un fichier déjà téléchargé)
//
// Images : le champ « autorise » de data/ludum-images.json est conservé tel quel d'une exécution à l'autre ; il vaut false tant que
// Ludum n'a pas confirmé par écrit qu'on peut afficher ses couvertures. Pour l'activer : mettre "autorise": true dans ce fichier.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsbn13 } from './shops.mjs';
import { loadBnf } from './catalogue-bnf.mjs';
import { decode } from './collectors.mjs';
import { loadExceptions } from './trous.mjs';
import { flat, saveAjouts } from './ajouts-lib.mjs';
import { chargerAdulte, estAdulte } from './adulte.mjs';
import { lignesCsv, completerCatalogue, imagesManquantes, isbnVoulus } from './cultura-flux.mjs';

export const LUDUM_FLUX = 'https://www.ludum.fr/flux-mangas-ludum';
export const LUDUM_BASE = 'https://www.ludum.fr/mangas/';
export const LUDUM_IMG = 'https://images.centprod.com/';

/**
 * Flux CSV (séparé par « , ») -> produits { isbn, nom, serie, tome, marque, etat, slug, img } (ISBN-13 valides ; adresses vérifiées).
 * serie et tome ne sont renseignés que pour un titre de la forme exacte « <série> - Tome <n> » : les éditions spéciales
 * (« - Édition couleur », coffrets…) ne servent ni à combler un trou ni à ajouter un tome.
 */
export function produitsLudum(texte) {
  const it = lignesCsv(texte, ',');
  const tete = it.next().value || [];
  const col = (n) => tete.indexOf(n);
  const iEan = col('ean13'), iNom = col('nom'), iEd = col('editeur'), iEtat = col('etat'), iUrl = col('url_produit'), iImg = col('url_image');
  if (iEan < 0 || iNom < 0 || iUrl < 0) throw new Error('Flux inattendu : colonnes ean13, nom et url_produit introuvables.');
  const out = [], vus = new Set();
  for (const r of it) {
    const isbn = String(r[iEan] || '').replace(/[^0-9]/g, '');
    if (!isIsbn13(isbn) || vus.has(isbn)) continue;
    const u = String(r[iUrl] || '').match(/^https:\/\/www\.ludum\.fr\/mangas\/([a-z0-9][a-z0-9-]{2,200})$/);
    if (!u) continue;
    vus.add(isbn);
    const nom = decode(String(r[iNom] || '')).trim();
    const t = nom.match(/^(.+?) - Tome (\d{1,3})$/i);
    const img = String(iImg >= 0 ? r[iImg] : '').match(/^https:\/\/images\.centprod\.com\/([\w./-]{5,300})$/);
    out.push({ isbn, nom, desc: '', marque: decode(String(iEd >= 0 ? r[iEd] : '')).trim(), etat: String(iEtat >= 0 ? r[iEtat] : '').trim().toLowerCase(), serie: t ? flat(t[1]) : '', tome: t ? String(Number(t[2])) : '', img: img ? img[1] : '', slug: u[1] });
  }
  return out;
}

/** Liens directs { isbn13: chemin de la fiche } pour les ISBN voulus ; les titres en rupture sont écartés (impasse pour le visiteur). */
export function liensLudum(produits, voulus) {
  const liens = {};
  for (const p of produits) if (voulus.has(p.isbn) && p.etat !== 'rupture' && !liens[p.isbn]) liens[p.isbn] = p.slug;
  return liens;
}

async function main() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const essai = process.argv.includes('--essai');
  const fichier = (process.argv.find((a) => a.startsWith('--fichier=')) || '').slice(10);
  let texte;
  if (fichier) texte = readFileSync(fichier, 'utf8');
  else {
    const url = process.env.LUDUM_FEED_URL || LUDUM_FLUX;
    if (!/^https:\/\/www\.ludum\.fr\//.test(url)) { console.log('LUDUM_FEED_URL inattendue : rien à faire.'); return; }
    const r = await fetch(url, { headers: { 'User-Agent': 'manga-calendrier/1.0 (calendrier gratuit de sorties ; prochaintome.fr)' }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) { console.error(`Téléchargement du flux refusé (HTTP ${r.status}).`); process.exitCode = 1; return; }
    texte = Buffer.from(await r.arrayBuffer()).toString('utf8');
  }
  texte = texte.replace(/^﻿/, '');
  const tous = produitsLudum(texte);
  const stable = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
  const ecrire = (nom, objet, comparer) => {
    const cible = path.join(dir, nom);
    try { const old = JSON.parse(readFileSync(cible, 'utf8')); if (comparer(old)) return false; } catch {}
    writeFileSync(cible, JSON.stringify(objet) + '\n');
    return true;
  };
  const maj = new Date().toISOString().slice(0, 10);

  // Contenu adulte : jamais de lien, d'image ni de tome pour ce qui est déjà retiré du site (éditeur, ISBN, série ou titre listés)
  const adulteCfg = chargerAdulte(dir);
  const produits = tous.filter((p) => !estAdulte(adulteCfg, { editeur: p.marque, serie: p.serie || p.nom, isbn: p.isbn }));
  console.log(`Flux Ludum : ${tous.length} produits avec ISBN valide, ${tous.length - produits.length} écartés (contenu adulte).`);

  // 1. Tomes absents du catalogue
  const bnf = loadBnf(dir);
  const nouveaux = completerCatalogue(produits, bnf, loadExceptions(dir), bnf.byIsbn.keys(), 'ludum');
  const trous = nouveaux.filter((a) => a.motif === 'trou').length;
  console.log(`Catalogue : ${trous} trous de numérotation comblés, ${nouveaux.length - trous} tomes suivants ajoutés.`);
  if (!essai && nouveaux.length) console.log(`  ${saveAjouts(dir, nouveaux)} références écrites dans data/catalogue-ajouts.json.`);

  // 2. Liens directs
  const voulus = new Set([...isbnVoulus(dir), ...(essai ? nouveaux.map((a) => a.isbn) : [])]);
  const liens = liensLudum(produits, voulus);
  const n = Object.keys(liens).length;
  console.log(`Liens directs : ${n} sur ${voulus.size} ISBN du site (${Math.round((100 * n) / voulus.size)} %).`);
  if (n < 500) { console.error('Bilan trop faible : fichiers de liens et d\'images laissés tels quels.'); process.exitCode = 1; return; }

  // 3. Images pour les couvertures manquantes
  let faits = new Set();
  try { faits = new Set(JSON.parse(readFileSync(path.join(dir, 'couvertures-isbn.json'), 'utf8')).done || []); } catch {}
  const images = imagesManquantes(produits, voulus, faits);
  let autorise = false;
  try { autorise = JSON.parse(readFileSync(path.join(dir, 'ludum-images.json'), 'utf8')).autorise === true; } catch {}
  console.log(`Couvertures : ${Object.keys(images).length} ISBN sans couverture ont une image chez Ludum (utilisation ${autorise ? 'autorisée' : 'NON autorisée pour l\'instant'}).`);

  if (essai) { console.log('Essai à blanc : rien écrit.'); return; }
  const tri = Object.fromEntries(Object.entries(liens).sort(([a], [b]) => a.localeCompare(b)));
  const l = ecrire('ludum-liens.json', { source: 'Flux produits Ludum', maj, base: LUDUM_BASE, liens: tri }, (old) => stable(old.liens || {}) === stable(liens));
  const im = ecrire('ludum-images.json', { source: 'Flux produits Ludum', maj, autorise, base: LUDUM_IMG, img: images }, (old) => old.autorise === autorise && stable(old.img || {}) === stable(images));
  console.log(`ludum-liens.json : ${l ? 'écrit' : 'inchangé'} ; ludum-images.json : ${im ? 'écrit' : 'inchangé'}.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`Erreur : ${e.message}`); process.exitCode = 1; });
