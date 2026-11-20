// Décisions « Ludum gagne » : quand le catalogue (BnF) ou le calendrier et la fiche Ludum d'un même ISBN se contredisent sur le numéro de tome
// ou sur la série, c'est Ludum qui fait foi. Les décisions sont calculées chaque nuit par scripts/base-isbn.mjs à partir des sources brutes et
// écrites dans data/isbn-ludum.json ; loadBnf() et loadAllManga() les appliquent ensuite (sans cycle : la base lit toujours les sources brutes).
// Format : { maj, isbn: { "<isbn13>": { t: "<tome>", k?: "<série d'arrivée>", x?: 1 } } }  — x : l'ISBN quitte sa série du catalogue ; k : il rejoint la série k si elle existe.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const plat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const PACK = /\b(coffret|pack|int[ée]grale|box|lot|collector|tomes?\s+\d+\s*(à|a|et|&|-))/i;

/** Titre Ludum « <série> - Tome N … » -> { serie, tome } ; null pour un coffret, un pack ou un titre sans numéro. Le champ numero_tome du flux est ignoré : il contredit parfois ses propres titres. */
export function tomeLudum(nom) {
  const t = String(nom || '');
  if (PACK.test(t)) return null;
  const m = t.match(/^(.*?)\s*[-–:]\s*Tome\s+(\d{1,3})\b/i);
  if (!m || !m[1].trim()) return null;
  const n = Number(m[2]);
  return n >= 1 && n <= 300 ? { serie: m[1].trim(), tome: String(n) } : null;
}

/** Les deux noms de série désignent-ils la même série ? (identiques, l'un commence par l'autre, ou un mot de 3 lettres ou plus en commun) */
export function memeSerie(a, b) {
  const x = plat(a), y = plat(b);
  if (!x || !y) return true;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  const cx = x.replace(/ /g, ''), cy = y.replace(/ /g, ''); // « Inu Yasha » / « InuYasha », « Hina matsuri » / « Hinamatsuri »
  if (cx === cy || (Math.min(cx.length, cy.length) >= 4 && (cx.startsWith(cy) || cy.startsWith(cx)))) return true;
  const mots = new Set(x.split(' ').filter((w) => w.length >= 3));
  return y.split(' ').some((w) => w.length >= 3 && mots.has(w));
}

/** Décisions à partir du catalogue brut (loadBnf(dir, { brut: true })), des fiches Ludum { isbn: [titre, éditeur, date, état, prix, n°] } et du calendrier { isbn: tome }. */
export function decider(bnf, fiches, calendrier = new Map()) {
  const parNom = new Map(bnf.series.map((s) => [plat(s.n), s]));
  const decisions = {};
  const prises = new Map(); // série -> tomes déjà pris par un autre ISBN
  for (const s of bnf.series) prises.set(s.k, new Map(s.v.map((v) => [String(v[1]), String(v[0] ?? '')])));
  const libre = (k, isbn, t) => ![...prises.get(k).entries()].some(([i, x]) => i !== isbn && x === t);
  for (const s of bnf.series) for (const v of s.v) {
    const isbn = v[1], f = fiches[isbn];
    const l = f && tomeLudum(f[0]);
    if (!l) continue;
    const tc = calendrier.get(isbn);
    if (!memeSerie(l.serie, s.n)) {
      const cible = parNom.get(plat(l.serie)) || [...parNom.values()].find((x) => memeSerie(l.serie, x.n) && plat(x.n) !== plat(s.n) && (plat(l.serie).startsWith(plat(x.n)) || plat(x.n).startsWith(plat(l.serie))));
      const d = { t: l.tome, x: 1 };
      if (cible && libre(cible.k, isbn, l.tome)) d.k = cible.k;
      decisions[isbn] = d;
    } else if (String(v[0] ?? '') !== l.tome || (tc !== undefined && String(tc) !== l.tome)) {
      if (!libre(s.k, isbn, l.tome)) continue; // un autre ISBN de la série porte déjà ce numéro : on ne crée pas de doublon
      decisions[isbn] = { t: l.tome };
      prises.get(s.k).set(isbn, l.tome);
    }
  }
  return decisions;
}

export function lireDecisions(dir) {
  try {
    const j = JSON.parse(readFileSync(path.join(dir, 'isbn-ludum.json'), 'utf8'));
    const m = new Map();
    for (const [i, d] of Object.entries(j.isbn || {})) if (/^\d{13}$/.test(i) && d && /^\d{1,3}$/.test(String(d.t || '')) && (d.k === undefined || /^[a-z0-9-]{1,120}$/.test(d.k))) m.set(i, { t: String(d.t), k: d.k, x: d.x ? 1 : 0 });
    return m;
  } catch { return new Map(); }
}

/** Applique les décisions à la table des séries { k -> { v: [[tome, isbn, année, libellé?]] } } (modifiée sur place). */
export function appliquerDecisions(base, decisions) {
  if (!decisions.size) return;
  const arrivees = [];
  for (const s of base.values()) {
    s.v = s.v.flatMap((v) => {
      const d = decisions.get(v[1]);
      if (!d) return [v];
      if (!d.x) return [[d.t, ...v.slice(1)]];
      if (d.k) arrivees.push([d.k, [d.t, ...v.slice(1)]]);
      return [];
    });
  }
  for (const [k, v] of arrivees) { const t = base.get(k); if (t && !t.v.some((x) => x[1] === v[1])) t.v.push(v); }
}
