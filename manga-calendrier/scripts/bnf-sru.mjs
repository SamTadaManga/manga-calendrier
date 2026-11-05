// Client du service SRU du catalogue général de la BnF (https://catalogue.bnf.fr/api/SRU, ouvert à tous, sans identifiant).
// Documentation : https://www.bnf.fr/fr/service-sru-catalogue-general-de-la-bnf — index bib.title, bib.publisher, bib.isbn, bib.creationdate…
// Fonctions pures (analyse du XML UNIMARC) + une requête polie : 1 par seconde, nouvelle tentative en cas d'erreur passagère.
import { decode } from './collectors.mjs';
import { isIsbn13 } from './shops.mjs';

export const SRU_URL = process.env.BNF_SRU_URL || 'https://catalogue.bnf.fr/api/SRU'; // BNF_SRU_URL : serveur de test
const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties ; mise à jour du catalogue)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Texte d'une requête CQL : guillemets retirés (ils casseraient la requête). */
export const cql = (s) => String(s || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();

const sub = (xml, tag) => {
  const out = {};
  const re = new RegExp(`<(?:\\w+:)?datafield\\b[^>]*\\btag="${tag}"[^>]*>([\\s\\S]*?)</(?:\\w+:)?datafield>`, 'g');
  for (const m of xml.matchAll(re)) {
    for (const s of m[1].matchAll(/<(?:\w+:)?subfield\b[^>]*\bcode="(\w)"[^>]*>([\s\S]*?)<\/(?:\w+:)?subfield>/g)) {
      const v = decode(s[2].replace(/<[^>]+>/g, ''));
      if (v) (out[s[1]] ||= []).push(v);
    }
  }
  return out;
};

const isbn13Of = (raw) => {
  const d = String(raw || '').replace(/[^0-9Xx]/g, '');
  return d.length === 13 && isIsbn13(d) ? d : '';
};

/** Une notice UNIMARC (XML) -> { ark, isbn, titre, tome, partie, editeur, annee, collection }. */
export function parseNotice(xml) {
  const ark = (xml.match(/<(?:\w+:)?controlfield\b[^>]*\btag="003"[^>]*>([^<]*)</) || [])[1] || '';
  const f010 = sub(xml, '010'), f073 = sub(xml, '073'), f200 = sub(xml, '200'), f210 = sub(xml, '210'), f225 = sub(xml, '225');
  const isbn = [...(f010.a || []), ...(f073.a || [])].map(isbn13Of).find(Boolean) || '';
  const partie = (f200.h || [])[0] || '';
  const tome = (partie.match(/(?:^|\D)(\d{1,3})(?:\D|$)/) || [])[1] || '';
  const annee = ((f210.d || [])[0] || '').match(/(19|20)\d{2}/)?.[0] || '';
  return { ark: ark.trim(), isbn, titre: (f200.a || [])[0] || '', tome: tome ? String(Number(tome)) : '', partie, editeur: (f210.c || [])[0] || '', annee: annee ? Number(annee) : 0, collection: (f225.a || [])[0] || '' };
}

/** Réponse SRU complète -> { total, notices }. */
export function parseReponse(xml) {
  const total = Number((xml.match(/<(?:\w+:)?numberOfRecords>(\d+)</) || [])[1] || 0);
  const notices = [...xml.matchAll(/<(?:\w+:)?recordData>([\s\S]*?)<\/(?:\w+:)?recordData>/g)].map((m) => parseNotice(m[1]));
  return { total, notices };
}

/**
 * Cherche dans le catalogue. query : requête CQL. Renvoie toutes les notices (par pages de 100, jusqu'à `max`).
 * opts : { max = 300, fetchFn = fetch, pause = 1000 }
 */
export async function sru(query, { max = 300, fetchFn = fetch, pause = Number(process.env.BNF_PAUSE ?? 1000) } = {}) {
  const out = [];
  let start = 1, total = Infinity;
  while (start <= total && out.length < max) {
    const url = `${SRU_URL}?version=1.2&operation=searchRetrieve&recordSchema=unimarcxchange&maximumRecords=100&startRecord=${start}&query=${encodeURIComponent(query)}`;
    let xml = '', lastErr;
    for (let k = 0; k < 3 && !xml; k++) {
      if (pause) await sleep(pause * (k + 1));
      try {
        const r = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' }, signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(`BnF ${r.status}`);
        xml = await r.text();
      } catch (e) { lastErr = e; }
    }
    if (!xml) throw lastErr || new Error('BnF : pas de réponse');
    if (/<(?:\w+:)?diagnostic\b/.test(xml) && !/<(?:\w+:)?recordData>/.test(xml)) {
      const msg = (xml.match(/<(?:\w+:)?message>([^<]*)</) || [])[1] || (xml.match(/<(?:\w+:)?details>([^<]*)</) || [])[1] || 'requête refusée';
      throw new Error(`BnF : ${decode(msg)}`);
    }
    const p = parseReponse(xml);
    total = p.total;
    if (!p.notices.length) break;
    out.push(...p.notices);
    start += 100;
  }
  return out.slice(0, max);
}
