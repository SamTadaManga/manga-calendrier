// Contenu réservé aux adultes (18+) : un seul endroit décide ce qui est retiré du site (calendrier, catalogue, recherche, flux, réseaux, couvertures).
// Trois sources, toutes lues ici :
//   data/contenu-adulte.json       (à la main, jamais réécrit par un script) :
//        { "editeurs": ["Nom du label adulte"], "series": { "adresse-de-la-serie": "motif" }, "isbn": ["978…"], "conserver": { "adresse-de-la-serie": "faux positif" } }
//   data/contenu-adulte-auto.json  (produit par « Liens Cultura » / adulte-analyse.mjs) : séries repérées par leur description.
//   data/contenu-adulte-images.json (produit par « Contrôle des couvertures ») : séries dont les couvertures sont classées adultes par le modèle d'image.
//   Les règles ci-dessous : labels adultes connus et titres explicites.
// « conserver » l'emporte toujours : c'est la liste des faux positifs confirmés par une personne.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const flat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Labels dont le catalogue est destiné aux adultes (vérifié sur les titres de leurs séries). */
export const EDITEURS_ADULTES = ['Hot manga', 'Dynamite', 'Niho niba', 'SEEBD', 'La Musardine'];
/** Mots qui, dans le TITRE d'une série, la désignent comme explicite. */
export const TITRE_EXPLICITE = /\b(hentai|porno\w*|pornograph\w*|bondage|nsfw|bdsm|lewd|nympho\w*|fellation|sex\w*)\b/i;
/** Mots d'une description qui suffisent à la classer adulte : l'œuvre se dit elle-même hentai. */
export const TEXTE_ADULTE = /\bhentai\b/i;
/** Repères plus faibles : la série est proposée à la relecture, pas retirée. */
export const TEXTE_A_REVOIR = [
  ['porno', /pornograph|\bporno\b/i], ['erotique', /érotis|érotique|erotic/i], ['xxx', /\bxxx\b|\+\s*18\b|\b18\s*\+|réservé aux (?:adultes|plus de 18|majeurs)|public (?:adulte|majeur)|interdit aux (?:moins de 18|mineurs)/i],
  ['explicite', /scènes? (?:de sexe|de cul|sexuelles?|torrides?|hot|érotiques?)|sexe (?:torride|explicite)|orgasm|masturb|fellation|relations? sexuelles?|rapports? sexuels?|actes? sexuels?|sexe oral|nu(?:e|s|es)? intégral/i],
  ['kink', /bondage|\bbdsm\b|\bsado-?maso|fétichis|domination et soumission|esclave sexuel|dressage sexuel/i], ['lascif', /lubrique|lascive?|libidineu|salace|obscène|dépravé|débauche|luxure/i],
];

const lire = (dir, nom) => { try { return JSON.parse(readFileSync(path.join(dir, nom), 'utf8')); } catch { return {}; } };

/** Charge les réglages. dir vide : seulement les règles intégrées. */
export function chargerAdulte(dir) {
  const man = dir ? lire(dir, 'contenu-adulte.json') : {};
  const auto = dir ? lire(dir, 'contenu-adulte-auto.json') : {};
  const img = dir ? lire(dir, 'contenu-adulte-images.json') : {};
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return {
    editeurs: new Set([...EDITEURS_ADULTES, ...(Array.isArray(man.editeurs) ? man.editeurs : [])].map(flat)),
    series: new Set([...Object.keys(obj(man.series)), ...Object.keys(obj(auto.series)), ...Object.keys(obj(img.series))]),
    isbn: new Set((Array.isArray(man.isbn) ? man.isbn : []).map(String)),
    conserver: new Set(Object.keys(obj(man.conserver))),
  };
}

/** Une série ou un tome est-il à retirer ? x : { editeur, serie, slug, isbn } (tous facultatifs). */
export function estAdulte(cfg, x = {}) {
  const k = x.slug || slug(x.serie);
  if (k && cfg.conserver.has(k)) return false;
  if (x.isbn && cfg.isbn.has(String(x.isbn))) return true;
  if (k && cfg.series.has(k)) return true;
  if (x.editeur && cfg.editeurs.has(flat(x.editeur))) return true;
  return Boolean(x.serie && TITRE_EXPLICITE.test(String(x.serie)));
}

/** Analyse du texte d'une série : { exclure: motif | '', revoir: [repères] }. */
export function analyserTexte(titre, texte) {
  if (TITRE_EXPLICITE.test(titre)) return { exclure: 'titre explicite', revoir: [] };
  if (TEXTE_ADULTE.test(texte)) return { exclure: 'description : hentai', revoir: [] };
  return { exclure: '', revoir: TEXTE_A_REVOIR.filter(([, re]) => re.test(texte)).map(([n]) => n) };
}
