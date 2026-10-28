/* Recherche globale : touche « / » ou bouton loupe. L'index (/data/search.json) est chargé à la première ouverture. */
(function () {
  'use strict';
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var idx = null, loading = false, box, input, list, prev, btn, items = [], cur = -1, lastFocus = null;

  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function build() {
    box = h('div', 'srch-box'); box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Recherche');
    var panel = h('div', 'srch-panel');
    input = h('input', 'srch-input'); input.type = 'search'; input.placeholder = 'Chercher une série, un anime, un article'; input.setAttribute('aria-label', 'Recherche'); input.autocomplete = 'off';
    list = h('ul', 'srch-list'); list.setAttribute('role', 'listbox');
    prev = h('div', 'srch-prev'); prev.hidden = true;
    var hint = h('p', 'srch-hint', '↑ ↓ pour choisir · Entrée pour ouvrir · Échap pour fermer');
    panel.appendChild(input); panel.appendChild(list); panel.appendChild(prev); panel.appendChild(hint); box.appendChild(panel);
    box.addEventListener('mousedown', function (e) { if (e.target === box) close(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { var a = list.querySelector('a.on') || list.querySelector('a'); if (a) { e.preventDefault(); location.href = a.href; } else if (input.value.trim()) { e.preventDefault(); location.href = '/recherche/?q=' + encodeURIComponent(input.value.trim()); } }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    document.body.appendChild(box);
  }

  function preview(x) {
    prev.textContent = '';
    if (!x) { prev.hidden = true; return; }
    prev.hidden = false;
    if (x.c && /^https:\/\//.test(x.c)) { var im = h('img'); im.src = x.c; im.alt = ''; im.width = 48; im.height = 72; im.referrerPolicy = 'no-referrer'; im.loading = 'lazy'; prev.appendChild(im); }
    var t = h('div'); t.appendChild(h('strong', '', x.n));
    if (x.d) t.appendChild(h('span', '', x.d));
    if (x.x) t.appendChild(h('span', 'srch-x', x.x));
    prev.appendChild(t);
  }

  function load() {
    if (idx || loading) return; loading = true;
    fetch('/data/search.json').then(function (r) { return r.json(); }).then(function (j) { idx = j; render(); }).catch(function () { loading = false; list.textContent = ''; list.appendChild(h('li', 'srch-empty', 'La recherche est indisponible pour le moment.')); });
  }

  function score(q, name) {
    var n = norm(name), i = n.indexOf(q);
    if (i < 0) return 0;
    if (i === 0) return 3;
    return /[\s'’:-]/.test(n.charAt(i - 1)) ? 2 : 1;
  }

  function render() {
    list.textContent = ''; items = []; cur = -1; if (prev) prev.hidden = true;
    var q = norm(input.value).trim();
    if (!idx) { list.appendChild(h('li', 'srch-empty', 'Chargement…')); return; }
    if (!q) { list.appendChild(h('li', 'srch-empty', 'Tape le nom d\'une série, d\'un anime ou d\'un article.')); return; }
    var cat = (idx.catalogue || []).map(function (c) { return { n: c[0], u: '/serie/' + c[1] + '/', a: c[2], d: c[3] + (c[3] > 1 ? ' tomes' : ' tome') + (c[2] ? ' · ' + c[2] : '') }; });
    var groups = [['Séries manga', idx.series], ['Catalogue complet', cat], ['Animes de la semaine', idx.anime], ['Articles', idx.articles]], total = 0;
    groups.forEach(function (g) {
      var hits = (g[1] || []).map(function (x) { return { x: x, s: score(q, x.n + ' ' + (x.a || '')) }; }).filter(function (o) { return o.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.x.n.localeCompare(b.x.n, 'fr'); }).slice(0, 6);
      if (!hits.length) return;
      var li = h('li', 'srch-group', g[0]); li.setAttribute('role', 'presentation'); list.appendChild(li);
      hits.forEach(function (o) {
        var row = h('li', 'srch-row'); row.setAttribute('role', 'option');
        var a = h('a'); a.href = o.x.u; a.appendChild(h('strong', '', o.x.n)); if (o.x.d) a.appendChild(h('span', 'srch-sub', o.x.d));
        a.__x = o.x; a.addEventListener('mouseenter', function () { preview(a.__x); }); a.addEventListener('focus', function () { preview(a.__x); });
        row.appendChild(a); list.appendChild(row); items.push(a); total++;
      });
    });
    if (!total) list.appendChild(h('li', 'srch-empty', 'Aucun résultat pour « ' + input.value.trim() + ' ».'));
    else {
      var all = h('li', 'srch-row'); var aa = h('a'); aa.href = '/recherche/?q=' + encodeURIComponent(input.value.trim()); aa.appendChild(h('strong', '', 'Voir tous les résultats')); all.appendChild(aa); list.appendChild(all); items.push(aa); cur = 0; items[0].classList.add('on'); preview(items[0].__x); }
  }

  function move(d) {
    if (!items.length) return;
    items[cur] && items[cur].classList.remove('on');
    cur = (cur + d + items.length) % items.length;
    items[cur].classList.add('on'); items[cur].scrollIntoView({ block: 'nearest' }); preview(items[cur].__x);
  }

  function open(initial) {
    if (!box) build();
    lastFocus = document.activeElement; box.hidden = false; document.body.classList.add('srch-open');
    input.value = typeof initial === 'string' ? initial : ''; render(); load(); input.focus();
  }
  window.mcSearchOpen = open;
  function close() { if (!box) return; box.hidden = true; document.body.classList.remove('srch-open'); if (lastFocus && lastFocus.focus && !(lastFocus.closest && lastFocus.closest('.home-search')) && !(lastFocus.hasAttribute && lastFocus.hasAttribute('data-gs'))) lastFocus.focus(); }

  function init() {
    var bar = document.querySelector('.site-header .tools');
    if (bar) {
      btn = h('button', 'srch-btn'); btn.type = 'button'; btn.setAttribute('aria-label', 'Rechercher (touche /)'); btn.title = 'Rechercher (touche /)';
      btn.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
      btn.addEventListener('click', open); bar.appendChild(btn);
    }
    // la barre de recherche de l'accueil ouvre la même recherche (suggestions, aperçu) que la loupe du bandeau
    // (accueil, calendrier manga, calendrier anime)
    [].forEach.call(document.querySelectorAll('.home-search input[type=search], input[type=search][data-gs]'), function (hq) {
      var go = function () { if (!box || box.hidden) open(hq.value); };
      hq.addEventListener('focus', go); hq.addEventListener('click', go);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var t = e.target, tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        e.preventDefault(); open();
      } else if (e.key === 'Escape' && box && !box.hidden) close();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
