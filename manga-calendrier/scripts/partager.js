/* Visuels à partager : l'image est dessinée dans ton navigateur à partir des données du site, puis téléchargée en PNG.
   Rien n'est envoyé nulle part. */
(function () {
  'use strict';
  var root = document.getElementById('partage-app');
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var FORMATS = { story: [1080, 1920, 'Story / TikTok (9:16)'], post: [1080, 1350, 'Post Instagram (4:5)'], carre: [1080, 1080, 'Carré (1:1)'] };
  var KINDS = { manga: 'Sorties manga de la semaine', nouv: 'Nouvelles séries à découvrir', anime: 'Anime de la semaine', dates: 'Changements de date' };
  var PUBCOL = { glenat: '#0a4fd6', kana: '#d93a0b', pika: '#08804a', 'ki-oon': '#7a24c9', akata: '#c4177d', autre: '#5f6672' };
  var THEMES = { jaune: { bg: '#ffd21f', fg: '#111', sub: '#3a3300', card: '#fff8d6' }, sombre: { bg: '#111111', fg: '#f6f4ee', sub: '#b9b6ab', card: '#1f1f22' } };
  var fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  var fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });
  var fmtHM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  var key = function (d) { return fmtKey.format(d); };
  var add = function (k, n) { var d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var dayLabel = function (k) { return fmtDay.format(new Date(k + 'T12:00:00Z')).replace(/\./g, '').toUpperCase(); };
  var shortDate = function (k) { return fmtDay.format(new Date(k + 'T12:00:00Z')).replace(/\./g, ''); };
  var pubKey = function (e) {
    var s = String(e || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return PUBCOL[s] ? s : 'autre';
  };
  var today = key(new Date());
  var DATA = { manga: null, anime: null, recent: null };

  function get(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  /* ---- contenu : { title, sub, groups: [{ head, items: [{ main, side, color }] }] } ---- */
  function build(kind) {
    var g = [], title = KINDS[kind], sub = '';
    if (kind === 'manga' || kind === 'nouv') {
      var to = add(today, kind === 'manga' ? 6 : 30);
      var rows = (DATA.manga.rows || []).filter(function (r) { return r.d >= today && r.d <= to && r.st !== 'annule' && (kind === 'manga' || r.nw); })
        .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (b.nw ? 1 : 0) - (a.nw ? 1 : 0) || a.s.localeCompare(b.s, 'fr'); });
      sub = kind === 'manga' ? 'du ' + shortDate(today) + ' au ' + shortDate(to) : 'dans les 30 prochains jours';
      var by = {};
      rows.forEach(function (r) { (by[r.d] = by[r.d] || []).push({ main: r.s + (r.t ? ' T' + r.t : ''), side: r.e || '', color: PUBCOL[pubKey(r.e)], nw: r.nw, key: r.d }); });
      Object.keys(by).sort().forEach(function (d) { g.push({ head: kind === 'manga' ? dayLabel(d) : '', items: by[d] }); });
      if (kind === 'nouv') { var all = []; g.forEach(function (x) { x.items.forEach(function (i) { i.side = shortDate(i.key) + ' · ' + i.side; all.push(i); }); }); g = all.length ? [{ head: '', items: all }] : []; }
    } else if (kind === 'anime') {
      var end = add(today, 6);
      var eps = (DATA.anime.eps || []).map(function (e) { return { e: e, k: key(new Date(e.at * 1000)) }; }).filter(function (x) { return x.k >= today && x.k <= end; });
      var prem = eps.filter(function (x) { return x.e.p; });
      var use = prem.length >= 4 ? prem : eps.sort(function (a, b) { return (b.e.s ? b.e.s.length : 0) - (a.e.s ? a.e.s.length : 0); }).slice(0, 30);
      sub = prem.length >= 4 ? 'les premiers épisodes de la semaine' : 'du ' + shortDate(today) + ' au ' + shortDate(end);
      use.sort(function (a, b) { return a.e.at - b.e.at; });
      var by2 = {};
      use.forEach(function (x) { (by2[x.k] = by2[x.k] || []).push({ main: x.e.t, side: 'ép. ' + x.e.e + ' · ' + fmtHM.format(new Date(x.e.at * 1000)).replace(':', ' h '), color: '#111' }); });
      Object.keys(by2).sort().forEach(function (d) { g.push({ head: dayLabel(d), items: by2[d] }); });
    } else {
      var since = add(today, -14);
      var ev = (DATA.recent.events || []).filter(function (e) { return e.type === 'date' && e.day >= since && e.from && e.to; });
      sub = 'relevés ces 14 derniers jours';
      if (ev.length) g.push({ head: '', items: ev.map(function (e) { return { main: e.t || e.s, side: shortDate(e.from) + ' → ' + shortDate(e.to), color: e.to > e.from ? '#d93a0b' : '#08804a' }; }) });
    }
    return { title: title, sub: sub, groups: g };
  }

  /* ---- dessin ---- */
  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
    return text.replace(/\s+$/, '') + '…';
  }
  function draw(canvas, kind, fmt, theme) {
    var W = FORMATS[fmt][0], H = FORMATS[fmt][1], T = THEMES[theme], c = build(kind);
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = theme === 'jaune' ? 'rgba(0,0,0,.07)' : 'rgba(255,210,31,.10)';
    for (var y = 12; y < H; y += 24) for (var x = (y / 24) % 2 ? 12 : 0; x < W; x += 24) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.3); ctx.fill(); }
    var M = 64, top = fmt === 'story' ? 150 : 80;
    ctx.fillStyle = T.fg; ctx.textBaseline = 'alphabetic';
    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif'; ctx.fillText('PROCHAIN TOME', M, top);
    ctx.font = '400 74px "Dela Gothic One", sans-serif';
    var words = c.title.split(' '), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > W - 2 * M && cur) { lines.push(cur); cur = w; } else cur = t; });
    lines.push(cur);
    var yy = top + 84;
    lines.forEach(function (l) { ctx.fillText(l, M, yy); yy += 84; });
    ctx.font = '700 34px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = T.sub; ctx.fillText(c.sub, M, yy - 30);
    yy += 26;
    var bottom = H - (fmt === 'story' ? 190 : 120);
    var rowH = 62, headH = 64, y0 = yy, shown = 0, total = 0;
    c.groups.forEach(function (g) { total += g.items.length; });
    if (!total) {
      ctx.fillStyle = T.fg; ctx.font = '700 40px "Zen Kaku Gothic New", sans-serif';
      ctx.fillText('Aucune donnée pour cette période.', M, y0 + 60);
    }
    var done = false;
    c.groups.forEach(function (g) {
      if (done) return;
      var need = (g.head ? headH : 0) + rowH;
      if (yy + need > bottom) { done = true; return; }
      if (g.head) {
        ctx.fillStyle = T.fg; ctx.font = '400 34px "Dela Gothic One", sans-serif'; ctx.fillText(g.head, M, yy + 44); yy += headH;
      }
      g.items.forEach(function (it) {
        if (done) return;
        if (yy + rowH > bottom) { done = true; return; }
        ctx.fillStyle = it.color; ctx.beginPath(); ctx.arc(M + 12, yy + 28, 12, 0, 6.3); ctx.fill();
        ctx.fillStyle = T.fg; ctx.font = '800 36px "Zen Kaku Gothic New", sans-serif';
        var sideW = 0;
        ctx.font = '700 28px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = T.sub;
        var side = fit(ctx, it.side, 330); sideW = ctx.measureText(side).width;
        ctx.textAlign = 'right'; ctx.fillText(side, W - M, yy + 40); ctx.textAlign = 'left';
        ctx.fillStyle = T.fg; ctx.font = '800 36px "Zen Kaku Gothic New", sans-serif';
        ctx.fillText(fit(ctx, it.main, W - 2 * M - 48 - sideW - 24), M + 40, yy + 41);
        yy += rowH; shown++;
      });
      yy += 10;
    });
    if (shown < total) {
      ctx.fillStyle = T.fg; ctx.font = '800 34px "Zen Kaku Gothic New", sans-serif';
      ctx.fillText('+ ' + (total - shown) + ' autre' + (total - shown > 1 ? 's' : '') + ' sur prochaintome.fr', M, Math.min(yy + 44, H - (fmt === 'story' ? 150 : 90)));
    }
    ctx.fillStyle = T.fg; ctx.fillRect(0, H - (fmt === 'story' ? 150 : 76), W, fmt === 'story' ? 150 : 76);
    ctx.fillStyle = T.bg; ctx.font = '400 38px "Dela Gothic One", sans-serif';
    ctx.fillText('prochaintome.fr', M, H - (fmt === 'story' ? 80 : 26));
    return { shown: shown, total: total, c: c };
  }

  /* ---- interface ---- */
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
  function opt(sel, map) { Object.keys(map).forEach(function (k) { var o = el('option'); o.value = k; o.textContent = Array.isArray(map[k]) ? map[k][2] : map[k]; sel.appendChild(o); }); }
  var kSel = el('select'), fSel = el('select'), tSel = el('select');
  kSel.id = 'p-kind'; fSel.id = 'p-fmt'; tSel.id = 'p-theme';
  opt(kSel, KINDS); opt(fSel, FORMATS); opt(tSel, { jaune: 'Fond jaune', sombre: 'Fond sombre' });
  fSel.value = 'post';
  var canvas = el('canvas', 'partage-canvas'); canvas.setAttribute('role', 'img');
  var msg = el('p', 'muted'); msg.setAttribute('role', 'status');
  var dl = el('button', 'chip chip-go', 'Télécharger l’image (PNG)'); dl.type = 'button';
  var cap = el('textarea'); cap.rows = 5; cap.readOnly = true; cap.setAttribute('aria-label', 'Texte à copier avec l’image');
  var cp = el('button', 'chip', 'Copier le texte'); cp.type = 'button';
  function lab(t, s) { var l = el('label', 'p-lab'); l.appendChild(el('span', '', t)); l.appendChild(s); return l; }
  var bar = el('div', 'filters'); bar.appendChild(lab('Visuel', kSel)); bar.appendChild(lab('Format', fSel)); bar.appendChild(lab('Couleurs', tSel));
  root.textContent = '';
  root.appendChild(bar); root.appendChild(canvas); root.appendChild(el('p', '')).appendChild(dl); root.appendChild(msg);
  root.appendChild(el('h2', '', 'Texte pour accompagner l’image')); root.appendChild(cap); root.appendChild(el('p', '')).appendChild(cp);

  function render() {
    if (!DATA.manga || !DATA.anime || !DATA.recent) return;
    var r = draw(canvas, kSel.value, fSel.value, tSel.value);
    canvas.setAttribute('aria-label', r.c.title + ' ' + r.c.sub);
    msg.textContent = r.total ? r.shown + ' sur ' + r.total + ' éléments affichés.' : 'Rien à afficher pour cette période : choisis un autre visuel.';
    var lines = [r.c.title + ' (' + r.c.sub + ')', ''];
    r.c.groups.forEach(function (g) { g.items.slice(0, 12).forEach(function (i) { lines.push('• ' + i.main + (g.head ? ' (' + g.head.toLowerCase() + ')' : '')); }); });
    lines.push('', 'Le calendrier complet : prochaintome.fr', '#manga #sortiesmanga #animé #prochaintome');
    cap.value = lines.join('\n');
  }
  [kSel, fSel, tSel].forEach(function (s) { s.addEventListener('change', render); });
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
  Promise.all([get('/data/manga.json'), get('/data/anime-week.json'), get('/data/recent.json'), fonts]).then(function (a) {
    DATA.manga = a[0]; DATA.anime = a[1]; DATA.recent = a[2]; render();
  }).catch(function () { msg.textContent = 'Les données du site ne sont pas disponibles pour le moment.'; });
})();
