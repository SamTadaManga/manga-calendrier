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
  parseFrontmatter,
} from '../scripts/lib.mjs';
import { splitTitle, robotsAllows, parseKioon, decode } from '../scripts/collectors.mjs';
import { updateChanges, emptyState } from '../scripts/changes.mjs';

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
  const anime = JSON.parse(read(dirs.DATA_DIR, 'anime.json'));
  assert.equal(anime.episodes.length, 6, 'filtre : adulte, Chine, musique, hier et hors fenêtre exclus');
  assert.ok(anime.episodes.every((e) => e.title && typeof e.airingAt === 'number'));

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
  assert.ok(sp.includes('Alpha Old') && sp.includes('en cours de diffusion') && sp.includes('Prochain épisode'), 'encadré de la page série');
  const animePage = read(dist('anime/index.html'));
  assert.ok(animePage.includes('Test Series One') && animePage.includes('Shiken Ni'));
  assert.ok(animePage.includes('class="bridge" href="/serie/serie-fictive-alpha/"') && read(dirs.OUT_DIR, 'serie/serie-fictive-alpha/index.html').includes('Adapté en anime'), 'pont anime vers manga');
  assert.ok(animePage.includes('class="stream s-crunchyroll"') && animePage.includes('Crunchyroll') && !animePage.includes('evil.example'), 'plateformes de streaming');
  assert.ok(dist('theme.js') && existsSync(dist('theme.js')) && existsSync(dist('agenda/kana.ics')), 'thème et agendas par éditeur');
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
  assert.ok(/Glénat : 3/.test(out) && /Kana : 3/.test(out) && /Pika : 4/.test(out) && /Ki-oon : 3/.test(out) && !/Akata/.test(out), out);
  const csv = readFileSync(path.join(tmp, 'manga-auto.csv'), 'utf8');
  assert.ok(!csv.includes('Lou ! Sonata'), 'la BD Glénat est exclue');
  assert.ok(!csv.includes('Vieux Titre') && !csv.includes('2026-05-20'), 'dates hors fenêtre exclues');
  assert.equal((csv.match(/,9782344077573,/g) || []).length, 1, 'doublon fusionné');
  assert.ok(csv.includes('Wind Breaker,24') && csv.includes('Übel Blatt II,4,,9791032723999,"8,45"'));
  assert.ok(csv.includes('Paru') && csv.includes('Annoncé'));
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

  build({ showCovers: true, launched: false });
  const page = read(dirs.OUT_DIR, 'manga/index.html');
  assert.ok(page.includes('class="cover-img"') && page.includes('referrerpolicy="no-referrer"') && page.includes('loading="lazy"'));
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
  assert.match(rd(`serie/${links[0]}/index.html`), /data-coll/);
  assert.match(rd('manga/index.html'), /class="own"/);
  const monthLinks = [...rd('sorties-manga/index.html').matchAll(/href="\/sorties-manga\/([a-z]+-\d{4})\/"/g)].map((m) => m[1]);
  assert.ok(monthLinks.length > 0);
  assert.match(rd(`sorties-manga/${monthLinks[0]}/index.html`), /Sorties manga de/);
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
