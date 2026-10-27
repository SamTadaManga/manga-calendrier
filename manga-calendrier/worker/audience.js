// Mesure d'audience maison, sans cookie et sans adresse IP enregistrée.
// Principe (comme Plausible) : chaque jour, un « sel » aléatoire est tiré puis jeté le lendemain.
// Un visiteur est reconnu dans la journée par une empreinte = SHA-256(sel du jour + IP + navigateur),
// tronquée. L'IP elle-même n'est jamais stockée et, une fois le sel jeté, l'empreinte ne permet plus
// de retrouver personne. Conséquence : un même visiteur revenu deux jours différents compte deux fois
// dans les « visiteurs uniques » d'une période (on additionne les visiteurs uniques de chaque jour).
// Les données vivent dans un Durable Object SQLite (classe Audience), conservées 13 mois.

const SESSION_GAP = 30 * 60 * 1000; // 30 min d'inactivité = nouvelle visite
const MAX_DWELL = 30 * 60 * 1000;   // temps passé sur une page plafonné à 30 min
const RETENTION = 395 * 24 * 3600 * 1000;
const LIVE = 5 * 60 * 1000;

const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
export function parisParts(ms) {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: parseInt(p.hour, 10) % 24, dow: DOW[p.weekday] || 0 };
}
export const shiftDay = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayCount = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1;

export const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|python|curl|wget|go-http|java\/|axios|node-fetch|phantom|selenium|puppeteer|playwright/i;
export function parseUA(ua = '') {
  const appareil = /iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'Tablette'
    : /Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua) ? 'Mobile'
      : 'Ordinateur';
  const nav = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS|Chromium/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Autre';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Autre';
  return { appareil, nav, os };
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|qwant|ecosia|yahoo|yandex|brave|startpage|lilo|baidu)\./;
const SOCIAL = /(^|\.)(facebook|fb|instagram|t|twitter|x|reddit|tiktok|youtube|youtu|discord|discordapp|pinterest|linkedin|threads|bsky|mastodon|snapchat|whatsapp|telegram|messenger)\.(com|co|be|app|net|org|social|me|gg)$/;
export function canal(ref, utm) {
  if (utm) return 'Campagnes';
  if (!ref) return 'Accès direct';
  if (SEARCH.test(ref)) return 'Moteurs de recherche';
  if (SOCIAL.test(ref) || /^(l|lm|m)\.facebook\.com$/.test(ref)) return 'Réseaux sociaux';
  return 'Autres sites';
}
const rubrique = (p) => { const s = p.split('/')[1] || ''; return s ? s.slice(0, 40) : 'accueil'; };

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
export function cleanEvent(b) {
  if (!b || typeof b !== 'object') return null;
  const id = String(b.id || '');
  if (!/^[a-z0-9]{8,24}$/.test(id)) return null;
  if (b.e === 'v') {
    let p = clean(b.p, 200);
    if (!p.startsWith('/')) return null;
    try { p = decodeURI(p); } catch { /* garde tel quel */ }
    const ref = clean(b.r, 100).toLowerCase().replace(/^www\./, '');
    return {
      e: 'v', id, p, ref: /^[a-z0-9.-]*$/.test(ref) ? ref : '', utm: clean(b.u, 60).toLowerCase(),
      n: b.n ? 1 : 0, w: Math.max(0, Math.min(10000, parseInt(b.w, 10) || 0)),
      q: clean(b.q, 80).toLowerCase().replace(/\s+/g, ' '), x: b.x ? 1 : 0,
    };
  }
  if (b.e === 'f') {
    const num = (x, max) => Math.max(0, Math.min(max, Math.round(Number(x) || 0)));
    return { e: 'f', id, d: num(b.d, MAX_DWELL), sc: num(b.sc, 100), c: num(b.c, 120000) };
  }
  return null;
}

async function hash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf).slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS vues(id TEXT PRIMARY KEY, ts INTEGER, jour TEXT, heure INTEGER, dow INTEGER, v TEXT, s TEXT,
    chemin TEXT, rubrique TEXT, ref TEXT, recherche TEXT, e404 INTEGER, duree INTEGER DEFAULT 0, scroll INTEGER DEFAULT 0, charge INTEGER DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS vues_jour ON vues(jour)',
  'CREATE INDEX IF NOT EXISTS vues_ts ON vues(ts)',
  `CREATE TABLE IF NOT EXISTS sessions(s TEXT PRIMARY KEY, v TEXT, jour TEXT, debut INTEGER, fin INTEGER, pages INTEGER, duree INTEGER DEFAULT 0,
    entree TEXT, sortie TEXT, ref TEXT, utm TEXT, canal TEXT, pays TEXT, appareil TEXT, nav TEXT, os TEXT, nouveau INTEGER)`,
  'CREATE INDEX IF NOT EXISTS sessions_v ON sessions(v, fin)',
  'CREATE INDEX IF NOT EXISTS sessions_jour ON sessions(jour)',
  'CREATE TABLE IF NOT EXISTS sel(jour TEXT PRIMARY KEY, valeur TEXT)',
];

// `sql(query, ...params)` doit renvoyer un tableau de lignes (objets).
export class AudienceStore {
  constructor(sql) { this.sql = sql; this.salt = null; }
  init() { for (const q of SCHEMA) this.sql(q); }
  one(q, ...p) { return this.sql(q, ...p)[0] || {}; }

  saltFor(jour, now) {
    if (this.salt && this.salt.jour === jour) return this.salt.valeur;
    let row = this.sql('SELECT valeur FROM sel WHERE jour = ?', jour)[0];
    if (!row) {
      const valeur = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
      this.sql('DELETE FROM sel WHERE jour <> ?', jour); // le sel de la veille est détruit
      this.sql('INSERT INTO sel(jour, valeur) VALUES (?, ?)', jour, valeur);
      this.sql('DELETE FROM vues WHERE ts < ?', now - RETENTION);
      this.sql('DELETE FROM sessions WHERE fin < ?', now - RETENTION);
      row = { valeur };
    }
    this.salt = { jour, valeur: row.valeur };
    return row.valeur;
  }

  // meta : { now, ip, ua, pays, host }
  async event(ev, meta) {
    const now = meta.now;
    if (ev.e === 'v') {
      if (this.sql('SELECT 1 AS x FROM vues WHERE id = ?', ev.id).length) return 'doublon';
      const { jour, heure, dow } = parisParts(now);
      const v = await hash(`${this.saltFor(jour, now)}|${meta.ip}|${meta.ua}|${meta.host}`);
      const cur = this.sql('SELECT s FROM sessions WHERE v = ? AND fin > ? ORDER BY fin DESC LIMIT 1', v, now - SESSION_GAP)[0];
      let s;
      if (cur) {
        s = cur.s;
        this.sql('UPDATE sessions SET fin = ?, pages = pages + 1, sortie = ? WHERE s = ?', now, ev.p, s);
      } else {
        s = ev.id;
        const ua = parseUA(meta.ua);
        this.sql(`INSERT INTO sessions(s, v, jour, debut, fin, pages, duree, entree, sortie, ref, utm, canal, pays, appareil, nav, os, nouveau)
          VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s, v, jour, now, now, ev.p, ev.p, ev.ref, ev.utm, canal(ev.ref, ev.utm), meta.pays || 'XX', ua.appareil, ua.nav, ua.os, ev.n);
      }
      this.sql(`INSERT INTO vues(id, ts, jour, heure, dow, v, s, chemin, rubrique, ref, recherche, e404)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ev.id, now, jour, heure, dow, v, s, ev.p, ev.x ? '404' : rubrique(ev.p), ev.ref, ev.q, ev.x);
      return 'ok';
    }
    if (ev.e === 'f') {
      const row = this.sql('SELECT s, duree FROM vues WHERE id = ?', ev.id)[0];
      if (!row) return 'inconnu';
      const delta = Math.max(0, ev.d - (row.duree || 0));
      this.sql('UPDATE vues SET duree = MAX(duree, ?), scroll = MAX(scroll, ?), charge = CASE WHEN ? > 0 THEN ? ELSE charge END WHERE id = ?',
        ev.d, ev.sc, ev.c, ev.c, ev.id);
      if (delta) this.sql('UPDATE sessions SET duree = duree + ?, fin = MAX(fin, ?) WHERE s = ?', delta, now, row.s);
      return 'ok';
    }
    return 'ignore';
  }

  // maxTs : ne compte que ce qui s'est passé avant cet instant (comparer « aujourd'hui jusqu'à maintenant » à « hier à la même heure »)
  totals(de, a, maxTs = 8.64e15) {
    const s = this.one(`SELECT COUNT(*) AS sessions, COALESCE(AVG(duree), 0) AS duree, COALESCE(AVG(pages), 0) AS pages,
      COALESCE(SUM(pages = 1), 0) AS rebonds, COALESCE(SUM(pages >= 2 OR duree >= 10000), 0) AS engagees, COALESCE(SUM(nouveau), 0) AS nouveaux
      FROM sessions WHERE jour BETWEEN ? AND ? AND debut <= ?`, de, a, maxTs);
    const v = this.one('SELECT COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM vues WHERE jour BETWEEN ? AND ? AND ts <= ?', de, a, maxTs);
    const med = s.sessions ? this.one('SELECT duree FROM sessions WHERE jour BETWEEN ? AND ? AND debut <= ? ORDER BY duree LIMIT 1 OFFSET ?', de, a, maxTs, Math.floor(s.sessions / 2)).duree || 0 : 0;
    return {
      visiteurs: v.visiteurs || 0, sessions: s.sessions || 0, vues: v.vues || 0,
      dureeMoy: Math.round(s.duree || 0), dureeMed: med, pagesParVisite: s.sessions ? Number((s.pages || 0).toFixed(2)) : 0,
      rebond: s.sessions ? s.rebonds / s.sessions : 0, engagement: s.sessions ? s.engagees / s.sessions : 0,
      nouveaux: s.sessions ? s.nouveaux / s.sessions : 0,
    };
  }

  stats(de, a, now) {
    const n = dayCount(de, a);
    const pa = shiftDay(de, -1); const pde = shiftDay(de, -n);
    const rows = (q, ...p) => this.sql(q, ...p);
    const R = [de, a];
    const top = (col, lim = 15, table = 'sessions', extra = '') => rows(`SELECT ${col} AS cle, COUNT(*) AS n, COALESCE(AVG(duree), 0) AS duree
      FROM ${table} WHERE jour BETWEEN ? AND ? ${extra} GROUP BY ${col} ORDER BY n DESC LIMIT ${lim}`, ...R)
      .map((r) => ({ cle: r.cle, n: r.n, duree: Math.round(r.duree) }));
    const parJour = (x, y) => {
      const d = Object.fromEntries(rows('SELECT jour, AVG(duree) AS d FROM sessions WHERE jour BETWEEN ? AND ? GROUP BY jour', x, y).map((r) => [r.jour, Math.round(r.d || 0)]));
      return rows('SELECT jour, COUNT(*) AS vues, COUNT(DISTINCT v) AS visiteurs, COUNT(DISTINCT s) AS sessions FROM vues WHERE jour BETWEEN ? AND ? GROUP BY jour ORDER BY jour', x, y)
        .map((r) => ({ ...r, duree: d[r.jour] || 0 }));
    };
    return {
      de, a, genere: now,
      totaux: this.totals(de, a),
      // si la période se termine aujourd'hui, la période précédente s'arrête au même moment de la journée
      precedent: { de: pde, a: pa, ...this.totals(pde, pa, parisParts(now).jour === a ? now - n * 86400000 : undefined) },
      jours: parJour(de, a),
      joursPrecedents: parJour(pde, pa),
      heures: rows('SELECT heure AS cle, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM vues WHERE jour BETWEEN ? AND ? GROUP BY heure', ...R),
      semaine: rows('SELECT dow AS cle, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM vues WHERE jour BETWEEN ? AND ? GROUP BY dow', ...R),
      pages: rows(`SELECT chemin AS cle, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs, AVG(NULLIF(duree, 0)) AS temps,
        AVG(NULLIF(scroll, 0)) AS scroll, AVG(NULLIF(charge, 0)) AS charge FROM vues WHERE jour BETWEEN ? AND ? AND e404 = 0
        GROUP BY chemin ORDER BY vues DESC LIMIT 50`, ...R)
        .map((r) => ({ cle: r.cle, vues: r.vues, visiteurs: r.visiteurs, temps: Math.round(r.temps || 0), scroll: Math.round(r.scroll || 0), charge: Math.round(r.charge || 0) })),
      rubriques: rows(`SELECT rubrique AS cle, COUNT(*) AS n, AVG(NULLIF(duree, 0)) AS duree FROM vues WHERE jour BETWEEN ? AND ? AND e404 = 0
        GROUP BY rubrique ORDER BY n DESC LIMIT 15`, ...R).map((r) => ({ cle: r.cle, n: r.n, duree: Math.round(r.duree || 0) })),
      entrees: rows(`SELECT entree AS cle, COUNT(*) AS n, SUM(pages = 1) AS rebonds FROM sessions WHERE jour BETWEEN ? AND ?
        GROUP BY entree ORDER BY n DESC LIMIT 15`, ...R),
      sorties: top('sortie'),
      canaux: rows(`SELECT canal AS cle, COUNT(*) AS n, AVG(duree) AS duree, AVG(pages) AS pages, SUM(pages = 1) AS rebonds
        FROM sessions WHERE jour BETWEEN ? AND ? GROUP BY canal ORDER BY n DESC`, ...R)
        .map((r) => ({ cle: r.cle, n: r.n, duree: Math.round(r.duree || 0), pages: Number((r.pages || 0).toFixed(2)), rebonds: r.rebonds })),
      referents: top('ref', 20, 'sessions', "AND ref <> ''"),
      campagnes: top('utm', 15, 'sessions', "AND utm <> ''"),
      pays: top('pays', 20),
      appareils: top('appareil', 5),
      navigateurs: top('nav', 8),
      systemes: top('os', 8),
      recherches: rows(`SELECT recherche AS cle, COUNT(*) AS n FROM vues WHERE jour BETWEEN ? AND ? AND recherche <> ''
        GROUP BY recherche ORDER BY n DESC LIMIT 30`, ...R),
      introuvables: rows(`SELECT chemin AS cle, COUNT(*) AS n, MAX(ref) AS ref FROM vues WHERE jour BETWEEN ? AND ? AND e404 = 1
        GROUP BY chemin ORDER BY n DESC LIMIT 20`, ...R),
      direct: {
        visiteurs: this.one('SELECT COUNT(DISTINCT v) AS n FROM vues WHERE ts > ?', now - LIVE).n || 0,
        pages: rows('SELECT chemin AS cle, COUNT(DISTINCT v) AS n FROM vues WHERE ts > ? GROUP BY chemin ORDER BY n DESC LIMIT 10', now - LIVE),
      },
    };
  }
}

// Durable Object : une seule instance (« prochaintome ») qui détient la base SQLite.
export class Audience {
  constructor(ctx) {
    this.store = new AudienceStore((q, ...p) => ctx.storage.sql.exec(q, ...p).toArray());
    ctx.blockConcurrencyWhile(async () => this.store.init());
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/event' && request.method === 'POST') {
      const { ev, meta } = await request.json();
      return new Response(await this.store.event(ev, meta));
    }
    if (url.pathname === '/stats') {
      return Response.json(this.store.stats(url.searchParams.get('de'), url.searchParams.get('a'), Number(url.searchParams.get('now')) || Date.now()));
    }
    return new Response('Introuvable', { status: 404 });
  }
}
