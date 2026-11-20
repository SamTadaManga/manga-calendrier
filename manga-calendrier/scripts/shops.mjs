// Liens d'achat par ISBN. Chaque boutique a une adresse « normale » ; si un lien d'affiliation est
// renseigné dans site.config.json (shops.<id>.affiliate), il la remplace sans rien changer d'autre.
// Variables possibles dans un lien d'affiliation : {isbn} {isbn10} {url} (adresse normale) {urlenc} (adresse normale encodée).

export const isIsbn13 = (s) => {
  const d = String(s || '');
  if (!/^97[89]\d{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[12]);
};

// ISBN-10 (uniquement pour les ISBN-13 en 978) : sert aux adresses directes d'Amazon
export const isbn10Of = (isbn13) => {
  if (!isIsbn13(isbn13) || !isbn13.startsWith('978')) return '';
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
};

export const SHOPS = [
  { id: 'amazon', name: 'Amazon', short: 'AMZ', url: (i) => (isbn10Of(i) ? `https://www.amazon.fr/dp/${isbn10Of(i)}` : `https://www.amazon.fr/s?k=${i}&i=stripbooks`) },
  { id: 'cultura', name: 'Cultura', short: 'CULT', url: (i) => `https://www.cultura.com/search/results?search_query=${i}` },
  { id: 'bdfugue', name: 'BDfugue', short: 'BDF', url: (i) => `https://www.bdfugue.com/catalogsearch/result/?q=${i}` },
  // Ludum : pas de page de recherche par ISBN, donc le bouton n'apparaît que pour les tomes dont le flux donne la fiche (onlyDirect).
  // Désactivé tant que shops.ludum.enabled n'est pas true (optIn). Sans shops.ludum.aff (numéro d'affilié) : lien simple vers la fiche, non sponsorisé.
  { id: 'ludum', name: 'Ludum', short: 'LUD', onlyDirect: true, optIn: true, url: () => '' },
];

const fill = (tpl, vars) => tpl.replace(/\{(isbn10|isbn|urlenc|url)\}/g, (_, k) => vars[k]);

/* Réglages : config.shops = { amazon: { enabled: true, affiliate: "" }, ... }. Renvoie les boutiques actives dans l'ordre. */
export function shopsFrom(config) {
  const conf = config && typeof config.shops === 'object' && config.shops ? config.shops : {};
  const numAff = (s) => (typeof conf[s.id]?.aff === 'string' || typeof conf[s.id]?.aff === 'number') && /^\d{1,8}$/.test(String(conf[s.id].aff).trim()) ? String(conf[s.id].aff).trim() : '';
  return SHOPS.filter((s) => (s.optIn ? conf[s.id]?.enabled === true : conf[s.id]?.enabled !== false)).map((s) => {
    if (s.id === 'ludum') return { ...s, affiliate: '', tag: '', aff: numAff(s), sponsored: Boolean(numAff(s)) };
    const aff = typeof conf[s.id]?.affiliate === 'string' ? conf[s.id].affiliate.trim() : '';
    const tag = typeof conf[s.id]?.tag === 'string' && /^[a-z0-9][a-z0-9-]{2,39}$/i.test(conf[s.id].tag.trim()) ? conf[s.id].tag.trim() : '';
    const affiliate = /^https:\/\/[^\s"<>]+$/.test(aff) ? aff : '';
    // « tag » : identifiant partenaire Amazon (ex. prochaintome-21), ajouté à l'adresse normale, y compris pour les ISBN en 979 sans adresse directe
    return { ...s, affiliate, tag: s.id === 'amazon' && !affiliate ? tag : '', sponsored: Boolean(affiliate || (s.id === 'amazon' && tag)) };
  });
}

/** Liens directs vers la fiche produit : flux Awin { base, liens: { isbn: id } } ou flux Effinity { base, suffix, liens: { isbn: chemin } } ; ignoré s'il est mal formé. */
export const LUDUM_BASE = 'https://www.ludum.fr/mangas/';
export const EFFI_BASE = /^https:\/\/track\.effiliation\.com\/servlet\/effi\.redir\?id_compteur=\d{3,12}&url=$/;
export function directFrom(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.liens !== 'object' || !raw.liens) return null;
  if (/^https:\/\/www\.awin1\.com\/pclick\.php\?(?:[a-z]=\d+&)+p=$/.test(raw.base || '')) return { base: raw.base, liens: raw.liens };
  if (raw.base === LUDUM_BASE) return { base: raw.base, plain: true, liens: raw.liens };
  if (EFFI_BASE.test(raw.base || '') && /^https:\/\/www\.bdfugue\.com\/$/.test(raw.site || '')) {
    const suffix = typeof raw.suffix === 'string' && /^\?[\w=&.%-]{0,200}$/.test(raw.suffix) ? raw.suffix : '';
    return { base: raw.base, site: raw.site, suffix, liens: raw.liens };
  }
  return null;
}

/** Faut-il afficher le bouton de cette boutique pour cet ISBN ? (Ludum : seulement si le flux donne la fiche du tome.) */
export const hasLink = (shop, isbn) => !shop.onlyDirect || Boolean(shop.direct && shop.direct.plain && /^[a-z0-9][a-z0-9-]{2,200}$/.test(shop.direct.liens[isbn] || ''));

export function buyUrl(shop, isbn) {
  const id = shop.direct && shop.direct.liens[isbn];
  // Ludum : adresse de la fiche + ?aff=<numéro d'affilié>
  if (shop.direct && shop.direct.plain) return hasLink(shop, isbn) ? `${shop.direct.base}${id}${shop.aff ? `?aff=${shop.aff}` : ''}` : '';
  if (id && /^\d{3,20}$/.test(id) && !shop.direct.site) return `${shop.direct.base}${id}`;
  if (id && shop.direct && shop.direct.site && /^[a-z0-9][a-z0-9-]{2,200}$/.test(id)) return `${shop.direct.base}${encodeURIComponent(`${shop.direct.site}${id}${shop.direct.suffix}`)}`;
  const url = shop.url(isbn);
  if (shop.tag) return `${url}${url.includes('?') ? '&' : '?'}tag=${encodeURIComponent(shop.tag)}`;
  if (!shop.affiliate) return url;
  return fill(shop.affiliate, { isbn, isbn10: isbn10Of(isbn), url, urlenc: encodeURIComponent(url) });
}
