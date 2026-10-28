// Envoi de fichiers vers Cloudflare R2 (API compatible S3), sans dépendance : signature AWS Signature V4.
import { createHash, createHmac } from 'node:crypto';

const sha256 = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Renvoie les en-têtes signés d'une requête (exporté pour les tests, vecteur de la documentation AWS).
export function signV4({ method, host, pathname, query = '', headers = {}, body = '', accessKey, secretKey, region = 'auto', service = 's3', amzDate }) {
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const h = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, pathname.split('/').map(enc).join('/'), query, ...names.map((n) => `${n}:${lower[n]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...lower, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

export function r2Client({ accountId, bucket, accessKey, secretKey }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  return {
    async put(key, body, contentType, cacheControl = 'public, max-age=31536000, immutable') {
      const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
      const pathname = `/${bucket}/${key}`;
      const headers = signV4({ method: 'PUT', host, pathname, headers: { 'content-type': contentType, 'cache-control': cacheControl }, body, accessKey, secretKey, amzDate });
      const r = await fetch(`https://${host}${pathname.split('/').map(enc).join('/')}`, { method: 'PUT', headers, body, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`R2 ${r.status} : ${(await r.text()).slice(0, 200)}`);
    },
  };
}
