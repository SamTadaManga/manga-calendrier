// Teste les liens externes du calendrier (sources officielles et couvertures) et écrit ceux qui ne répondent pas.
// Usage : node scripts/liens-externes.mjs [dossier_de_sortie=rapports]
// Poli : User-Agent qui s'identifie, une requête à la fois par site, ~1 s d'écart, HEAD puis GET si le site refuse HEAD.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths, loadAllManga } from './lib.mjs';

const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties; verification mensuelle des liens)';
const OUT = path.resolve(process.argv[2] || 'rapports');
mkdirSync(OUT, { recursive: true });
const P = paths();
const urls = new Map();
for (const r of loadAllManga(P.dataDir)) for (const [kind, u] of [['source officielle', r.source], ['couverture', r.cover]]) if (/^https?:\/\//.test(u || '') && !urls.has(u)) urls.set(u, { kind, serie: r.serie, editeur: r.editeur });
const byHost = new Map();
for (const [u, m] of urls) { const h = new URL(u).host; if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push([u, m]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = []; let ok = 0;
async function probe(u) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(u, { method, redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (r.status === 405 || r.status === 501) continue;
      return r.status;
    } catch (e) { if (method === 'GET') return `erreur : ${e.cause?.code || e.message}`; }
  }
  return 'erreur';
}
await Promise.all([...byHost].map(async ([host, list]) => {
  for (const [u, m] of list) {
    const s = await probe(u);
    if (typeof s === 'number' && s < 400) ok++; else bad.push([u, s, m.kind, m.editeur, m.serie]);
    await sleep(1000);
  }
}));
const csv = [['url', 'résultat', 'type', 'éditeur', 'série'], ...bad.sort((a, b) => a[3].localeCompare(b[3]))].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
writeFileSync(path.join(OUT, '4c-liens-externes-en-erreur.csv'), '﻿' + csv + '\n');
const sum = `${urls.size} liens externes testés : ${ok} répondent, ${bad.length} en erreur.`;
writeFileSync(path.join(OUT, 'liens-externes.md'), `# Liens externes\n\n${sum}\n\n${bad.slice(0, 80).map((b) => `- ${b[1]} · ${b[3]} · ${b[4]} · ${b[0]}`).join('\n')}\n`);
console.log(sum);
