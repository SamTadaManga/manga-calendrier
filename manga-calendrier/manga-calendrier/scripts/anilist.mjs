// Outils communs pour les scripts qui interrogent AniList (API publique, sans clé).
// Plateformes de streaming reconnues (nom affiché -> domaine). Seuls les liens https vers ces domaines sont gardés.
const PLATFORMS = [
  ['Crunchyroll', /(^|\.)crunchyroll\.com$/i], ['ADN', /(^|\.)animationdigitalnetwork\.(com|fr)$/i],
  ['Netflix', /(^|\.)netflix\.com$/i], ['Prime Video', /(^|\.)(primevideo|amazon)\.com$/i],
  ['Disney+', /(^|\.)disneyplus\.com$/i], ['Wakanim', /(^|\.)wakanim\.tv$/i],
];
export function streams(links) {
  const out = [];
  for (const l of Array.isArray(links) ? links : []) {
    if (!l || l.isDisabled || l.type !== 'STREAMING') continue;
    let u; try { u = new URL(l.url); } catch { continue; }
    if (u.protocol !== 'https:') continue;
    const p = PLATFORMS.find(([, rx]) => rx.test(u.hostname));
    if (p && !out.some((o) => o.n === p[0])) out.push({ n: p[0], u: u.href });
  }
  return out;
}

// Titres du manga d'origine (relation « adaptation » d'AniList) : sert à relier l'anime à sa série dans le calendrier manga
export function sourceManga(relations) {
  const out = [];
  for (const ed of relations?.edges || []) {
    if (!ed || !['ADAPTATION', 'SOURCE'].includes(ed.relationType) || ed.node?.type !== 'MANGA') continue;
    for (const t of [ed.node.title?.english, ed.node.title?.romaji]) if (t && !out.includes(t) && out.length < 4) out.push(String(t).slice(0, 200));
  }
  return out;
}


export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
