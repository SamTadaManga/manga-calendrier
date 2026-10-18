// Traduit en français les synopsis d'anime (AniList, en anglais) -> data/synopsis-fr.json
// Une seule traduction par anime (mémorisée) : un synopsis déjà traduit n'est jamais retraduit tant que le texte anglais ne change pas.
// Fournisseurs, selon la clé disponible (secrets GitHub) :
//   DEEPL_API_KEY      -> DeepL (offre gratuite : 500 000 caractères par mois)
//   ANTHROPIC_API_KEY  -> Claude (quelques centimes par mois)
//   (aucune clé)       -> MyMemory, gratuit et sans compte : 5 000 caractères par jour (50 000 si MYMEMORY_EMAIL est renseigné),
//                         qualité correcte mais inférieure ; la traduction se fait donc sur plusieurs jours.
// TRANSLATE_PROVIDER=none désactive la traduction (le site affiche alors le synopsis en anglais).
// Test hors ligne : TRANSLATE_MOCK=fichier.json (objet { "texte anglais": "texte français" })
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { paths, readAnime } from './lib.mjs';

const P = paths();
const BUDGET = Number(process.env.TRANSLATE_PER_RUN || 80);
const hash = (t) => createHash('sha1').update(t).digest('hex').slice(0, 12);

const file = path.join(P.dataDir, 'synopsis-fr.json');
let cache = {};
try { cache = JSON.parse(readFileSync(file, 'utf8')); } catch { /* premier passage */ }

const wanted = new Map();
for (const e of readAnime(P.dataDir).episodes) if (e.synopsis && !wanted.has(e.mediaId)) wanted.set(e.mediaId, e.synopsis);
const todo = [...wanted].filter(([id, en]) => cache[id]?.h !== hash(en)).slice(0, BUDGET);

async function deepl(texts) {
  const key = process.env.DEEPL_API_KEY;
  const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const body = new URLSearchParams();
  for (const t of texts) body.append('text', t);
  body.set('source_lang', 'EN');
  body.set('target_lang', 'FR');
  const res = await fetch(`https://${host}/v2/translate`, { method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${key}`, 'User-Agent': 'manga-calendrier/1.0' }, body });
  if (!res.ok) throw new Error(`DeepL : code ${res.status}`);
  const j = await res.json();
  return (j.translations || []).map((x) => x.text);
}

async function claude(texts) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 4000,
      messages: [{ role: 'user', content: `Traduis en français naturel ces résumés d'anime (ton neutre, sans rien ajouter ni retirer, noms propres inchangés). Réponds uniquement par un tableau JSON de ${texts.length} chaînes, dans le même ordre.\n\n${JSON.stringify(texts)}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude : code ${res.status}`);
  const j = await res.json();
  const txt = (j.content || []).map((c) => c.text || '').join('');
  const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('Claude : réponse inattendue');
  return arr.map(String);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unent = (t) => String(t).replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// MyMemory limite chaque requête à 500 octets : on découpe par phrases
function chunks(text, max = 420) {
  const out = [];
  let cur = '';
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    if (cur && Buffer.byteLength(`${cur} ${part}`) > max) { out.push(cur); cur = part; } else cur = cur ? `${cur} ${part}` : part;
  }
  if (cur) out.push(cur);
  return out;
}
async function mymemory(texts) {
  const out = [];
  for (const text of texts) {
    const parts = [];
    for (const c of chunks(text)) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(c)}&langpair=en%7Cfr${process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : ''}`;
      await sleep(1000);
      const res = await fetch(url, { headers: { 'User-Agent': 'manga-calendrier/1.0' } });
      if (!res.ok) throw new Error(`MyMemory : code ${res.status}`);
      const j = await res.json();
      const t = String(j.responseData?.translatedText || '');
      if (Number(j.responseStatus) !== 200 || /^MYMEMORY WARNING/i.test(t)) throw new Error('MyMemory : quota du jour atteint');
      parts.push(unent(t));
    }
    out.push(parts.join(' '));
  }
  return out;
}

let translate = null;
let provider = '';
if (process.env.TRANSLATE_MOCK) {
  const mock = JSON.parse(readFileSync(path.resolve(process.env.TRANSLATE_MOCK), 'utf8'));
  translate = async (texts) => texts.map((t) => mock[t] || '');
  provider = 'simulé';
} else if (process.env.TRANSLATE_PROVIDER === 'none') { /* désactivé */ }
else if (process.env.DEEPL_API_KEY) { translate = deepl; provider = 'DeepL'; }
else if (process.env.ANTHROPIC_API_KEY) { translate = claude; provider = 'Claude'; }
else { translate = mymemory; provider = 'MyMemory'; }

if (!translate) {
  console.log('Traduction désactivée (TRANSLATE_PROVIDER=none) : les synopsis restent en anglais.');
  process.exit(0);
}

let done = 0;
try {
  const size = provider === 'MyMemory' ? 1 : 10;
  for (let i = 0; i < todo.length; i += size) {
    const batch = todo.slice(i, i + size);
    const out = await translate(batch.map(([, en]) => en));
    batch.forEach(([id, en], k) => {
      const fr = String(out[k] || '').trim();
      if (fr && fr.length > 20 && fr.length < en.length * 3) { cache[id] = { h: hash(en), t: fr }; done++; }
    });
  }
} catch (e) {
  console.error(`Traduction interrompue (${e.message}) : le reste sera retenté demain.`);
}
mkdirSync(P.dataDir, { recursive: true });
const text = JSON.stringify(cache) + '\n';
if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
console.log(`Traduction (${provider}) : ${done} synopsis traduits, ${Math.max(0, todo.length - done)} restant(s) à traiter — ${Object.keys(cache).length} au total.`);
