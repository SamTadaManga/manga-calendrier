// Avatar et bannières des comptes (X, Bluesky, Pinterest) dans la direction artistique du site : logo à gauche, texte à droite.
// Usage : node scripts/social-profils.mjs [dossier]   (défaut : scripts/assets/social)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { ROOT } from './lib.mjs';
import { launch } from './social-visuels.mjs';

const FONTS = pathToFileURL(path.join(ROOT, 'scripts/assets/fonts')).href;
const svg = (n) => `data:image/svg+xml;base64,${readFileSync(path.join(ROOT, 'scripts/assets/logo', n)).toString('base64')}`;

// Bannière 3:1 (3000×1000 ; X l'affiche à 1500×500). Les avatars cachent le bas gauche et X rogne un peu le haut et le bas : tout le contenu est à droite de 17 % et dans la bande centrale.
const banniere = (W, H) => {
  const u = W / 3000, p = (n) => `${(n * u).toFixed(1)}px`;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Dela;src:url(${FONTS}/dela-400.woff) format("woff")}
@font-face{font-family:Zen;font-weight:700;src:url(${FONTS}/zen-700.woff) format("woff")}
@font-face{font-family:Zen;font-weight:900;src:url(${FONTS}/zen-900.woff) format("woff")}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:${W}px;height:${H}px;overflow:hidden}
body{position:relative;background:#ffd21f;color:#111;font-family:Zen,sans-serif;font-weight:700}
.dots{position:absolute;inset:0;background:radial-gradient(rgba(17,17,17,.16) ${p(5)},transparent ${p(7)}) 0 0/${p(34)} ${p(34)};-webkit-mask-image:linear-gradient(100deg,transparent 30%,#000);mask-image:linear-gradient(100deg,transparent 30%,#000)}
.rays{position:absolute;inset:-60%;background:repeating-conic-gradient(from 0deg at 62% 50%,rgba(255,255,255,.30) 0 3deg,transparent 3deg 9deg)}
.logo{position:absolute;left:${p(470)};top:${p(350)};height:${p(300)}}
.txt{position:absolute;left:${p(1560)};top:${p(250)};width:${p(1400)};height:${p(500)};display:flex;flex-direction:column;justify-content:center;gap:${p(34)}}
.h{font-family:Dela;font-size:${p(82)};line-height:1.1;text-transform:uppercase;text-shadow:${p(7)} ${p(7)} 0 #fff}
.pill{align-self:flex-start;background:#111;color:#ffd21f;font-family:Dela;font-size:${p(42)};padding:${p(14)} ${p(34)};border-radius:${p(50)}}
.u{font-family:Dela;font-size:${p(54)};letter-spacing:.01em}
</style><div class="rays"></div><div class="dots"></div>
<img class="logo" src="${svg('logo-clair.svg')}" alt="">
<div class="txt"><div class="h">Le calendrier des sorties manga et anime</div><span class="pill">En France · jour par jour · gratuit</span><div class="u">prochaintome.fr</div></div>`;
};
const avatar = (S) => `<!doctype html><meta charset="utf-8"><style>*{margin:0}html,body{width:${S}px;height:${S}px;overflow:hidden}img{width:${S}px;height:${S}px;display:block}</style><img src="${svg('icone-app.svg')}" alt="">`;

const sorties = [
  ['avatar-1000.png', 1000, 1000, avatar(1000)], // X, Bluesky, Pinterest : même image, recadrée en rond par chaque réseau
  ['banniere-bluesky-3000x1000.png', 3000, 1000, banniere(3000, 1000)],
  ['banniere-x-1500x500.png', 1500, 500, banniere(1500, 500)],
  ['banniere-pinterest-1600x533.png', 1600, 533, banniere(1600, 533)],
];
const dossier = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/assets/social'));
mkdirSync(dossier, { recursive: true });
const browser = await launch();
try {
  for (const [nom, W, H, html] of sorties) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const tmp = path.join(tmpdir(), `profil-${process.pid}-${nom}.html`);
    writeFileSync(tmp, html);
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(dossier, nom), type: 'png' });
    await page.close();
    console.log(`${nom} (${W}×${H})`);
  }
} finally { await browser.close(); }
