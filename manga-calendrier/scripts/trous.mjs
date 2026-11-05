// Trous dans la numérotation des séries du catalogue : un seul endroit décide ce qui est un vrai trou.
// Trois classes :
//   petit  = quelques tomes absents au milieu d'une série bien fournie : on le montre sur le site et on cherche l'ISBN ;
//   gros   = série dont une bonne partie manque (catalogue incomplet) : à compléter en priorité, mais pas affiché tome par tome ;
//   bruit  = éditeur hors manga (collections numérotées), numéros de collection, séries mal regroupées : ignoré.
// Les exceptions légitimes (hors-série, tome unique, double tome « 1-2 »…) se déclarent dans data/numerotation-ok.json :
//   { "editeursExclus": ["Nom éditeur"], "exceptions": { "adresse-de-la-serie": { "numeros": [5, 6], "motif": "double tome" } } }
//   "numeros": "tous" ignore toute la série.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Éditeurs dont les numéros sont des numéros de collection ou des séries qui ne sont pas du manga.
export const EDITEURS_EXCLUS = [
  'Harlequin', 'Gallimard', 'Flammarion', 'Dargaud', 'Sperling & Kupfer', 'Gulf Stream éditeur', 'P. Picquier', 'Picquier jeunesse', 'Lys bleu',
  "J'ai lu", 'Azura Rowen', 'De Vecchi', 'Payot & Rivages', 'Presses universitaires de France', 'Édilivre', 'ESA communications',
  'Librairie générale française', 'Actes sud', 'Maïa', 'Grand livre du mois', 'Belin éducation', 'Nathan', 'Hachette', 'Archipel', 'Ramsay',
  'Coffre à BD', 'Francesco Carovillano', 'Éditions du bord du Lot', 'Plumes de marmotte', 'Média 1000', 'SilvanaEditoriale', 'Solitaires intempestifs',
];
const MAX_NUM = 100;      // au-delà, ce sont presque toujours des numéros de collection
const SMALL_ABS = 5;      // un trou « petit » : au plus 5 tomes…
const SMALL_PART = 0.25;  // …ou le quart de la série

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function loadExceptions(dir) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(path.join(dir, 'numerotation-ok.json'), 'utf8')); } catch {}
  const exclus = new Set([...EDITEURS_EXCLUS, ...(Array.isArray(raw.editeursExclus) ? raw.editeursExclus : [])].map(norm));
  const exceptions = new Map();
  for (const [k, v] of Object.entries(raw.exceptions && typeof raw.exceptions === 'object' ? raw.exceptions : {})) {
    if (v === 'tous' || v?.numeros === 'tous') exceptions.set(k, 'tous');
    else if (Array.isArray(v?.numeros)) exceptions.set(k, new Set(v.numeros.map(Number).filter((n) => n > 0)));
  }
  return { exclus, exceptions };
}

/**
 * Classe les trous de numérotation d'une série.
 * s : série du catalogue ({ k, n, e, v }) ; extra : numéros de tomes connus par ailleurs (calendrier) ; ex : résultat de loadExceptions.
 * Renvoie null s'il n'y a rien à signaler, sinon { k, n, e, have, max, miss: [numéros], kind: 'petit' | 'gros' | 'bruit' }.
 */
export function gapsOf(s, extra = [], ex = loadExceptions('')) {
  const exc = ex.exceptions.get(s.k);
  if (exc === 'tous') return null;
  const nums = new Set(s.v.map((v) => Number(v[0])).filter((n) => n > 0 && n < 1000));
  for (const n of extra) if (Number(n) > 0 && Number(n) < 1000) nums.add(Number(n));
  if (nums.size < 2) return null;
  const max = Math.max(...nums);
  const miss = [];
  for (let i = 1; i <= max; i++) if (!nums.has(i) && !(exc && exc.has(i))) miss.push(i);
  if (!miss.length) return null;
  let kind;
  if (ex.exclus.has(norm(s.e)) || max > MAX_NUM) kind = 'bruit';
  else if (miss.length <= Math.max(SMALL_ABS, Math.floor(max * SMALL_PART)) && nums.size > miss.length) kind = 'petit';
  else kind = 'gros';
  return { k: s.k, n: s.n, e: s.e, have: nums.size, max, miss, kind };
}

/** Tous les trous du catalogue, classés. extraOf(k) : numéros connus par ailleurs pour cette série. */
export function findGaps(series, extraOf = () => [], ex) {
  const out = { petit: [], gros: [], bruit: [] };
  for (const s of series) { const g = gapsOf(s, extraOf(s.k), ex); if (g) out[g.kind].push(g); }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.miss.length - b.miss.length || a.n.localeCompare(b.n, 'fr'));
  return out;
}
