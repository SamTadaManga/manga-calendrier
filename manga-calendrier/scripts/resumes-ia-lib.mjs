// Résumés réécrits par une IA locale : consigne, contrôle du texte produit, empreinte de la source. Sans effet de bord (importé aussi par build.mjs).
import { createHash } from 'node:crypto';

export const empreinte = (texte) => createHash('sha1').update(String(texte || '')).digest('hex').slice(0, 10);
const plat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Messages envoyés au modèle. x : { nom, auteurs, genres, editeur, source }. */
export function consigne(x) {
  const faits = [
    `Série : ${x.nom}`,
    x.auteurs?.length ? `Auteur(s) : ${x.auteurs.join(', ')}` : '',
    x.genres?.length ? `Genres : ${x.genres.join(', ')}` : '',
    x.editeur ? `Éditeur français : ${x.editeur}` : '',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: 'Tu rédiges des fiches pour un site français de sorties manga. Tu écris en français correct, sobre et factuel.' },
    { role: 'user', content: `Réécris le résumé ci-dessous en 2 ou 3 phrases (entre 250 et 550 caractères), avec tes propres mots.\nRègles strictes :\n- n'utilise que les informations données ci-dessous ; n'invente aucun nom, aucun chiffre, aucun fait ;\n- ne révèle pas la fin de l'histoire ;\n- pas de formule publicitaire, pas de titre, pas de guillemets, un seul paragraphe ;\n- réponds uniquement par le résumé réécrit.\n\n${faits}\n\nRésumé de l'éditeur : ${x.source}\n\n/no_think` },
  ];
}

const BAVARDAGE = /^(voici|bien sûr|bien sur|d'accord|résumé\s*:|reformulation|réécriture|ce résumé|le résumé)/i;
const ANGLAIS = /\b(the|and|with|his|her|their|which)\b/i;

/** Plus longue suite de mots identiques entre deux textes (mesure de la copie). */
export function suiteCommune(a, b) {
  const x = plat(a).split(' '), y = new Set(); const z = plat(b).split(' ');
  const idx = new Map(); z.forEach((w, i) => (idx.get(w) || idx.set(w, []).get(w)).push(i));
  let best = 0;
  for (let i = 0; i < x.length; i++) for (const j of idx.get(x[i]) || []) { let n = 0; while (x[i + n] !== undefined && x[i + n] === z[j + n]) n++; if (n > best) best = n; }
  void y; return best;
}

/**
 * Contrôle d'un texte produit par le modèle. Renvoie { ok: true, texte } ou { ok: false, motif }.
 * source : résumé de l'éditeur ; faits : texte de la fiche (nom, auteurs, genres) autorisé en plus.
 */
export function valider(sortie, source, faits = '') {
  let t = String(sortie || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^["«“]\s*|\s*["»”]$/g, '').trim();
  if (!t) return { ok: false, motif: 'vide' };
  if (/\n\s*\n/.test(t) || /^\s*[-*#•\d]+[.)]?\s/m.test(t)) return { ok: false, motif: 'mise en forme' };
  t = t.replace(/\s+/g, ' ');
  if (BAVARDAGE.test(t)) return { ok: false, motif: 'bavardage' };
  if (/https?:\/\/|www\./i.test(t)) return { ok: false, motif: 'lien' };
  const min = Math.min(150, Math.round(String(source).length * 0.5));
  if (t.length < Math.max(100, min) || t.length > 700) return { ok: false, motif: `longueur ${t.length}` };
  if (!/[.!?…]$/.test(t)) return { ok: false, motif: 'phrase coupée' };
  if (ANGLAIS.test(t) && !ANGLAIS.test(source)) return { ok: false, motif: 'anglais' };
  // noms propres et nombres : tous doivent venir de la source ou de la fiche
  const base = ` ${plat(`${source} ${faits}`)} `;
  for (const m of t.matchAll(/\p{Lu}[\p{L}'’-]*|\d+/gu)) {
    if (/^\p{Lu}/u.test(m[0]) && (m.index === 0 || /[.!?…:;]\s+$/.test(t.slice(0, m.index)))) continue; // début de phrase : majuscule normale
    const w = plat(m[0]);
    if (w.length > 1 && !base.includes(` ${w} `) && !base.includes(` ${w.replace(/s$/, '')} `)) return { ok: false, motif: `mot absent de la source : ${m[0]}` };
  }
  if (suiteCommune(t, source) >= 12) return { ok: false, motif: 'copie de la source' };
  return { ok: true, texte: t };
}
