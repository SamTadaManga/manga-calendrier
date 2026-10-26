/* Ma collection : vue d'ensemble de la bibliothèque personnelle (tomes possédés, lus, à acheter, précommandés).
   Les données restent dans le navigateur (localStorage) : mc-own, mc-tome, mc-suivi, mc-statut. Rien n'est envoyé. */
(function () {
  'use strict';
  var root = document.getElementById('coll-app');
  if (!root) return;
  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  var TM = { a: 'À acheter', p: 'Précommandé', r: 'À lire', l: 'Lu' };
  var ui = { q: '', pub: '', f: 'tous', sort: 'titre' };
  var openSet = {}, rows = [], series = {}, covers = false;

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k]; else if (k === 'hidden') e.hidden = true; else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function ls(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; } }
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var slug = function (s) { return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };
  var euro = function (n) { return n.toFixed(2).replace('.', ',') + ' €'; };
  function dateFr(d) { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z')).replace('.', ''); }
  function tnum(t) { if (t === '' || t == null) return 0; return /^\d+$/.test(String(t)) ? parseInt(t, 10) : null; }
  function plural(n, a, b) { return n + ' ' + (n > 1 ? b : a); }

  /* ---------- état lu depuis le navigateur */
  function state() {
    var own = ls('mc-own', {}), tm = ls('mc-tome', {}), follow = ls('mc-suivi', []), st = ls('mc-statut', {});
    if (Array.isArray(own) || typeof own !== 'object') own = {};
    return { own: own, tm: typeof tm === 'object' && tm ? tm : {}, follow: Array.isArray(follow) ? follow : [], st: st && typeof st === 'object' ? st : {} };
  }

  function buildSeries(S) {
    series = {};
    rows.forEach(function (r) {
      if (r.st === 'annule') return;
      var n = tnum(r.t); if (n === null) return;
      var s = series[r.k] || (series[r.k] = { k: r.k, name: r.s, pub: r.e, vols: {}, cover: '' });
      if (!s.vols[n] || r.d < s.vols[n].d) s.vols[n] = { n: n, d: r.d, p: typeof r.p === 'number' ? r.p : null, t: r.t, u: r.u };
      if (r.c) s.cover = r.c;
      if (r.e) s.pub = r.e;
    });
  }

  function inCollection(S) {
    var ks = {};
    Object.keys(S.own).forEach(function (k) { ks[k] = 1; });
    Object.keys(S.tm).forEach(function (k) { ks[k] = 1; });
    S.follow.forEach(function (k) { ks[k] = 1; });
    return Object.keys(ks).filter(function (k) { return series[k]; });
  }

  /* Le calendrier ne contient que les sorties récentes et à venir : les tomes plus anciens que l'on possède
     sont ajoutés à la liste, et les tomes 1..N (N = dernier tome paru connu) non possédés comptent comme manquants. */
  function metrics(s, S) {
    var own = (S.own[s.k] || []).filter(function (n) { return typeof n === 'number'; }), tm = S.tm[s.k] || {};
    var set = {}; Object.keys(s.vols).forEach(function (n) { set[n] = 1; }); own.forEach(function (n) { set[n] = 1; });
    var maxOut = 0; Object.keys(s.vols).forEach(function (n) { if (s.vols[n].d <= today && +n > maxOut) maxOut = +n; });
    for (var i = 1; i <= maxOut && i <= 500; i++) set[i] = 1;
    var nums = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    var m = { released: 0, owned: 0, read: 0, missing: [], toBuy: 0, pre: 0, toRead: 0, spent: 0, budgetBuy: 0, budgetPre: 0, next: null, nums: nums, vols: {} };
    nums.forEach(function (n) {
      var known = s.vols[n], o = own.indexOf(n) > -1, c = tm[n] || '';
      var v = known || { n: n, d: null, p: null, t: n === 0 ? '' : String(n) };
      m.vols[n] = v;
      var out = v.d === null || v.d <= today;
      if (out) { m.released++; if (!o) m.missing.push(n); }
      else if (!m.next) m.next = v;
      if (o) { m.owned++; if (v.p) m.spent += v.p; }
      if (c === 'l') m.read++;
      if (c === 'a') { m.toBuy++; if (v.p) m.budgetBuy += v.p; }
      if (c === 'p') { m.pre++; if (v.p) m.budgetPre += v.p; }
      if (c === 'r') m.toRead++;
    });
    m.pct = m.released ? Math.min(100, Math.round(100 * Math.min(m.owned, m.released) / m.released)) : 0;
    return m;
  }

  /* ---------- rendu */
  function stat(label, value, sub) {
    return h('div', { class: 'cstat' }, [h('dt', { text: label }), h('dd', { text: value }), sub ? h('span', { class: 'muted', text: sub }) : null]);
  }

  function volRow(s, v, S) {
    var o = (S.own[s.k] || []).indexOf(v.n) > -1, c = (S.tm[s.k] || {})[v.n] || '';
    var released = v.d === null || v.d <= today;
    var tag = o ? 'Possédé' : (released ? 'Manquant' : 'À paraître');
    var li = h('li', { class: 'cvol ' + (o ? 'is-own' : released ? 'is-missing' : 'is-soon') }, [
      h('strong', { text: v.t ? 'Tome ' + v.t : 'Tome unique' }),
      v.d ? h('time', { datetime: v.d, class: 'muted', text: dateFr(v.d) }) : null,
      v.p ? h('span', { class: 'muted', text: euro(v.p) }) : null,
      h('span', { class: 'badge ' + (o ? 's-confirme' : released ? 's-reporte' : 's-estime'), text: tag + (c && TM[c] && !(o && c === 'l') ? ' · ' + TM[c] : '') + (o && c === 'l' ? ' · Lu' : '') }),
      h('button', { type: 'button', class: 'own', 'data-s': s.k, 'data-t': v.t || '', 'aria-pressed': 'false', hidden: '', text: 'Je l’ai' }),
    ]);
    var sel = h('select', { class: 'tst', 'data-s': s.k, 'data-t': v.t || '', 'aria-label': 'Statut du tome ' + (v.t || ''), hidden: '' }, [h('option', { value: '', text: 'Statut…' })]);
    Object.keys(TM).forEach(function (code) { sel.appendChild(h('option', { value: code, text: TM[code] })); });
    li.appendChild(sel);
    return li;
  }

  function seriesCard(s, S) {
    var m = metrics(s, S);
    var cover = h('div', { class: 'cover', 'aria-hidden': covers && s.cover ? 'false' : 'true' });
    if (covers && /^https:\/\//.test(s.cover)) cover.appendChild(h('img', { class: 'cover-img', src: s.cover, alt: 'Couverture de ' + s.name, width: '60', height: '90', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
    var prog = h('div', { class: 'cbar', role: 'img', 'aria-label': m.pct + ' % des tomes parus possédés' }, [h('i', { style: 'width:' + m.pct + '%' })]);
    var line = m.released ? plural(Math.min(m.owned, m.released), 'tome possédé', 'tomes possédés') + ' sur ' + m.released + ' parus' : 'Aucun tome paru pour le moment';
    var bits = [line];
    if (m.missing.length) bits.push(plural(m.missing.length, 'manquant', 'manquants'));
    else if (m.released) bits.push('à jour');
    if (m.read) bits.push(m.read + ' lu' + (m.read > 1 ? 's' : ''));
    var det = h('details', { class: 'cdet' }, [h('summary', { text: 'Voir les tomes (' + m.nums.length + ')' })]);
    det.open = !!openSet[s.k];
    det.addEventListener('toggle', function () { if (det.open) openSet[s.k] = 1; else delete openSet[s.k]; });
    var ul = h('ul', { class: 'cvols' });
    m.nums.forEach(function (n) { ul.appendChild(volRow(s, m.vols[n], S)); });
    det.appendChild(ul);
    var next = m.next ? h('p', { class: 'muted' }, ['Prochain tome : ' + (m.next.t ? 'tome ' + m.next.t + ', ' : '') + dateFr(m.next.d)]) : null;
    var extra = [];
    if (m.pre) extra.push(plural(m.pre, 'précommandé', 'précommandés'));
    if (m.toBuy) extra.push(plural(m.toBuy, 'à acheter', 'à acheter'));
    if (m.toRead) extra.push(plural(m.toRead, 'à lire', 'à lire'));
    return h('li', { class: 'cseries', 'data-k': s.k }, [
      h('a', { class: 'rel-cover', href: '/serie/' + s.k + '/', 'aria-label': s.name + ' : page de la série', tabindex: '-1' }, [cover]),
      h('div', { class: 'cs-main' }, [
        h('h3', {}, [h('a', { href: '/serie/' + s.k + '/', text: s.name })]),
        h('p', { class: 'muted' }, [(s.pub || '') + (S.follow.indexOf(s.k) > -1 ? ' · suivie' : '')]),
        prog, h('p', { text: bits.join(' · ') }),
        extra.length ? h('p', { class: 'muted', text: extra.join(' · ') }) : null,
        next, det,
      ]),
    ]);
  }

  function visible(keys, S) {
    var q = norm(ui.q).trim();
    var list = keys.map(function (k) { return series[k]; }).filter(function (s) {
      var m = metrics(s, S);
      if (q && norm(s.name + ' ' + (s.pub || '')).indexOf(q) < 0) return false;
      if (ui.pub && s.pub !== ui.pub) return false;
      if (ui.f === 'manquants' && !m.missing.length) return false;
      if (ui.f === 'jour' && (m.missing.length || !m.released)) return false;
      if (ui.f === 'precommandes' && !m.pre) return false;
      if (ui.f === 'acheter' && !m.toBuy) return false;
      if (ui.f === 'alire' && !m.toRead) return false;
      return true;
    });
    var by = {
      titre: function (a, b) { return a.name.localeCompare(b.name, 'fr'); },
      sortie: function (a, b) { var x = metrics(a, S).next, y = metrics(b, S).next; return (x ? x.d : '9999') < (y ? y.d : '9999') ? -1 : (x ? x.d : '9999') > (y ? y.d : '9999') ? 1 : a.name.localeCompare(b.name, 'fr'); },
      progression: function (a, b) { return metrics(b, S).pct - metrics(a, S).pct || a.name.localeCompare(b.name, 'fr'); },
      editeur: function (a, b) { return String(a.pub).localeCompare(String(b.pub), 'fr') || a.name.localeCompare(b.name, 'fr'); },
    };
    return list.sort(by[ui.sort] || by.titre);
  }

  function csvExport(S, keys) {
    var out = ['serie;tome;possede;statut'];
    keys.forEach(function (k) {
      var s = series[k], own = S.own[k] || [], tm = S.tm[k] || {};
      Object.keys(s.vols).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
        out.push([s.name.replace(/;/g, ','), n, own.indexOf(n) > -1 ? 'oui' : 'non', TM[tm[n]] || ''].join(';'));
      });
    });
    var blob = new Blob(['﻿' + out.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ma-collection-' + today + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function csvImport(text) {
    var own = ls('mc-own', {}), tm = ls('mc-tome', {}), n = 0, bySlug = {};
    Object.keys(series).forEach(function (k) { bySlug[k] = k; bySlug[slug(series[k].name)] = k; });
    var lines = String(text).replace(/^﻿/, '').split(/\r?\n/).slice(0, 20001);
    var delim = (lines[0] || '').indexOf(';') > -1 ? ';' : ',';
    var codes = {}; Object.keys(TM).forEach(function (c) { codes[norm(TM[c])] = c; });
    lines.slice(1).forEach(function (ln) {
      var c = ln.split(delim); if (c.length < 3) return;
      var k = bySlug[slug(c[0])], t = tnum(String(c[1]).trim());
      if (!k || t === null || t > 2000) return;
      var yes = /^(oui|1|x|true|yes|possede|possédé)$/i.test(String(c[2]).trim());
      if (yes) { own[k] = own[k] || []; if (own[k].indexOf(t) < 0) { own[k].push(t); own[k].sort(function (a, b) { return a - b; }); n++; } }
      var code = codes[norm(c[3] || '').trim()];
      if (code) { (tm[k] = tm[k] || {})[t] = code; }
    });
    try { localStorage.setItem('mc-own', JSON.stringify(own)); localStorage.setItem('mc-tome', JSON.stringify(tm)); } catch (e) { return -1; }
    return n;
  }

  function render() {
    var focusInfo = document.activeElement && document.activeElement.getAttribute ? { c: document.activeElement.className, s: document.activeElement.getAttribute('data-s'), t: document.activeElement.getAttribute('data-t'), id: document.activeElement.id } : null;
    var S = state(), keys = inCollection(S);
    root.textContent = '';
    if (!keys.length) {
      root.appendChild(h('div', { class: 'panel empty-coll' }, [
        h('h2', { text: 'Ta collection est vide pour le moment' }),
        h('p', { text: 'Commence en cliquant sur « Je l’ai » ou en choisissant un statut sur un tome, ou suis une série avec le bouton « Suivre ». Tu peux aussi indiquer d’un coup jusqu’à quel tome tu possèdes une série.' }),
        h('p', {}, [h('a', { class: 'chip', href: '/series/', text: 'Parcourir les séries' }), ' ', h('a', { class: 'chip', href: '/manga/', text: 'Calendrier manga' }), ' ', h('a', { class: 'chip', href: '/mon-planning/', text: 'Mon planning' })]),
      ]));
      root.appendChild(tools(S, keys));
      return;
    }
    var tot = { owned: 0, read: 0, missing: 0, uptodate: 0, spent: 0, buy: 0, buyB: 0, pre: 0, preB: 0 };
    keys.forEach(function (k) { var m = metrics(series[k], S); tot.owned += m.owned; tot.read += m.read; tot.missing += m.missing.length; if (m.released && !m.missing.length) tot.uptodate++; tot.spent += m.spent; tot.buy += m.toBuy; tot.buyB += m.budgetBuy; tot.pre += m.pre; tot.preB += m.budgetPre; });
    var dl = h('dl', { class: 'cstats' }, [
      stat('Séries', String(keys.length), plural(tot.uptodate, 'série à jour', 'séries à jour')),
      stat('Tomes possédés', String(tot.owned), tot.spent ? 'valeur ≈ ' + euro(tot.spent) : ''),
      stat('Tomes lus', String(tot.read), tot.owned ? Math.round(100 * tot.read / tot.owned) + ' % des possédés' : ''),
      stat('Manquants', String(tot.missing), 'tomes parus à compléter'),
      stat('Précommandés', String(tot.pre), tot.preB ? euro(tot.preB) : ''),
      stat('À acheter', String(tot.buy), tot.buyB ? euro(tot.buyB) : ''),
    ]);
    root.appendChild(dl);

    var q = h('input', { type: 'search', id: 'c-q', placeholder: 'Chercher dans ma collection', 'aria-label': 'Chercher dans ma collection' }); q.value = ui.q;
    q.addEventListener('input', function () { ui.q = q.value; renderList(S, keys); });
    var sel = h('select', { id: 'c-sort', 'aria-label': 'Trier' });
    [['titre', 'Titre A → Z'], ['sortie', 'Prochaine sortie'], ['progression', 'Progression'], ['editeur', 'Éditeur']].forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
    sel.value = ui.sort; sel.addEventListener('change', function () { ui.sort = sel.value; renderList(S, keys); });
    var chips = h('div', { class: 'filters', id: 'c-chips' });
    [['tous', 'Toutes'], ['manquants', 'Avec tomes manquants'], ['jour', 'À jour'], ['precommandes', 'Précommandés'], ['acheter', 'À acheter'], ['alire', 'À lire']].forEach(function (f) {
      var b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(ui.f === f[0]), text: f[1] });
      b.addEventListener('click', function () { ui.f = f[0]; [].forEach.call(chips.querySelectorAll('.chip[data-f]'), function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-f') === ui.f)); }); renderList(S, keys); });
      b.setAttribute('data-f', f[0]); chips.appendChild(b);
    });
    var pubs = {}; keys.forEach(function (k) { if (series[k].pub) pubs[series[k].pub] = 1; });
    var pubSel = h('select', { id: 'c-pub', 'aria-label': 'Éditeur' }, [h('option', { value: '', text: 'Tous les éditeurs' })]);
    Object.keys(pubs).sort().forEach(function (p) { pubSel.appendChild(h('option', { value: p, text: p })); });
    pubSel.value = ui.pub; pubSel.addEventListener('change', function () { ui.pub = pubSel.value; renderList(S, keys); });
    root.appendChild(h('div', { class: 'ctools' }, [q, pubSel, sel]));
    root.appendChild(chips);
    root.appendChild(h('div', { id: 'c-list' }));
    renderList(S, keys);
    root.appendChild(tools(S, keys));
    if (window.mcPaintOwn) window.mcPaintOwn();
    if (focusInfo && focusInfo.s) {
      var sel2 = (focusInfo.c.indexOf('own') > -1 ? 'button.own' : 'select.tst') + '[data-s="' + focusInfo.s + '"][data-t="' + (focusInfo.t || '') + '"]';
      var el = root.querySelector(sel2); if (el) el.focus();
    } else if (focusInfo && focusInfo.id === 'c-q') { var qq = document.getElementById('c-q'); if (qq) { qq.focus(); qq.setSelectionRange(qq.value.length, qq.value.length); } }
  }

  function renderList(S, keys) {
    var box = document.getElementById('c-list'); if (!box) return;
    box.textContent = '';
    var list = visible(keys, S);
    if (!list.length) { box.appendChild(h('p', { class: 'empty', text: 'Aucune série ne correspond à ces filtres.' })); return; }
    var ul = h('ul', { class: 'clist' });
    list.forEach(function (s) { ul.appendChild(seriesCard(s, S)); });
    box.appendChild(ul);
    if (window.mcPaintOwn) window.mcPaintOwn();
  }

  function tools(S, keys) {
    var msg = h('span', { class: 'muted', role: 'status' });
    var exp = h('button', { type: 'button', class: 'chip', text: 'Exporter en CSV' });
    exp.addEventListener('click', function () { if (!keys.length) { msg.textContent = ' Rien à exporter.'; return; } csvExport(S, keys); msg.textContent = ' Fichier enregistré dans tes téléchargements.'; });
    var file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'Importer un fichier CSV' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      if (f.size > 2000000) { msg.textContent = ' Fichier trop gros.'; return; }
      var rd = new FileReader();
      rd.onload = function () { var n = csvImport(rd.result); if (n < 0) msg.textContent = ' Impossible d’enregistrer (stockage du navigateur bloqué).'; else { render(); var m = document.getElementById('c-msg'); if (m) m.textContent = n + ' tome(s) ajouté(s) à ta collection. Rien n’a été supprimé.'; } };
      rd.readAsText(f);
    });
    return h('details', { class: 'transfer' }, [
      h('summary', { text: 'Exporter ou importer ma collection' }),
      h('p', { class: 'muted' }, ['Format CSV (colonnes serie ; tome ; possede ; statut), lisible dans un tableur : ', exp, msg]),
      h('p', { class: 'muted' }, ['Importer un CSV du même format (fusionne avec ta collection actuelle) : ', file]),
      h('p', { class: 'muted', id: 'c-msg', role: 'status' }),
      h('p', { class: 'muted' }, ['Pour une sauvegarde complète (séries suivies, animes, statuts) ou le transfert vers un autre appareil, utilise la page ', h('a', { href: '/mon-planning/', text: 'Mon planning' }), '.']),
    ]);
  }

  function start() {
    window.mcRender = render; // appelé par les boutons « Je l'ai », « Suivre » et les statuts
    fetch('/data/manga.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      rows = j.rows || []; covers = j.covers === true; buildSeries(); render();
    }).catch(function () { root.textContent = ''; root.appendChild(h('p', { class: 'empty', text: 'Les données du calendrier sont indisponibles pour le moment. Réessaie dans quelques instants.' })); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
