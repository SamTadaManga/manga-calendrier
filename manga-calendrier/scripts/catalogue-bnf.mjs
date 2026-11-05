// Catalogue des séries de manga publiées en français (data/catalogue-bnf.json, produit par import-bnf.mjs à partir de la BnF).
// Une série : { k: adresse, n: nom, e: éditeur principal, p: autres éditeurs, v: [[tome, isbn, année, libellé?], …] }
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Compléments au catalogue : data/catalogue-ajouts.json, écrit par bnf-maj.mjs et trous-combler.mjs (le fichier du catalogue, lui, vient du CSV et peut être régénéré).
// { ajouts: [{ k, n, e, t: tome, isbn, y: année, src: 'bnf' | 'google', statut: 'ok' | 'a-valider', l?: libellé }] } : seuls les ajouts « ok » entrent dans le site.
export function readAjouts(dir) {
  try { const j = JSON.parse(readFileSync(path.join(dir, 'catalogue-ajouts.json'), 'utf8')); return { ...j, ajouts: Array.isArray(j.ajouts) ? j.ajouts : [] }; } catch { return { ajouts: [] }; }
}

export function loadBnf(dir) {
  let raw;
  try { raw = JSON.parse(readFileSync(path.join(dir, 'catalogue-bnf.json'), 'utf8')); } catch { raw = { series: [] }; }
  const list = (Array.isArray(raw?.series) ? raw.series : []).filter((s) => s && /^[a-z0-9-]{1,120}$/.test(s.k || '') && s.n && Array.isArray(s.v));
  const base = new Map(list.map((s) => [s.k, { ...s, v: [...s.v] }]));
  const seen = new Set(); for (const s of base.values()) for (const v of s.v) seen.add(v[1]);
  for (const a of readAjouts(dir).ajouts) {
    if (a.statut !== 'ok' || !/^[a-z0-9-]{1,120}$/.test(a.k || '') || !/^\d{13}$/.test(a.isbn || '') || seen.has(a.isbn)) continue;
    let s = base.get(a.k);
    if (!s) { if (!a.n) continue; s = { k: a.k, n: a.n, e: a.e || '', v: [] }; base.set(a.k, s); }
    s.v.push(a.l ? [String(a.t || ''), a.isbn, Number(a.y) || 0, a.l] : [String(a.t || ''), a.isbn, Number(a.y) || 0]);
    seen.add(a.isbn);
  }
  const series = [...base.values()].filter((s) => s.v.length).map((s) => { s.v.sort((x, y) => (Number(x[0]) || 1e6) - (Number(y[0]) || 1e6) || x[2] - y[2] || x[1].localeCompare(y[1])); return s; })
    .sort((a, b) => a.k.localeCompare(b.k));
  const byK = new Map(series.map((s) => [s.k, s]));
  const byIsbn = new Map();
  for (const s of series) for (const v of s.v) if (!byIsbn.has(v[1])) byIsbn.set(v[1], s);
  return { series, byK, byIsbn };
}

export const yearsOf = (s) => {
  const ys = s.v.map((v) => v[2]).filter(Boolean);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 0];
};
