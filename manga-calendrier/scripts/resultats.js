(function () {
  'use strict';
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var out = document.getElementById('rres'), input = document.getElementById('rq');
  var q0 = new URLSearchParams(location.search).get('q') || '';
  if (input) input.value = q0;
  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function score(q, name) { var n = norm(name), i = n.indexOf(q); if (i < 0) return 0; if (i === 0) return 3; return /[\s'’:-]/.test(n.charAt(i - 1)) ? 2 : 1; }
  var q = norm(q0).trim();
  if (!out) return;
  if (!q) { out.appendChild(h('p', 'empty', 'Tape le nom d\'une série, d\'un anime ou d\'un article.')); return; }
  fetch('/data/search.json').then(function (r) { return r.json(); }).then(function (idx) {
    var groups = [['Séries manga', idx.series], ['Animes de la semaine', idx.anime], ['Articles', idx.articles]], total = 0;
    groups.forEach(function (g) {
      var hits = (g[1] || []).map(function (x) { return { x: x, s: score(q, x.n + ' ' + (x.a || '')) }; }).filter(function (o) { return o.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.x.n.localeCompare(b.x.n, 'fr'); });
      if (!hits.length) return;
      total += hits.length;
      out.appendChild(h('h2', '', g[0] + ' (' + hits.length + ')'));
      var ul = h('ul', 'list panel');
      hits.slice(0, 50).forEach(function (o) {
        var li = h('li', 'res-row');
        if (o.x.c && /^https:\/\//.test(o.x.c)) { var im = h('img'); im.src = o.x.c; im.alt = ''; im.width = 48; im.height = 72; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; li.appendChild(im); }
        var t = h('div'); var a = h('a'); a.href = o.x.u; a.appendChild(h('strong', '', o.x.n)); t.appendChild(a);
        if (o.x.d) t.appendChild(h('span', 'muted', ' · ' + o.x.d));
        if (o.x.x) t.appendChild(h('p', 'notes', o.x.x));
        li.appendChild(t); ul.appendChild(li);
      });
      out.appendChild(ul);
    });
    if (!total) out.appendChild(h('p', 'empty', 'Aucun résultat pour « ' + q0 + ' ». Essaie une autre orthographe ou parcours la liste des séries.'));
  }).catch(function () { out.appendChild(h('p', 'empty', 'La recherche est indisponible pour le moment.')); });
})();
