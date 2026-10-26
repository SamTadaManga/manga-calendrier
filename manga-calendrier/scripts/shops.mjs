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
  { id: 'fnac', name: 'Fnac', short: 'FNAC', url: (i) => `https://www.fnac.com/SearchResult/ResultList.aspx?Search=${i}` },
  { id: 'cultura', name: 'Cultura', short: 'CULT', url: (i) => `https://www.cultura.com/search/results?search_query=${i}` },
  { id: 'bdfugue', name: 'BDfugue', short: 'BDF', url: (i) => `https://www.bdfugue.com/catalogsearch/result/?q=${i}` },
];

const fill = (tpl, vars) => tpl.replace(/\{(isbn10|isbn|urlenc|url)\}/g, (_, k) => vars[k]);

/* Réglages : config.shops = { amazon: { enabled: true, affiliate: "" }, ... }. Renvoie les boutiques actives dans l'ordre. */
export function shopsFrom(config) {
  const conf = config && typeof config.shops === 'object' && config.shops ? config.shops : {};
  return SHOPS.filter((s) => conf[s.id]?.enabled !== false).map((s) => {
    const aff = typeof conf[s.id]?.affiliate === 'string' ? conf[s.id].affiliate.trim() : '';
    const tag = typeof conf[s.id]?.tag === 'string' && /^[a-z0-9][a-z0-9-]{2,39}$/i.test(conf[s.id].tag.trim()) ? conf[s.id].tag.trim() : '';
    const affiliate = /^https:\/\/[^\s"<>]+$/.test(aff) ? aff : '';
    // « tag » : identifiant partenaire Amazon (ex. prochaintome-21), ajouté à l'adresse normale, y compris pour les ISBN en 979 sans adresse directe
    return { ...s, affiliate, tag: s.id === 'amazon' && !affiliate ? tag : '', sponsored: Boolean(affiliate || (s.id === 'amazon' && tag)) };
  });
}

export function buyUrl(shop, isbn) {
  const url = shop.url(isbn);
  if (shop.tag) return `${url}${url.includes('?') ? '&' : '?'}tag=${encodeURIComponent(shop.tag)}`;
  if (!shop.affiliate) return url;
  return fill(shop.affiliate, { isbn, isbn10: isbn10Of(isbn), url, urlenc: encodeURIComponent(url) });
}
