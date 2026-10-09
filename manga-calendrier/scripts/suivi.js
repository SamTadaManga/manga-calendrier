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

  /* ------------------------------------------------ page « Mon planning » */
  var root = document.getElementById('suivi-app');
  if (!root) return;

  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  var rows = [], bySlug = {}, names = {};

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

  function render() {
    root.textContent = '';
    var up = upcoming();

    /* série suivies */
    var chips = h('ul', { class: 'follow-chips' });
    list.slice().sort().forEach(function (k) {
      var n = names[k] || k;
      var count = up.filter(function (r) { return r.k === k; }).length;
      var rm = h('button', { type: 'button', class: 'chip', 'data-rm': k, 'aria-label': 'Ne plus suivre ' + n }, [
        h('span', { text: n }), h('span', { class: 'n', text: count ? count + ' à venir' : 'rien d\'annoncé' }), h('span', { 'aria-hidden': 'true', text: ' ×' }),
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
      m.rows.forEach(function (r) { if (typeof r.p === 'number') total += r.p; else unknown++; });
      var title = MOIS[Number(m.key.slice(5)) - 1] + ' ' + m.key.slice(0, 4);
      var sum = m.rows.length + (m.rows.length > 1 ? ' tomes' : ' tome') + (total ? ' · ' + euro(total) : '') +
        (unknown && total ? ' (+ ' + unknown + ' sans prix annoncé)' : unknown ? ' · prix non annoncé' : '');
      root.appendChild(h('h2', { text: title[0].toUpperCase() + title.slice(1) }));
      root.appendChild(h('p', { class: 'budget', text: sum }));
      var ul = h('ul', { class: 'list panel' });
      m.rows.forEach(function (r) {
        var title = [h('strong', { text: r.s })];
        if (r.t) title.push(h('span', { class: 'tome', text: ' tome ' + r.t }));
        var meta = [h('time', { datetime: r.d, text: dateFr(r.d) }), h('span', { class: 'pub', text: pubName(r.e) })];
        if (typeof r.p === 'number') meta.push(h('span', { text: euro(r.p) }));
        if (r.mv) meta.push(h('span', { class: 'badge ' + (r.d > r.mv ? 's-reporte' : 's-confirme'), text: (r.d > r.mv ? 'Reporté' : 'Avancé') + ' (avant : ' + dateFr(r.mv) + ')' }));
        else if (r.st === 'reporte') meta.push(h('span', { class: 'badge s-reporte', text: 'Reporté' }));
        if (r.st === 'confirme') meta.push(h('span', { class: 'badge s-confirme', text: 'Date confirmée' }));
        if (/^https?:\/\//.test(r.u || '')) meta.push(h('a', { href: r.u, rel: 'noopener nofollow', text: 'Fiche éditeur' }));
        ul.appendChild(h('li', { class: 'rel p-' + pubClass(r.e) }, [h('div', { class: 'rel-title' }, title), h('div', { class: 'meta' }, meta)]));
      });
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
    root.appendChild(h('details', { class: 'transfer' }, [
      h('summary', { text: 'Sauvegarder ou transférer ma liste' }),
      h('p', { class: 'muted', text: 'Ta liste est enregistrée dans ce navigateur uniquement. Pour la retrouver sur un autre appareil, copie le texte ci-dessous puis colle-le dans la même page là-bas.' }),
      area, imp, impBtn,
    ]));
    if (!stored) root.appendChild(h('p', { class: 'muted', text: 'Ce navigateur bloque l\'enregistrement local : ta liste sera perdue en quittant la page.' }));
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
    rows.forEach(function (r) { bySlug[r.k] = true; if (!names[r.k]) names[r.k] = r.s; });
    render();
  }).catch(function () {
    root.textContent = 'Impossible de charger le calendrier. Recharge la page dans un instant.';
  });
})();
