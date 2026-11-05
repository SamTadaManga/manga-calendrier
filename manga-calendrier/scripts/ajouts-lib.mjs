// Écriture des compléments du catalogue (data/catalogue-ajouts.json) : un ISBN n'y figure qu'une fois.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readAjouts } from './catalogue-bnf.mjs';

export const flat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Éditeurs dont tout le catalogue est du manga : leurs nouvelles séries peuvent entrer sans autre contrôle. */
export const EDITEURS_MANGA = ['ki oon', 'kurokawa', 'akata', 'meian', 'mangetsu', 'taifu comics', 'nobi nobi', 'komikku', 'ototo', 'doki doki', 'kaze', 'tonkam', 'mana books', 'kbooks', 'crunchyroll', 'vega dupuis', 'lezard noir', 'noeve grafx', 'hot manga', 'asuka', 'panini manga'];
export const isEditeurManga = (e) => EDITEURS_MANGA.includes(flat(e).replace(/^editions? /, '').replace(/ editions?$/, ''));
/** Les deux noms d'éditeur désignent-ils la même maison ? */
export const memeEditeur = (a, b) => { const x = flat(a), y = flat(b); return Boolean(x && y && (x === y || x.includes(y) || y.includes(x))); };

/** Ajoute des compléments sans doublon d'ISBN ; renvoie le nombre réellement ajouté. */
export function saveAjouts(dir, nouveaux, date = new Date().toISOString().slice(0, 10)) {
  const cur = readAjouts(dir);
  const seen = new Set(cur.ajouts.map((a) => a.isbn));
  const add = nouveaux.filter((a) => a.isbn && !seen.has(a.isbn) && seen.add(a.isbn));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'catalogue-ajouts.json'), JSON.stringify({ maj: date, ajouts: [...cur.ajouts, ...add] }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
  return add.length;
}

/** Change le statut des compléments qui répondent au filtre (par exemple valider les ajouts « a-valider »). Renvoie le nombre modifié. */
export function majStatut(dir, filtre, statut, date = new Date().toISOString().slice(0, 10)) {
  const cur = readAjouts(dir);
  let n = 0;
  const ajouts = cur.ajouts.map((a) => (filtre(a) && a.statut !== statut ? (n++, { ...a, statut }) : a));
  if (n) writeFileSync(path.join(dir, 'catalogue-ajouts.json'), JSON.stringify({ maj: date, ajouts }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
  return n;
}
