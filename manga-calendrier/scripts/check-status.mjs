// Dernière étape du workflow : échoue (donc alerte GitHub) si une source clé n'a plus réussi depuis trop longtemps.
import { readStatus } from './status.mjs';
import { paths, now } from './lib.mjs';

const P = paths();
const MAX_DAYS = Number(process.env.MAX_STALE_DAYS || 3);
const KEY = ['Anime · AniList', 'Manga · Glénat', 'Manga · Kana', 'Manga · Pika', 'Manga · Ki-oon'];
const { sources } = readStatus(P.dataDir);
const late = [];
for (const [name, v] of Object.entries(sources)) {
  if (!KEY.includes(name)) continue;
  const days = v.lastSuccess ? (now().getTime() - new Date(v.lastSuccess).getTime()) / 864e5 : Infinity;
  if (days > MAX_DAYS) late.push(`${name} : ${v.lastSuccess ? `dernière réussite il y a ${Math.floor(days)} jours` : 'jamais réussi'}`);
}
if (late.length) {
  console.error(`Sources en retard de plus de ${MAX_DAYS} jours :\n- ${late.join('\n- ')}`);
  process.exit(1);
}
console.log('Sources clés à jour.');
