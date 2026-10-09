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

  /* ------------------------------------------------ page « Mon planning » */
  var root = document.getElementById('suivi-app');
  if (!root) return;

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
    return ['glenat', 'kana', 'pika', 'ki-oon'].indexOf(k) > -1 ? k : 'autre';
  };
  var pubName = function (e) { return e || 'Éditeur inconnu'; };

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

  function render() {
    root.textContent = '';
    var up = upcoming();

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
    } else {
      root.appendChild(h('h2', { text: 'Séries suivies' }));
      root.appendChild(chips);
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
    if (up.length) {
      var dl2 = h('button', { type: 'button', class: 'chip', id: 'ics', text: 'Télécharger mon agenda (.ics)' });
      dl2.addEventListener('click', function () { downloadICS(up); });
      root.appendChild(h('p', { class: 'more' }, [dl2]));
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
    root.appendChild(h('details', { class: 'transfer' }, [
      h('summary', { text: 'Sauvegarder ou transférer ma liste' }),
      h('p', { class: 'muted', text: 'Ta liste est enregistrée dans ce navigateur uniquement. Pour la retrouver sur un autre appareil, copie le texte ci-dessous puis colle-le dans la même page là-bas.' }),
      area, imp, impBtn,
      h('p', { class: 'muted', text: 'Ta collection (tomes possédés), à copier de la même façon :' }), ownArea, ownImp, ownBtn,
    ]));
    if (!stored) root.appendChild(h('p', { class: 'muted', text: 'Ce navigateur bloque l\'enregistrement local : ta liste sera perdue en quittant la page.' }));
    paintOwn();
  }
  window.mcRender = render;

  root.addEventListener('click', function (e) {
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
  function downloadICS(up) {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendrier manga//Mon planning//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Mon planning manga'];
    up.forEach(function (r) {
      var sum = r.s + (r.t ? ' tome ' + r.t : '') + (r.e ? ' (' + r.e + ')' : '');
      var desc = [typeof r.p === 'number' ? euro(r.p) : '', r.st === 'reporte' ? 'Reporté' : ''].filter(Boolean).join(' · ');
      lines.push('BEGIN:VEVENT', 'UID:suivi-' + (r.i || r.k + '-' + r.t + '-' + r.d) + '@calendrier-manga', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + r.d.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + nextDay(r.d), 'SUMMARY:' + esc(sum));
      if (desc) lines.push('DESCRIPTION:' + esc(desc));
      if (/^https?:\/\//.test(r.u || '')) lines.push('URL:' + r.u);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    var blob = new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mon-planning-manga.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ------------------------------------------------ données */
  root.textContent = 'Chargement…';
  fetch('/data/manga.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
    rows = j.rows || [];
    covers = j.covers === true;
    rows.forEach(function (r) { bySlug[r.k] = true; if (!names[r.k]) names[r.k] = r.s; });
    render();
  }).catch(function () {
    root.textContent = 'Impossible de charger le calendrier. Recharge la page dans un instant.';
  });
})();
