/* Visuels à partager : l'image est dessinée dans le navigateur à partir des données du site, puis téléchargée en PNG.
   Rien n'est envoyé nulle part. Style « affiche de manga » : titre géant, traits de vitesse, cartes à ombre dure, autocollant, bandeau d'adresse. */
(function () {
  'use strict';
  var root = document.getElementById('partage-app');
  if (!root) return;
  var FORMATS = { post: [1080, 1350, 'Post Instagram (4:5)'], story: [1080, 1920, 'Story / TikTok (9:16)'], carre: [1080, 1080, 'Carré (1:1)'] };
  var KINDS = {
    manga: 'Sorties manga de la semaine', mois: 'Bilan du mois', nouv: 'Nouvelles séries à découvrir', dates: 'Changements de date',
    anime: 'Anime de la semaine', traite: 'Sélection : à lire d’une traite', genre: 'Sélection : si tu aimes… (genre du moment)',
  };
  var PUBCOL = { glenat: '#0a4fd6', kana: '#d93a0b', pika: '#08804a', 'ki-oon': '#7a24c9', akata: '#c4177d', autre: '#5f6672' };
  var THEMES = {
    jaune: { bg: '#ffd21f', ink: '#111', sub: '#3a3300', card: '#ffffff', cardInk: '#111', cardSub: '#555', border: '#111', shadow: '#111', title: '#111', titleShadow: '#ffffff', ray: 'rgba(255,255,255,.35)', dot: 'rgba(0,0,0,.08)', band: '#111', bandInk: '#ffd21f', chip: '#111', chipInk: '#ffd21f', accent: '#e4361b', sticker: '#e4361b', stickerInk: '#fff' },
    sombre: { bg: '#121214', ink: '#f6f4ee', sub: '#b9b6ab', card: '#1f1f23', cardInk: '#f6f4ee', cardSub: '#b9b6ab', border: '#ffd21f', shadow: '#ffd21f', title: '#ffd21f', titleShadow: '#e4361b', ray: 'rgba(255,210,31,.10)', dot: 'rgba(255,210,31,.08)', band: '#ffd21f', bandInk: '#111', chip: '#ffd21f', chipInk: '#111', accent: '#ff6a4d', sticker: '#ffd21f', stickerInk: '#111' },
  };
  var DISPLAY = '"Dela Gothic One", "Arial Black", sans-serif', SANS = '"Zen Kaku Gothic New", system-ui, sans-serif';
  var fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  var fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });
  var fmtHM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  var key = function (d) { return fmtKey.format(d); };
  var add = function (k, n) { var d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var up = function (s) { return String(s).toUpperCase(); };
  var shortDate = function (k) { return fmtDay.format(new Date(k + 'T12:00:00Z')).replace(/\./g, ''); };
  var dayLabel = function (k) { return up(shortDate(k)); };
  var dm = function (k) { return up(new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }).format(new Date(k + 'T12:00:00Z')).replace(/\./g, '')); };
  var pubKey = function (e) {
    var s = String(e || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return PUBCOL[s] ? s : 'autre';
  };
  var today = key(new Date());
  var DATA = { manga: null, anime: null, recent: null, part: null };
  var weekNo = Math.floor(Date.parse(today + 'T00:00:00Z') / 604800000);

  function get(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  /* ---------------------------------------------------------------- contenu */
  // item : { main, side, sub, color, tag, pri }   groupes : [{ head, items }]
  function content(kind, opt) {
    var c = { title: ['SORTIES', 'MANGA'], sticker: '', sub: '', groups: [], stats: null, bars: null, empty: 'Rien à afficher pour cette période.', mode: 'list' };
    var by, rows, to;
    if (kind === 'manga' || kind === 'nouv') {
      to = add(today, kind === 'manga' ? 6 : 30);
      rows = (DATA.manga.rows || []).filter(function (r) { return r.d >= today && r.d <= to && r.st !== 'annule' && (kind === 'manga' || r.nw); });
      by = {};
      rows.forEach(function (r) {
        var sp = /collector|coffret|int[ée]grale|artbook|deluxe|prestige/i.test((r.s || '') + ' ' + (r.t || ''));
        (by[r.d] = by[r.d] || []).push({ main: r.s + (r.t ? ' T' + r.t : ''), side: kind === 'nouv' ? dm(r.d) : '', sub: r.e || '', color: PUBCOL[pubKey(r.e)], tag: r.nw ? 'NOUVEAU' : '', pri: (r.nw ? 3 : 0) + (sp ? 1 : 0), key: r.d });
      });
      c.groups = Object.keys(by).sort().map(function (d) { return { head: kind === 'manga' ? dayLabel(d) : '', items: by[d] }; });
      if (kind === 'manga') {
        c.title = ['CETTE SEMAINE', 'EN MANGA']; c.sub = 'du ' + shortDate(today) + ' au ' + shortDate(to);
        c.sticker = rows.length + ' SORTIE' + (rows.length > 1 ? 'S' : '');
      } else {
        c.title = ['NOUVELLES', 'SÉRIES']; c.sub = 'les tomes 1 des 30 prochains jours'; c.sticker = 'TOME 1';
        var all = []; c.groups.forEach(function (g) { g.items.forEach(function (i) { all.push(i); }); });
        c.groups = all.length ? [{ head: '', items: all }] : [];
      }
    } else if (kind === 'anime') {
      var end = add(today, 6);
      var eps = (DATA.anime.eps || []).map(function (e) { return { e: e, k: key(new Date(e.at * 1000)) }; }).filter(function (x) { return x.k >= today && x.k <= end; });
      var prem = eps.filter(function (x) { return x.e.p; });
      var use = prem.length >= 4 ? prem : eps.sort(function (a, b) { return (b.e.s ? b.e.s.length : 0) - (a.e.s ? a.e.s.length : 0); }).slice(0, 30);
      use.sort(function (a, b) { return a.e.at - b.e.at; });
      by = {};
      use.forEach(function (x) { (by[x.k] = by[x.k] || []).push({ main: x.e.t, side: fmtHM.format(new Date(x.e.at * 1000)).replace(':', ' H '), sub: 'épisode ' + x.e.e, color: '#111', tag: x.e.p ? 'PREMIER ÉP.' : '', pri: x.e.p ? 3 : 0 }); });
      c.groups = Object.keys(by).sort().map(function (d) { return { head: dayLabel(d), items: by[d] }; });
      c.title = ['L’ANIME', 'DE LA SEMAINE']; c.sub = prem.length >= 4 ? 'les premiers épisodes' : 'du ' + shortDate(today) + ' au ' + shortDate(end); c.sticker = 'HEURE DE PARIS';
    } else if (kind === 'dates') {
      var since = add(today, -14);
      var ev = (DATA.recent.events || []).filter(function (e) { return e.type === 'date' && e.day >= since && e.from && e.to; });
      c.mode = 'dates'; c.title = ['ÇA BOUGE !', 'DATES DE SORTIE']; c.sub = 'relevés ces 14 derniers jours'; c.sticker = ev.length + ' CHANGEMENT' + (ev.length > 1 ? 'S' : '');
      c.empty = 'Aucun changement de date relevé ces 14 derniers jours.';
      var seenE = {}; ev = ev.filter(function (e) { var k = e.s + '|' + e.t + '|' + e.from + '|' + e.to; if (seenE[k]) return false; seenE[k] = 1; return true; });
      c.sticker = ev.length ? ev.length + ' CHANGEMENT' + (ev.length > 1 ? 'S' : '') : '';
      if (ev.length) c.groups.push({ head: '', items: ev.map(function (e) { var late = e.to > e.from; return { main: (e.s || '') + (e.t ? ' T' + e.t : ''), side: dm(e.from) + '  →  ' + dm(e.to), sub: '', color: late ? '#e4361b' : '#08804a', tag: late ? 'REPORTÉ' : 'AVANCÉ', pri: 1 }; }) });
    } else if (kind === 'mois') {
      var mo = DATA.part.months.filter(function (m) { return m.k === opt.month; })[0] || DATA.part.months[0];
      if (!mo) return c;
      c.mode = 'mois'; c.title = [up(mo.label), 'EN MANGA']; c.sub = 'ce qu’il ne faut pas rater'; c.sticker = mo.busy ? 'PIC LE ' + dm(mo.busy.d) : '';
      c.stats = [[mo.total, 'sorties'], [mo.fresh.length, 'nouvelle' + (mo.fresh.length > 1 ? 's' : '') + ' série' + (mo.fresh.length > 1 ? 's' : '')], [mo.special.length, 'édition' + (mo.special.length > 1 ? 's' : '') + ' spéciale' + (mo.special.length > 1 ? 's' : '')]];
      var picks = mo.fresh.slice(0, 5).map(function (f) { return { main: f.s, side: dm(f.d), sub: f.e, color: PUBCOL[pubKey(f.e)], tag: 'NOUVEAU' }; })
        .concat(mo.special.slice(0, 4).map(function (f) { return { main: f.s, side: dm(f.d), sub: f.ty + ' · ' + f.e, color: PUBCOL[pubKey(f.e)], tag: '' }; }));
      c.groups = picks.length ? [{ head: 'À NE PAS RATER', items: picks }] : [];
      c.bars = mo.pubs.map(function (p) { return { label: p.e, n: p.n, color: PUBCOL[pubKey(p.e)] }; });
      c.busy = mo.busy;
    } else if (kind === 'traite') {
      var pool = DATA.part.finished.slice(), n = pool.length, pick = [];
      for (var i = 0; i < Math.min(6, n); i++) pick.push(pool[(weekNo * 7 + i * Math.max(1, Math.floor(n / 6))) % n]);
      var seen = {}; pick = pick.filter(function (p) { if (seen[p.s]) return false; seen[p.s] = 1; return true; });
      c.title = ['À LIRE', 'D’UNE TRAITE']; c.sub = 'des séries terminées au Japon'; c.sticker = 'TERMINÉES';
      c.groups = pick.length ? [{ head: '', items: pick.map(function (p) { return { main: p.s, side: '', sub: (p.g.join(', ') + (p.au ? ' · ' + p.au : '')).replace(/^ · /, ''), color: PUBCOL[pubKey(p.e)], tag: p.e }; }) }] : [];
    } else {
      var gs = DATA.part.genres;
      if (!gs.length) return c;
      var gg = gs[weekNo % gs.length], it = gg.items, m2 = it.length, ps = [];
      for (var j = 0; j < Math.min(6, m2); j++) ps.push(it[(weekNo * 5 + j * Math.max(1, Math.floor(m2 / 6))) % m2]);
      var seen2 = {}; ps = ps.filter(function (p) { if (seen2[p.s]) return false; seen2[p.s] = 1; return true; });
      c.title = ['SI TU AIMES', up(gg.g)]; c.sub = 'six séries à suivre'; c.sticker = ps.length + ' SÉRIES';
      c.groups = [{ head: '', items: ps.map(function (p) { return { main: p.s, side: '', sub: p.e, color: PUBCOL[pubKey(p.e)], tag: '' }; }) }];
    }
    return c;
  }

  /* ---------------------------------------------------------------- dessin */
  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
    return text.replace(/\s+$/, '') + '…';
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function card(ctx, T, x, y, w, h) {
    ctx.fillStyle = T.shadow; rr(ctx, x + 8, y + 8, w, h, 14); ctx.fill();
    ctx.fillStyle = T.card; rr(ctx, x, y, w, h, 14); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = T.border; rr(ctx, x, y, w, h, 14); ctx.stroke();
  }
  function pill(ctx, x, y, text, bg, fg, size, align) {
    ctx.font = '800 ' + size + 'px ' + SANS;
    var w = ctx.measureText(text).width + size * 1.1, h = size * 1.6;
    if (align === 'right') x -= w;
    ctx.fillStyle = bg; rr(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, x + size * 0.55, y + h / 2 + 1); ctx.textBaseline = 'alphabetic';
    return w;
  }
  function burst(ctx, T, cx, cy, R) {
    ctx.fillStyle = T.ray;
    var n = 28;
    for (var i = 0; i < n; i += 2) {
      var a0 = (i / n) * 6.2832, a1 = ((i + 1) / n) * 6.2832;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); ctx.closePath(); ctx.fill();
    }
  }
  function shadowText(ctx, T, text, x, y, size) {
    ctx.font = '400 ' + size + 'px ' + DISPLAY;
    ctx.fillStyle = T.titleShadow; ctx.fillText(text, x + 7, y + 7);
    ctx.fillStyle = T.title; ctx.fillText(text, x, y);
  }
  function sticker(ctx, T, text, cx, cy, angle) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.font = '400 40px ' + DISPLAY;
    var w = ctx.measureText(text).width + 56, h = 84;
    ctx.fillStyle = '#111'; rr(ctx, -w / 2 + 6, -h / 2 + 6, w, h, 18); ctx.fill();
    ctx.fillStyle = T.sticker; rr(ctx, -w / 2, -h / 2, w, h, 18); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#111'; rr(ctx, -w / 2, -h / 2, w, h, 18); ctx.stroke();
    ctx.fillStyle = T.stickerInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 3);
    ctx.restore(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    return w;
  }

  function draw(canvas, kind, fmt, themeName, opt) {
    var W = FORMATS[fmt][0], H = FORMATS[fmt][1], T = THEMES[themeName], c = content(kind, opt);
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d'), M = 60, story = fmt === 'story', square = fmt === 'carre';
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    burst(ctx, T, W * 0.78, story ? 330 : 230, Math.max(W, H));
    ctx.fillStyle = T.dot;
    for (var y = 14; y < H; y += 28) for (var x = (y / 28) % 2 ? 14 : 0; x < W; x += 28) { ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.3); ctx.fill(); }

    /* en-tête */
    var top = story ? 170 : 64;
    ctx.fillStyle = T.chip; var logo = 'PROCHAIN TOME';
    ctx.font = '400 28px ' + DISPLAY; var lw = ctx.measureText(logo).width + 44;
    rr(ctx, M, top - 40, lw, 58, 29); ctx.fill(); ctx.fillStyle = T.chipInk; ctx.textBaseline = 'middle'; ctx.fillText(logo, M + 22, top - 9); ctx.textBaseline = 'alphabetic';
    var size = square ? 92 : 110;
    var ty = top + (square ? 96 : 130);
    var lastS = size;
    c.title.forEach(function (line, i) {
      var s = size; ctx.font = '400 ' + s + 'px ' + DISPLAY;
      while (ctx.measureText(line).width > W - 2 * M - 10 && s > 50) { s -= 4; ctx.font = '400 ' + s + 'px ' + DISPLAY; }
      shadowText(ctx, T, line, M, ty, s); lastS = s; ty += s * 1.06;
    });
    var subY = ty - lastS * 1.06 + 62;
    ctx.font = '800 36px ' + SANS; ctx.fillStyle = T.ink; ctx.fillText(c.sub, M, subY);
    if (c.sticker) {
      ctx.font = '400 40px ' + DISPLAY; var sw = ctx.measureText(c.sticker).width + 56;
      ctx.font = '800 36px ' + SANS; var subW = ctx.measureText(c.sub).width;
      if (M + subW + 30 + sw < W - M) sticker(ctx, T, c.sticker, W - M - sw / 2 + 4, subY - 14, -0.05);
      else sticker(ctx, T, c.sticker, W - M - sw / 2 + 4, top - 8, 0.05);
    }
    var yy = subY + 52;

    /* pied de page */
    var fh = story ? 230 : 124, fy = H - fh;
    ctx.fillStyle = T.band; ctx.fillRect(0, fy, W, fh);
    ctx.fillStyle = T.bandInk;
    ctx.font = '800 26px ' + SANS; ctx.fillText('TOUTES LES DATES, CHAQUE JOUR, GRATUIT', M, fy + 42);
    ctx.font = '400 52px ' + DISPLAY; ctx.fillText('prochaintome.fr', M, fy + 100);
    ctx.fillStyle = T.bandInk; ctx.beginPath(); var ax = W - M - 70, ay = fy + 70; ctx.moveTo(ax, ay - 30); ctx.lineTo(ax + 56, ay); ctx.lineTo(ax, ay + 30); ctx.lineTo(ax + 14, ay); ctx.closePath(); ctx.fill();
    var bottom = fy - 26, shown = 0, total = 0;
    c.groups.forEach(function (g) { total += g.items.length; });

    if (!total && c.mode !== 'mois') {
      ctx.fillStyle = T.ink; ctx.font = '800 40px ' + SANS; ctx.fillText(c.empty, M, yy + 40);
      return { shown: 0, total: 0, c: c };
    }

    /* tuiles de chiffres + barres éditeurs (bilan du mois) */
    if (c.mode === 'mois') {
      var tw = (W - 2 * M - 2 * 22) / 3, th = square ? 120 : 140;
      c.stats.forEach(function (s, i) {
        var tx = M + i * (tw + 22);
        card(ctx, T, tx, yy, tw, th);
        ctx.fillStyle = T.cardInk; ctx.font = '400 ' + (square ? 60 : 70) + 'px ' + DISPLAY; ctx.fillText(String(s[0]), tx + 22, yy + (square ? 68 : 80));
        ctx.font = '800 24px ' + SANS; ctx.fillStyle = T.cardSub; ctx.fillText(fit(ctx, s[1], tw - 40), tx + 22, yy + th - 24);
      });
      yy += th + 30;
      if (c.bars && c.bars.length && !square) {
        var mx = c.bars[0].n, bh = story ? 50 : 36, gap = story ? 12 : 8, labW = 190;
        var nb = Math.min(c.bars.length, story ? 6 : 3);
        ctx.font = '400 30px ' + DISPLAY; ctx.fillStyle = T.ink; ctx.fillText('PAR ÉDITEUR', M, yy + 26); yy += 46;
        for (var b = 0; b < nb; b++) {
          var bar = c.bars[b], bw = Math.max(40, (W - 2 * M - labW - 90) * bar.n / mx);
          ctx.font = '800 28px ' + SANS; ctx.fillStyle = T.ink; ctx.fillText(fit(ctx, bar.label, labW - 12), M, yy + bh * 0.68);
          ctx.fillStyle = T.shadow; rr(ctx, M + labW + 5, yy + 5, bw, bh, 10); ctx.fill();
          ctx.fillStyle = bar.color; rr(ctx, M + labW, yy, bw, bh, 10); ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = T.border; rr(ctx, M + labW, yy, bw, bh, 10); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = '400 28px ' + DISPLAY; ctx.fillText(String(bar.n), M + labW + 16, yy + bh * 0.7);
          yy += bh + gap;
        }
        yy += 14;
      }
    }

    /* liste de cartes : on garde les plus marquantes si la place manque, puis on remet dans l'ordre */
    var headH = 62, gapY = 16;
    var hOf = function (it) { return (it.sub || it.tag) ? (story ? 146 : square ? 104 : 118) : (story ? 116 : square ? 80 : 94); };
    var flat = [];
    c.groups.forEach(function (g, gi) { g.items.forEach(function (it, ii) { flat.push({ it: it, g: gi, i: ii, pri: it.pri || 0 }); }); });
    var chosen = [], used = 0, seenG = {};
    flat.map(function (f, idx) { f.idx = idx; return f; }).sort(function (a, b) { return b.pri - a.pri || a.idx - b.idx; }).forEach(function (f) {
      var h = hOf(f.it) + gapY + (c.groups[f.g].head && !seenG[f.g] ? headH : 0);
      if (yy + used + h <= bottom - 60) { used += h; seenG[f.g] = 1; chosen.push(f); }
    });
    chosen.sort(function (a, b) { return a.idx - b.idx; });
    var lastG = -1;
    chosen.forEach(function (f) {
      var g = c.groups[f.g], it = f.it;
      if (g.head && lastG !== f.g) {
        ctx.font = '400 34px ' + DISPLAY; var hw = ctx.measureText(g.head).width + 40;
        ctx.fillStyle = T.chip; rr(ctx, M, yy, hw, 50, 25); ctx.fill(); ctx.fillStyle = T.chipInk; ctx.textBaseline = 'middle'; ctx.fillText(g.head, M + 20, yy + 27); ctx.textBaseline = 'alphabetic';
        yy += headH - 6 + 6;
      }
      lastG = f.g;
      var cw = W - 2 * M - 8, ch = hOf(it) - 8, two = !!(it.sub || it.tag);
      card(ctx, T, M, yy, cw, ch);
      ctx.fillStyle = it.color || '#111'; ctx.save(); rr(ctx, M, yy, cw, ch, 14); ctx.clip(); ctx.fillRect(M, yy, 22, ch); ctx.restore();
      var tx = M + 44, right = M + cw - 24, sideW = 0;
      if (it.side) {
        ctx.font = (c.mode === 'dates' ? '400 30px ' : '400 34px ') + DISPLAY; ctx.fillStyle = c.mode === 'dates' ? it.color : T.cardInk;
        var side = it.side; sideW = ctx.measureText(side).width; ctx.textAlign = 'right'; ctx.fillText(side, right, yy + (two ? (story ? 60 : 50) : ch / 2 + 12)); ctx.textAlign = 'left';
        if (c.mode === 'dates') { sideW = Math.min(sideW, 300); }
      }
      var big = square ? 34 : story ? 44 : 38;
      ctx.font = '800 ' + big + 'px ' + SANS; ctx.fillStyle = T.cardInk;
      var mainMax = right - tx - (it.side ? sideW + 24 : 0);
      ctx.fillText(fit(ctx, it.main, mainMax), tx, yy + (two ? (story ? 62 : 50) : ch / 2 + 15));
      var rowSubY = yy + ch - (story ? 26 : 20);
      if (it.sub || it.tag) {
        var cx2 = tx;
        if (it.tag) { var pw = pill(ctx, tx, rowSubY - 29, it.tag, c.mode === 'dates' ? it.color : (kindIsTag(it.tag) ? T.accent : T.chip), (kindIsTag(it.tag) ? '#fff' : T.chipInk), 20); cx2 = tx + pw + 14; }
        if (it.sub) { ctx.font = '700 26px ' + SANS; ctx.fillStyle = T.cardSub; ctx.fillText(fit(ctx, it.sub, right - cx2), cx2, rowSubY); }
      }
      yy += hOf(it) + gapY; shown++;
    });
    if (shown < total) {
      var more = '+ ' + (total - shown) + ' autre' + (total - shown > 1 ? 's' : '') + ' sur le site';
      ctx.font = '400 32px ' + DISPLAY; var mw = ctx.measureText(more).width + 44;
      ctx.fillStyle = T.chip; rr(ctx, M, Math.min(yy + 2, bottom - 54), mw, 54, 27); ctx.fill(); ctx.fillStyle = T.chipInk; ctx.textBaseline = 'middle'; ctx.fillText(more, M + 22, Math.min(yy + 2, bottom - 54) + 29); ctx.textBaseline = 'alphabetic';
    }
    return { shown: shown, total: total, c: c };
  }
    function kindIsTag(t) { return t === 'NOUVEAU' || t === 'PREMIER ÉP.'; }

  /* ---------------------------------------------------------------- texte d'accompagnement */
  function caption(kind, c) {
    var names = [];
    c.groups.forEach(function (g) { g.items.slice(0, 8).forEach(function (i) { names.push(i.main); }); });
    var hook = {
      manga: 'Ta semaine manga en un coup d’œil : ' + (c.sticker || '').toLowerCase() + ' à ne pas rater.',
      mois: 'Le mois manga est chargé ! Voici les dates à retenir.',
      nouv: 'Nouvelles séries : lesquelles vas-tu tenter ?',
      dates: 'Attention, des dates de sortie ont bougé. Vérifie avant de précommander.',
      anime: 'Les animes de la semaine, heures de diffusion à Paris.',
      traite: 'Envie d’une lecture sans attendre le tome suivant ? Ces séries sont terminées.',
      genre: 'Tu aimes ce genre ? Ces séries pourraient te plaire.',
    }[kind];
    var tags = { manga: '#manga #sortiesmanga #mangafr', mois: '#manga #sortiesmanga #mangafr', nouv: '#manga #nouveautés #mangafr', dates: '#manga #report #sortiesmanga', anime: '#anime #animé #simulcast', traite: '#manga #mangafr #lecture', genre: '#manga #mangafr #bonsplans' }[kind] + ' #prochaintome';
    var out = [hook, ''];
    if (kind !== 'mois') names.slice(0, 6).forEach(function (n) { out.push('• ' + n); });
    out.push('', 'Toutes les dates, gratuit, mis à jour chaque jour : prochaintome.fr (lien en bio)', tags);
    return out.join('\n');
  }

  /* ---------------------------------------------------------------- interface */
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
  function opts(sel, map) { Object.keys(map).forEach(function (k) { var o = el('option'); o.value = k; o.textContent = Array.isArray(map[k]) ? map[k][2] : map[k]; sel.appendChild(o); }); }
  var kSel = el('select'), fSel = el('select'), tSel = el('select'), mSel = el('select');
  kSel.id = 'p-kind'; fSel.id = 'p-fmt'; tSel.id = 'p-theme'; mSel.id = 'p-month';
  opts(kSel, KINDS); opts(fSel, FORMATS); opts(tSel, { jaune: 'Fond jaune', sombre: 'Fond sombre' });
  var canvas = el('canvas', 'partage-canvas'); canvas.setAttribute('role', 'img');
  var msg = el('p', 'muted'); msg.setAttribute('role', 'status');
  var dl = el('button', 'chip chip-go', 'Télécharger l’image (PNG)'); dl.type = 'button';
  var cap = el('textarea'); cap.rows = 7; cap.readOnly = true; cap.setAttribute('aria-label', 'Texte à copier avec l’image');
  var cp = el('button', 'chip', 'Copier le texte'); cp.type = 'button';
  function lab(t, s, id) { var l = el('label', 'p-lab'); if (id) l.id = id; l.appendChild(el('span', '', t)); l.appendChild(s); return l; }
  var mLab = lab('Mois', mSel, 'p-month-lab');
  var bar = el('div', 'filters'); bar.appendChild(lab('Visuel', kSel)); bar.appendChild(mLab); bar.appendChild(lab('Format', fSel)); bar.appendChild(lab('Couleurs', tSel));
  root.textContent = '';
  root.appendChild(bar); root.appendChild(canvas); root.appendChild(el('p', '')).appendChild(dl); root.appendChild(msg);
  root.appendChild(el('h2', '', 'Texte pour accompagner l’image')); root.appendChild(cap); root.appendChild(el('p', '')).appendChild(cp);

  function render() {
    if (!DATA.manga || !DATA.anime || !DATA.recent || !DATA.part) return;
    mLab.hidden = kSel.value !== 'mois';
    var r = draw(canvas, kSel.value, fSel.value, tSel.value, { month: mSel.value });
    canvas.setAttribute('aria-label', r.c.title.join(' ') + ' ' + r.c.sub);
    msg.textContent = r.total ? r.shown + ' élément' + (r.shown > 1 ? 's' : '') + ' sur ' + r.total + ' affichés.' : (kSel.value === 'mois' ? '' : 'Rien à afficher pour cette période : choisis un autre visuel.');
    cap.value = caption(kSel.value, r.c);
  }
  [kSel, fSel, tSel, mSel].forEach(function (s) { s.addEventListener('change', render); });
  dl.addEventListener('click', function () {
    canvas.toBlob(function (b) {
      if (!b) { msg.textContent = 'Impossible de créer l’image dans ce navigateur.'; return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = 'prochain-tome-' + kSel.value + '-' + fSel.value + '-' + today + '.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, 'image/png');
  });
  cp.addEventListener('click', function () {
    cap.select();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cap.value).then(function () { msg.textContent = 'Texte copié.'; }, function () { document.execCommand('copy'); });
    else { try { document.execCommand('copy'); msg.textContent = 'Texte copié.'; } catch (e) {} }
  });

  var fonts = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('40px "Dela Gothic One"'), document.fonts.load('800 30px "Zen Kaku Gothic New"'), document.fonts.load('700 30px "Zen Kaku Gothic New"')]).catch(function () {}) : Promise.resolve();
  Promise.all([get('/data/manga.json'), get('/data/anime-week.json'), get('/data/recent.json'), get('/data/partage.json'), fonts]).then(function (a) {
    DATA.manga = a[0]; DATA.anime = a[1]; DATA.recent = a[2]; DATA.part = a[3];
    DATA.part.months.forEach(function (m) { var o = el('option'); o.value = m.k; o.textContent = m.label.charAt(0).toUpperCase() + m.label.slice(1); mSel.appendChild(o); });
    // le mois suivant prend le relais en fin de mois
    var d = Number(today.slice(8)); if (d >= 22 && DATA.part.months[1]) mSel.value = DATA.part.months[1].k;
    fSel.value = 'post';
    render();
  }).catch(function () { msg.textContent = 'Les données du site ne sont pas disponibles pour le moment.'; });
})();
