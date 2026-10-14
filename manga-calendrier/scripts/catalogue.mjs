// Catalogue des tomes (data/catalogue.json, produit par collect-catalogue.mjs) : normalisation pour le site.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// « one-piece-edition-originale » -> série « one-piece », édition « Édition originale »
const EDITION = /-((?:nouvelle-|perfect-|ultimate-|deluxe-|collector-)?edition(?:-(?:originale|collector|deluxe|prestige|limitee|integrale|couleur|speciale))?|integrale|perfect|deluxe)$/;
const cap = (s) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function splitEdition(key) {
  const m = key.match(EDITION);
  return m && m.index > 0 ? { base: key.slice(0, m.index), edition: cap(m[1]).replace(/^Edition/, 'Édition').replace(/ edition/i, ' édition').replace(/Integrale/, 'Intégrale') } : { base: key, edition: '' };
}

const words = (k) => k.split('-').filter(Boolean).map((w) => (w.length > 2 || /^\d/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

export function loadCatalogue(dir) {
  let raw;
  try { raw = JSON.parse(readFileSync(path.join(dir, 'catalogue.json'), 'utf8')); } catch { return []; }
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items
    .filter((i) => i && /^97[89]\d{10}$/.test(i.isbn || '') && i.key)
    .map((i) => ({ ...splitEdition(String(i.key)), name: '', isbn: i.isbn, editeur: i.editeur || '', serie: i.serie || '', tome: /^\d{1,3}$/.test(i.tome || '') ? String(i.tome) : '', source: /^https:\/\//.test(i.source || '') ? i.source : '' }))
    .map((c) => ({ ...c, name: words(c.base) }));
}

// Couvertures trouvées par collect-covers.mjs : { isbn: { u: adresse https, d: date } }
export function loadCovers(dir) {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, 'covers.json'), 'utf8'));
    return new Map(Object.entries(raw).filter(([, v]) => /^https:\/\//.test(v?.u || '')).map(([k, v]) => [k, v.u]));
  } catch { return new Map(); }
}
