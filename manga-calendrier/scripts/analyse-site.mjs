// Analyse du site : tomes manquants, ISBN sans couverture, doublons, liens internes cassés.
// Usage : node scripts/analyse-site.mjs [dossier_de_sortie=rapports] [dossier_du_site_construit=dist]
// Écrit des fichiers CSV et un rapport.md ; ne modifie aucune donnée.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { paths, loadAllManga, slugify } from './lib.mjs';
import { loadBnf } from './catalogue-bnf.mjs';
import { isIsbn13 } from './shops.mjs';
import { isbn10 } from './couvertures-lib.mjs';

const P = paths();
const OUT = path.resolve(process.argv[2] || 'rapports');
const SITE = path.resolve(process.argv[3] || P.outDir || 'dist');
mkdirSync(OUT, { recursive: true });
const csv = (rows) => rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n') + '\n';
const save = (name, head, rows) => writeFileSync(path.join(OUT, name), '﻿' + csv([head, ...rows]));

const manga = loadAllManga(P.dataDir).filter((r) => r.statut !== 'annule');
const BNF = loadBnf(P.dataDir);
const rep = [];
const h = (t) => rep.push(`\n## ${t}\n`);

// --- 0. Chiffres généraux
const calSeries = new Map();
for (const r of manga) { const k = slugify(r.serie); if (!calSeries.has(k)) calSeries.set(k, []); calSeries.get(k).push(r); }
rep.push('# Analyse du site\n', `Calendrier : ${manga.length} sorties, ${calSeries.size} séries. Catalogue BnF : ${BNF.series.length} séries, ${BNF.series.reduce((n, s) => n + s.v.length, 0)} références.`);

// --- 1. Tomes pas encore référencés
h('1. Tomes non référencés');
const notInCat = []; // sorties du calendrier dont l'ISBN n'est pas au catalogue
for (const r of manga) if (isIsbn13(r.isbn) && !BNF.byIsbn.has(r.isbn)) notInCat.push([r.serie, r.tome, r.isbn, r.date, r.editeur, BNF.byK.has(slugify(r.serie)) ? 'série connue, tome absent du catalogue' : 'série absente du catalogue']);
save('1a-sorties-absentes-du-catalogue.csv', ['série', 'tome', 'isbn', 'date', 'éditeur', 'cas'], notInCat);
const newSeries = [...calSeries].filter(([k]) => !BNF.byK.has(k)).map(([k, rs]) => [rs[0].serie, rs[0].editeur, rs.length, k]);
save('1b-series-du-calendrier-absentes-du-catalogue.csv', ['série', 'éditeur', 'sorties', 'adresse'], newSeries);
const gaps = []; // trous dans la numérotation d'une série
for (const s of BNF.series) {
  const nums = new Set(s.v.map((v) => Number(v[0])).filter((n) => n > 0 && n < 1000));
  if (nums.size < 2) continue;
  const max = Math.max(...nums);
  const miss = []; for (let i = 1; i <= max; i++) if (!nums.has(i)) miss.push(i);
  // une série dont presque tout manque est probablement mal regroupée : on la signale à part
  if (miss.length) gaps.push([s.n, s.e, nums.size, max, miss.length, miss.length > 30 ? `${miss.slice(0, 30).join(' ')} …` : miss.join(' '), miss.length > nums.size ? 'à vérifier (peu de tomes présents)' : '', s.k]);
}
gaps.sort((a, b) => a[4] - b[4]);
save('1c-tomes-manquants-dans-la-numerotation.csv', ['série', 'éditeur', 'tomes présents', 'dernier numéro', 'nb manquants', 'numéros manquants', 'remarque', 'adresse'], gaps);
// Sorties du calendrier plus récentes que le catalogue (le catalogue BnF est en retard par nature)
let ahead = 0;
for (const [k, rs] of calSeries) { const c = BNF.byK.get(k); if (!c) continue; const mx = Math.max(0, ...c.v.map((v) => Number(v[0]) || 0)); if (rs.some((r) => Number(r.tome) > mx)) ahead++; }
rep.push(`- ${notInCat.length} sorties du calendrier n'ont pas leur ISBN dans le catalogue BnF (1a).`, `- ${newSeries.length} séries du calendrier sont absentes du catalogue (1b).`, `- ${gaps.length} séries du catalogue ont des numéros manquants (1c), dont ${gaps.filter((g) => g[6]).length} à vérifier car peu de tomes y figurent.`, `- ${ahead} séries du calendrier ont un tome plus récent que ceux du catalogue.`);

// --- 2. ISBN pour lesquels il faut une couverture
h('2. ISBN à couvrir');
const haveCover = new Map(); // isbn -> url
for (const r of manga) if (isIsbn13(r.isbn) && /^https:\/\//.test(r.cover || '')) haveCover.set(r.isbn, r.cover);
const need = []; const seen = new Set();
for (const r of manga) if (isIsbn13(r.isbn) && !haveCover.has(r.isbn) && !seen.has(r.isbn)) { seen.add(r.isbn); need.push([r.isbn, isbn10(r.isbn), r.serie, r.tome, r.editeur, r.date.slice(0, 4), 'calendrier']); }
for (const s of BNF.series) {
  // une seule édition par tome (la plus récente) : c'est celle que le site affiche
  const best = new Map();
  for (const v of s.v) { const key = v[0] ? `t${v[0]}` : `l${v[3] || v[1]}`; const b = best.get(key); if (!b || v[2] > b[2]) best.set(key, v); }
  for (const v of best.values()) if (isIsbn13(v[1]) && !haveCover.has(v[1]) && !seen.has(v[1])) { seen.add(v[1]); need.push([v[1], isbn10(v[1]), s.n, v[0], s.e, v[2] || '', 'catalogue']); }
}
save('2-isbn-a-couvrir.csv', ['isbn13', 'isbn10', 'série', 'tome', 'éditeur', 'année', 'origine'], need);
rep.push(`- ${need.length} ISBN (une édition par tome) n'ont pas de couverture connue : ${need.filter((x) => x[6] === 'calendrier').length} du calendrier, ${need.filter((x) => x[6] === 'catalogue').length} du catalogue (2). Les ${[...haveCover.keys()].length} sorties qui ont déjà une couverture d'éditeur sont exclues.`);

// --- 3. Doublons
h('3. Doublons');
const dupRows = [];
// 3a. même ISBN dans plusieurs séries du catalogue
const isbnSeries = new Map();
for (const s of BNF.series) for (const v of s.v) { if (!isbnSeries.has(v[1])) isbnSeries.set(v[1], new Set()); isbnSeries.get(v[1]).add(s.k); }
for (const [i, ks] of isbnSeries) if (ks.size > 1) dupRows.push(['ISBN dans plusieurs séries', i, [...ks].join(' | ')]);
// 3b. ISBN en double dans le calendrier
const calIsbn = new Map();
for (const r of manga) if (isIsbn13(r.isbn)) { if (!calIsbn.has(r.isbn)) calIsbn.set(r.isbn, []); calIsbn.get(r.isbn).push(r); }
for (const [i, rs] of calIsbn) if (rs.length > 1) dupRows.push(['ISBN en double au calendrier', i, rs.map((r) => `${r.serie} T${r.tome} ${r.date} (${r.editeur})`).join(' | ')]);
// 3c. même série + même tome avec des ISBN différents au calendrier
const st = new Map();
for (const r of manga) { const key = `${slugify(r.serie)}#${r.tome}#${r.editeur}`; if (!st.has(key)) st.set(key, []); st.get(key).push(r); }
for (const [, rs] of st) if (rs.length > 1 && new Set(rs.map((r) => r.isbn)).size > 1 && rs[0].tome) dupRows.push(['même tome, ISBN différents', rs.map((r) => r.isbn).join(' '), `${rs[0].serie} T${rs[0].tome} : ${rs.map((r) => r.date).join(' / ')}`]);
// 3d. séries du catalogue au contenu quasi identique (mêmes ISBN) ou au nom proche
const flat = (s) => slugify(s).replace(/-/g, '');
const byFlat = new Map();
for (const s of BNF.series) { const f = flat(s.n); if (!byFlat.has(f)) byFlat.set(f, []); byFlat.get(f).push(s); }
for (const [, ss] of byFlat) if (ss.length > 1) dupRows.push(['séries au nom identique', ss.map((s) => s.k).join(' | '), ss.map((s) => `${s.v.length} tomes`).join(' | ')]);
// 3e. série du calendrier rangée sous un autre éditeur ou nom dans le catalogue
for (const [k, rs] of calSeries) { const c = BNF.byK.get(k); if (!c) continue; const pubs = new Set(rs.map((r) => r.editeur)); if (c.e && ![...pubs].some((p) => p === c.e || (c.p || []).includes(p))) dupRows.push(['éditeur différent calendrier / catalogue', k, `${[...pubs].join(', ')} ≠ ${c.e}`]); }
// 3f. un même ISBN deux fois dans une série (ne devrait pas arriver)
for (const s of BNF.series) { const u = new Set(s.v.map((v) => v[1])); if (u.size !== s.v.length) dupRows.push(['ISBN répété dans une série', s.k, `${s.v.length - u.size} en trop`]); }
save('3-doublons.csv', ['type', 'clé', 'détail'], dupRows);
const byType = {}; for (const r of dupRows) byType[r[0]] = (byType[r[0]] || 0) + 1;
rep.push(...Object.entries(byType).map(([t, n]) => `- ${t} : ${n}`), dupRows.length ? '- Détail dans 3-doublons.csv.' : '- Aucun doublon trouvé.');

// --- 4. Liens cassés
h('4. Liens');
const files = [];
if (existsSync(SITE)) {
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(SITE);
  const set = new Set(files.map((f) => '/' + path.relative(SITE, f).split(path.sep).join('/')));
  const exists = (u) => { u = u.split('#')[0].split('?')[0]; if (!u) return true; try { u = decodeURIComponent(u); } catch {} return set.has(u) || set.has(u.replace(/\/?$/, '/') + 'index.html') || set.has(u + '.html'); };
  const bad = new Map(); let total = 0;
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(\/[^"\/][^"]*)"/g)) {
      total++;
      const u = m[1].replace(/&amp;/g, '&');
      if (/^\/cdn-cgi\//.test(u) || exists(u)) continue;
      const key = u.split('#')[0].split('?')[0];
      if (!bad.has(key)) bad.set(key, []);
      bad.get(key).push('/' + path.relative(SITE, f).split(path.sep).join('/'));
    }
  }
  save('4a-liens-internes-casses.csv', ['lien', 'nb de pages', 'exemple de page'], [...bad].map(([u, ps]) => [u, ps.length, ps[0]]));
  rep.push(`- Liens internes testés : ${total} (dans ${files.filter((x) => x.endsWith('.html')).length} pages). Cassés : ${bad.size} adresses distinctes (4a).`);
} else rep.push(`- Site construit introuvable (${SITE}) : liens internes non testés.`);
// liens externes à tester depuis une machine qui a accès au web (le serveur d'analyse n'a pas Internet)
const ext = new Map();
for (const r of manga) for (const [kind, u] of [['source officielle', r.source], ['couverture', r.cover]]) if (/^https?:\/\//.test(u || '')) { if (!ext.has(u)) ext.set(u, [kind, r.editeur, r.serie]); }
save('4b-liens-externes-a-tester.csv', ['url', 'type', 'éditeur', 'série'], [...ext].map(([u, v]) => [u, ...v]));
rep.push(`- ${ext.size} liens externes (sources officielles et couvertures) listés dans 4b. Ils doivent être testés depuis une connexion Internet ouverte : voir scripts/liens-externes.mjs.`);

writeFileSync(path.join(OUT, 'rapport.md'), rep.join('\n') + '\n');
console.log(rep.join('\n'));
