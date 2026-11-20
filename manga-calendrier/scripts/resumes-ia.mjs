// Résumés des grandes séries réécrits par une IA locale (voir .github/workflows/resumes-ia.yml).
//   node scripts/resumes-ia.mjs preparer [--limite=80] [--sortie=taches.json]    : choisit les séries à traiter et prépare les consignes
//   (python scripts/llm-local.py taches.json resultats.json                       : le modèle écrit)
//   node scripts/resumes-ia.mjs appliquer [--entree=resultats.json] [--essai]    : contrôle chaque texte et l'enregistre dans data/resumes-ia.json
// Le résumé de l'éditeur (data/resumes-catalogue.json) reste la source ; un texte refusé par le contrôle n'est jamais publié.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBnf } from './catalogue-bnf.mjs';
import { slugify } from './lib.mjs';
import { consigne, valider, empreinte } from './resumes-ia-lib.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const lire = (f, def) => { try { return JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { return def; } };
const arg = (n, def = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || def;
const GENRES = { Action: 'action', Adventure: 'aventure', Comedy: 'comédie', Drama: 'drame', Fantasy: 'fantasy', Horror: 'horreur', Mystery: 'mystère', Romance: 'romance', 'Sci-Fi': 'science-fiction', 'Slice of Life': 'tranche de vie', Sports: 'sport', Supernatural: 'surnaturel', Psychological: 'psychologique', Thriller: 'thriller', Mecha: 'mecha', Music: 'musique' };

/** Séries à traiter : celles dont le résumé de l'éditeur a changé ou qui n'ont pas encore de texte IA, les plus longues d'abord. */
export function aTraiter({ bnf, resumes, ia, adapt }, limite = 80) {
  const out = [];
  for (const s of bnf.series) {
    const r = resumes[s.k];
    if (!r || !r.t) continue;
    const h = empreinte(r.t);
    if (ia[s.k] && ia[s.k].h === h) continue;
    const i = adapt[slugify(s.n)]?.i || {};
    out.push({ k: s.k, h, taille: s.v.length, x: { nom: s.n, auteurs: (i.au || []).slice(0, 3), genres: (i.g || []).map((g) => GENRES[g]).filter(Boolean).slice(0, 4), editeur: s.e || '', source: r.t } });
  }
  return out.sort((a, b) => b.taille - a.taille || a.k.localeCompare(b.k)).slice(0, limite);
}

const faitsDe = (x) => `${x.nom} ${x.auteurs.join(' ')} ${x.genres.join(' ')} ${x.editeur}`;

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'preparer') {
    const taches = aTraiter({ bnf: loadBnf(dir), resumes: lire('resumes-catalogue.json', {}).resumes || {}, ia: lire('resumes-ia.json', {}).resumes || {}, adapt: lire('adaptations.json', {}).series || {} }, Number(arg('limite', '80')) || 80);
    writeFileSync(arg('sortie', 'taches.json'), JSON.stringify(taches.map((t) => ({ k: t.k, h: t.h, messages: consigne(t.x), x: t.x }))));
    console.log(`${taches.length} résumés à écrire.`);
  } else if (cmd === 'appliquer') {
    let res;
    try { res = JSON.parse(readFileSync(arg('entree', 'resultats.json'), 'utf8')); } catch { console.log('Aucun résultat exploitable (le modèle n\'a rien produit) : rien à enregistrer.'); return; }
    const cible = lire('resumes-ia.json', {});
    const ia = { ...(cible.resumes || {}) };
    const refus = {}; let ok = 0;
    for (const r of res) {
      if (!r.x) continue;
      const v = valider(r.sortie, r.x.source, faitsDe(r.x));
      if (v.ok) { ia[r.k] = { t: v.texte, h: r.h }; ok++; } else { const m = v.motif.replace(/:.*/, ''); refus[m] = (refus[m] || 0) + 1; console.log(`  refusé ${r.k} : ${v.motif}`); }
    }
    console.log(`${ok} résumés acceptés, ${res.length - ok} refusés ${JSON.stringify(refus)}.`);
    if (!process.argv.includes('--essai') && ok) writeFileSync(path.join(dir, 'resumes-ia.json'), JSON.stringify({ source: 'Résumés réécrits par une IA locale à partir du résumé de l\'éditeur', modele: process.env.MODELE || cible.modele || '', maj: new Date().toISOString().slice(0, 10), resumes: ia }) + '\n');
  } else { console.error('Usage : preparer | appliquer'); process.exitCode = 1; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`Erreur : ${e.message}`); process.exitCode = 1; });
