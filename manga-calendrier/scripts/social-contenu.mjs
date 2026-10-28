// Contenu pour les réseaux : choix des sorties et textes adaptés à chaque réseau (longueurs, liens, hashtags).
// Aucune requête réseau ici : tout vient des données du site (calendrier manga, épisodes d'anime).
import { slugify, addDays, weekdayOfKey, frLongDate, frDayMonth, isFirstVolume, NOT_NEW } from './lib.mjs';

export const PUBCOL = { glenat: '#0a4fd6', kana: '#d93a0b', pika: '#08804a', 'ki-oon': '#7a24c9', akata: '#c4177d', delcourt: '#0e7c86', soleil: '#b8860b', kaze: '#5c7f1a', kurokawa: '#3b3f4a', meian: '#8d5524', mangetsu: '#a61e4d', 'panini-manga': '#c92a2a', autre: '#5f6672' };
export const pubKey = (e) => { const k = slugify(e || ''); return k in PUBCOL ? k : 'autre'; };
const SPECIAL = /collector|coffret|int[ée]grale|artbook|deluxe|prestige|perfect|fanbook/i;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const tag = (s) => `#${slugify(s).replace(/-/g, '')}`;
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

/** Une sortie prête à afficher. */
const item = (r) => ({
  serie: r.serie, tome: r.tome || '', editeur: r.editeur || '', color: PUBCOL[pubKey(r.editeur)],
  cover: /^https:\/\//.test(r.cover || '') ? r.cover : '', nouveau: isFirstVolume(r), special: SPECIAL.test(`${r.serie} ${r.titre || ''}`), date: r.date,
});
const label = (i) => `${i.serie}${i.tome ? ` T${i.tome}` : ''}`;

/** Ordre d'affichage : nouvelles séries d'abord, puis éditions spéciales, puis celles qui ont une couverture, une série une seule fois. */
export function pick(rows, n) {
  const seen = new Set();
  return rows.map(item)
    .sort((a, b) => (Number(b.nouveau) - Number(a.nouveau)) || (Number(b.special) - Number(a.special)) || (Number(!!b.cover) - Number(!!a.cover)) || label(a).localeCompare(label(b), 'fr'))
    .filter((i) => { const k = slugify(i.serie); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
}

const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const wdName = (k) => WD[weekdayOfKey(k)];
const dm = (k) => frDayMonth(k).replace(/^\S+\s/, ''); // « 4 novembre » sans le jour de la semaine

/**
 * Compose le contenu d'un type de publication : 'jour' (le jour même, ou la prochaine vague s'il n'y a rien),
 * 'semaine' (7 jours à partir d'aujourd'hui) ou 'nouveautes' (tomes 1 des 14 prochains jours).
 * Renvoie null s'il n'y a rien d'intéressant à dire.
 */
export function compose({ kind, today, manga, anime, site }) {
  const live = manga.filter((r) => r.statut !== 'annule' && r.date);
  const base = (site || '').replace(/\/+$/, '');
  let rows, d;
  if (kind === 'jour') {
    rows = live.filter((r) => r.date === today);
    if (rows.length) d = { mode: 'jour', title: ['AUJOURD’HUI', 'EN MANGA'], sticker: plural(rows.length, 'SORTIE', 'SORTIES'), when: frDayMonth(today), path: '/semaine/' };
    else {
      const next = [...new Set(live.filter((r) => r.date > today && r.date <= addDays(today, 10)).map((r) => r.date))].sort()[0];
      if (!next) return null;
      rows = live.filter((r) => r.date === next);
      const dd = Math.round((Date.parse(next) - Date.parse(today)) / 864e5);
      d = { mode: 'prochain', title: [dd === 1 ? 'DEMAIN' : `${wdName(next).toUpperCase()}`, 'EN MANGA'], sticker: dd === 1 ? plural(rows.length, 'SORTIE', 'SORTIES') : `DANS ${dd} JOURS`, when: frDayMonth(next), path: '/semaine/' };
    }
  } else if (kind === 'semaine') {
    const to = addDays(today, 6);
    rows = live.filter((r) => r.date >= today && r.date <= to);
    d = { mode: 'semaine', title: ['CETTE SEMAINE', 'EN MANGA'], sticker: plural(rows.length, 'SORTIE', 'SORTIES'), when: `du ${dm(today)} au ${dm(to)}`, path: '/semaine/' };
  } else if (kind === 'nouveautes') {
    const to = addDays(today, 14);
    rows = live.filter((r) => r.date >= today && r.date <= to && isFirstVolume(r) && !NOT_NEW.test(r.titre || ''));
    d = { mode: 'nouveautes', title: ['NOUVELLES', 'SÉRIES'], sticker: 'TOME 1', when: `les 14 prochains jours`, path: '/nouveautes/' };
  } else return null;
  if (!rows.length) return null;

  const total = new Set(rows.map((r) => slugify(r.serie) + '#' + r.tome)).size;
  const items = pick(rows, 24);
  const eps = (anime?.episodes || []).filter((e) => new Date(e.airingAt * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) === today);
  const firsts = eps.filter((e) => e.episode === 1);
  const animeLine = eps.length && (kind === 'jour') ? `${plural(eps.length, 'épisode d’anime', 'épisodes d’anime')} aujourd’hui${firsts.length ? `, dont ${plural(firsts.length, 'premier', 'premiers')}` : ''}` : '';
  const key = `${kind}-${today}`;
  const link = (src) => `${base}${d.path}?utm_source=${src}&utm_medium=social&utm_campaign=${kind}`;
  const pubs = [...new Set(items.map((i) => i.editeur).filter(Boolean))];
  const lines = items.map((i) => `${label(i)} (${i.editeur || 'éditeur ?'})`);
  const head = { jour: `Aujourd’hui en manga : ${plural(total, 'sortie', 'sorties')}`, prochain: `${frDayMonth(items[0].date)} : ${plural(total, 'sortie manga', 'sorties manga')}`, semaine: `Cette semaine en manga : ${plural(total, 'sortie', 'sorties')}`, nouveautes: `Nouvelles séries à découvrir : ${plural(total, 'tome 1', 'tomes 1')} à venir` }[d.mode];

  // Liste qui tient dans la limite du réseau
  const fit = (max, prefix, suffix, bullet = '• ') => {
    const out = []; let used = prefix.length + suffix.length + 2;
    for (const l of lines) {
      const t = `${bullet}${l}`; const more = `\n+ ${lines.length - out.length - 1} autres`;
      if (used + t.length + 1 + (lines.length - out.length - 1 > 0 ? more.length : 0) > max) break;
      out.push(t); used += t.length + 1;
    }
    const rest = lines.length - out.length;
    return `${prefix}\n${out.join('\n')}${rest > 0 ? `\n+ ${rest} autres` : ''}${suffix}`;
  };
  const alt = `${head}. ${lines.slice(0, 6).join(', ')}.`;
  const hashtags = ['#manga', '#mangafr', d.mode === 'nouveautes' ? '#nouveautemanga' : '#sortiemanga', '#calendrier', ...pubs.slice(0, 4).map(tag)];
  if (animeLine) hashtags.push('#anime');

  const shown = `${base.replace(/^https?:\/\//, '')}${d.path.replace(/\/$/, '')}`; // texte visible ; le lien réel (avec suivi) est porté par la facette
  const text = {
    bluesky: fit(300 - 4, head, `${animeLine ? `\n${animeLine}` : ''}\n\n${shown}`),
    // sur X une adresse compte pour 23 caractères quelle que soit sa longueur
    x: fit(280 - 24, head, `${animeLine ? `\n${animeLine}` : ''}\n\n`),
    instagram: `${head} 📚\n\n${lines.slice(0, 10).map((l) => `• ${l}`).join('\n')}${lines.length > 10 ? `\n+ ${lines.length - 10} autres` : ''}${animeLine ? `\n\n📺 ${animeLine}` : ''}\n\nToutes les dates, par éditeur, et le suivi de ta collection : ${base.replace(/^https?:\/\//, '')} (lien dans la bio)\n\n${hashtags.join(' ')} #mangaaddict #lecturemanga #bdfr`,
    tiktok: clip(`${head} 📚 Tout le calendrier : ${base.replace(/^https?:\/\//, '')} (lien en bio)`, 120) + ` ${hashtags.slice(0, 5).join(' ')} #fyp #mangatok #booktok`,
    pinterest: { title: clip(`${head} | ${d.when}`, 100), description: clip(`${lines.slice(0, 12).join(', ')}. Le calendrier des sorties manga en France, par éditeur, avec liens d’achat. ${hashtags.slice(0, 6).join(' ')}`, 500), link: link('pinterest') },
  };
  text.x += link('x');
  text.blueskyLink = { text: shown, uri: link('bluesky') };
  return { key, kind, ...d, date: today, total, items, lines, alt, animeLine, text, links: { site: base, page: link('site') } };
}
export { label, plural, frLongDate };
