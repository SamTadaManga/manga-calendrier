/* Mon planning : suivre des séries, voir leurs prochains tomes, le budget du mois, exporter un agenda.
   Tout reste dans le navigateur (localStorage). Aucune donnée n'est envoyée nulle part. */
(function () {
  'use strict';
  var KEY = 'mc-suivi';
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }) : [];
    } catch (e) { return []; }
  }
  var stored = true;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { stored = false; }
  }
  var list = load();
  var has = function (k) { return list.indexOf(k) > -1; };
  function toggle(k) {
    var i = list.indexOf(k);
    if (i > -1) list.splice(i, 1); else list.push(k);
    save();
  }

  /* ------------------------------------------------ boutons « Suivre » */
  function paint() {
    var bs = document.querySelectorAll('button.follow');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], on = has(b.getAttribute('data-s'));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? 'Suivie' : 'Suivre';
      b.setAttribute('aria-label', (on ? 'Ne plus suivre ' : 'Suivre ') + b.getAttribute('data-n'));
      b.hidden = false;
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.follow') : null;
    if (!b) return;
    toggle(b.getAttribute('data-s'));
    paint();
    if (window.mcRender) window.mcRender();
  });
  paint();
  window.mcPaint = paint;
  // une couverture introuvable laisse place à la trame de points
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('cover-img')) t.hidden = true;
  }, true);

  /* ------------------------------------------------ ma collection (tomes possédés) */
  var OWN_KEY = 'mc-own';
  function loadOwn() {
    try {
      var v = JSON.parse(localStorage.getItem(OWN_KEY) || '{}'), o = {};
      Object.keys(v).forEach(function (k) {
        if (Array.isArray(v[k])) {
          var a = v[k].filter(function (n) { return typeof n === 'number' && n >= 0 && n <= 2000 && n % 1 === 0; });
          if (a.length) o[k] = a;
        }
      });
      return o;
    } catch (e) { return {}; }
  }
  var own = loadOwn();
  function saveOwn() { try { localStorage.setItem(OWN_KEY, JSON.stringify(own)); } catch (e) { stored = false; } }
  var byNum = function (a, b) { return a - b; };
  function tnum(t) {
    if (t === '' || t == null) return 0; // one-shot
    return /^\d+$/.test(String(t)) ? parseInt(t, 10) : null; // null : numérotation non suivie
  }
  function isOwned(k, t) { var n = tnum(t); return n !== null && (own[k] || []).indexOf(n) > -1; }
  function setOwned(k, t, on) {
    var n = tnum(t); if (n === null) return;
    var a = (own[k] || []).slice(), i = a.indexOf(n);
    if (on && i < 0) a.push(n);
    if (!on && i > -1) a.splice(i, 1);
    if (a.length) own[k] = a.sort(byNum); else delete own[k];
    saveOwn();
  }
  function upTo(k) { // plus grand P tel que les tomes 1..P sont tous possédés
    var a = own[k] || [], p = 0;
    while (a.indexOf(p + 1) > -1) p++;
    return p;
  }
  function setUpTo(k, N) {
    var P = upTo(k);
    var a = (own[k] || []).filter(function (n) { return n === 0 || n > P; });
    for (var i = 1; i <= N; i++) if (a.indexOf(i) < 0) a.push(i);
    if (a.length) own[k] = a.sort(byNum); else delete own[k];
    saveOwn();
  }
  function ownCount(k) { return (own[k] || []).length; }
  function encodeOwn() {
    return Object.keys(own).sort().map(function (k) {
      var a = own[k], parts = [], i = 0;
      while (i < a.length) {
        var j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
        parts.push(j > i ? a[i] + '-' + a[j] : String(a[i])); i = j + 1;
      }
      return k + ':' + parts.join(',');
    }).join('|');
  }
  function decodeOwn(txt) {
    var added = 0;
    String(txt).split('|').forEach(function (seg) {
      var c = seg.indexOf(':'); if (c < 1) return;
      var k = seg.slice(0, c).trim(), a = own[k] || [];
      seg.slice(c + 1).split(',').forEach(function (p) {
        var m = p.trim().match(/^(\d+)(?:-(\d+))?$/); if (!m) return;
        var lo = +m[1], hi = m[2] ? +m[2] : lo;
        if (hi < lo || hi > 2000 || hi - lo > 2000) return;
        for (var n = lo; n <= hi; n++) if (a.indexOf(n) < 0) { a.push(n); added++; }
      });
      if (a.length) own[k] = a.sort(byNum);
    });
    saveOwn();
    return added;
  }
  function paintOwn() {
    var bs = document.querySelectorAll('button.own');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], on = isOwned(b.getAttribute('data-s'), b.getAttribute('data-t'));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? '✓ Possédé' : 'Je l’ai';
      b.hidden = false;
      var row = b.closest ? b.closest('.rel') : null;
      if (row) row.classList.toggle('is-owned', on);
    }
    var boxes = document.querySelectorAll('[data-coll]');
    for (var j = 0; j < boxes.length; j++) collBox(boxes[j].getAttribute('data-s'), boxes[j]);
  }
  window.mcPaintOwn = paintOwn;
  function collBox(k, box) {
    var focus = document.activeElement && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    var P = upTo(k);
    box.textContent = '';
    var input = h('input', { type: 'number', min: '0', max: '400', inputmode: 'numeric', value: String(P || ''), placeholder: '0', 'aria-label': 'Je possède les tomes de 1 jusqu’au numéro' });
    var msg = h('span', { class: 'coll-msg', role: 'status', text: P ? 'Prochain tome à acheter : le tome ' + (P + 1) + '.' : (ownCount(k) ? ownCount(k) + ' tome(s) cochés.' : 'Aucun tome renseigné.') });
    var ok = h('button', { type: 'button', class: 'chip', text: 'Valider' });
    function apply() {
      var n = parseInt(input.value, 10);
      if (isNaN(n) || n < 0 || n > 400) return;
      setUpTo(k, n); paintOwn(); if (window.mcRender) window.mcRender();
    }
    ok.addEventListener('click', apply);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    box.appendChild(h('label', { class: 'coll-l' }, ['Je possède les tomes 1 à ', input]));
    box.appendChild(ok); box.appendChild(msg);
    box.hidden = false;
    if (focus) input.focus();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.own') : null;
    if (!b) return;
    setOwned(b.getAttribute('data-s'), b.getAttribute('data-t'), b.getAttribute('aria-pressed') !== 'true');
    paintOwn();
    if (window.mcRender) window.mcRender();
  });
  paintOwn();

  /* ------------------------------------------------ animes suivis (mc-anime : { identifiant : titre }) */
  var A_KEY = 'mc-anime';
  function loadA() {
    try {
      var v = JSON.parse(localStorage.getItem(A_KEY) || '{}'), o = {};
      Object.keys(v).forEach(function (k) { if (/^\d{1,9}$/.test(k) && typeof v[k] === 'string') o[k] = v[k].slice(0, 200); });
      return o;
    } catch (e) { return {}; }
  }
  var anime = loadA();
  function saveA() { try { localStorage.setItem(A_KEY, JSON.stringify(anime)); } catch (e) { stored = false; } }
  function paintA() {
    var bs = document.querySelectorAll('button.afollow');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], on = !!anime[b.getAttribute('data-a')];
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? 'Suivi' : 'Suivre';
      b.setAttribute('aria-label', (on ? 'Ne plus suivre ' : 'Suivre ') + b.getAttribute('data-n'));
      b.hidden = false;
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.afollow') : null;
    if (!b) return;
    var id = b.getAttribute('data-a');
    if (anime[id]) delete anime[id]; else anime[id] = b.getAttribute('data-n') || id;
    saveA(); paintA();
    if (window.mcRender) window.mcRender();
  });
  paintA();
  window.mcPaintA = paintA;

  /* ------------------------------------------------ page « Mon planning » et section « Pour toi » */
  var root = document.getElementById('suivi-app'), home = document.getElementById('pour-toi');
  if (!root && !home) return;

  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  var rows = [], bySlug = {}, names = {}, covers = false;

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var euro = function (n) { return n.toFixed(2).replace('.', ',') + '\u00a0€'; };
  function dateFr(d) {
    var dt = new Date(d + 'T12:00:00Z');
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(dt).replace('.', '');
  }
  var pubClass = function (e) {
    var k = (e || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z-]/g, '');
    return ['glenat', 'kana', 'pika', 'ki-oon', 'akata'].indexOf(k) > -1 ? k : 'autre';
  };
  var pubName = function (e) { return e || 'Éditeur inconnu'; };
  function addD(d, n) { var dt = new Date(d + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
  var aeps = [];
  var fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });
  var fmtHM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var epKey = function (e) { return fmtKey.format(new Date(e.at * 1000)); };
  var epHM = function (e) { return fmtHM.format(new Date(e.at * 1000)).replace(':', ' h '); };
  var ICON = { 'Crunchyroll': 'CR', 'ADN': 'ADN', 'Netflix': 'N', 'Prime Video': 'P', 'Disney+': 'D+', 'Wakanim': 'W' };
  function streamEls(list2) {
    var box = h('span', { class: 'streams' });
    (list2 || []).forEach(function (x) {
      if (!x || !/^https:\/\//.test(x.u || '') || !ICON[x.n]) return;
      var a = h('a', { class: 'stream s-' + x.n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), href: x.u, rel: 'noopener nofollow', target: '_blank', title: 'Regarder sur ' + x.n, 'aria-label': 'Regarder sur ' + x.n });
      a.innerHTML = '<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>';
      a.appendChild(document.createTextNode(ICON[x.n]));
      box.appendChild(a);
    });
    return box.childNodes.length ? box : null;
  }
  function animeRowEl(e) {
    var meta = [h('time', { text: dateFr(epKey(e)) + ' à ' + epHM(e) }), streamEls(e.s)];
    if (e.p) meta.push(h('span', { class: 'badge s-new', text: '\u2605 Épisode 1' }));
    meta.push(h('a', { href: '/anime/#j-' + epKey(e), text: 'Voir le jour' }));
    if (e.ms) meta.push(h('a', { href: '/serie/' + e.ms + '/', text: 'Lire le manga' }));
    return h('li', { class: 'rel p-anime' }, [h('div', { class: 'rel-main' }, [
      h('div', { class: 'rel-title' }, [h('strong', { text: e.t }), h('span', { class: 'tome', text: ' épisode ' + e.e })]),
      h('div', { class: 'meta' }, meta),
    ])]);
  }
  function weekAnime(from, to) {
    return aeps.filter(function (e) { var k = epKey(e); return anime[e.id] && k >= from && k <= to; }).sort(function (a, b) { return a.at - b.at; });
  }
  function getJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  function upcoming() {
    return rows.filter(function (r) { return has(r.k) && r.d >= today && r.st !== 'annule'; })
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.s < b.s ? -1 : 1; });
  }

  function rowEl(r) {
      var title = [h('strong', { text: r.s })];
      if (r.t) title.push(h('span', { class: 'tome', text: ' tome ' + r.t }));
      var meta = [h('time', { datetime: r.d, text: dateFr(r.d) }), h('span', { class: 'pub', text: pubName(r.e) })];
      if (typeof r.p === 'number') meta.push(h('span', { text: euro(r.p) }));
      if (r.mv) meta.push(h('span', { class: 'badge ' + (r.d > r.mv ? 's-reporte' : 's-confirme'), text: (r.d > r.mv ? 'Reporté' : 'Avancé') + ' (avant : ' + dateFr(r.mv) + ')' }));
      else if (r.st === 'reporte') meta.push(h('span', { class: 'badge s-reporte', text: 'Reporté' }));
      if (r.nw) meta.push(h('span', { class: 'badge s-new', text: '\u2605 Nouvelle série' }));
      if (r.st === 'confirme') meta.push(h('span', { class: 'badge s-confirme', text: 'Date confirmée' }));
      if (/^https?:\/\//.test(r.u || '')) meta.push(h('a', { href: r.u, rel: 'noopener nofollow', text: 'Fiche éditeur' }));
      if (tnum(r.t) !== null) meta.push(h('button', { type: 'button', class: 'own', 'data-s': r.k, 'data-t': r.t || '', 'aria-pressed': 'false', hidden: 'hidden', text: 'Je l’ai' }));
      var kids = [h('div', { class: 'rel-main' }, [h('div', { class: 'rel-title' }, title), h('div', { class: 'meta' }, meta)])];
      if (covers) {
        var box = h('div', { class: 'cover', 'aria-hidden': r.c ? 'false' : 'true' });
        if (/^https:\/\//.test(r.c || '')) box.appendChild(h('img', { class: 'cover-img', src: r.c, alt: 'Couverture de ' + r.s + (r.t ? ' tome ' + r.t : ''), width: '60', height: '90', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
        kids.unshift(box);
      }
      return h('li', { class: 'rel p-' + pubClass(r.e) + (covers ? ' has-cover' : '') }, kids);
  }

  /* lien de partage : #p=<json encodé> ; rien n'est importé sans clic */
  function b64u(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return decodeURIComponent(escape(atob(str))); }
  function shareUrl(withOwn) {
    var p = { s: list.slice(0, 300), a: Object.keys(anime).slice(0, 100).map(function (id) { return [id, anime[id]]; }) };
    if (withOwn) { var o = encodeOwn(); if (o) p.o = o; }
    return location.origin + '/mon-planning/#p=' + b64u(JSON.stringify(p));
  }
  var shared = null;
  try {
    var mh = location.hash.match(/^#p=([\w-]+)$/);
    if (mh) {
      var sp = JSON.parse(unb64u(mh[1]));
      shared = {
        s: (Array.isArray(sp.s) ? sp.s : []).filter(function (k) { return typeof k === 'string' && /^[a-z0-9-]{1,100}$/.test(k); }).slice(0, 300),
        a: (Array.isArray(sp.a) ? sp.a : []).filter(function (x) { return Array.isArray(x) && /^\d{1,9}$/.test(String(x[0])) && typeof x[1] === 'string'; }).slice(0, 100),
        o: typeof sp.o === 'string' ? sp.o.slice(0, 20000) : '',
      };
    }
  } catch (e) { shared = null; }

  function render() {
    root.textContent = '';
    var up = upcoming();

    if (shared) {
      var known = shared.s.filter(function (k) { return names[k]; });
      var okBtn = h('button', { type: 'button', class: 'chip chip-go', text: 'Ajouter à ma liste' });
      var noBtn = h('button', { type: 'button', class: 'chip', text: 'Ignorer' });
      okBtn.addEventListener('click', function () {
        known.forEach(function (k) { if (!has(k)) list.push(k); });
        shared.a.forEach(function (x) { anime[String(x[0])] = x[1].slice(0, 200); });
        save(); saveA(); if (shared.o) decodeOwn(shared.o);
        shared = null; try { history.replaceState(null, '', location.pathname); } catch (e) {}
        paint(); paintA(); paintOwn(); render();
      });
      noBtn.addEventListener('click', function () { shared = null; try { history.replaceState(null, '', location.pathname); } catch (e) {} render(); });
      root.appendChild(h('div', { class: 'share-in panel' }, [
        h('strong', { text: 'Quelqu\'un t\'a partagé sa liste : ' }),
        h('span', { text: known.length + (known.length > 1 ? ' séries' : ' série') + ', ' + shared.a.length + (shared.a.length > 1 ? ' animes' : ' anime') + (shared.o ? ' et sa collection' : '') + '. ' }),
        okBtn, noBtn,
      ]));
    }

    /* série suivies */
    var chips = h('ul', { class: 'follow-chips' });
    list.slice().sort().forEach(function (k) {
      var n = names[k] || k;
      var count = up.filter(function (r) { return r.k === k; }).length;
      var rm = h('button', { type: 'button', class: 'chip', 'data-rm': k, 'aria-label': 'Ne plus suivre ' + n }, [
        h('span', { text: n }), h('span', { class: 'n', text: (count ? count + ' à venir' : 'rien d\'annoncé') + (upTo(k) ? ' · possédé jusqu’au t.' + upTo(k) : '') }), h('span', { 'aria-hidden': 'true', text: ' ×' }),
      ]);
      chips.appendChild(h('li', {}, [rm]));
    });

    /* ajout */
    var dl = h('datalist', { id: 'series-list' });
    Object.keys(names).sort(function (a, b) { return names[a].localeCompare(names[b], 'fr'); }).forEach(function (k) {
      dl.appendChild(h('option', { value: names[k] }));
    });
    var input = h('input', { type: 'search', id: 'ajout', list: 'series-list', placeholder: 'Ajouter une série', 'aria-label': 'Ajouter une série', autocomplete: 'off' });
    var msg = h('p', { class: 'muted', id: 'ajout-msg', role: 'status' });
    var form = h('form', { class: 'filters' }, [input, h('button', { type: 'submit', class: 'chip', text: 'Ajouter' }), dl]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim().toLowerCase();
      if (!q) return;
      var keys = Object.keys(names);
      var exact = keys.filter(function (k) { return names[k].toLowerCase() === q; });
      var found = exact.length ? exact : keys.filter(function (k) { return names[k].toLowerCase().indexOf(q) > -1; });
      if (found.length === 1) { if (!has(found[0])) { list.push(found[0]); save(); paint(); } render(); }
      else if (!found.length) msg.textContent = 'Aucune série trouvée avec ce nom dans le calendrier.';
      else msg.textContent = found.length + ' séries correspondent : précise le nom (ex. ' + names[found[0]] + ').';
    });
    root.appendChild(form);
    root.appendChild(msg);

    if (!list.length) {
      root.appendChild(h('p', { class: 'empty', text: 'Tu ne suis aucune série. Ajoute-en une ci-dessus, ou clique sur « Suivre » à côté d\'une sortie du calendrier.' }));
      /* suggestions pour démarrer : séries avec le plus de tomes annoncés ou parus, tome 1 à venir en tête */
      var score = {};
      rows.forEach(function (r) { if (r.k) score[r.k] = (score[r.k] || 0) + (r.d >= today ? 2 : 1) + (r.nw ? 3 : 0); });
      var sug = Object.keys(score).filter(function (k) { return names[k]; }).sort(function (a, b) { return score[b] - score[a] || names[a].localeCompare(names[b], 'fr'); }).slice(0, 10);
      if (sug.length) {
        var box = h('section', { class: 'suggest' }, [h('h2', { text: 'Pour commencer' }), h('p', { class: 'muted', text: 'Quelques séries très présentes dans le calendrier. Un clic pour suivre.' })]);
        var ul = h('ul', { class: 'follow-chips' });
        sug.forEach(function (k) {
          var b = h('button', { type: 'button', class: 'chip', 'aria-label': 'Suivre ' + names[k] }, [h('span', { text: '+ ' + names[k] })]);
          b.addEventListener('click', function () { if (!has(k)) { list.push(k); save(); paint(); } render(); });
          ul.appendChild(h('li', {}, [b]));
        });
        box.appendChild(ul);
        root.appendChild(box);
      }
    } else {
      root.appendChild(h('h2', { text: 'Séries suivies' }));
      root.appendChild(chips);
    }

    /* ma collection : chiffres et progression par série */
    var maxT = {};
    rows.forEach(function (r) { var n = tnum(r.t); if (n && r.st !== 'annule' && (!maxT[r.k] || n > maxT[r.k])) maxT[r.k] = n; });
    var ownKeys = Object.keys(own);
    if (ownKeys.length) {
      var totalOwned = 0, upToDate = 0, buyN = 0, buySum = 0;
      ownKeys.forEach(function (k) { totalOwned += (own[k] || []).filter(function (n) { return n >= 1; }).length; });
      list.forEach(function (k) { if (maxT[k] && own[k] && upTo(k) >= maxT[k]) upToDate++; });
      rows.forEach(function (r) {
        if (has(r.k) && own[r.k] && r.d < today && r.st !== 'annule' && tnum(r.t) !== null && !isOwned(r.k, r.t)) { buyN++; if (typeof r.p === 'number') buySum += r.p; }
      });
      var tile = function (big, small) { return h('div', { class: 'stat' }, [h('b', { text: big }), h('span', { text: small })]); };
      root.appendChild(h('h2', { text: 'Ma collection' }));
      root.appendChild(h('div', { class: 'stats' }, [
        tile(String(totalOwned), totalOwned > 1 ? 'tomes possédés' : 'tome possédé'),
        tile(String(upToDate), upToDate > 1 ? 'séries à jour' : 'série à jour'),
        tile(String(buyN), buyN > 1 ? 'tomes à rattraper' + (buySum ? ' · ' + euro(buySum) : '') : 'tome à rattraper' + (buySum ? ' · ' + euro(buySum) : '')),
      ]));
      var progUl = h('ul', { class: 'prog' });
      list.slice().sort(function (a, b) { return (names[a] || a).localeCompare(names[b] || b, 'fr'); }).forEach(function (k) {
        if (!maxT[k] || !own[k]) return;
        var n = (own[k] || []).filter(function (x) { return x >= 1 && x <= maxT[k]; }).length;
        var pct = Math.min(100, Math.round(n / maxT[k] * 100));
        var bar = h('span', { class: 'pbar', role: 'img', 'aria-label': n + ' tomes sur ' + maxT[k] }, [h('i', { style: 'width:' + pct + '%' })]);
        progUl.appendChild(h('li', {}, [h('a', { href: '/serie/' + k + '/', text: names[k] || k }), bar, h('span', { class: 'muted', text: n + ' / ' + maxT[k] })]));
      });
      if (progUl.childNodes.length) {
        root.appendChild(progUl);
        root.appendChild(h('p', { class: 'muted', text: 'Le total est le dernier tome connu dans le calendrier : il peut grandir quand un éditeur en annonce de nouveaux.' }));
      }
    }

    /* animes suivis */
    var aIds = Object.keys(anime);
    root.appendChild(h('h2', { text: 'Animes suivis' }));
    if (!aIds.length) {
      root.appendChild(h('p', { class: 'muted' }, ['Tu ne suis aucun anime. Clique sur « Suivre » sur la page ', h('a', { href: '/anime/', text: 'Anime' }), ' pour voir ici les prochains épisodes.']));
    } else {
      var achips = h('ul', { class: 'follow-chips' });
      aIds.sort(function (a, b) { return anime[a].localeCompare(anime[b], 'fr'); }).forEach(function (id) {
        achips.appendChild(h('li', {}, [h('button', { type: 'button', class: 'chip', 'data-arm': id, 'aria-label': 'Ne plus suivre ' + anime[id] }, [h('span', { text: anime[id] }), h('span', { 'aria-hidden': 'true', text: ' ×' })])]));
      });
      root.appendChild(achips);
      var weekEps = weekAnime(today, addD(today, 6));
      if (weekEps.length) {
        var aul = h('ul', { class: 'list panel' });
        weekEps.forEach(function (e) { aul.appendChild(animeRowEl(e)); });
        root.appendChild(aul);
      } else root.appendChild(h('p', { class: 'muted', text: 'Aucun épisode de tes animes cette semaine.' }));
    }

    /* à acheter maintenant : tomes parus des séries dont la collection est renseignée */
    if (list.length) {
      var buy = rows.filter(function (r) {
        return has(r.k) && own[r.k] && r.d < today && r.st !== 'annule' && tnum(r.t) !== null && !isOwned(r.k, r.t);
      }).sort(function (a, b) { return a.d < b.d ? 1 : -1; });
      root.appendChild(h('h2', { text: 'À acheter' }));
      if (buy.length) {
        var sum = 0, nop = 0;
        buy.forEach(function (r) { if (typeof r.p === 'number') sum += r.p; else nop++; });
        root.appendChild(h('p', { class: 'budget', text: buy.length + (buy.length > 1 ? ' tomes déjà parus que tu n’as pas' : ' tome déjà paru que tu n’as pas') + (sum ? ' · ' + euro(sum) : '') + (nop && sum ? ' (+ ' + nop + ' sans prix)' : '') }));
        var ulb = h('ul', { class: 'list panel' });
        buy.forEach(function (r) { ulb.appendChild(rowEl(r)); });
        root.appendChild(ulb);
      } else {
        root.appendChild(h('p', { class: 'muted', text: Object.keys(own).length ? 'Rien à rattraper parmi les tomes récents de tes séries. Bravo !' : 'Indique ci-dessous jusqu’à quel tome tu as chaque série : tu verras ici les tomes qu’il te reste à acheter.' }));
      }
      var det = h('details', { class: 'transfer coll-edit' }, [h('summary', { text: 'Régler ma collection série par série' })]);
      list.slice().sort(function (a, b) { return (names[a] || a).localeCompare(names[b] || b, 'fr'); }).forEach(function (k) {
        var box = h('div', { class: 'coll', 'data-coll': '', 'data-s': k });
        det.appendChild(h('div', { class: 'coll-row' }, [h('strong', { text: names[k] || k }), box]));
        collBox(k, box);
      });
      root.appendChild(det);
    }

    /* mois par mois */
    if (list.length && !up.length) root.appendChild(h('p', { class: 'empty', text: 'Aucune sortie annoncée pour tes séries pour le moment. Elles apparaîtront ici dès qu\'un éditeur les ajoute à son planning.' }));
    var months = [];
    up.forEach(function (r) {
      var mk = r.d.slice(0, 7), m = months[months.length - 1];
      if (!m || m.key !== mk) { m = { key: mk, rows: [] }; months.push(m); }
      m.rows.push(r);
    });
    months.forEach(function (m) {
      var total = 0, unknown = 0;
      m.rows.forEach(function (r) { if (isOwned(r.k, r.t)) return; if (typeof r.p === 'number') total += r.p; else unknown++; });
      var title = MOIS[Number(m.key.slice(5)) - 1] + ' ' + m.key.slice(0, 4);
      var sum = m.rows.length + (m.rows.length > 1 ? ' tomes' : ' tome') + (total ? ' · ' + euro(total) : '') +
        (unknown && total ? ' (+ ' + unknown + ' sans prix annoncé)' : unknown ? ' · prix non annoncé' : '');
      root.appendChild(h('h2', { text: title[0].toUpperCase() + title.slice(1) }));
      root.appendChild(h('p', { class: 'budget', text: sum }));
      var ul = h('ul', { class: 'list panel' });
      m.rows.forEach(function (r) { ul.appendChild(rowEl(r)); });
      root.appendChild(ul);
    });

    /* agenda + transfert */
    var icsEps = weekAnime(today, addD(today, 6));
    if (up.length || icsEps.length) {
      var dl2 = h('button', { type: 'button', class: 'chip', id: 'ics', text: 'Télécharger mon agenda avec rappels (.ics)' });
      dl2.addEventListener('click', function () { downloadICS(up, icsEps); });
      root.appendChild(h('p', { class: 'more' }, [dl2, h('span', { class: 'muted', text: ' Rappel la veille à 18 h et le jour même à 9 h pour les tomes, 10 minutes avant pour les épisodes. C\'est une photo du moment : retélécharge-le de temps en temps.' })]));
    }
    var area = h('textarea', { readonly: 'readonly', rows: '2', 'aria-label': 'Ma liste, à copier' });
    area.value = list.join(',');
    var imp = h('textarea', { rows: '2', 'aria-label': 'Liste à importer', placeholder: 'Colle ici une liste copiée sur un autre appareil' });
    var impBtn = h('button', { type: 'button', class: 'chip', text: 'Importer' });
    impBtn.addEventListener('click', function () {
      var added = 0;
      imp.value.split(/[,\s]+/).forEach(function (k) { if (names[k] && !has(k)) { list.push(k); added++; } });
      save(); paint(); render();
      var m = document.getElementById('ajout-msg');
      if (m) m.textContent = added + (added > 1 ? ' séries ajoutées.' : ' série ajoutée.');
    });
    var ownArea = h('textarea', { readonly: 'readonly', rows: '2', 'aria-label': 'Ma collection, à copier' });
    ownArea.value = encodeOwn();
    var ownImp = h('textarea', { rows: '2', 'aria-label': 'Collection à importer', placeholder: 'Colle ici une collection copiée sur un autre appareil' });
    var ownBtn = h('button', { type: 'button', class: 'chip', text: 'Importer ma collection' });
    ownBtn.addEventListener('click', function () {
      var n = decodeOwn(ownImp.value);
      paintOwn(); render();
      var m = document.getElementById('ajout-msg');
      if (m) m.textContent = n + (n > 1 ? ' tomes ajoutés à ta collection.' : ' tome ajouté à ta collection.');
    });
    var inclOwn = h('input', { type: 'checkbox', id: 'share-own', checked: 'checked' });
    var shareBtn = h('button', { type: 'button', class: 'chip', text: 'Copier un lien de partage' });
    var shareMsg = h('span', { class: 'muted', role: 'status' });
    shareBtn.addEventListener('click', function () {
      var url = shareUrl(inclOwn.checked);
      var done = function () { shareMsg.textContent = ' Lien copié. La personne choisira d\'ajouter ta liste ou non.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { shareMsg.textContent = ' ' + url; });
      else shareMsg.textContent = ' ' + url;
    });
    root.appendChild(h('details', { class: 'transfer' }, [
      h('summary', { text: 'Sauvegarder, transférer ou partager ma liste' }),
      h('p', { class: 'muted' }, ['Partager par lien (tes séries et tes animes suivis) : ', h('label', {}, [inclOwn, ' inclure ma collection']), ' ', shareBtn, shareMsg]),
      h('p', { class: 'muted', text: 'Ta liste est enregistrée dans ce navigateur uniquement. Pour la retrouver sur un autre appareil, copie le texte ci-dessous puis colle-le dans la même page là-bas.' }),
      area, imp, impBtn,
      h('p', { class: 'muted', text: 'Ta collection (tomes possédés), à copier de la même façon :' }), ownArea, ownImp, ownBtn,
    ]));
    if (!stored) root.appendChild(h('p', { class: 'muted', text: 'Ce navigateur bloque l\'enregistrement local : ta liste sera perdue en quittant la page.' }));
    paintOwn();
  }
  window.mcRender = render;

  if (root) root.addEventListener('click', function (e) {
    var ab = e.target.closest ? e.target.closest('[data-arm]') : null;
    if (ab) { delete anime[ab.getAttribute('data-arm')]; saveA(); paintA(); render(); return; }
    var b = e.target.closest ? e.target.closest('[data-rm]') : null;
    if (!b) return;
    toggle(b.getAttribute('data-rm'));
    paint();
    render();
  });

  /* ------------------------------------------------ agenda .ics */
  function fold(line) {
    var enc = new TextEncoder(), out = [], cur = '', len = 0;
    Array.from(line).forEach(function (ch) {
      var l = enc.encode(ch).length;
      if (len + l > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
      cur += ch; len += l;
    });
    out.push(cur);
    return out.join('\r\n ');
  }
  var esc = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); };
  function nextDay(d) {
    var dt = new Date(d + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10).replace(/-/g, '');
  }
  function downloadICS(up, epsList) {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendrier manga//Mon planning//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Mon planning'];
    up.forEach(function (r) {
      var sum = r.s + (r.t ? ' tome ' + r.t : '') + (r.e ? ' (' + r.e + ')' : '');
      var desc = [typeof r.p === 'number' ? euro(r.p) : '', r.st === 'reporte' ? 'Reporté' : ''].filter(Boolean).join(' · ');
      lines.push('BEGIN:VEVENT', 'UID:suivi-' + (r.i || r.k + '-' + r.t + '-' + r.d) + '@calendrier-manga', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + r.d.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + nextDay(r.d), 'SUMMARY:' + esc(sum));
      if (desc) lines.push('DESCRIPTION:' + esc(desc));
      if (/^https?:\/\//.test(r.u || '')) lines.push('URL:' + r.u);
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(sum + ' sort demain'), 'TRIGGER:-PT6H', 'END:VALARM');
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(sum + ' sort aujourd\'hui'), 'TRIGGER:PT9H', 'END:VALARM');
      lines.push('END:VEVENT');
    });
    var z = function (t) { return new Date(t * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); };
    (epsList || []).forEach(function (e) {
      var sum = e.t + ' : épisode ' + e.e;
      lines.push('BEGIN:VEVENT', 'UID:suivi-anime-' + e.id + '-' + e.e + '@calendrier-manga', 'DTSTAMP:' + stamp,
        'DTSTART:' + z(e.at), 'DTEND:' + z(e.at + 1440), 'SUMMARY:' + esc(sum), 'DESCRIPTION:' + esc('Diffusion japonaise. La disponibilité en France dépend des plateformes.'),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(sum + ' dans 10 minutes'), 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    var blob = new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mon-planning.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ------------------------------------------------ section « Pour toi » (accueil) */
  function pourToi() {
    var body = document.getElementById('pt-body');
    home.hidden = false; body.textContent = '';
    var end = addD(today, 6);
    var items = rows.filter(function (r) { return has(r.k) && r.d >= today && r.d <= end && r.st !== 'annule'; })
      .map(function (r) { return { key: r.d, at: 0, el: rowEl(r) }; })
      .concat(weekAnime(today, end).map(function (e) { return { key: epKey(e), at: e.at, el: animeRowEl(e) }; }))
      .sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : a.at - b.at; });
    if (items.length) {
      var ul = h('ul', { class: 'list panel' });
      items.slice(0, 12).forEach(function (x) { ul.appendChild(x.el); });
      body.appendChild(ul);
      if (items.length > 12) body.appendChild(h('p', { class: 'muted', text: '+ ' + (items.length - 12) + ' autres cette semaine.' }));
    } else {
      var next = rows.filter(function (r) { return has(r.k) && r.d > end && r.st !== 'annule'; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; })[0];
      body.appendChild(h('p', { class: 'muted', text: 'Rien cette semaine pour tes séries et tes animes.' + (next ? ' Prochaine sortie : ' + next.s + (next.t ? ' tome ' + next.t : '') + ', ' + dateFr(next.d) + '.' : '') }));
    }
    body.appendChild(h('p', { class: 'more' }, [h('a', { href: '/mon-planning/', text: 'Voir tout mon planning' })]));
    paint(); paintOwn();
  }

  /* ------------------------------------------------ données */
  var needM = !!root || list.length > 0, needA = !!root || Object.keys(anime).length > 0;
  if (root) root.textContent = 'Chargement…';
  if (home && !needM && !needA) {
    home.hidden = false;
    document.getElementById('pt-body').appendChild(h('p', { class: 'muted' }, ['Suis tes séries et tes animes avec les boutons « Suivre » : tes sorties de la semaine s\'afficheront ici. ', h('a', { href: '/mon-planning/', text: 'Voir Mon planning' })]));
    return;
  }
  Promise.all([
    needM ? getJSON('/data/manga.json') : Promise.resolve({ rows: [] }),
    needA ? getJSON('/data/anime-week.json').catch(function () { return { eps: [] }; }) : Promise.resolve({ eps: [] }),
  ]).then(function (res) {
    var j = res[0];
    rows = j.rows || [];
    covers = j.covers === true;
    aeps = res[1].eps || [];
    rows.forEach(function (r) { bySlug[r.k] = true; if (!names[r.k]) names[r.k] = r.s; });
    if (root) render();
    if (home) pourToi();
  }).catch(function () {
    if (root) root.textContent = 'Impossible de charger le calendrier. Recharge la page dans un instant.';
  });
})();
