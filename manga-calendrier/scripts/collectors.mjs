// Analyseurs (parsers) des pages « planning » des éditeurs. Fonctions pures : texte reçu -> liste de sorties.
// Chaque sortie : { date:'AAAA-MM-JJ', editeur, serie, tome, titre, isbn, prix, source }.
// On ne lit que des faits (titre, tome, date, prix, ISBN) : ni images, ni résumés.

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„', hellip: '…', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', middot: '·', times: '×', deg: '°', euro: '€', oelig: 'œ', OElig: 'Œ', szlig: 'ß',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yuml: 'ÿ',
  Agrave: 'À', Acirc: 'Â', Auml: 'Ä', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Icirc: 'Î', Iuml: 'Ï',
  Ocirc: 'Ô', Ouml: 'Ö', Ugrave: 'Ù', Ucirc: 'Û', Uuml: 'Ü',
};
const decodeOnce = (s) =>
  String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
  });
// deux passes : certaines pages encodent deux fois (&amp;rsquo;)
export const decode = (s) => decodeOnce(decodeOnce(s)).replace(/\s+/g, ' ').trim();
const strip = (h) => decode(String(h).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '));
const isbnOf = (s) => (String(s).match(/97[89]\d{10}/) || [''])[0];

// « Série - Tome 01 - Édition collector » / « Série T04 » -> serie, tome, titre (titre seulement pour les éditions particulières)
export function splitTitle(full) {
  const t = decode(full);
  const m = t.match(/^(.*?)[\s,–-]*\b(?:tome|t\.?|vol(?:ume)?\.?)\s*0*(\d+)\b\s*(.*)$/i);
  if (!m || !m[1]) return { serie: t, tome: '', titre: '' };
  const rest = m[3].replace(/^[\s–-]+/, '').trim();
  return { serie: m[1].trim(), tome: m[2], titre: rest ? t : '' };
}

const dmy = (s) => {
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/* Glénat et Pika utilisent la même plateforme : des cartes <a href=".../ISBN/"> contenant .InnerCard,
   le titre dans l'attribut aria-label de la couverture et la date JJ/MM/AAAA dans le texte. */
// Couvertures : l'adresse de l'image est dans les données JSON de la page (année et collection variables), repérée par ISBN
const hachetteCover = (html, isbn) => {
  if (!isbn) return '';
  const m = html.match(new RegExp(`imgArticle(?:\\\\*/)([A-Za-z]+)(?:\\\\*/)(\\d{4})(?:\\\\*/)${isbn}-001-X\\.jpe?g`));
  return m ? `https://media.hachette.fr/fit-in/320x480/imgArticle/${m[1]}/${m[2]}/${isbn}-001-X.jpeg?source=web` : '';
};
const httpsOnly = (u) => (/^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

export function parseHachette(html, { editeur, base, hrefPrefix }) {
  const out = [];
  const re = /<a\b[^>]*\bhref="([^"]+)"[^>]*>((?:(?!<\/a>)[\s\S])*?InnerCard[\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const href = decode(m[1]);
    if (hrefPrefix && !href.startsWith(hrefPrefix)) continue;
    const label = (m[2].match(/role="img"[^>]*\baria-label="([^"]+)"/) || m[2].match(/\baria-label="([^"]+)"[^>]*role="img"/) || [])[1];
    const text = strip(m[2]);
    const date = dmy(text);
    if (!label || !date) continue;
    const { serie, tome, titre } = splitTitle(label);
    const isbn = isbnOf(href);
    out.push({ date, editeur, serie, tome, titre, isbn, prix: null, source: new URL(href, base).href, cover: hachetteCover(html, isbn) });
  }
  return out;
}

/* Kana : <div class="block-date__inner"><h2><span class="day">02</span><span class="month">octobre</span></h2><ul>…<li> */
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const monthNum = (s) => MOIS.indexOf(String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()) + 1;
export function parseKana(html, { year, base = 'https://www.kana.fr/' }) {
  const out = [];
  for (const block of html.split(/class="block-date__inner"/).slice(1)) {
    const day = (block.match(/class="day"[^>]*>\s*(\d{1,2})\s*</) || [])[1];
    const mon = monthNum((block.match(/class="month"[^>]*>\s*([^<]+)</) || [])[1]);
    if (!day || !mon) continue;
    const date = `${year}-${String(mon).padStart(2, '0')}-${day.padStart(2, '0')}`;
    for (const item of block.split(/class="loop loop--product/).slice(1)) {
      const href = (item.match(/href="([^"]*\/produit\/[^"]*)"/) || [])[1];
      const name = item.match(/class="loop__name__inner"[^>]*>\s*<span>([\s\S]*?)<\/span>\s*<\/span>/);
      if (!href || !name) continue;
      const small = (name[1].match(/<small>([\s\S]*?)<\/small>/) || [])[1] || '';
      const serie = strip(name[1].replace(/<small>[\s\S]*?<\/small>/, ''));
      const tm = strip(small).match(/(\d+)/);
      out.push({
        date, editeur: 'Kana', serie, tome: tm ? String(Number(tm[1])) : '',
        titre: tm || !small ? '' : `${serie} ${strip(small)}`,
        isbn: isbnOf(item), prix: null, source: new URL(decode(href), base).href,
        cover: httpsOnly(decode((item.match(/<img[^>]*\bsrc="([^"]+)"/) || [])[1])),
      });
    }
  }
  return out;
}

/* Ki-oon : API JSON utilisée par leur propre page /planning */
export function parseKioon(json) {
  const list = Array.isArray(json?.volumes) ? json.volumes : [];
  const out = [];
  for (const v of list) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date || '') ? v.date : null;
    if (!date || !v.serie_title) continue;
    const prix = parseFloat(String(v.prix ?? '').replace(',', '.').replace(/[^0-9.]/g, ''));
    const num = Number(v.number);
    const link = String(v.link || '').replace(/[^A-Za-z0-9-]/g, '');
    out.push({
      date, editeur: 'Ki-oon', serie: decode(v.serie_title), tome: Number.isInteger(num) && num > 0 ? String(num) : '',
      titre: '', isbn: isbnOf(v.ean), prix: Number.isFinite(prix) && prix > 0 ? prix : null,
      source: link ? `https://ki-oon.com/${link}` : 'https://ki-oon.com/planning',
      cover: /^https:\/\/api\.ki-oon\.com\//.test(v.poster_url || '') ? v.poster_url : '',
    });
  }
  return out;
}

/* robots.txt minimal : groupe « User-agent: * », règles Allow/Disallow, la plus longue gagne. */
/* Akata : une page par mois ; chaque sortie est un lien /publications/<slug> précédé d'une date JJ/MM/AAAA.
   Analyse tolérante : on parcourt la page dans l'ordre, chaque lien reçoit la dernière date vue. */
export function parseAkata(html, { base = 'https://www.akata.fr/' } = {}) {
  const out = [];
  const seen = new Set();
  let date = null;
  const re = /(\d{2}\/\d{2}\/\d{4})|<a\b[^>]*\bhref="([^"]*\/publications\/[^"#?]+)"[^>]*>((?:(?!<\/a>)[\s\S])*?)<\/a>/g;
  let m;
  const pending = new Map();
  while ((m = re.exec(html))) {
    if (m[1]) { date = dmy(m[1]); continue; }
    if (!date) continue;
    const href = new URL(decode(m[2]), base).href;
    const inner = m[3];
    const alt = (inner.match(/\balt="([^"]+)"/) || [])[1];
    const src = (inner.match(/\bsrc="([^"]+)"/) || [])[1];
    const text = strip(inner);
    let e = pending.get(href);
    if (!e) { e = { date, href, title: '', cover: '' }; pending.set(href, e); }
    if (!e.title) e.title = text || (alt ? decode(alt) : '');
    if (!e.cover && src) { const c = httpsOnly(new URL(decode(src), base).href); if (/^https:\/\/(www\.)?akata\.fr\//.test(c)) e.cover = c; }
  }
  for (const e of pending.values()) {
    if (!e.title || seen.has(e.href)) continue;
    seen.add(e.href);
    const { serie, tome, titre } = splitTitle(e.title);
    out.push({ date: e.date, editeur: 'Akata', serie, tome, titre, isbn: isbnOf(e.cover), prix: null, source: e.href, cover: e.cover });
  }
  return out;
}

export function robotsAllows(robotsTxt, pathname) {
  if (!robotsTxt || /^\s*<(!doctype|html)/i.test(robotsTxt)) return true;
  let inStar = false, rules = [], seenAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'user-agent') {
      if (!seenAgent) inStar = false;
      seenAgent = true;
      if (m[2].trim() === '*') inStar = true;
    } else {
      seenAgent = false;
      if (inStar && (k === 'allow' || k === 'disallow') && m[2]) rules.push({ allow: k === 'allow', p: m[2] });
    }
  }
  let best = null;
  for (const r of rules) {
    const rx = new RegExp('^' + r.p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (rx.test(pathname) && (!best || r.p.length > best.p.length)) best = r;
  }
  return !best || best.allow;
}
