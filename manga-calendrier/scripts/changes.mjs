// Mémoire des sorties déjà vues (data/changes.json) pour repérer ce qui change d'un jour à l'autre :
//   - date : une sortie à venir change de date (reportée ou avancée)
//   - nouveau : un tome à venir apparaît dans un planning déjà connu
//   - retire : un tome à venir disparaît du planning de son éditeur pendant 3 collectes d'affilée
// Premier passage : on mémorise tout sans rien annoncer. Un éditeur qui ne répond pas est ignoré ce jour-là.
import { readFileSync, existsSync } from 'node:fs';
import { slugify, addDays } from './lib.mjs';

export const keyOf = (r) =>
  (r.isbn && r.isbn.length >= 10 ? `i:${r.isbn}` : `s:${slugify(r.serie)}|${r.tome}|${slugify(r.titre || '')}`);

export const emptyState = () => ({ version: 1, since: null, updated: null, seen: {}, events: [] });

export function readChanges(file) {
  if (!existsSync(file)) return emptyState();
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return { ...emptyState(), ...j, seen: j.seen && typeof j.seen === 'object' ? j.seen : {}, events: Array.isArray(j.events) ? j.events : [] };
  } catch {
    return emptyState();
  }
}

export function updateChanges(state, rows, okPublishers, today) {
  const st = JSON.parse(JSON.stringify(state));
  const seed = !st.since;
  if (!st.since) st.since = today;

  const maxMonth = {};
  for (const s of Object.values(st.seen)) {
    const m = s.d.slice(0, 7);
    if (!maxMonth[s.e] || m > maxMonth[s.e]) maxMonth[s.e] = m;
  }

  const observed = new Set();
  for (const r of rows) {
    if (!okPublishers.has(r.editeur)) continue;
    const k = keyOf(r);
    observed.add(k);
    const info = { e: r.editeur, s: r.serie, t: r.tome, u: r.source || '' };
    const known = st.seen[k];
    if (!known) {
      st.seen[k] = { ...info, d: r.date, f: today, m: 0 };
      // un tome situé après le dernier mois connu de l'éditeur est l'arrivée d'un nouveau mois dans la fenêtre, pas une annonce
      if (!seed && maxMonth[r.editeur] && r.date >= today && r.date.slice(0, 7) <= maxMonth[r.editeur]) {
        st.events.push({ day: today, type: 'nouveau', k, ...info, to: r.date });
      }
    } else {
      if (known.d !== r.date && known.d >= today && r.date >= today) {
        st.events.push({ day: today, type: 'date', k, ...info, from: known.d, to: r.date });
      }
      Object.assign(known, info, { d: r.date, m: 0, x: false });
    }
  }

  for (const [k, s] of Object.entries(st.seen)) {
    if (observed.has(k) || !okPublishers.has(s.e) || s.d < today) continue;
    s.m = (s.m || 0) + 1;
    if (s.m >= 3 && !s.x) {
      st.events.push({ day: today, type: 'retire', k, e: s.e, s: s.s, t: s.t, u: s.u, from: s.d });
      s.x = true;
    }
  }

  const oldest = addDays(today, -60);
  for (const [k, s] of Object.entries(st.seen)) if (s.d < oldest) delete st.seen[k];
  const evOldest = addDays(today, -90);
  st.events = st.events.filter((e) => e.day >= evOldest).slice(-400);
  st.updated = today;
  return st;
}

// Une clé par ligne : l'historique Git reste lisible
export function serializeChanges(st) {
  const keys = Object.keys(st.seen).sort();
  return '{\n'
    + `"version": 1,\n"since": ${JSON.stringify(st.since)},\n"updated": ${JSON.stringify(st.updated)},\n`
    + `"events": [\n${st.events.map((e) => JSON.stringify(e)).join(',\n')}\n],\n`
    + `"seen": {\n${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(st.seen[k])}`).join(',\n')}\n}\n}\n`;
}
