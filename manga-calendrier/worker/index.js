// Compteur de clics anonyme sur les liens d'achat (aucun cookie, aucune adresse IP, aucun identifiant).
// POST /api/clic   : enregistre un clic { sh: boutique, k: série, p: type de page }
// GET  /api/clics  : rapport lisible, protégé par le secret STATS_KEY (?cle=...)
// Les compteurs sont stockés dans KV (liaison CLICS) : une clé par jour, boutique, série et type de page.
// Le reste du site est servi tel quel par Cloudflare (run_worker_first ne concerne que /api/*).

export const SHOPS = ['amazon', 'fnac', 'cultura', 'bdfugue', 'goodies'];
export const PAGES = ['home', 'manga', 'serie', 'anime', 'mon-planning', 'recherche', 'editeur', 'sorties-manga', 'semaine', 'articles', 'autre'];
const TTL = 60 * 60 * 24 * 400;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (d = new Date()) => d.toISOString().slice(0, 10);

export async function record(env, body, now = new Date()) {
  const sh = String(body && body.sh || '');
  const k = String(body && body.k || '');
  const p = String(body && body.p || 'autre');
  if (!SHOPS.includes(sh) || !/^[a-z0-9-]{0,100}$/.test(k)) return false;
  const key = `c|${day(now)}|${sh}|${k}|${PAGES.includes(p) ? p : 'autre'}`;
  const n = parseInt(await env.CLICS.get(key), 10) || 0;
  await env.CLICS.put(key, String(n + 1), { expirationTtl: TTL });
  return true;
}

export async function collect(env) {
  const rows = [];
  let cursor;
  do {
    const r = await env.CLICS.list({ prefix: 'c|', cursor, limit: 1000 });
    for (const x of r.keys) rows.push(x.name);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  const out = [];
  for (let i = 0; i < rows.length; i += 50) {
    const part = await Promise.all(rows.slice(i, i + 50).map(async (name) => {
      const [, d, sh, k, p] = name.split('|');
      return { d, sh, k, p, n: parseInt(await env.CLICS.get(name), 10) || 0 };
    }));
    out.push(...part);
  }
  return out;
}

export function summarize(rows, today = day()) {
  const by = (f) => { const m = new Map(); for (const r of rows) m.set(f(r), (m.get(f(r)) || 0) + r.n); return [...m].sort((a, b) => b[1] - a[1]); };
  const since = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return day(d); };
  const total = (list) => list.reduce((s, r) => s + r.n, 0);
  return {
    total: total(rows), last7: total(rows.filter((r) => r.d > since(7))), last30: total(rows.filter((r) => r.d > since(30))),
    shops: by((r) => r.sh), pages: by((r) => r.p), series: by((r) => r.k || '(sans série)').slice(0, 30),
    seriesShop: by((r) => `${r.k || '(sans série)'} · ${r.sh}`).slice(0, 30),
    days: by((r) => r.d).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14),
  };
}

const table = (title, list) => `<h2>${esc(title)}</h2><table>${list.length ? list.map(([a, n]) => `<tr><td>${esc(a)}</td><td class="n">${n}</td></tr>`).join('') : '<tr><td>Aucun clic pour le moment.</td></tr>'}</table>`;
export function page(s) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Clics sur les liens d'achat</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 16px}table{width:100%;border-collapse:collapse}td{padding:4px 8px;border-bottom:1px solid #ddd}td.n{text-align:right;font-weight:700}h2{margin-top:2rem}</style></head><body>
<h1>Clics sur les liens d'achat</h1><p><strong>${s.total}</strong> clics au total · <strong>${s.last7}</strong> sur 7 jours · <strong>${s.last30}</strong> sur 30 jours.</p>
${table('Par boutique', s.shops)}${table('Par type de page', s.pages)}${table('Séries les plus cliquées', s.series)}${table('Série et boutique', s.seriesShop)}${table('14 derniers jours', s.days)}
<p style="color:#666;font-size:.85rem">Compteur anonyme : aucun cookie, aucune adresse IP enregistrée. Un clic n'est pas une vente : les ventes sont dans Amazon Partenaires.</p></body></html>`;
}

const sameSecret = (a, b) => { if (!a || !b || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/clic' && request.method === 'POST') {
      // La réponse est toujours 204 (un compteur ne doit jamais gêner la navigation) ; l'en-tête X-Clic indique ce qui s'est passé : ok, ignore, nokv ou erreur
      let etat = 'ignore';
      try {
        const origin = request.headers.get('Origin');
        if (origin && new URL(origin).host !== url.host) etat = 'origine';
        else if (!env.CLICS) etat = 'nokv';
        else {
          const text = await request.text();
          etat = text.length < 400 && await record(env, JSON.parse(text)) ? 'ok' : 'invalide';
        }
      } catch (err) { etat = 'erreur'; console.error('clic', err && err.message); }
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'X-Clic': etat } });
    }
    if (url.pathname === '/api/clics' && request.method === 'GET') {
      if (!env.STATS_KEY || !env.CLICS || !sameSecret(url.searchParams.get('cle') || '', String(env.STATS_KEY))) return new Response('Introuvable', { status: 404 });
      const summary = summarize(await collect(env));
      if (url.searchParams.get('json')) return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
      return new Response(page(summary), { headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    return new Response('Introuvable', { status: 404 });
  },
};
