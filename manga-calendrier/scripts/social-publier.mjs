// Publication sur Bluesky, X, Instagram et Pinterest. Chaque réseau est facultatif : il n'est utilisé que si ses identifiants sont présents.
// Les identifiants viennent uniquement des variables d'environnement (secrets GitHub), jamais des fichiers du dépôt.
import { createHmac, randomBytes } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (r, what) => {
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t.slice(0, 300) }; }
  if (!r.ok) throw new Error(`${what} : ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};

/* ------------------------------------------------------------------ Bluesky */
export const blueskyReady = (env) => Boolean(env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD);
/** post : { text, link: { text, uri }, images: [{ buf, alt, w, h }] } */
export async function postBluesky(post, env, fetchFn = fetch) {
  const host = env.BLUESKY_HOST || 'https://bsky.social';
  const ses = await json(await fetchFn(`${host}/xrpc/com.atproto.server.createSession`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }) }), 'Bluesky connexion');
  const auth = { authorization: `Bearer ${ses.accessJwt}` };
  const images = [];
  for (const im of post.images.slice(0, 4)) {
    const up = await json(await fetchFn(`${host}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'content-type': 'image/jpeg' }, body: im.buf }), 'Bluesky image');
    images.push({ alt: im.alt, image: up.blob, aspectRatio: { width: im.w, height: im.h } });
  }
  const record = { $type: 'app.bsky.feed.post', text: post.text, createdAt: new Date().toISOString(), langs: ['fr'], embed: { $type: 'app.bsky.embed.images', images } };
  if (post.link) {
    const i = post.text.lastIndexOf(post.link.text);
    if (i >= 0) record.facets = [{ index: { byteStart: Buffer.byteLength(post.text.slice(0, i)), byteEnd: Buffer.byteLength(post.text.slice(0, i + post.link.text.length)) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: post.link.uri }] }];
  }
  const res = await json(await fetchFn(`${host}/xrpc/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ repo: ses.did, collection: 'app.bsky.feed.post', record }) }), 'Bluesky publication');
  return { id: res.uri };
}

/* ------------------------------------------------------------------ X (OAuth 1.0a) */
export const xReady = (env) => Boolean(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET);
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** En-tête Authorization OAuth 1.0a (signature HMAC-SHA1). Les corps JSON et multipart n'entrent pas dans la signature. */
export function oauth1Header({ method, url, query = {}, env, nonce = randomBytes(12).toString('hex'), ts = Math.floor(Date.now() / 1000) }) {
  const oauth = { oauth_consumer_key: env.X_API_KEY, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(ts), oauth_token: env.X_ACCESS_TOKEN, oauth_version: '1.0' };
  const all = { ...query, ...oauth };
  const base = [method.toUpperCase(), pct(url), pct(Object.keys(all).sort().map((k) => `${pct(k)}=${pct(all[k])}`).join('&'))].join('&');
  oauth.oauth_signature = createHmac('sha1', `${pct(env.X_API_SECRET)}&${pct(env.X_ACCESS_SECRET)}`).update(base).digest('base64');
  return `OAuth ${Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(', ')}`;
}
export async function postX(post, env, fetchFn = fetch) {
  const ids = [];
  for (const im of post.images.slice(0, 4)) {
    const form = new FormData();
    form.append('media', new Blob([im.buf], { type: 'image/jpeg' }), 'visuel.jpg');
    form.append('media_category', 'tweet_image');
    const url = 'https://api.x.com/2/media/upload';
    const r = await fetchFn(url, { method: 'POST', headers: { authorization: oauth1Header({ method: 'POST', url, env }) }, body: form });
    const j = await json(r, 'X image');
    ids.push(j.data?.id || j.media_id_string);
  }
  const url = 'https://api.x.com/2/tweets';
  const body = { text: post.text, ...(ids.length ? { media: { media_ids: ids } } : {}) };
  const j = await json(await fetchFn(url, { method: 'POST', headers: { authorization: oauth1Header({ method: 'POST', url, env }), 'content-type': 'application/json' }, body: JSON.stringify(body) }), 'X publication');
  return { id: j.data?.id };
}

/* ------------------------------------------------------------------ Instagram (API Graph de Meta) */
export const instagramReady = (env) => Boolean(env.IG_USER_ID && env.IG_ACCESS_TOKEN);
/** post : { caption, urls: [adresses publiques d'images JPEG] } (carrousel de 2 à 10 images, ou une image seule) */
export async function postInstagram(post, env, fetchFn = fetch, wait = sleep) {
  const api = env.IG_GRAPH || 'https://graph.facebook.com/v21.0';
  const token = env.IG_ACCESS_TOKEN;
  const call = async (p, params, what) => json(await fetchFn(`${api}/${p}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, access_token: token }) }), what);
  const ready = async (id) => { for (let k = 0; k < 20; k++) { const j = await json(await fetchFn(`${api}/${id}?fields=status_code&access_token=${encodeURIComponent(token)}`), 'Instagram état'); if (j.status_code === 'FINISHED' || !j.status_code) return; if (j.status_code === 'ERROR' || j.status_code === 'EXPIRED') throw new Error(`Instagram : image refusée (${j.status_code})`); await wait(3000); } throw new Error('Instagram : délai dépassé'); };
  const urls = post.urls.slice(0, 10);
  let creation;
  if (urls.length === 1) creation = (await call(`${env.IG_USER_ID}/media`, { image_url: urls[0], caption: post.caption }, 'Instagram image')).id;
  else {
    const kids = [];
    for (const u of urls) { const c = await call(`${env.IG_USER_ID}/media`, { image_url: u, is_carousel_item: 'true' }, 'Instagram vignette'); kids.push(c.id); }
    for (const k of kids) await ready(k);
    creation = (await call(`${env.IG_USER_ID}/media`, { media_type: 'CAROUSEL', children: kids.join(','), caption: post.caption }, 'Instagram carrousel')).id;
  }
  await ready(creation);
  const pub = await call(`${env.IG_USER_ID}/media_publish`, { creation_id: creation }, 'Instagram publication');
  return { id: pub.id };
}

/* ------------------------------------------------------------------ Pinterest */
export const pinterestReady = (env) => Boolean(env.PINTEREST_TOKEN && env.PINTEREST_BOARD_ID);
export async function postPinterest(post, env, fetchFn = fetch) {
  const api = env.PINTEREST_API || 'https://api.pinterest.com/v5';
  const j = await json(await fetchFn(`${api}/pins`, { method: 'POST', headers: { authorization: `Bearer ${env.PINTEREST_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ board_id: env.PINTEREST_BOARD_ID, title: post.title, description: post.description, link: post.link, alt_text: post.alt.slice(0, 500), media_source: { source_type: 'image_url', url: post.url } }) }), 'Pinterest publication');
  return { id: j.id };
}
