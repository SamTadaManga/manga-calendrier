// Base ISBN du site : croise toutes les sources qui contiennent des ISBN et écrit data/base-isbn.csv (une ligne par ISBN du site).
// Sources : catalogue BnF + ajouts (catalogue-bnf.json, catalogue-ajouts.json), calendrier (manga.csv, manga-auto.csv),
//           flux Cultura, BDfugue (Effinity) et Ludum (liens, ludum-produits.json), état des couvertures (couvertures-controle.json, couvertures-isbn.json).
// Quand le catalogue ou le calendrier contredit Ludum sur le tome ou la série d'un ISBN, Ludum fait foi : la ligne reçoit la valeur de Ludum, l'écart est noté dans « alertes »,
// et la décision est écrite dans data/isbn-ludum.json (appliquée ensuite par le site, voir scripts/isbn-ludum.mjs). Les sources lues ici sont toujours les sources brutes.
// Le fichier est reconstruit entièrement à chaque passage (workflow « Base ISBN », chaque nuit) : il se complète tout seul quand une source s'enrichit.
// Colonnes séparées par « ; », UTF-8 avec BOM (s'ouvre directement dans Excel). Aucune écriture si rien n'a changé.
// Usage : node scripts/base-isbn.mjs [--essai]   (--essai : bilan seulement)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsbn13 } from './shops.mjs';
import { loadBnf, readAjouts } from './catalogue-bnf.mjs';
import { loadAllManga, slugify } from './lib.mjs';
import { tomeLudum, decider } from './isbn-ludum.mjs';

export const COLONNES = ['isbn13', 'serie', 'serie_slug', 'tome', 'editeur', 'titre', 'date_sortie', 'date_source', 'annee_bnf', 'statut', 'prix_ttc', 'prix_source', 'couverture', 'cultura', 'bdfugue', 'ludum', 'ludum_etat', 'sources', 'alertes'];

const lire = (dir, nom) => { try { return JSON.parse(readFileSync(path.join(dir, nom), 'utf8')); } catch { return {}; } };
const num = (t) => { const n = Number(String(t ?? '').replace(',', '.')); return Number.isFinite(n) && String(t ?? '').trim() !== '' ? String(n) : String(t ?? '').trim(); };
const jours = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
export const csvChamp = (v) => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Rassemble les sources et renvoie { lignes: [objet par ISBN], bilan }. */
export function construireBase(dir) {
  const bnf = loadBnf(dir, { brut: true });
  const ajouts = new Map(readAjouts(dir).ajouts.filter((a) => a.statut === 'ok').map((a) => [a.isbn, a.src || 'ajout']));
  const calendrier = new Map();
  for (const r of loadAllManga(dir, { brut: true })) if (isIsbn13(r.isbn) && !calendrier.has(r.isbn)) calendrier.set(r.isbn, r);
  const cult = lire(dir, 'cultura-liens.json').liens || {}, bdf = lire(dir, 'bdfugue-liens.json').liens || {}, lud = lire(dir, 'ludum-liens.json').liens || {};
  const fiches = lire(dir, 'ludum-produits.json').fiches || {};
  const vus = lire(dir, 'couvertures-controle.json').vus || {};
  const faits = new Set(lire(dir, 'couvertures-isbn.json').done || []);

  const lignes = new Map();
  const ligne = (isbn) => lignes.get(isbn) || lignes.set(isbn, { isbn13: isbn, sources: new Set(), tomes: {}, alertes: [] }).get(isbn);
  for (const s of bnf.series) for (const v of s.v) {
    if (!isIsbn13(v[1])) continue;
    const l = ligne(v[1]);
    Object.assign(l, { serie: s.n, serie_slug: s.k, editeur: s.e || '', annee_bnf: v[2] || '' });
    l.tomes.bnf = num(v[0]); l.titre ||= v[3] || '';
    l.sources.add(ajouts.has(v[1]) ? `ajout-${ajouts.get(v[1])}` : 'bnf');
  }
  for (const [isbn, r] of calendrier) {
    const l = ligne(isbn);
    l.sources.add('calendrier');
    l.serie ||= r.serie; l.serie_slug ||= slugify(r.serie); l.editeur ||= r.editeur; l.titre = r.titre || l.titre || '';
    l.tomes.calendrier = num(r.tome);
    l.date = r.date; l.date_source = 'calendrier'; l.statut = r.statut || '';
    if (r.prix) { l.prix = r.prix; l.prix_source = 'calendrier'; }
  }
  const maintenant = new Date().toISOString().slice(0, 10);
  const decisions = decider(bnf, fiches, new Map([...calendrier].map(([i, r]) => [i, num(r.tome)])));
  for (const [isbn, l] of lignes) {
    const f = fiches[isbn];
    if (f) {
      const [nom, ed, date, etat, prix] = f;
      l.sources.add('ludum');
      l.ludum_etat = etat || '';
      const tl = tomeLudum(nom);
      if (tl) l.tomes.ludum = tl.tome;
      l.editeur ||= ed || '';
      if (date) {
        if (!l.date) { l.date = date; l.date_source = 'ludum'; }
        else if (l.date_source === 'calendrier' && jours(l.date, date) > 3) l.alertes.push(`date: calendrier=${l.date} ludum=${date}`);
      }
      if (prix && !l.prix) { l.prix = prix; l.prix_source = 'ludum'; }
      l.titre ||= nom || '';
    }
    if (cult[isbn]) l.sources.add('cultura');
    if (bdf[isbn]) l.sources.add('bdfugue');
    const vals = Object.entries(l.tomes).filter(([, t]) => t !== '');
    l.tome = l.tomes.calendrier || l.tomes.bnf || l.tomes.ludum || '';
    const d = decisions[isbn];
    if (d && vals.some(([k, t]) => k !== 'ludum' && t !== d.t)) l.alertes.push(`tome: ${vals.map(([k, t]) => `${k}=${t}`).join(' ')} → ludum`);
    else if (new Set(vals.map(([, t]) => t)).size > 1) l.alertes.push(`tome: ${vals.map(([k, t]) => `${k}=${t}`).join(' ')}`);
    if (d) {
      l.tome = d.t;
      if (d.x) {
        const cible = d.k && bnf.byK.get(d.k);
        l.alertes.push(`serie: bnf=${l.serie} ludum=${tomeLudum(fiches[isbn][0]).serie} → ${cible ? 'ludum' : 'retiré du catalogue'}`);
        if (cible) { l.serie = cible.n; l.serie_slug = cible.k; l.editeur = cible.e || l.editeur; } else l.retire = true;
      }
    }
    l.couverture = vus[`isbn/${isbn}`] || faits.has(isbn) ? 'isbn' : (vus[`series/${l.serie_slug}`] ? 'serie' : 'aucune');
    l.cultura = cult[isbn] || ''; l.bdfugue = bdf[isbn] || ''; l.ludum = lud[isbn] || '';
    if (!l.date && !l.annee_bnf) l.alertes.push('date: aucune');
    l.statut ||= l.date ? (l.date > maintenant ? 'A paraître' : 'Paru') : '';
  }
  const rows = [...lignes.values()].map((l) => ({ ...l, sources: [...l.sources].sort().join('+'), alertes: l.alertes.join(' | '), date_sortie: l.date || '', prix_ttc: l.prix ? l.prix.toFixed(2) : '' }))
    .sort((a, b) => String(a.serie_slug).localeCompare(String(b.serie_slug)) || Number(a.tome || 0) - Number(b.tome || 0) || a.isbn13.localeCompare(b.isbn13));
  const n = (f) => rows.filter(f).length;
  const bilan = {
    isbn: rows.length,
    avecDate: n((r) => r.date_sortie), avecPrix: n((r) => r.prix_ttc), sansCouverture: n((r) => r.couverture === 'aucune'),
    liensCultura: n((r) => r.cultura), liensBdfugue: n((r) => r.bdfugue), liensLudum: n((r) => r.ludum), sansLien: n((r) => !r.cultura && !r.bdfugue && !r.ludum),
    contradictionsTome: n((r) => r.alertes.includes('tome:')), contradictionsDate: n((r) => r.alertes.includes('date: calendrier')), sansDate: n((r) => r.alertes.includes('date: aucune')),
    parSource: Object.fromEntries([...rows.reduce((m, r) => { for (const s of r.sources.split('+')) m.set(s, (m.get(s) || 0) + 1); return m; }, new Map())].sort()),
  };
  bilan.decisions = Object.keys(decisions).length;
  bilan.decisionsSerie = Object.values(decisions).filter((d) => d.x).length;
  return { lignes: rows, bilan, decisions };
}

export function versCsv(lignes) {
  return `﻿${COLONNES.join(';')}\n${lignes.map((l) => COLONNES.map((c) => csvChamp(l[c])).join(';')).join('\n')}\n`;
}

function main() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const essai = process.argv.includes('--essai');
  const { lignes, bilan: b, decisions } = construireBase(dir);
  console.log(`Base ISBN : ${b.isbn} ISBN (${Object.entries(b.parSource).map(([k, v]) => `${k} ${v}`).join(', ')}).`);
  console.log(`  Date connue : ${b.avecDate} · prix connu : ${b.avecPrix} · sans couverture : ${b.sansCouverture}.`);
  console.log(`  Liens directs : Cultura ${b.liensCultura}, BDfugue ${b.liensBdfugue}, Ludum ${b.liensLudum} · aucun lien direct : ${b.sansLien}.`);
  console.log(`  Contradictions entre sources : tome ${b.contradictionsTome}, date ${b.contradictionsDate} · sans aucune date : ${b.sansDate}.`);
  console.log(`  Décisions « Ludum gagne » : ${b.decisions} ISBN (dont ${b.decisionsSerie} changés de série ou retirés).`);
  if (b.isbn < 1000) { console.error('Base trop petite : fichier laissé tel quel.'); process.exitCode = 1; return; }
  const cible = path.join(dir, 'base-isbn.csv');
  const csv = versCsv(lignes);
  let ancien = '';
  try { ancien = readFileSync(cible, 'utf8'); } catch {}
  if (essai) { console.log('Essai à blanc : rien écrit.'); return; }
  if (ancien === csv) console.log('data/base-isbn.csv : inchangé.');
  else { writeFileSync(cible, csv); console.log('data/base-isbn.csv : écrit.'); }
  const dec = path.join(dir, 'isbn-ludum.json');
  const trie = Object.fromEntries(Object.entries(decisions).sort(([a], [c]) => a.localeCompare(c)));
  let avant = {};
  try { avant = JSON.parse(readFileSync(dec, 'utf8')).isbn || {}; } catch {}
  if (JSON.stringify(avant) === JSON.stringify(trie)) console.log('data/isbn-ludum.json : inchangé.');
  else { writeFileSync(dec, JSON.stringify({ source: 'Décisions « Ludum gagne » (scripts/base-isbn.mjs)', maj: new Date().toISOString().slice(0, 10), isbn: trie }) + '\n'); console.log('data/isbn-ludum.json : écrit.'); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) { try { main(); } catch (e) { console.error(`Erreur : ${e.message}`); process.exitCode = 1; } }
