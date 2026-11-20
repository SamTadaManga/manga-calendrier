// Décisions « Ludum gagne » : quand le catalogue (BnF) ou le calendrier et la fiche Ludum d'un même ISBN se contredisent sur le numéro de tome
// ou sur la série, c'est Ludum qui fait foi. Les décisions sont calculées chaque nuit par scripts/base-isbn.mjs à partir des sources brutes et
// écrites dans data/isbn-ludum.json ; loadBnf() et loadAllManga() les appliquent ensuite (sans cycle : la base lit toujours les sources brutes).
// Format : { maj, isbn: { "<isbn13>": { t: "<tome>", k?: "<série d'arrivée>", x?: 1, n?: "<nom>", e?: "<éditeur>", a?: 1 } } }
//   x : l'ISBN quitte sa série du catalogue ; k : il rejoint la série k (créée avec le nom n et l'éditeur e si elle n'existe pas encore, seulement si n est donné) ;
//   a : l'ISBN n'est pas dans le catalogue, il y est ajouté dans la série k.
// Éditions : un titre Ludum « <série> - Tome N - <édition> » (Édition originale, Perfect Edition, Deluxe, Intégrale…) forme sa propre série « <série> - <édition> »,
// dont l'adresse (slugify) est celle du calendrier (« Yu-Gi-Oh! – Édition Millénium » -> yu-gi-oh-edition-millenium). Elle n'est créée que si l'édition est bien distincte : la série du calendrier
// existe déjà, ou la série d'origine contient déjà un autre ISBN pour le même numéro de tome (réédition). Sinon l'édition est la version courante de la série et rien ne change.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const plat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
// Même adresse que slugify() de lib.mjs (copiée ici pour éviter une dépendance circulaire)
export const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const PACK_ED = /\b(coffret|pack|box|lot|tomes\s+\d+\s*(à|a|et|&|-)\s*\d)/i;
const EDITION_OK = /(édition|edition|intégrale|integrale|deluxe|collection)/i;
const EDITION_KO = /(découverte|decouverte|offre|€|sens français|roman|coffret|pack|ancienne|paillettes)/i;
const PACK = /\b(coffret|pack|int[ée]grale|box|lot|collector|tomes\s+\d+\s*(à|a|et|&|-)\s*\d)/i;

/** Titre Ludum « <série> - Tome N … » -> { serie, tome } ; null pour un coffret, un pack ou un titre sans numéro. Le champ numero_tome du flux est ignoré : il contredit parfois ses propres titres. */
export function tomeLudum(nom) {
  const t = String(nom || '');
  if (PACK.test(t)) return null;
  const m = t.match(/^(.*?)\s*[-–:]\s*Tome\s+(\d{1,3})\b/i);
  if (!m || !m[1].trim()) return null;
  const n = Number(m[2]);
  return n >= 1 && n <= 300 ? { serie: m[1].trim(), tome: String(n) } : null;
}

/** Titre Ludum « <série> - Tome N - <édition> » -> { serie, tome, edition, k, nom } ; null si ce n'est pas une édition distincte (promotion, coffret, roman, sens de lecture…). */
export function editionLudum(nom) {
  const t = String(nom || '');
  if (PACK_ED.test(t)) return null;
  const m = t.match(/^(.+?) - Tome (\d{1,3}) - (.+)$/i);
  if (!m) return null;
  const e = m[3].trim(), n = Number(m[2]);
  if (!EDITION_OK.test(e) || EDITION_KO.test(e) || e.includes(' - ') || e.length > 60 || n < 1 || n > 300) return null;
  return { serie: m[1].trim(), tome: String(n), edition: e, k: slug(`${m[1]} ${e}`), nom: `${m[1].trim()} - ${e}` };
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
export function decider(bnf, fiches, calendrier = new Map(), seriesCalendrier = new Set()) {
  const parNom = new Map(bnf.series.map((s) => [plat(s.n), s]));
  const decisions = {};
  const prises = new Map(); // série -> tomes déjà pris par un autre ISBN
  for (const s of bnf.series) prises.set(s.k, new Map(s.v.map((v) => [String(v[1]), String(v[0] ?? '')])));
  const libre = (k, isbn, t) => ![...prises.get(k).entries()].some(([i, x]) => i !== isbn && x === t);

  // 1. Éditions distinctes (voir l'en-tête)
  const parIsbn = new Map();
  for (const s of bnf.series) for (const v of s.v) parIsbn.set(v[1], { s, v });
  const groupes = new Map();
  for (const [isbn, f] of Object.entries(fiches)) {
    const ed = editionLudum(f[0]);
    if (!ed) continue;
    const o = parIsbn.get(isbn);
    if (o && !memeSerie(ed.serie, o.s.n)) continue; // rangé dans une autre série : traité plus bas
    const g = groupes.get(ed.k) || groupes.set(ed.k, { ed, membres: [], ok: seriesCalendrier.has(ed.k) || bnf.byK.has(ed.k), reedition: false }).get(ed.k);
    g.membres.push({ isbn, t: ed.tome, o, f });
  }
  for (const g of groupes.values()) {
    const ids = new Set(g.membres.map((m) => m.isbn));
    for (const m of g.membres) if (m.o && m.o.s.v.some((v) => v[1] !== m.isbn && String(v[0]) === m.t && !ids.has(v[1]))) g.reedition = true; // réédition : le même numéro existe déjà dans la série d'origine
    // Édition distincte si le calendrier ou le catalogue en fait déjà une série ; sinon, si c'est une réédition d'au moins 2 tomes qui n'est pas la version dominante de la série
    // (plus de 60 % de ses ISBN : c'est alors la série elle-même, comme « Dorohedoro - Édition originale »).
    const parOrigine = new Map();
    for (const m of g.membres) if (m.o) parOrigine.set(m.o.s.k, (parOrigine.get(m.o.s.k) || 0) + 1);
    const dominante = [...parOrigine].some(([k, n]) => n > 0.6 * bnf.byK.get(k).v.length);
    if (!g.ok && !(g.reedition && g.membres.length >= 2 && !dominante)) continue;
    const arrivee = bnf.byK.get(g.ed.k);
    const deja = new Set(arrivee ? arrivee.v.map((v) => String(v[0])) : []);
    const eds = g.membres.find((m) => m.o);
    for (const m of [...g.membres].sort((a, b) => Number(a.t) - Number(b.t) || a.isbn.localeCompare(b.isbn))) {
      if (m.o && m.o.s.k === g.ed.k) continue;
      if (deja.has(m.t)) continue; // numéro déjà pris dans la série d'arrivée : pas de doublon
      deja.add(m.t);
      const e = (eds ? eds.o.s.e : m.f[1]) || '';
      decisions[m.isbn] = m.o ? { t: m.t, x: 1, k: g.ed.k, n: g.ed.nom, e } : { t: m.t, a: 1, k: g.ed.k, n: g.ed.nom, e };
    }
  }

  // 2. Numéro de tome et série
  for (const s of bnf.series) for (const v of s.v) {
    const isbn = v[1], f = fiches[isbn];
    if (decisions[isbn]) continue;
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
    for (const [i, d] of Object.entries(j.isbn || {})) if (/^\d{13}$/.test(i) && d && /^\d{1,3}$/.test(String(d.t || '')) && (d.k === undefined || /^[a-z0-9-]{1,120}$/.test(d.k))) {
      const n = typeof d.n === 'string' && d.n.length <= 120 && !/[\u0000-\u001f<>]/.test(d.n) ? d.n.trim() : '';
      const e = typeof d.e === 'string' && d.e.length <= 60 && !/[\u0000-\u001f<>]/.test(d.e) ? d.e.trim() : '';
      m.set(i, { t: String(d.t), k: d.k, x: d.x ? 1 : 0, a: d.a ? 1 : 0, n, e });
    }
    return m;
  } catch { return new Map(); }
}

/** Applique les décisions à la table des séries { k -> { n, e, v: [[tome, isbn, année, libellé?]] } } (modifiée sur place). */
export function appliquerDecisions(base, decisions) {
  if (!decisions.size) return;
  const arrivees = [];
  for (const s of base.values()) {
    s.v = s.v.flatMap((v) => {
      const d = decisions.get(v[1]);
      if (!d) return [v];
      if (!d.x) return [[d.t, ...v.slice(1)]];
      if (d.k) arrivees.push([d, [d.t, ...v.slice(1)]]);
      return [];
    });
  }
  for (const [isbn, d] of decisions) if (d.a && d.k) arrivees.push([d, [d.t, isbn, 0]]);
  for (const [d, v] of arrivees) {
    let t = base.get(d.k);
    if (!t && d.n) { t = { k: d.k, n: d.n, e: d.e || '', v: [] }; base.set(d.k, t); } // série d'édition créée
    if (t && !t.v.some((x) => x[1] === v[1])) t.v.push(v);
  }
}
