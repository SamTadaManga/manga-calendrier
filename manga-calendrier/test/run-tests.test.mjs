// Tests : node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDate, parseCSV, parseMangaCSV, markdown, foldLine, parisMidnight, parisKey, parisHM, addDays, weekdayOfKey,
  parseFrontmatter, loadAllManga,
} from '../scripts/lib.mjs';
import { splitTitle, robotsAllows, parseKioon, decode } from '../scripts/collectors.mjs';
import { updateChanges, emptyState } from '../scripts/changes.mjs';
import { shopsFrom as sf, buyUrl as bu } from '../scripts/shops.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(...p), 'utf8');

/* ------------------------------------------------------------ fonctions */
test('parseDate accepte AAAA-MM-JJ et JJ/MM/AAAA, refuse le reste', () => {
  assert.equal(parseDate('2026-10-05'), '2026-10-05');
  assert.equal(parseDate('5/10/2026'), '2026-10-05');
  assert.equal(parseDate('05/10/26'), '2026-10-05');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('bientôt'), null);
  assert.equal(parseDate(''), null);
});

test('fuseau Europe/Paris : minuit, changement d\'heure, jour de la semaine', () => {
  assert.equal(parisMidnight('2026-10-12').toISOString(), '2026-10-11T22:00:00.000Z'); // heure d'été
  assert.equal(parisMidnight('2026-11-02').toISOString(), '2026-11-01T23:00:00.000Z'); // heure d'hiver
  assert.equal(parisKey(new Date('2026-10-12T22:30:00Z')), '2026-10-13');
  assert.equal(parisHM(new Date('2026-10-12T21:30:00Z')), '23 h 30');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(weekdayOfKey('2026-10-12'), 1); // lundi
});

test('parseCSV gère BOM, point-virgule, guillemets et retours Windows', () => {
  const rows = parseCSV('﻿a;b;c\r\n1;"x;y";"il dit ""oui"""\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x;y', 'il dit "oui"']]);
  assert.deepEqual(parseCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('parseMangaCSV : colonnes du modèle, exemple ignoré, lien dangereux supprimé', () => {
  const rows = parseMangaCSV(read(ROOT, 'test/fixtures/manga.csv'));
  const names = rows.map((r) => r.serie);
  assert.ok(names.includes('Série Fictive Alpha'));
  assert.ok(!names.some((n) => /^Exemple/i.test(n)), "la ligne d'exemple doit être ignorée");
  assert.ok(!names.includes('Série Sans Date'), 'une date invalide fait ignorer la ligne');
  const alpha = rows.find((r) => r.serie === 'Série Fictive Alpha');
  assert.equal(alpha.date, '2026-10-12');
  assert.equal(alpha.prix, 7.2);
  assert.equal(alpha.statut, 'confirme');
  assert.equal(alpha.notes, 'Adaptation animée annoncée; suite attendue');
  const beta = rows.find((r) => r.serie === 'Série Fictive Beta');
  assert.equal(beta.source, '', 'javascript: ne doit jamais devenir un lien');
  assert.equal(beta.statut, 'annonce');
  assert.equal(rows.find((r) => r.serie === 'Série Fictive Gamma').statut, 'reporte');
});

test('markdown neutralise le HTML et les liens dangereux', () => {
  const html = markdown('# Titre\n\nUn **gras** et <script>alert(1)</script> et [piège](javascript:alert(1)) et [ok](https://exemple.fr).\n\n- a\n- b');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<a href="https://exemple.fr"'));
  assert.ok(html.includes('<strong>gras</strong>'));
  assert.ok(html.includes('<ul><li>a</li><li>b</li></ul>'));
});

test('parseFrontmatter lit les champs entre guillemets', () => {
  const { data, body } = parseFrontmatter('---\ntitle: "Un \\"titre\\""\ndate: 2026-10-01\ndraft: false\n---\n\nTexte');
  assert.equal(data.title, 'Un "titre"');
  assert.equal(data.draft, 'false');
  assert.equal(body.trim(), 'Texte');
});

test('foldLine coupe à 75 octets sans casser les caractères accentués', () => {
  const line = 'SUMMARY:' + 'é'.repeat(100);
  const folded = foldLine(line).split('\r\n');
  assert.ok(folded.length > 1);
  for (const l of folded) assert.ok(new TextEncoder().encode(l).length <= 75, `ligne trop longue : ${l.length}`);
  assert.equal(folded.map((l, i) => (i ? l.slice(1) : l)).join(''), line);
});

/* ------------------------------------------------------ chaîne complète */
test('chaîne complète : fetch (simulé), articles du jour, build', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = {
    DATA_DIR: path.join(tmp, 'data'),
    ARTICLES_DIR: path.join(tmp, 'articles'),
    AUTO_DIR: path.join(tmp, 'auto'),
    OUT_DIR: path.join(tmp, 'dist'),
    CONFIG_FILE: path.join(ROOT, 'test/fixtures/site.config.json'),
    NOW: '2026-10-12T07:00:00Z', // lundi 12 octobre 2026, 9 h à Paris
  };
  mkdirSync(dirs.DATA_DIR);
  mkdirSync(dirs.ARTICLES_DIR);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(dirs.DATA_DIR, 'manga.csv'));
  const art = (name, fm, body = 'Contenu **test**.') => writeFileSync(path.join(dirs.ARTICLES_DIR, name), `---\n${fm}\n---\n\n${body}\n`);
  art('publie.md', 'title: "Article publié"\ndate: 2026-10-01\ndraft: false');
  art('brouillon.md', 'title: "Article brouillon"\ndate: 2026-10-01\ndraft: true');
  art('futur.md', 'title: "Article programmé"\ndate: 2026-12-01\ndraft: false');
  art('_modele.md', 'title: "Modèle ignoré"\ndate: 2026-10-01\ndraft: false');
  art('sans-date.md', 'title: "Sans date"');

  const env = { ...process.env, ...dirs };
  const run = (script, ...args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env, encoding: 'utf8' });

  run('fetch-anime.mjs', '--from-file', path.join(ROOT, 'test/mock-anilist.json'));
  run('fetch-adaptations.mjs', '--from-file', path.join(ROOT, 'test/mock-adaptations.json'));
  run('fetch-season.mjs', '--from-file', path.join(ROOT, 'test/mock-season.json'));
  const anime = JSON.parse(read(dirs.DATA_DIR, 'anime.json'));
  assert.equal(anime.episodes.length, 6, 'filtre : adulte, Chine, musique, hier et hors fenêtre exclus');
  assert.ok(anime.episodes.every((e) => e.title && typeof e.airingAt === 'number'));

  const adaptJson = JSON.parse(read(dirs.DATA_DIR, 'adaptations.json'));
  assert.deepEqual(adaptJson.series['serie-fictive-alpha'].i, { au: ['Auteur Test'], sc: ['Auteur Test'], ar: ['Auteur Test'], g: ['Action', 'Sci-Fi'], st: 'RELEASING', y: 2019, v: 2 }, 'fiche auteur, genres, état');
  run('daily-articles.mjs');
  const animeMd = read(dirs.AUTO_DIR, 'anime-2026-10-12.md');
  assert.ok(animeMd.includes('02 h 30') && animeMd.includes('17 h 00') && animeMd.includes('23 h 30'));
  assert.ok(!animeMd.includes('Test Series Four'), 'un épisode à 00 h 30 le 13 appartient au jour suivant');
  assert.ok(animeMd.includes('Programme complet (3 épisodes)'));
  assert.ok(animeMd.includes('→ [Page Anime](/anime/#j-2026-10-12)') && animeMd.includes('[Lire le manga](/serie/serie-fictive-alpha/)') === false || animeMd.includes('[Page Anime]'), 'liens sous les animes');
  const weekAnime = read(dirs.AUTO_DIR, 'anime-semaine-2026-10-12.md');
  assert.ok(weekAnime.includes('Les séries les plus suivies') && weekAnime.includes('Test Series One'), 'récap anime du lundi');
  assert.ok(existsSync(path.join(dirs.AUTO_DIR, 'manga-semaine-2026-10-12.md')));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/daily-articles.mjs')], { env: { ...env, DATE: '2026-10-01' }, encoding: 'utf8' });
  const monthMd = read(dirs.AUTO_DIR, 'manga-mois-2026-10.md');
  assert.ok(monthMd.includes('## Par éditeur') && monthMd.includes('/sorties-manga/octobre-2026/'), 'récap manga du 1er du mois');
  const mangaMd = read(dirs.AUTO_DIR, 'manga-2026-10-12.md');
  assert.ok(mangaMd.includes('Série Fictive Alpha tome 5') && mangaMd.includes('7,20 €') && mangaMd.includes('date confirmée'));
  assert.ok(mangaMd.includes('→ [Calendrier manga](/manga/#j-2026-10-12) · [Page de la série](/serie/serie-fictive-alpha/)'), 'liens sous les mangas');
  assert.ok(!/javascript:/.test(mangaMd) && !/Exemple/.test(mangaMd));
  const weekMd = read(dirs.AUTO_DIR, 'manga-semaine-2026-10-12.md');
  assert.ok(weekMd.includes('Série Fictive Gamma') && !weekMd.includes('Série Annulée') && !weekMd.includes('Série Ancienne'));

  run('build.mjs');
  const dist = (...p) => path.join(dirs.OUT_DIR, ...p);
  for (const f of ['index.html', 'anime/index.html', 'manga/index.html', 'articles/index.html', 'mentions-legales/index.html',
    'articles/anime-2026-10-12/index.html', 'articles/manga-2026-10-12/index.html', 'articles/publie/index.html',
    'mon-planning/index.html', 'data/manga.json', 'suivi.js', 'manga.ics', 'anime.ics', 'sitemap.xml', 'robots.txt', 'style.css', '404.html', '_headers']) {
    assert.ok(existsSync(dist(f)), `fichier manquant : ${f}`);
  }
  assert.ok(!existsSync(dist('articles/brouillon/index.html')), 'un brouillon ne doit pas être publié');
  assert.ok(existsSync(dist('og.png')) && read(dirs.OUT_DIR, 'index.html').includes('property="og:image" content="https://test.example.org/og.png"'), 'image de partage');
  assert.ok(!existsSync(dist('articles/futur/index.html')), 'un article daté du futur ne doit pas être publié');
  assert.ok(!existsSync(dist('articles/modele/index.html')) && !existsSync(dist('articles/_modele/index.html')));

  const mp = read(dist('manga/index.html'));
  assert.ok(mp.includes('Adapté en anime') && mp.includes('Alpha Season 2') && mp.includes('crunchyroll.com/series/ALPHA') && !mp.includes('evil.example'), 'adaptation sous les tomes');
  const sp = read(dist('serie/serie-fictive-alpha/index.html'));
  const seasonPage = read(dist('anime/saison/index.html'));
  assert.ok(seasonPage.includes('Season Test One') && seasonPage.includes('Hiver 2027') && !seasonPage.includes('Pas un anime') && !seasonPage.includes('evil'), 'page saison filtrée');
  assert.ok(sp.includes('class="facts"') && sp.includes('Auteur Test') && sp.includes('Science-fiction') && !sp.includes('Pas Un Auteur'), 'fiche série : auteur et genres AniList');
  assert.ok(sp.includes('Alpha Old') && sp.includes('en cours de diffusion') && sp.includes('Prochain épisode'), 'encadré de la page série');
  assert.ok(read(dirs.OUT_DIR, 'index.html').includes('id="pour-toi"') && existsSync(dist('data/anime-week.json')), 'section Pour toi et données anime');
  assert.ok(JSON.parse(read(dirs.OUT_DIR, 'data/anime-week.json')).eps.length > 0 && read(dirs.OUT_DIR, 'anime/index.html').includes('class="chip afollow"'), 'suivi des animes');
  const animePage = read(dist('anime/index.html'));
  assert.ok(animePage.includes('Test Series One') && animePage.includes('Shiken Ni'));
  assert.ok(animePage.includes('class="bridge" href="/serie/serie-fictive-alpha/"') && read(dirs.OUT_DIR, 'serie/serie-fictive-alpha/index.html').includes('Adapté en anime'), 'pont anime vers manga');
  assert.ok(animePage.includes('class="stream s-crunchyroll"') && animePage.includes('Crunchyroll') && !animePage.includes('evil.example'), 'plateformes de streaming');
  assert.ok(/href="\/anime\/1-test-series-one\/"/.test(animePage) && !/href="https:\/\/anilist\.co/.test(animePage.replace(/<footer[\s\S]*$/, '')), 'les animes pointent vers leur fiche, pas vers AniList');
  const fiche = read(dist('anime/1-test-series-one/index.html'));
  assert.ok(fiche.includes('Où regarder') && fiche.includes('Regarder sur Crunchyroll') && !fiche.includes('evil.example'), 'fiche anime avec liens de streaming');
  assert.ok(dist('theme.js') && existsSync(dist('theme.js')) && existsSync(dist('agenda/kana.ics')), 'thème et agendas par éditeur');
  const sp0 = read(dist('serie/serie-fictive-alpha/index.html'));
  assert.ok(sp0.includes('class="shops') && sp0.includes('https://www.amazon.fr/dp/2000000010') && !sp0.includes('fnac.com') && sp0.includes('cultura.com') && sp0.includes('bdfugue.com'), "liens d'achat par ISBN");
  assert.ok(!sp0.includes('sponsored') && !sp0.includes('affil-note') && !read(dirs.OUT_DIR, 'mentions-legales/index.html').includes('id="affiliation"'), "pas de mention d'affiliation sans lien d'affiliation");
  const cfg0 = JSON.parse(readFileSync(dirs.CONFIG_FILE, 'utf8'));
  const withShops = (shops) => { writeFileSync(dirs.CONFIG_FILE, JSON.stringify({ ...cfg0, shops })); run('build.mjs'); };
  const homeP = read(dist('index.html'));
  assert.ok(/class="tile-cover" href="\/serie\/[a-z0-9-]+\/"/.test(homeP) || !homeP.includes('class="tile '), "accueil : les jaquettes mènent à la page de la série");
  assert.ok(homeP.includes('class="stream shop'), 'accueil : boutons d\'achat');
  let sp1;
  try {
    withShops({ bdfugue: { affiliate: 'https://track.example/c?u={urlenc}' }, cultura: { enabled: false } });
    sp1 = read(dist('serie/serie-fictive-alpha/index.html'));
  } finally { writeFileSync(dirs.CONFIG_FILE, JSON.stringify(cfg0)); }
  assert.ok(sp1.includes('https://track.example/c?u=https%3A%2F%2Fwww.bdfugue.com') && sp1.includes('rel="sponsored nofollow noopener"') && sp1.includes('class="stream shop') && !sp1.includes('cultura.com') && sp1.includes('affil-note'), "lien d'affiliation remplaçable, boutique désactivable, mention affichée");
  assert.ok(read(dirs.OUT_DIR, 'mentions-legales/index.html').includes('id="affiliation"'), "mention légale d'affiliation");
  withShops({ amazon: { tag: 'prochaintome-21' } });
  const spA = read(dist('serie/serie-fictive-alpha/index.html'));
  assert.ok(spA.includes('https://www.amazon.fr/dp/2000000010?tag=prochaintome-21') && spA.includes('rel="sponsored nofollow noopener"') && spA.includes('affil-note'), 'Amazon : identifiant partenaire ajouté');
  assert.ok(read(dirs.OUT_DIR, 'mentions-legales/index.html').includes('En tant que Partenaire Amazon, je réalise un bénéfice sur les achats remplissant les conditions requises.'), 'phrase Partenaire Amazon');
  const amz = sf({ shops: { amazon: { tag: 'prochaintome-21' } } }).find((x) => x.id === 'amazon');
  withShops({ amazon: { tag: 'prochaintome-21' } });
  const spG = read(dist('serie/serie-fictive-alpha/index.html'));
  assert.ok(spG.includes('https://www.amazon.fr/s?k=S%C3%A9rie+Fictive+Alpha+goodies&amp;tag=prochaintome-21') || /amazon\.fr\/s\?k=[^"]*goodies&amp;tag=prochaintome-21/.test(spG), 'bouton goodies sur la page série');
  writeFileSync(dirs.CONFIG_FILE, JSON.stringify({ ...cfg0, shops: { amazon: { tag: 'prochaintome-21' } }, goodies: false })); run('build.mjs');
  assert.ok(!read(dist('serie/serie-fictive-alpha/index.html')).includes('goodies'), 'goodies désactivables');
  withShops({ amazon: { enabled: false } });
  assert.ok(!read(dist('serie/serie-fictive-alpha/index.html')).includes('goodies'), 'pas de goodies sans Amazon');
  assert.equal(bu(amz, '9791032723999'), 'https://www.amazon.fr/s?k=9791032723999&i=stripbooks&tag=prochaintome-21', 'ISBN en 979 : recherche + tag');
  try {
    withShops({ bdfugue: { affiliate: 'javascript:alert(1)' } });
    assert.ok(!read(dist('serie/serie-fictive-alpha/index.html')).includes('javascript:'), "lien d'affiliation non https refusé");
  } finally { writeFileSync(dirs.CONFIG_FILE, JSON.stringify(cfg0)); }
  run('build.mjs');
  assert.ok(existsSync(dist('data/search.json')) && existsSync(dist('recherche.js')), 'index de recherche');
  assert.ok(animePage.includes('data-chip="crunchyroll"') && animePage.includes('data-pub="crunchyroll"'), 'filtre par plateforme');
  assert.ok(!animePage.includes('<script>alert(1)'), 'titre piégé non échappé');
  assert.ok(animePage.includes('&lt;script&gt;alert(1)&lt;/script&gt; Hacker &amp; Co'));
  const mangaPage = read(dist('manga/index.html'));
  assert.ok(mangaPage.includes('Série Fictive Alpha') && mangaPage.includes('Annulé'));
  assert.ok(!mangaPage.includes('Exemple') && !mangaPage.includes('Série Ancienne'));
  assert.ok(!mangaPage.includes('<b>Piégée') && mangaPage.includes('&lt;b&gt;Piégée&lt;/b&gt;'));
  assert.ok(!/href="javascript/.test(mangaPage));
  const mj = JSON.parse(read(dist('data/manga.json')));
  assert.ok(mj.rows.length >= 4 && mj.rows.every((r) => r.k && r.d && r.s), 'manga.json : lignes valides');
  assert.ok(mangaPage.includes('class="follow"') && mangaPage.includes('/suivi.js'), 'boutons Suivre et script présents');
  assert.ok(read(dist('mon-planning/index.html')).includes('noindex') && !read(dist('sitemap.xml')).includes('mon-planning'));
  const home = read(dist('index.html'));
  assert.ok(home.includes('canonical') && home.includes('Article publié'));
  assert.ok(read(dist('sitemap.xml')).includes('https://test.example.org/articles/publie/'));

  for (const f of ['manga.ics', 'anime.ics']) {
    const ics = read(dist(f));
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'retours à la ligne CRLF uniquement');
    for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75);
  }
  assert.equal((read(dist('manga.ics')).match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.equal((read(dist('anime.ics')).match(/BEGIN:VEVENT/g) || []).length, 6);
  assert.ok(read(dist('manga.ics')).includes('DTSTART;VALUE=DATE:20261012'));
  assert.ok(read(dist('anime.ics')).includes('DTSTART:20261012T150000Z'));
});

/* ------------------------------------------------------------ collecteurs */
test('splitTitle sépare série, tome et édition spéciale', () => {
  assert.deepEqual(splitTitle('Ryukyu Buccaneer - Tome 01'), { serie: 'Ryukyu Buccaneer', tome: '1', titre: '' });
  assert.equal(splitTitle('Toilet-bound Hanako-kun T25 - Collector').tome, '25');
  assert.equal(splitTitle('Toilet-bound Hanako-kun T25 - Collector').titre, 'Toilet-bound Hanako-kun T25 - Collector');
  assert.deepEqual(splitTitle("Dreamland L&#039;Artbook"), { serie: "Dreamland L'Artbook", tome: '', titre: '' });
});

test('robots.txt : Disallow, Allow plus précis, page HTML = autorisé', () => {
  const r = 'User-agent: *\nDisallow: /api/\nAllow: /api/public\nUser-agent: Bot\nDisallow: /';
  assert.equal(robotsAllows(r, '/api/x'), false);
  assert.equal(robotsAllows(r, '/api/public/x'), true);
  assert.equal(robotsAllows(r, '/manga/planning/'), true);
  assert.equal(robotsAllows('<!DOCTYPE html><html>', '/x'), true);
  assert.equal(parseKioon({ volumes: [{ serie_title: 'X', date: 'pas une date' }] }).length, 0);
});

test('collecte (pages simulées) + fusion : la saisie manuelle l\'emporte', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const env = { ...process.env, DATA_DIR: tmp, NOW: '2026-10-12T07:00:00Z', COLLECT_FIXTURES: path.join(ROOT, 'test/fixtures/publishers') };
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/collect-manga.mjs')], { env, encoding: 'utf8' });
  assert.ok(/Glénat : 3/.test(out) && /Kana : 3/.test(out) && /Pika : 4/.test(out) && /Ki-oon : 3/.test(out) && /Akata : [1-9]/.test(out), out);
  const csv = readFileSync(path.join(tmp, 'manga-auto.csv'), 'utf8');
  assert.ok(!csv.includes('Lou ! Sonata'), 'la BD Glénat est exclue');
  assert.ok(!csv.includes('Vieux Titre') && !csv.includes('2026-05-20'), 'dates hors fenêtre exclues');
  assert.equal((csv.match(/,9782344077573,/g) || []).length, 1, 'doublon fusionné');
  assert.ok(csv.includes('Wind Breaker,24') && csv.includes('Übel Blatt II,4,,9791032723999,"8,45"'));
  assert.ok(csv.includes('Paru') && csv.includes('Annoncé'));
  // Delcourt, Soleil (même gabarit) et Kazé (dates BDbase, prix et couverture de la boutique par ISBN)
  assert.ok(/Delcourt : 6/.test(out) && /Soleil : 3/.test(out) && /Kazé : 3/.test(out), out);
  assert.ok(!csv.includes('Fabulous') && !csv.includes('Druides') && !csv.includes('Frankenstein'), 'BD, comics et jeunesse exclus');
  assert.ok(csv.includes('"Sing ""Yesterday"" for Me",9') && csv.includes('2026-12-03,Delcourt'), 'dates JJ.MM.AAAA et entités décodées');
  assert.ok(csv.includes('2026-10-15,Delcourt,The Brave Wish Revenging,15'), 'fiche à fenêtre modale conservée');
  assert.ok(csv.includes('2026-10-26,Kazé,Vavam Vampire,8,,9782820355218,"7,99"') && csv.includes('2026-11-20,Kazé,Hors Boutique,2'), 'Kazé : date BDbase, prix de la boutique, titre absent de la boutique conservé');
  assert.ok(csv.includes('cdn.shopify.com/s/files/1/0810/4011/3877/files/9782820355218.jpg?v=1783539873&width=360'), 'couverture Kazé');
  assert.ok(csv.includes('https://www.editions-delcourt.fr/sites/default/files/styles/image_list_retinafy_/public/product/9782413095309.jpg?itok=abc'), 'couverture Delcourt');
  // Kurokawa, Meian, Mangetsu via BDbase : fiches lues une fois, autres éditeurs écartés
  assert.ok(/Kurokawa : 1/.test(out) && /Mangetsu : 2/.test(out), out);
  assert.ok(csv.includes('2026-11-12,Kurokawa,Chainsaw Man,19,,9782368099991') && !csv.includes('Autre Série'), 'fiche d\'un autre éditeur écartée');
  assert.ok(csv.includes('"Ao Ashi, playmaker",37') && csv.includes('One-shot Mangetsu,,,9782377700024'), 'série et tome lus dans le fil d\'Ariane');
  assert.ok(existsSync(path.join(tmp, 'bdbase-fiches.json')));
  // 2e passage identique : rien ne change
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/collect-manga.mjs')], { env, encoding: 'utf8' });
  assert.equal(readFileSync(path.join(tmp, 'manga-auto.csv'), 'utf8'), csv);
  // fusion : une ligne manuelle (même ISBN) remplace la ligne automatique
  writeFileSync(path.join(tmp, 'manga.csv'), 'Date de sortie,Éditeur,Série,Tome,ISBN-13,Statut\n2026-10-30,Kana,Slam Dunk Deluxe,17,9782505000002,Confirmé\n');
  const code = `import {loadAllManga} from ${JSON.stringify(path.join(ROOT, 'scripts/lib.mjs'))};const r=loadAllManga(process.env.DATA_DIR).filter(x=>x.serie==='Slam Dunk Deluxe');console.log(JSON.stringify(r.map(x=>x.statut)));`;
  const merged = execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  assert.equal(merged.trim(), '["confirme"]');
});

/* ------------------------------------------------- changements de date */
const row = (o) => ({ editeur: 'Kana', serie: 'Serie', tome: '1', titre: '', isbn: '9782505000001', date: '2026-11-10', source: '', ...o });

test('changements : premier passage silencieux, puis report, nouveauté et retrait', () => {
  const ok = new Set(['Kana']);
  const base = [row({}), row({ tome: '2', isbn: '9782505000002', date: '2026-12-10' })];
  let st = updateChanges(emptyState(), base, ok, '2026-10-12');
  assert.equal(st.events.length, 0, 'rien à annoncer au premier passage');
  st = updateChanges(st, base, ok, '2026-10-13');
  assert.equal(st.events.length, 0, 'aucun changement = aucun événement');
  // report du tome 1, nouveau tome 3 dans un mois déjà connu, nouveau tome 4 dans un mois jamais vu
  const next = [row({ date: '2026-11-24' }), base[1],
    row({ tome: '3', isbn: '9782505000003', date: '2026-11-30' }), row({ tome: '4', isbn: '9782505000004', date: '2027-01-15' })];
  st = updateChanges(st, next, ok, '2026-10-14');
  const types = st.events.map((e) => `${e.type}:${e.t}`).sort();
  assert.deepEqual(types, ['date:1', 'nouveau:3']);
  assert.equal(st.events.find((e) => e.type === 'date').from, '2026-11-10');
  // un éditeur muet ne provoque ni retrait ni nouveauté
  st = updateChanges(st, [], new Set(), '2026-10-15');
  assert.equal(st.events.length, 2);
  // retrait : seulement après 3 collectes d'affilée sans le tome 2
  const without = next.filter((r) => r.tome !== '2');
  for (const d of ['2026-10-16', '2026-10-17']) st = updateChanges(st, without, ok, d);
  assert.equal(st.events.filter((e) => e.type === 'retire').length, 0);
  st = updateChanges(st, without, ok, '2026-10-18');
  assert.equal(st.events.filter((e) => e.type === 'retire').length, 1);
  st = updateChanges(st, without, ok, '2026-10-19');
  assert.equal(st.events.filter((e) => e.type === 'retire').length, 1, 'retrait annoncé une seule fois');
});

test('changements : chaîne complète (collecte, articles du jour, pages)', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const fx = path.join(tmp, 'fixtures');
  cpSync(path.join(ROOT, 'test/fixtures/publishers'), fx, { recursive: true });
  const dirs = {
    DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'articles'), AUTO_DIR: path.join(tmp, 'auto'),
    OUT_DIR: path.join(tmp, 'dist'), CONFIG_FILE: path.join(ROOT, 'test/fixtures/site.config.json'), COLLECT_FIXTURES: fx,
  };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  const run = (script, now) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], { env: { ...process.env, ...dirs, NOW: now }, encoding: 'utf8' });
  const first = run('collect-manga.mjs', '2026-10-12T07:00:00Z');
  assert.ok(!/changement\(s\)/.test(first), 'premier passage silencieux');
  // l'éditeur déplace un tome et en ajoute un autre
  const f = path.join(fx, 'api_ki_oon_com_planning_year_2026_month_10.json');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  j.volumes.find((v) => v.serie_title.startsWith('Übel')).date = '2026-10-29';
  j.volumes.push({ serie_title: 'Nouvelle Série', ean: '9791032729999', link: '9791032729999-nouvelle-serie', number: 1, date: '2026-10-21', prix: '7,95 €' });
  writeFileSync(f, JSON.stringify(j));
  const second = run('collect-manga.mjs', '2026-10-13T07:00:00Z');
  assert.ok(/2 changement\(s\)/.test(second), second);
  const ch = JSON.parse(readFileSync(path.join(dirs.DATA_DIR, 'changes.json'), 'utf8'));
  assert.deepEqual(ch.events.map((e) => e.type).sort(), ['date', 'nouveau']);
  run('daily-articles.mjs', '2026-10-13T07:00:00Z');
  const art = readFileSync(path.join(dirs.AUTO_DIR, 'manga-changements-2026-10-13.md'), 'utf8');
  assert.ok(art.includes('## Reportés') && art.includes('Übel Blatt II') && art.includes('## Nouvelles sorties annoncées') && art.includes('Nouvelle Série'));
  run('build.mjs', '2026-10-13T07:00:00Z');
  const page = readFileSync(path.join(dirs.OUT_DIR, 'changements/index.html'), 'utf8');
  assert.ok(page.includes('Reporté') && page.includes('Übel Blatt II') && page.includes('Annoncé') && page.includes('Nouvelle Série'));
  const mangaPage = readFileSync(path.join(dirs.OUT_DIR, 'manga/index.html'), 'utf8');
  assert.ok(/Reporté \(avant : /.test(mangaPage), 'badge de report sur la page manga');
  assert.ok(readFileSync(path.join(dirs.OUT_DIR, 'index.html'), 'utf8').includes('Derniers changements de date'));
});

/* ------------------------------------------------------------ couvertures */
test('couvertures : collecte, interrupteur et mode site privé', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = {
    DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'articles'), AUTO_DIR: path.join(tmp, 'auto'),
    OUT_DIR: path.join(tmp, 'dist'), CONFIG_FILE: path.join(tmp, 'config.json'),
    COLLECT_FIXTURES: path.join(ROOT, 'test/fixtures/publishers'), NOW: '2026-10-12T07:00:00Z',
  };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  const env = { ...process.env, ...dirs };
  const run = (script) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], { env, encoding: 'utf8' });
  run('collect-manga.mjs');
  const csv = read(dirs.DATA_DIR, 'manga-auto.csv');
  assert.ok(csv.includes('https://media.hachette.fr/fit-in/320x480/imgArticle/GLENAT/2026/9782344077573-001-X.jpeg?source=web'), 'couverture Glénat');
  assert.ok(csv.includes('https://media.hachette.fr/fit-in/320x480/imgArticle/PIKA/2026/9791043310812-001-X.jpeg?source=web'), 'couverture Pika');
  assert.ok(csv.includes('https://bdi.dlpdomain.com/album/9782505140535-couv-M300x425.jpg'), 'couverture Kana');
  assert.ok(csv.includes('https://api.ki-oon.com/images/volumes/9791032723425.jpg'), 'couverture Ki-oon');
  assert.ok(!csv.includes('evil.example'), 'une couverture hors https ou hors serveur éditeur est refusée');
  const cfg = JSON.parse(read(ROOT, 'test/fixtures/site.config.json'));
  const build = (extra) => { writeFileSync(dirs.CONFIG_FILE, JSON.stringify({ ...cfg, ...extra })); run('build.mjs'); };

  build({});
  assert.ok(!read(dirs.OUT_DIR, 'manga/index.html').includes('cover-img'), 'couvertures absentes par défaut');
  assert.ok(read(dirs.OUT_DIR, 'robots.txt').includes('Allow: /') && existsSync(path.join(dirs.OUT_DIR, 'sitemap.xml')));

  build({ legal: { contactEmail: 'contact@exemple.fr' } });
  assert.ok(read(dirs.OUT_DIR, 'manga/index.html').includes('<a href="/signaler/" data-report>'), 'lien Signaler vers la page dédiée');
  const rep = read(dirs.OUT_DIR, 'signaler/index.html');
  assert.ok(rep.includes('rep-gmail') && rep.includes('rep-mailto') && rep.includes('data-mail="contact@exemple.fr"'), 'page Signaler avec Gmail, Outlook, mail et copie');
  assert.ok(!read(dirs.OUT_DIR, 'visite.js').includes("'mailto:'"), 'plus de mailto direct dans visite.js');

  const vus = read(dirs.OUT_DIR, 'mes-animes/index.html');
  assert.ok(vus.includes('id="vus-app"') && vus.includes('/anime-vus.js') && vus.includes('noindex'), 'page Mes animes privée avec son script');
  assert.ok(existsSync(path.join(dirs.OUT_DIR, 'anime-vus.js')) && read(dirs.OUT_DIR, 'manga/index.html').includes('href="/mes-animes/"'), 'script publié et menu à jour');

  build({ showCovers: true, launched: false });
  const page = read(dirs.OUT_DIR, 'manga/index.html');
  assert.ok(page.includes('class="cover-img"') && page.includes('referrerpolicy="no-referrer"') && page.includes('loading="lazy"'));
  assert.ok(/<a class="rel-cover" href="\/serie\/[a-z0-9-]+\/"/.test(page), "jaquette cliquable vers la série");
  assert.ok(page.includes('noindex, nofollow'), 'site privé : noindex');
  assert.equal(read(dirs.OUT_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  assert.ok(!existsSync(path.join(dirs.OUT_DIR, 'sitemap.xml')), 'site privé : pas de sitemap');
  assert.equal(JSON.parse(read(dirs.OUT_DIR, 'data/manga.json')).covers, true);
  assert.ok(read(dirs.OUT_DIR, 'mentions-legales/index.html').includes('adresse IP'));
});

test('décodage HTML : apostrophes, accents et double encodage', () => {
  assert.equal(decode('Mémoire de l&rsquo;Arcadia'), 'Mémoire de l’Arcadia');
  assert.equal(decode('Caf&eacute; &amp;rsquo;x&amp;rsquo;'), 'Café ’x’');
  assert.equal(decode('A&nbsp;&nbsp;B &#233; &#x41;'), 'A B é A');
  assert.equal(decode('&inconnu; reste'), '&inconnu; reste');
});

test('affiches d\'anime : collectées, affichées seulement si showCovers', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = { DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'a'), AUTO_DIR: path.join(tmp, 'auto'), NOW: '2026-10-12T07:00:00Z' };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  const base = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/site.config.json'), 'utf8'));
  const cfg = (extra, name) => { const f = path.join(tmp, name); writeFileSync(f, JSON.stringify({ ...base, ...extra })); return f; };
  const run = (script, env, ...args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env: { ...process.env, ...dirs, ...env }, encoding: 'utf8' });
  run('fetch-anime.mjs', {}, '--from-file', path.join(ROOT, 'test/mock-anilist.json'));
  const json = JSON.parse(readFileSync(path.join(dirs.DATA_DIR, 'anime.json'), 'utf8'));
  assert.ok(json.episodes.some((e) => e.cover === 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1-test.jpg'));
  run('build.mjs', { CONFIG_FILE: cfg({ showCovers: true }, 'on.json'), OUT_DIR: path.join(tmp, 'on') });
  run('build.mjs', { CONFIG_FILE: cfg({}, 'off.json'), OUT_DIR: path.join(tmp, 'off') });
  assert.ok(readFileSync(path.join(tmp, 'on/anime/index.html'), 'utf8').includes('bx1-test.jpg'));
  assert.ok(!readFileSync(path.join(tmp, 'off/anime/index.html'), 'utf8').includes('bx1-test.jpg'));
});

test('pages par mois, par série et index : générées, liées et dans le sitemap', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = { DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'a'), AUTO_DIR: path.join(tmp, 'auto'), OUT_DIR: path.join(tmp, 'dist'), NOW: '2026-10-12T07:00:00Z' };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(dirs.DATA_DIR, 'manga.csv'));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json');
  writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.test', launched: true }));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { env: { ...process.env, ...dirs, CONFIG_FILE: cfg }, encoding: 'utf8' });
  const rd = (f) => readFileSync(path.join(tmp, 'dist', f), 'utf8');
  const idx = rd('series/index.html');
  const links = [...idx.matchAll(/href="\/serie\/([a-z0-9-]+)\/"/g)].map((m) => m[1]);
  assert.ok(links.length > 0, 'index des séries');
  for (const k of links) assert.ok(existsSync(path.join(tmp, 'dist/serie', k, 'index.html')), `page série ${k}`);
  assert.match(rd(`serie/${links[0]}/index.html`), /Prochain tome de/);
  const meta = (f) => ({ t: (rd(f).match(/<title>(.*?)<\/title>/) || [])[1], d: (rd(f).match(/name="description" content="(.*?)"/) || [])[1] });
  const withNext = links.map((k) => meta(`serie/${k}/index.html`)).find((m) => /sortie le \d/.test(m.t));
  assert.ok(withNext && /tome \d+ : /.test(withNext.t) && /Prochain tome de/.test(withNext.d) && withNext.d.length <= 160, 'titre avec tome et date, description avec « prochain tome »');
  assert.match(rd(`serie/${links[0]}/index.html`), /data-coll/);
  assert.match(rd('manga/index.html'), /class="own"/);
  const monthLinks = [...rd('sorties-manga/index.html').matchAll(/href="\/sorties-manga\/([a-z]+-\d{4})\/"/g)].map((m) => m[1]);
  assert.ok(monthLinks.length > 0);
  assert.match(rd(`sorties-manga/${monthLinks[0]}/index.html`), /Sorties manga de/);
  // référencement : icône lisible par Google, données structurées des mois et des séries, en-têtes de cache
  assert.ok(existsSync(path.join(tmp, 'dist/favicon.ico')) && existsSync(path.join(tmp, 'dist/favicon-48.png')));
  assert.match(rd('index.html'), /rel="icon" href="\/favicon\.ico"/);
  assert.ok(!/rel="icon" href="data:/.test(rd('index.html')), 'pas d\'icône en data: (Google ne la lit pas)');
  const ldOf = (f) => [...rd(f).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].flatMap((m) => [].concat(JSON.parse(m[1])));
  const monthLd = ldOf(`sorties-manga/${monthLinks[0]}/index.html`).find((j) => j['@type'] === 'CollectionPage');
  assert.ok(monthLd && monthLd.mainEntity.itemListElement.length > 0 && monthLd.mainEntity.itemListElement[0].item.datePublished, 'ItemList de tomes datés');
  assert.ok(ldOf(`serie/${links[0]}/index.html`).some((j) => j['@type'] === 'ComicSeries' && (Array.isArray(j.hasPart) ? j.hasPart.length : 0) > 0), 'ComicSeries avec ses tomes');
  assert.ok(rd('_headers').includes('/fonts/*'), 'cache long pour les polices');
  assert.match(rd(`sorties-manga/${monthLinks[0]}/index.html`), /href="\/editeur\/[a-z-]+\/"/, 'mois -> éditeurs');
  const sm = rd('sitemap.xml');
  assert.ok(sm.includes(`/serie/${links[0]}/`) && sm.includes('/sorties-manga/'));
});

test('badges : nouvelle série (tome 1 hors éditions spéciales) et premier épisode', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = { DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'a'), AUTO_DIR: path.join(tmp, 'auto'), OUT_DIR: path.join(tmp, 'dist'), NOW: '2026-10-12T07:00:00Z', CONFIG_FILE: path.join(ROOT, 'test/fixtures/site.config.json') };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  const H = 'Date de sortie,Éditeur,Série,Tome,Titre du tome (facultatif),ISBN-13,Prix (€),Statut,Source officielle (lien),Vérifié le,Notes';
  const line = (d, s, t, titre = '') => `${d},Kana,${s},${t},${titre},,7.5,Annoncé,https://exemple.test/,2026-10-12,`;
  writeFileSync(path.join(dirs.DATA_DIR, 'manga.csv'), [H,
    line('2026-10-20', 'Série Neuve', '1'),
    line('2026-10-21', 'Vieille Série', '1', 'Vieille Série tome 1 édition collector'),
    line('2026-10-22', 'Série Neuve', '2'),
    line('2026-10-23', 'Kickboxer Story', '1'),
    line('2026-10-24', 'Coffret Machin', '1')].join('\n'));
  writeFileSync(path.join(dirs.DATA_DIR, 'anime.json'), JSON.stringify({ generatedAt: '2026-10-12T05:00:00.000Z', episodes: [
    { airingAt: 1792000000, episode: 1, mediaId: 1, title: { romaji: 'Premier Anime', english: '', native: '' }, format: 'TV', popularity: 10, url: '', cover: '' },
    { airingAt: 1792003600, episode: 7, mediaId: 2, title: { romaji: 'Suite Anime', english: '', native: '' }, format: 'TV', popularity: 9, url: '', cover: '' }] }));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { env: { ...process.env, ...dirs }, encoding: 'utf8' });
  const page = readFileSync(path.join(tmp, 'dist/nouveautes/index.html'), 'utf8');
  assert.ok(page.includes('Série Neuve'));
  assert.ok(!page.includes('Vieille Série'), 'une édition collector n\'est pas une nouvelle série');
  assert.ok(!page.includes('Coffret Machin'));
  assert.ok(page.includes('Kickboxer Story'), 'box dans un mot ne doit pas exclure');
  assert.ok(page.includes('Premier Anime') && !page.includes('Suite Anime'));
  const m = JSON.parse(readFileSync(path.join(tmp, 'dist/data/manga.json'), 'utf8')).rows;
  assert.equal(m.filter((r) => r.nw).length, 2);
});

test('newsletter : formulaire et mentions seulement si formAction est renseigné', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  mkdirSync(path.join(tmp, 'data'));
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/site.config.json'), 'utf8'));
  const build = (extra, name) => {
    const cf = path.join(tmp, `${name}.json`);
    writeFileSync(cf, JSON.stringify({ ...cfg, ...extra }));
    const out = path.join(tmp, name);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { env: { ...process.env, DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'a'), AUTO_DIR: path.join(tmp, 'b'), OUT_DIR: out, CONFIG_FILE: cf, NOW: '2026-10-12T07:00:00Z' }, encoding: 'utf8' });
    return (f) => readFileSync(path.join(out, f), 'utf8');
  };
  const off = build({}, 'off');
  assert.ok(!off('index.html').includes('nl-form') && !off('newsletter/index.html').includes('<form') && off('newsletter/index.html').includes('noindex'));
  assert.ok(off('mentions-legales/index.html').includes('ne collecte pas de données personnelles'));
  const on = build({ newsletter: { formAction: 'https://exemple.com/s', emailField: 'fields[email]', provider: 'MailerLite' } }, 'on');
  assert.ok(on('index.html').includes('nl-form') && on('newsletter/index.html').includes('action="https://exemple.com/s"') && on('newsletter/index.html').includes('name="fields[email]"'));
  assert.ok(on('mentions-legales/index.html').includes('à MailerLite') && !on('mentions-legales/index.html').includes('ne collecte pas'));
  assert.ok(on('sitemap.xml').includes('/newsletter/'));
  const http = build({ newsletter: { formAction: 'http://exemple.com/s' } }, 'http');
  assert.ok(!http('index.html').includes('nl-form'), 'une adresse hors https est refusée');
});

test('ISBN : somme de contrôle et ISBN-10', async () => {
  const { isIsbn13, isbn10Of } = await import('../scripts/shops.mjs');
  assert.ok(isIsbn13('9782723488525') && !isIsbn13('9782723488526') && !isIsbn13('12345') && !isIsbn13(''));
  assert.equal(isbn10Of('9782723488525'), '2723488527');
  assert.equal(isbn10Of('9791032723425'), '');
});

test('résumés : collecte (pages simulées), puis affichage sur la page série et achat unique en haut', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = { DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'articles'), AUTO_DIR: path.join(tmp, 'auto'), OUT_DIR: path.join(tmp, 'dist'), CONFIG_FILE: path.join(ROOT, 'test/fixtures/site.config.json'), NOW: '2026-10-12T07:00:00Z', COLLECT_FIXTURES: path.join(ROOT, 'test/fixtures/synopsis') };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  const head = 'Date de sortie;Éditeur;Série;Tome;Titre du tome (facultatif);ISBN-13;Prix (€);Statut;Source officielle (lien);Vérifié le';
  writeFileSync(path.join(dirs.DATA_DIR, 'manga.csv'), [head,
    '2026-10-20;Kana;Sujet Test;3;;9782811664282;7,20;Confirmé;https://www.kana.fr/produit/sujet-test-t3/;',
    '2026-10-01;Kana;Sujet Test;2;;9782811664299;7,20;Paru;https://www.kana.fr/produit/sujet-test-t2/;',
    '2026-10-05;Kana;Sujet Vide;1;;9782723459112;7,20;Paru;https://www.kana.fr/produit/sujet-vide-t1/;',
    '2026-10-06;Kana;Sujet Vide;2;;9782723459129;7,20;Paru;https://www.kana.fr/produit/sujet-vide-t2/;'].join('\n'));
  const env = { ...process.env, ...dirs };
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/collect-synopsis.mjs')], { env, encoding: 'utf8' });
  assert.ok(out.includes('1 trouvés'), out);
  const syn = JSON.parse(read(dirs.DATA_DIR, 'synopsis.json'));
  assert.ok(syn['https://www.kana.fr/produit/sujet-test-t3/'].t.startsWith('Renji Jibo défend la porte') && syn['https://www.kana.fr/produit/sujet-test-t3/'].t.includes('citadelle interne !'));
  assert.equal(syn['https://www.kana.fr/produit/sujet-vide-t2/'].t, '', 'description trop courte : pas un résumé');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { env, encoding: 'utf8' });
  const page = read(dirs.OUT_DIR, 'serie/sujet-test/index.html');
  assert.ok(page.includes('class="synopsis"') && page.includes('Résumé du tome 3') && page.includes('Résumé de l\'éditeur'));
  const tile = (page.match(/class="tile rel vol[\s\S]*?<\/li>/g) || []);
  assert.ok(tile.some((t) => t.includes('Tome 3') && !t.includes('class="shops')), 'le tome mis en avant n\'a pas de boutons en double');
  const vide = read(dirs.OUT_DIR, 'serie/sujet-vide/index.html');
  assert.ok(!vide.includes('class="synopsis"'));
  assert.ok(vide.includes('Dernier tome paru : tome 2 ('), 'série sans sortie à venir : dernier tome paru');
  assert.ok(vide.indexOf('class="shops') < vide.indexOf('Déjà parus'), 'boutons d\'achat en haut même sans tome à venir');
});

test('synopsis anime + vignettes dans les articles (couvertures activées)', async () => {
  const lib = await import('../scripts/lib.mjs');
  assert.equal(lib.cleanSynopsis('Hello <br><br>world, this is a long enough synopsis for a test. (Source: X) [Written by MAL Rewrite]'), 'Hello world, this is a long enough synopsis for a test.');
  assert.equal(lib.cleanSynopsis('Trop court'), '');
  const html = lib.markdown('- [![Couverture de A](https://exemple.fr/a.jpg)](/serie/a/) **A** : texte\n  → [lien](/x/)\n- ![x](http://non-https/x.jpg) sans vignette\n- ![évil](javascript:alert(1))');
  assert.ok(html.includes('<li class="art-item"><a href="/serie/a/"') && html.includes('<img class="art-img" src="https://exemple.fr/a.jpg"'));
  assert.ok(!html.includes('http://non-https') || !/<img[^>]*http:\/\/non-https/.test(html), 'pas d\'image en http');
  assert.ok(!/<img[^>]*javascript:/.test(html));

  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = { DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'articles'), AUTO_DIR: path.join(tmp, 'auto'), OUT_DIR: path.join(tmp, 'dist'), CONFIG_FILE: path.join(tmp, 'config.json'), NOW: '2026-10-12T07:00:00Z' };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(dirs.DATA_DIR, 'manga.csv'));
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/site.config.json'), 'utf8'));
  const env = { ...process.env, ...dirs };
  const run = (script, ...args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env, encoding: 'utf8' });
  run('fetch-anime.mjs', '--from-file', path.join(ROOT, 'test/mock-anilist.json'));
  const eps = JSON.parse(read(dirs.DATA_DIR, 'anime.json')).episodes;
  assert.ok(eps.find((e) => e.synopsis.startsWith('A quiet student discovers') && !e.synopsis.includes('Source')));
  // couvertures désactivées : aucune image dans les articles
  writeFileSync(dirs.CONFIG_FILE, JSON.stringify(cfg));
  run('daily-articles.mjs');
  assert.ok(!read(dirs.AUTO_DIR, 'anime-2026-10-12.md').includes('!['));
  // couvertures activées
  writeFileSync(dirs.CONFIG_FILE, JSON.stringify({ ...cfg, showCovers: true }));
  run('daily-articles.mjs');
  const md = read(dirs.AUTO_DIR, 'anime-2026-10-12.md');
  assert.ok(md.includes('- [![Affiche de Test Series One](https://s4.anilist.co/'), md);
  run('build.mjs');
  const art = read(dirs.OUT_DIR, 'articles/anime-2026-10-12/index.html');
  assert.ok(art.includes('class="art-item"') && art.includes('class="art-img"'));
  const page = read(dirs.OUT_DIR, 'anime/1-test-series-one/index.html');
  assert.ok(page.includes('class="synopsis"') && page.includes('A quiet student discovers') && page.includes('en anglais'));
});

test('traduction des synopsis anime : désactivée rien ne change, avec traduction simulée le français s\'affiche', () => {
  const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mc-'));
  const dirs = { DATA_DIR: path.join(tmp, 'data'), ARTICLES_DIR: path.join(tmp, 'articles'), AUTO_DIR: path.join(tmp, 'auto'), OUT_DIR: path.join(tmp, 'dist'), CONFIG_FILE: path.join(ROOT, 'test/fixtures/site.config.json'), NOW: '2026-10-12T07:00:00Z' };
  mkdirSync(dirs.DATA_DIR); mkdirSync(dirs.ARTICLES_DIR);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(dirs.DATA_DIR, 'manga.csv'));
  const clean = { ...process.env, ...dirs }; delete clean.DEEPL_API_KEY; delete clean.ANTHROPIC_API_KEY; delete clean.TRANSLATE_MOCK; clean.TRANSLATE_PROVIDER = 'none';
  const run = (script, env = clean, ...args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env, encoding: 'utf8' });
  run('fetch-anime.mjs', clean, '--from-file', path.join(ROOT, 'test/mock-anilist.json'));
  assert.ok(run('translate-synopsis.mjs').includes('désactivée'));
  assert.ok(!existsSync(path.join(dirs.DATA_DIR, 'synopsis-fr.json')));
  run('build.mjs');
  assert.ok(read(dirs.OUT_DIR, 'anime/1-test-series-one/index.html').includes('en anglais'));
  const en = JSON.parse(read(dirs.DATA_DIR, 'anime.json')).episodes.find((e) => e.synopsis).synopsis;
  const mock = path.join(tmp, 'mock.json');
  writeFileSync(mock, JSON.stringify({ [en]: 'Un étudiant discret découvre une porte cachée dans la bibliothèque du lycée. Chaque nuit, elle s\'ouvre sur un monde différent.' }));
  const out = run('translate-synopsis.mjs', { ...clean, TRANSLATE_MOCK: mock });
  assert.ok(out.includes('1 synopsis traduits'), out);
  assert.ok(run('translate-synopsis.mjs', { ...clean, TRANSLATE_MOCK: mock }).includes('0 synopsis traduits'), 'déjà traduit : pas de nouvel appel');
  run('build.mjs');
  const page = read(dirs.OUT_DIR, 'anime/1-test-series-one/index.html');
  assert.ok(page.includes('Un étudiant discret') && page.includes('traduit automatiquement') && !page.includes('A quiet student'));
});

test('page /etat/ et message anime périmé', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'etat-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  writeFileSync(path.join(data, 'anime.json'), JSON.stringify({ generatedAt: '2026-10-01T00:00:00Z', episodes: [] }));
  writeFileSync(path.join(data, 'status.json'), JSON.stringify({ version: 1, sources: { 'Anime · AniList': { lastRun: '2026-10-12T03:00:00Z', ok: false, count: 0, note: '', lastSuccess: '2026-10-01T00:00:00Z', lastSuccessCount: 10, fails: 3 } } }));
  const out = path.join(tmp, 'out'); mkdirSync(path.join(tmp, 'art'));
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, ARTICLES_DIR: path.join(tmp, 'art'), AUTO_DIR: path.join(tmp, 'art'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const etat = readFileSync(path.join(out, 'etat/index.html'), 'utf8');
  assert.match(etat, /Anime · AniList/);
  assert.match(etat, /En retard/);
  assert.match(readFileSync(path.join(out, 'anime/index.html'), 'utf8'), /n'a pas pu être actualisé|n&#39;a pas pu être actualisé/);
  let failed = false;
  try { execFileSync('node', [path.join(ROOT, 'scripts/check-status.mjs')], { env, stdio: 'pipe' }); } catch { failed = true; }
  assert.ok(failed);
});

test('page des articles : séparation quotidien / hebdomadaire', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'art-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const auto = path.join(tmp, 'auto'); mkdirSync(auto);
  const fm = (t) => `---\ntitle: "${t}"\ndate: 2026-10-12\ndescription: "d"\nauto: true\ndraft: false\n---\n\nTexte\n`;
  writeFileSync(path.join(auto, 'manga-2026-10-12.md'), fm('Jour'));
  writeFileSync(path.join(auto, 'manga-semaine-2026-10-12.md'), fm('Semaine'));
  writeFileSync(path.join(auto, 'manga-mois-2026-11.md'), fm('Mois'));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, ARTICLES_DIR: path.join(tmp, 'none'), AUTO_DIR: auto, NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const h = readFileSync(path.join(out, 'articles/index.html'), 'utf8');
  assert.match(h, /id="t-hebdo"/); assert.match(h, /id="t-quotidien"/); assert.match(h, /id="t-mensuel"/);
  assert.ok(h.indexOf('id="t-mensuel"') < h.indexOf('id="t-hebdo"') && h.indexOf('id="t-hebdo"') < h.indexOf('id="t-quotidien"'));
});

test('phase 2 : pages /semaine/ et /recherche/, moteur de résultats copié', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'p2-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  assert.ok(existsSync(path.join(out, 'semaine/index.html')));
  assert.ok(existsSync(path.join(out, 'resultats.js')));
  assert.match(readFileSync(path.join(out, 'recherche/index.html'), 'utf8'), /noindex/);
  assert.doesNotMatch(readFileSync(path.join(out, 'index.html'), 'utf8'), /class="home-search"/);
});

test('goodies : lien produit direct avec tag quand data/goodies.csv existe, sinon recherche', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'gd-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  writeFileSync(path.join(data, 'goodies.csv'), 'serie;asin\nSérie Fictive Alpha;B0ABCDEF12\nSérie Fictive Alpha;B0ZZZZZZ99\nSérie Fictive Alpha;pas-un-asin\n');
  const cfg = path.join(tmp, 'site.config.json');
  writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8')), shops: { amazon: { tag: 'prochaintome-21' } } }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const a = readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8');
  assert.match(a, /amazon\.fr\/dp\/B0(ABCDEF12|ZZZZZZ99)\?tag=prochaintome-21/);
  const b = readFileSync(path.join(out, 'serie/serie-fictive-beta/index.html'), 'utf8');
  assert.match(b, /amazon\.fr\/s\?k=.*goodies.*tag=prochaintome-21/);
});

test('phase 3 : assets versionnés et sauvegarde/statuts présents', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'p3-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /recherche\.js\?v=[a-f0-9]{8}/);
  assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /style\.css\?v=[a-f0-9]{8}/);
  const js = readFileSync(path.join(out, 'suivi.js'), 'utf8');
  assert.match(js, /mc-statut/); assert.match(js, /prochain-tome-sauvegarde/);
  assert.match(readFileSync(path.join(out, '_headers'), 'utf8'), /\/data\/\*/);
});

test('analytics Cloudflare : balise seulement avec un jeton valide', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'an-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const go = (analytics, name) => {
    const cfg = path.join(tmp, `${name}.json`); writeFileSync(cfg, JSON.stringify({ ...base, analytics }));
    const out = path.join(tmp, name);
    execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env: { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' }, stdio: 'pipe' });
    return readFileSync(path.join(out, 'index.html'), 'utf8');
  };
  assert.ok(go({ cloudflareToken: 'a'.repeat(32) }, 'on').includes('static.cloudflareinsights.com/beacon.min.js'));
  assert.ok(!go({ cloudflareToken: 'pas-valide"><script>' }, 'off').includes('cloudflareinsights'));
});

test('visuels à partager : page et script publiés, lien dans le pied de page', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pt-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  assert.ok(existsSync(path.join(out, 'partager/index.html')) && existsSync(path.join(out, 'partager.js')));
  assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /href="\/partager\/"/);
  const part = JSON.parse(readFileSync(path.join(out, 'data/partage.json'), 'utf8'));
  assert.ok(part.months.length && part.months[0].total > 0 && Array.isArray(part.months[0].fresh) && Array.isArray(part.finished) && Array.isArray(part.genres), 'données des visuels : mois, séries terminées, genres');
  // la recherche du site s'ouvre depuis les barres de l'accueil, du calendrier manga et du calendrier anime
  for (const f of ['manga/index.html']) assert.match(readFileSync(path.join(out, f), 'utf8'), /<input type="search" id="f" data-gs /, f);
  assert.match(readFileSync(path.join(out, 'recherche.js'), 'utf8'), /input\[type=search\]\[data-gs\]/);
});

test('article du mois : généré à partir du 25 pour le mois suivant, une seule fois', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mois-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  const head = 'Date de sortie;Éditeur;Série;Tome;Titre du tome (facultatif);ISBN-13;Prix (€);Statut;Source officielle (lien);Vérifié le;Couverture (lien);Notes\n';
  writeFileSync(path.join(data, 'manga.csv'), head
    + '2026-11-04;Glénat;Série Neuve;1;;;;Annoncé;;;https://exemple.fr/c.jpg;\n'
    + '2026-11-04;Kana;Série Longue;12;;;;Annoncé;;;;\n'
    + '2026-11-10;Ki-oon;Coffret Spécial;;;;34,5;Annoncé;;;;\n');
  writeFileSync(path.join(data, 'adaptations.json'), JSON.stringify({ series: { 'serie-longue': { c: '2026-10-01', a: [{ id: 1, t: 'Longue', st: 'RELEASING', f: 'TV', u: '', s: [] }], i: null } } }));
  const auto = path.join(tmp, 'auto'); mkdirSync(auto);
  const env = { ...process.env, DATA_DIR: data, AUTO_DIR: auto, ARTICLES_DIR: path.join(tmp, 'n'), DATE: '2026-10-26', NOW: '2026-10-26T12:00:00Z' };
  const run = () => execFileSync('node', [path.join(ROOT, 'scripts/daily-articles.mjs')], { env, stdio: 'pipe' });
  run();
  const md = readFileSync(path.join(auto, 'manga-mois-2026-11.md'), 'utf8');
  assert.match(md, /title: "Manga : les sorties de novembre 2026, nos repères"/);
  assert.ok(!md.includes('2026 2026'));
  assert.ok(md.includes('![Couverture de Série Neuve tome 1]') || md.includes('**Série Neuve**'));
  assert.ok(md.includes('anime en cours de diffusion') && md.includes('34,50') );
  const before = md; writeFileSync(path.join(auto, 'manga-mois-2026-11.md'), before + '\nmarque');
  run();
  assert.ok(readFileSync(path.join(auto, 'manga-mois-2026-11.md'), 'utf8').endsWith('marque'), 'pas régénéré');
});

test('pages éditeurs : index, page par éditeur, lien depuis la fiche série et sitemap', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ed-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  assert.match(readFileSync(path.join(out, 'editeurs/index.html'), 'utf8'), /href="\/editeur\/glenat\/"/);
  const g = readFileSync(path.join(out, 'editeur/glenat/index.html'), 'utf8');
  assert.match(g, /Glénat : sorties manga/); assert.match(g, /BreadcrumbList/);
  assert.match(readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8'), /href="\/editeur\/glenat\/"/);
  assert.match(readFileSync(path.join(out, 'sitemap.xml'), 'utf8'), /\/editeur\/glenat\//);
});

test('fiche série : séries proches (auteur/genres) et articles qui la citent', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  const arts = path.join(tmp, 'n'); mkdirSync(arts);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const i = (au, g) => ({ a: [], i: { au, g, st: 'RELEASING', y: 2020 } });
  writeFileSync(path.join(data, 'adaptations.json'), JSON.stringify({ series: {
    'serie-fictive-alpha': { ...i(['Auteur Un', 'Dessinateur Deux'], ['Action', 'Fantasy']), i: { au: ['Auteur Un', 'Dessinateur Deux'], sc: ['Auteur Un'], ar: ['Dessinateur Deux'], g: ['Action', 'Fantasy'], st: 'RELEASING', y: 2020, v: 2 } },
    'serie-fictive-beta': i(['Auteur Un'], ['Drama']),
    'serie-fictive-gamma': i(['Autre'], ['Romance']),
  } }));
  writeFileSync(path.join(arts, 'test-alpha.md'), '---\ntitle: Focus sur Série Fictive Alpha\ndate: 2026-10-01\n---\nTexte.');
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: arts, AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const a = readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8');
  assert.match(a, /Si tu aimes/); assert.match(a, /class="carousel"/); assert.match(a, /href="\/serie\/serie-fictive-beta\/"/);
  assert.match(a, /<dt>Scénario<\/dt><dd>Auteur Un<\/dd>/); assert.match(a, /<dt>Dessin<\/dt><dd>Dessinateur Deux<\/dd>/);
  assert.match(a, /À lire aussi/); assert.match(a, /Focus sur Série Fictive Alpha/);
  assert.doesNotMatch(a, /href="\/serie\/serie-fictive-gamma\//);
  assert.doesNotMatch(readFileSync(path.join(out, 'serie/serie-fictive-gamma/index.html'), 'utf8'), /Si tu aimes/);
});

test('statuts par tome : sélecteur dans le calendrier et sur la fiche série, script de gestion publié', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tst-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  assert.match(readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8'), /<select class="tst"[^>]*>.*Précommandé/);
  assert.match(readFileSync(path.join(out, 'manga/index.html'), 'utf8'), /<select class="tst"/);
  const js = readFileSync(path.join(ROOT, 'scripts/suivi.js'), 'utf8');
  assert.match(js, /mc-tome/);
});

test('fiche série : date estimée/confirmée et historique des changements de date', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hist-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  writeFileSync(path.join(data, 'changes.json'), JSON.stringify({ version: 1, since: '2026-10-01', updated: '2026-10-11', seen: {}, events: [
    { day: '2026-10-10', type: 'date', k: 'x', e: 'Glénat', s: 'Série Fictive Alpha', t: '1', from: '2026-11-01', to: '2026-11-09' },
  ] }));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const a = readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8');
  assert.match(a, /Historique des dates \(1\)/); assert.match(a, /Reporté de 8 jours/);
  assert.match(a, /Date (estimée|confirmée)/);
  assert.match(readFileSync(path.join(out, 'serie/serie-fictive-beta/index.html'), 'utf8'), /Aucun changement de date/);
});

test('compteur de clics : liens marqués, script publié, Worker (enregistrement, validation, rapport protégé)', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clic-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const html = readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8');
  assert.match(html, /data-sh="amazon" data-k="serie-fictive-alpha"/);
  assert.match(html, /clic\.js/);
  assert.ok(readFileSync(path.join(out, 'clic.js'), 'utf8').includes('/api/clic'));
  const w = await import(path.join(ROOT, 'worker/index.js'));
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
  const e = { CLICS: kv, STATS_KEY: 'secret-test-key' };
  const post = (body, headers = {}) => w.default.fetch(new Request('https://exemple.fr/api/clic', { method: 'POST', body: JSON.stringify(body), headers }), e);
  const r1 = await post({ sh: 'amazon', k: 'serie-fictive-alpha', p: 'serie' });
  assert.equal(r1.status, 204); assert.equal(r1.headers.get('X-Clic'), 'ok');
  await post({ sh: 'amazon', k: 'serie-fictive-alpha', p: 'serie' });
  await post({ sh: 'fnac', k: 'serie-fictive-beta', p: 'manga' });
  await post({ sh: 'pirate', k: 'x', p: 'serie' });              // boutique inconnue
  await post({ sh: 'amazon', k: 'Pas Valide!', p: 'serie' });      // série invalide
  await post({ sh: 'amazon', k: 'x', p: 'serie' }, { Origin: 'https://autre-site.fr' }); // autre origine
  assert.equal(store.size, 2);
  assert.equal((await w.default.fetch(new Request('https://exemple.fr/api/clics?cle=mauvais'), e)).status, 404);
  const rep = await w.default.fetch(new Request('https://exemple.fr/api/clics?cle=secret-test-key&json=1'), e);
  const j = await rep.json();
  assert.equal(j.total, 3); assert.deepEqual(j.shops[0], ['amazon', 2]);
  assert.match(await (await w.default.fetch(new Request('https://exemple.fr/api/clics?cle=secret-test-key'), e)).text(), /serie-fictive-alpha/);
});

test('sélections éditoriales : pages de genres (≥3 séries), liens depuis la fiche série, séries terminées', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const i = (g, st) => ({ a: [], i: { au: [], g, st, y: 2020 } });
  writeFileSync(path.join(data, 'adaptations.json'), JSON.stringify({ series: {
    'serie-fictive-alpha': i(['Action', 'Drama'], 'FINISHED'), 'serie-fictive-beta': i(['Action'], 'RELEASING'), 'serie-fictive-gamma': i(['Action', 'Romance'], 'RELEASING'),
  } }));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const g = readFileSync(path.join(out, 'genre/action/index.html'), 'utf8');
  assert.match(g, /<h1>Mangas action<\/h1>/); assert.match(g, /3 séries action/); assert.match(g, /BreadcrumbList/);
  assert.equal(existsSync(path.join(out, 'genre/drame')), false); // 1 seule série : pas de page
  assert.match(readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8'), /href="\/genre\/action\/"/);
  assert.match(readFileSync(path.join(out, 'genres/index.html'), 'utf8'), /href="\/genre\/action\/"/);
  assert.match(readFileSync(path.join(out, 'sitemap.xml'), 'utf8'), /\/genre\/action\//);
});

test('accueil : tuiles de jours cliquables vers /semaine/, blocs du jour en carrousel avec les couvertures', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr', showCovers: true }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const h = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(h, /class="d-link" href="\/semaine\/#j-2026-10-12"/);
  assert.match(h, /class="two stack"/);
  assert.match(h, /<ul class="hscroll"/);
});

test('accueil et navigation : menu demandé, ordre des blocs, raccourcis et sélections', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const h = readFileSync(path.join(out, 'index.html'), 'utf8');
  const nav = h.match(/<nav aria-label="Navigation principale">(.*?)<\/nav>/s)[1];
  const labels = [...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Accueil', 'Sorties manga', 'Calendrier anime', 'Séries', 'Ma collection', 'Actualités']);
  const pos = (t) => h.indexOf(t);
  assert.doesNotMatch(h, /role="search"/);
  assert.ok(pos('id="t-days"') < pos('id="pour-toi"') && pos('id="pour-toi"') < pos('Anime du jour') && pos('Anime du jour') < pos('Derniers articles'), 'sorties de la semaine en tête, avant « Pour toi »');
  assert.doesNotMatch(h, /class="quick"/);
  // une fiche série met « Séries » en évidence
  assert.match(readFileSync(path.join(out, 'serie/serie-fictive-alpha/index.html'), 'utf8'), /href="\/series\/" aria-current="page"/);
});

test('calendrier manga : filtre par type de publication, navigation par mois, chargement progressif des mois', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cal-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  const csv = 'Date de sortie,Éditeur,Série,Tome,Titre du tome (facultatif),ISBN-13,Prix (€),Statut,Source officielle (lien),Vérifié le,Notes\n'
    + ['2026-10-14,Glénat,Alpha,1,Alpha T1,,,annonce,,,', '2026-10-15,Glénat,Alpha,2,Alpha T2 - Collector,,,annonce,,,', '2026-11-04,Kana,Beta,1,,,,annonce,,,', '2026-12-02,Pika,Gamma,1,,,,annonce,,,', '2027-01-06,Pika,Delta,1,,,,annonce,,,'].join('\n') + '\n';
  writeFileSync(path.join(data, 'manga.csv'), csv);
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const h = readFileSync(path.join(out, 'manga/index.html'), 'utf8');
  assert.match(h, /data-attr="ty"[^>]*>Collector/); assert.match(h, /data-ty="collector"/);
  assert.match(h, /<template id="mois-tpl">/); assert.match(h, /id="plus-btn"/);
  assert.ok(h.indexOf('<template id="mois-tpl">') > h.indexOf('Novembre 2026') && h.indexOf('Décembre 2026') > h.indexOf('<template id="mois-tpl">'), 'seuls 2 mois dans la page, les suivants à la demande');
  assert.match(h, /class="chiprow monthjump"/); assert.match(h, /href="\/sorties-manga\/decembre-2026\/"/);
});

test('page Ma collection : nav, page noindex, script, statut À lire', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cal-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  const csv = 'Date de sortie,Éditeur,Série,Tome,Titre du tome (facultatif),ISBN-13,Prix (€),Statut,Source officielle (lien),Vérifié le,Notes\n'
    + ['2026-10-14,Glénat,Alpha,1,Alpha T1,,,annonce,,,', '2026-10-15,Glénat,Alpha,2,Alpha T2 - Collector,,,annonce,,,', '2026-11-04,Kana,Beta,1,,,,annonce,,,', '2026-12-02,Pika,Gamma,1,,,,annonce,,,', '2027-01-06,Pika,Delta,1,,,,annonce,,,'].join('\n') + '\n';
  writeFileSync(path.join(data, 'manga.csv'), csv);
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: out, CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: path.join(tmp, 'n2'), NOW: '2026-10-12T07:00:00Z' };
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const c = readFileSync(path.join(out, 'ma-collection/index.html'), 'utf8');
  assert.match(c, /id="coll-app"/); assert.match(c, /<meta name="robots" content="noindex/); assert.match(c, /collection\.js\?v=/);
  assert.ok(existsSync(path.join(out, 'collection.js')));
  const h = readFileSync(path.join(out, 'manga/index.html'), 'utf8');
  assert.match(h, /href="\/ma-collection\/"[^>]*>Ma collection/); assert.doesNotMatch(h, /href="\/mon-planning\/"[^>]*>Ma collection/);
  assert.match(h, /<option value="r">À lire<\/option>/);
  assert.ok(existsSync(path.join(out, 'mon-planning/index.html')));
});

test('dossiers automatiques : fichiers générés, idempotents, section dédiée dans /articles/', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dos-'));
  const data = path.join(tmp, 'data'); mkdirSync(data);
  const auto = path.join(tmp, 'auto');
  const csv = 'Date de sortie,Éditeur,Série,Tome,Titre du tome (facultatif),ISBN-13,Prix (€),Statut,Source officielle (lien),Vérifié le,Notes\n'
    + ['2026-11-04,Kana,Serie Un,1,,,,annonce,,,', '2026-11-05,Kana,Serie Deux,1,,,,annonce,,,', '2026-11-06,Kana,Serie Trois,4,Serie Trois - Collector,,,annonce,,,', '2026-11-07,Kana,Serie Trois,5,Coffret Serie Trois,,,annonce,,,', '2026-11-09,Kana,Serie Quatre,2,Serie Quatre Artbook,,,annonce,,,', '2026-11-10,Kana,Serie Cinq,2,,,,annonce,,,'].join('\n') + '\n';
  writeFileSync(path.join(data, 'manga.csv'), csv);
  const base = JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, siteUrl: 'https://exemple.fr' }));
  const env = { ...process.env, DATA_DIR: data, OUT_DIR: path.join(tmp, 'out'), CONFIG_FILE: cfg, ARTICLES_DIR: path.join(tmp, 'n'), AUTO_DIR: auto, NOW: '2026-11-12T07:00:00Z' };
  const o1 = execFileSync('node', [path.join(ROOT, 'scripts/dossiers-auto.mjs')], { env }).toString();
  assert.match(o1, /[1-9]\d* fichier/);
  for (const f of ['dossier-nouvelles-series-2026-11.md', 'dossier-editions-speciales-2026-11.md', 'dossier-kana-2026-11.md']) assert.ok(existsSync(path.join(auto, f)), f);
  assert.match(execFileSync('node', [path.join(ROOT, 'scripts/dossiers-auto.mjs')], { env }).toString(), /0 fichier/, 'second passage : rien à réécrire');
  execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env, stdio: 'pipe' });
  const a = readFileSync(path.join(tmp, 'out/articles/index.html'), 'utf8');
  assert.match(a, /id="t-dossier"/); assert.match(a, /Dossiers du mois/);
  assert.doesNotMatch(readFileSync(path.join(auto, 'dossier-kana-2026-11.md'), 'utf8'), /href="\/serie\/serie-fictive/);
});

test('accueil : boutons de streaming sur les tuiles anime du jour ; articles : sélecteur de type et boutons', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ui-'));
  const data = path.join(tmp, 'data'); mkdirSync(data); mkdirSync(path.join(tmp, 'a'));
  cpSync(path.join(ROOT, 'test/fixtures/manga.csv'), path.join(data, 'manga.csv'));
  writeFileSync(path.join(tmp, 'a/x.md'), '---\ntitle: "Essai"\ndate: 2026-10-01\ndraft: false\n---\n\nTexte.\n');
  writeFileSync(path.join(tmp, 'a/auto.md'), '---\ntitle: "Sorties"\ndate: 2026-10-05\nauto: true\ndraft: false\n---\n\n- **Série** (Kana)\n  → [Calendrier manga](/manga/) · [Page de la série](/serie/serie-fictive-alpha/)\n');
  const base = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/site.config.json'), 'utf8'));
  const cfg = path.join(tmp, 'c.json'); writeFileSync(cfg, JSON.stringify({ ...base, showCovers: true }));
  const out = path.join(tmp, 'out');
  const env = { ...process.env, DATA_DIR: data, ARTICLES_DIR: path.join(tmp, 'a'), AUTO_DIR: path.join(tmp, 'auto'), OUT_DIR: out, CONFIG_FILE: cfg, NOW: '2026-10-12T07:00:00Z' };
  const run = (s, ...a) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', s), ...a], { env, encoding: 'utf8' });
  run('fetch-anime.mjs', '--from-file', path.join(ROOT, 'test/mock-anilist.json'));
  run('fetch-adaptations.mjs', '--from-file', path.join(ROOT, 'test/mock-adaptations.json'));
  run('build.mjs');
  assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /class="shops shops-sm t-shops"><a class="stream s-crunchyroll"/);
  const arts = readFileSync(path.join(out, 'articles/index.html'), 'utf8');
  assert.match(arts, /<select id="art-type">/); assert.match(arts, /id="t-quotidien"|id="t-redac"/);
  assert.match(readFileSync(path.join(out, 'articles/auto/index.html'), 'utf8'), /<span class="art-acts"><a class="chip"[^>]*>Calendrier manga<\/a><a class="chip"[^>]*>Page de la série<\/a><\/span>/);
});
