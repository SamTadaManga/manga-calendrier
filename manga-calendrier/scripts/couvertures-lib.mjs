// Outils communs : ISBN-10 et liste des ISBN dont il faut chercher la couverture.
import { slugify } from './lib.mjs';
import { isIsbn13 } from './shops.mjs';

export const isbn10 = (i) => {
  if (!/^978\d{10}$/.test(i)) return '';
  const d = i.slice(3, 12);
  let t = 0;
  for (let k = 0; k < 9; k++) t += (10 - k) * Number(d[k]);
  const c = (11 - (t % 11)) % 11;
  return d + (c === 10 ? 'X' : c);
};

// Une édition par tome (la plus récente, celle que le site affiche). Ordre : sorties du calendrier, puis séries du catalogue
// des plus longues aux plus courtes. `skip(isbn)` écarte ceux qui ont déjà une couverture ou qu'il est inutile de retenter.
export function targets({ manga, bnf, skip = () => false }) {
  const out = []; const seen = new Set();
  const add = (isbn, serie, tome, editeur, annee, origine) => {
    if (!isIsbn13(isbn) || seen.has(isbn) || skip(isbn)) return;
    seen.add(isbn);
    out.push({ isbn, isbn10: isbn10(isbn), serie, tome, editeur, annee, origine });
  };
  for (const r of manga) add(r.isbn, r.serie, r.tome, r.editeur, (r.date || '').slice(0, 4), 'calendrier');
  for (const s of [...bnf.series].sort((a, b) => b.v.length - a.v.length)) {
    const best = new Map();
    for (const v of s.v) { const key = v[0] ? `t${v[0]}` : `l${v[3] || v[1]}`; const b = best.get(key); if (!b || v[2] > b[2]) best.set(key, v); }
    for (const v of best.values()) add(v[1], s.n, v[0], s.e, v[2] || '', 'catalogue');
  }
  return out;
}
export { slugify };
