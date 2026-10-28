// Catalogue des séries de manga publiées en français (data/catalogue-bnf.json, produit par import-bnf.mjs à partir de la BnF).
// Une série : { k: adresse, n: nom, e: éditeur principal, p: autres éditeurs, v: [[tome, isbn, année, libellé?], …] }
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function loadBnf(dir) {
  let raw;
  try { raw = JSON.parse(readFileSync(path.join(dir, 'catalogue-bnf.json'), 'utf8')); } catch { return { series: [], byK: new Map(), byIsbn: new Map() }; }
  const series = (Array.isArray(raw?.series) ? raw.series : []).filter((s) => s && /^[a-z0-9-]{1,120}$/.test(s.k || '') && s.n && Array.isArray(s.v) && s.v.length);
  const byK = new Map(series.map((s) => [s.k, s]));
  const byIsbn = new Map();
  for (const s of series) for (const v of s.v) if (!byIsbn.has(v[1])) byIsbn.set(v[1], s);
  return { series, byK, byIsbn };
}

export const yearsOf = (s) => {
  const ys = s.v.map((v) => v[2]).filter(Boolean);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 0];
};
