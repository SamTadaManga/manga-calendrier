// Catalogue produits BDfugue (Effinity) -> data/bdfugue-liens.json (lien direct vers la fiche de chaque tome), data/bdfugue-images.json (couvertures manquantes),
// data/catalogue-ajouts.json (tomes absents du catalogue) et data/contenu-adulte-auto.json (séries 18+ repérées, retirées du site).
// L'adresse du flux contient une clé : elle vient UNIQUEMENT de la variable d'environnement EFFINITY_FEED_URL (secret GitHub), jamais écrite ni affichée.
// Usage : EFFINITY_FEED_URL=... node scripts/effinity-flux.mjs [--essai]      (ou --fichier=catalogue.csv pour un fichier déjà téléchargé)
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsbn13, EFFI_BASE } from './shops.mjs';
import { loadBnf } from './catalogue-bnf.mjs';
import { decode } from './collectors.mjs';
import { loadExceptions } from './trous.mjs';
import { flat, saveAjouts } from './ajouts-lib.mjs';
import { chargerAdulte, estAdulte, analyserTexte } from './adulte.mjs';
import { loadConfig, paths as cheminsSite } from './lib.mjs';
import { lignesCsv, completerCatalogue, analyserAdulte, imagesManquantes, isbnVoulus } from './cultura-flux.mjs';

const SITE = 'https://www.bdfugue.com/';
const IMG = 'https://www.bdfugue.com/media/catalog/product/';

/** Contenu du catalogue (CSV séparé par « ; ») -> produits { isbn, nom, desc, serie, tome, img, slug, base, suffix, marque } (ISBN-13 valides, liens vers www.bdfugue.com uniquement). */
export function produitsEffinity(texte) {
  const it = lignesCsv(texte, ';');
  const tete = it.next().value || [];
  const col = (n) => tete.indexOf(n);
  const iGtin = col('gtin'), iLien = col('link'), iTitre = col('title'), iImg = col('image_link'), iDesc = col('description'), iMarque = col('brand');
  if (iGtin < 0 || iLien < 0 || iTitre < 0) throw new Error('Catalogue inattendu : colonnes gtin, link et title introuvables.');
  const out = [];
  for (const r of it) {
    const isbn = String(r[iGtin] || '').replace(/[^0-9]/g, '');
    if (!isIsbn13(isbn)) continue;
    const m = String(r[iLien] || '').match(/^(https:\/\/track\.effiliation\.com\/servlet\/effi\.redir\?id_compteur=\d{3,12}&url=)(https%3A%2F%2Fwww\.bdfugue\.com%2F[\w%.-]+)$/);
    if (!m || !EFFI_BASE.test(m[1])) continue;
    let cible;
    try { cible = decodeURIComponent(m[2]); } catch { continue; }
    const u = cible.match(/^https:\/\/www\.bdfugue\.com\/([a-z0-9][a-z0-9-]{2,200})(\?[\w=&.%-]{0,200})?$/);
    if (!u) continue;
    const nom = decode(String(r[iTitre] || '')).trim();
    const t = nom.match(/^(.*?)\s+Tome\s*(\d{1,3})$/i);
    const img = String(iImg >= 0 ? r[iImg] : '').match(/^https:\/\/www\.bdfugue\.com\/media\/catalog\/product\/([\w./-]+)$/);
    out.push({ isbn, nom, desc: decode(String(iDesc >= 0 ? r[iDesc] : '').replace(/<[^>]+>/g, ' ')).slice(0, 1500), marque: decode(String(iMarque >= 0 ? r[iMarque] : '')).trim(), serie: t ? flat(t[1]) : '', tome: t ? String(Number(t[2])) : '', img: img ? img[1] : '', slug: u[1], suffix: u[2] || '', base: m[1] });
  }
  return out;
}

/** Liens directs { base, suffix, liens: { isbn13: chemin de la fiche } } pour les ISBN voulus (une seule base et un seul suffixe). */
export function liensEffinity(produits, voulus) {
  let base = '', suffix = null;
  const liens = {};
  for (const p of produits) {
    if (!voulus.has(p.isbn) || liens[p.isbn]) continue;
    if (!base) { base = p.base; suffix = p.suffix; }
    if (p.base !== base || p.suffix !== suffix) continue;
    liens[p.isbn] = p.slug;
  }
  return { lignes: produits.length, base, suffix: suffix || '', liens };
}

/** Résumé du tome 1 (ou du plus petit tome connu) de chaque grande série du catalogue : { slug: { t: texte, n: numéro du tome } }. Texte de l'éditeur tel que fourni dans le catalogue produits, tronqué à la fin d'une phrase. */
export function resumesCatalogue(produits, bnf, min = 10) {
  const parSerie = new Map();
  for (const p of produits) if (p.serie && p.tome && p.desc.length >= 80) (parSerie.get(p.serie) || parSerie.set(p.serie, []).get(p.serie)).push(p);
  const out = {};
  for (const s of bnf.series) {
    if (s.v.length < min) continue;
    const c = (parSerie.get(flat(s.n)) || []).sort((a, b) => Number(a.tome) - Number(b.tome))[0];
    if (!c) continue;
    let t = c.desc.replace(/\s+/g, ' ').replace(/([!?.])([A-ZÀ-ÝÉ])/g, '$1 $2').replace(/([.!"…])\s\?\s/g, '$1 ').replace(/^(résumé|synopsis)\s*:\s*/i, '').trim();
    if (t.length > 650) { const cut = t.slice(0, 650); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); t = i > 250 ? cut.slice(0, i + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`; }
    if (t.length < 80 || analyserTexte(s.n, t).exclure) continue;
    out[s.k] = { t, n: Number(c.tome) };
  }
  return out;
}

async function main() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const essai = process.argv.includes('--essai');
  const fichier = (process.argv.find((a) => a.startsWith('--fichier=')) || '').slice(10);
  let buf;
  if (fichier) buf = readFileSync(fichier);
  else {
    const url = process.env.EFFINITY_FEED_URL || '';
    if (!/^https:\/\/products\.effinity\.fr\//.test(url)) { console.log('EFFINITY_FEED_URL absent ou inattendu : rien à faire.'); return; }
    const r = await fetch(url, { headers: { 'User-Agent': 'manga-calendrier/1.0 (calendrier gratuit de sorties)' }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) { console.error(`Téléchargement du catalogue refusé (HTTP ${r.status}).`); process.exitCode = 1; return; }
    buf = Buffer.from(await r.arrayBuffer());
  }
  const texte = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8').replace(/^﻿/, '');
  const tous = produitsEffinity(texte);
  const stable = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
  const ecrire = (nom, objet, comparer) => {
    const cible = path.join(dir, nom);
    try { const old = JSON.parse(readFileSync(cible, 'utf8')); if (comparer(old)) return false; } catch {}
    writeFileSync(cible, JSON.stringify(objet) + '\n');
    return true;
  };
  const maj = new Date().toISOString().slice(0, 10);

  // 0. Contenu adulte : par éditeur, par titre/description (mêmes règles que le flux Cultura). Tout ce qui est repéré est retiré du site et du reste du traitement.
  const adulteCfg = chargerAdulte(dir);
  const ana = analyserAdulte(tous, loadBnf(dir, { tout: true }), adulteCfg);
  let ancien = {};
  try { ancien = JSON.parse(readFileSync(path.join(dir, 'contenu-adulte-auto.json'), 'utf8')); } catch {}
  const parReperes = Object.fromEntries(Object.entries(ana.revoir).map(([k, v]) => [k, { n: v.n, e: v.e, motif: `repères : ${v.r.join(', ')}` }]));
  const exclusAuto = Object.fromEntries(Object.entries({ ...(ancien.series || {}), ...parReperes, ...ana.exclure }).filter(([k]) => !adulteCfg.conserver.has(k)));
  console.log(`Contenu adulte : ${Object.keys(exclusAuto).length} séries retirées au total (${Object.keys(ana.exclure).length} + ${Object.keys(parReperes).length} repérées dans ce catalogue).`);
  if (!essai) ecrire('contenu-adulte-auto.json', { ...ancien, maj, series: exclusAuto }, (old) => stable(old.series || {}) === stable(exclusAuto));
  const nomsAdultes = new Set(Object.values(exclusAuto).map((x) => flat(x.n || '')).filter(Boolean));
  // produits eux-mêmes adultes (éditeur, titre ou ISBN listés) : jamais de lien ni d'image
  const produits = tous.filter((p) => !estAdulte(adulteCfg, { editeur: p.marque, serie: p.serie || p.nom, isbn: p.isbn }) && !(p.serie && nomsAdultes.has(p.serie)));
  console.log(`Catalogue : ${tous.length} produits avec ISBN valide, ${tous.length - produits.length} écartés (contenu adulte).`);

  // 1. Tomes absents du catalogue
  const bnf = loadBnf(dir);
  const nouveaux = completerCatalogue(produits, bnf, loadExceptions(dir), bnf.byIsbn.keys(), 'bdfugue');
  const trous = nouveaux.filter((a) => a.motif === 'trou').length;
  console.log(`Catalogue : ${trous} trous de numérotation comblés, ${nouveaux.length - trous} tomes suivants ajoutés.`);
  if (!essai && nouveaux.length) console.log(`  ${saveAjouts(dir, nouveaux)} références écrites dans data/catalogue-ajouts.json.`);

  // 2. Liens directs
  const voulus = new Set([...isbnVoulus(dir), ...(essai ? nouveaux.map((a) => a.isbn) : [])]);
  const { lignes, base, suffix, liens } = liensEffinity(produits, voulus);
  const n = Object.keys(liens).length;
  console.log(`Catalogue : ${lignes} produits retenus. ISBN du site : ${voulus.size}. Liens directs trouvés : ${n} (${Math.round((100 * n) / voulus.size)} %).`);
  if (!EFFI_BASE.test(base) || n < 1000) { console.error('Bilan trop faible ou adresse inattendue : fichiers de liens et d\'images laissés tels quels.'); process.exitCode = 1; return; }

  // 3. Images pour les couvertures manquantes
  let faits = new Set();
  try { faits = new Set(JSON.parse(readFileSync(path.join(dir, 'couvertures-isbn.json'), 'utf8')).done || []); } catch {}
  const images = imagesManquantes(produits, voulus, faits);
  console.log(`Couvertures : ${Object.keys(images).length} ISBN sans couverture ont une image chez BDfugue.`);

  // 4. Résumés des grandes séries (pages catalogue indexées)
  const resumes = resumesCatalogue(produits, bnf, Math.max(1, Number(loadConfig(cheminsSite().config).catalogueIndexMin) || 10));
  console.log(`Résumés : ${Object.keys(resumes).length} séries du catalogue ont un résumé du tome 1.`);

  if (essai) { console.log('Essai à blanc : rien écrit.'); return; }
  ecrire('resumes-catalogue.json', { source: 'Catalogue produits BDfugue (Effinity) : résumés de l\'éditeur', maj, resumes }, (old) => JSON.stringify(old.resumes || {}) === JSON.stringify(resumes));
  const tri = Object.fromEntries(Object.entries(liens).sort(([a], [b]) => a.localeCompare(b)));
  const l = ecrire('bdfugue-liens.json', { source: 'Catalogue produits BDfugue (Effinity)', maj, base, site: SITE, suffix, liens: tri }, (old) => old.base === base && old.suffix === suffix && stable(old.liens) === stable(liens));
  const im = ecrire('bdfugue-images.json', { source: 'Catalogue produits BDfugue (Effinity)', maj, base: IMG, img: images }, (old) => stable(old.img || {}) === stable(images));
  console.log(`bdfugue-liens.json : ${l ? 'écrit' : 'inchangé'} ; bdfugue-images.json : ${im ? 'écrit' : 'inchangé'}.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`Erreur : ${e.message}`); process.exitCode = 1; });
