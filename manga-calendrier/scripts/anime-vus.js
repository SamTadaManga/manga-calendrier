/* Mes animes : noter les épisodes vus (de X à Y). Tout reste dans le navigateur (localStorage). */
(function () {
  'use strict';
  var root = document.getElementById('vus-app');
  if (!root) return;
  var A_KEY = 'mc-anime', V_KEY = 'mc-vus', MAXEP = 9999;
  var stored = true;

  function read(key) { try { var v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } }
  var follow = {}, vus = {};
  (function () {
    var a = read(A_KEY);
    Object.keys(a).forEach(function (k) { if (/^\d{1,9}$/.test(k) && typeof a[k] === 'string') follow[k] = a[k].slice(0, 200); });
    var v = read(V_KEY);
    Object.keys(v).forEach(function (k) {
      var x = v[k]; if (!/^(\d{1,9}|x-[a-z0-9-]{1,60})$/.test(k) || !x || typeof x !== 'object') return;
      var r = (Array.isArray(x.r) ? x.r : []).filter(function (p) { return Array.isArray(p) && p[0] >= 1 && p[1] >= p[0] && p[1] <= MAXEP && p[0] % 1 === 0 && p[1] % 1 === 0; }).map(function (p) { return [p[0], p[1]]; });
      vus[k] = { t: typeof x.t === 'string' ? x.t.slice(0, 200) : '', r: merge(r) };
    });
  })();
  function saveV() { try { localStorage.setItem(V_KEY, JSON.stringify(vus)); } catch (e) { stored = false; } }
  function saveA() { try { localStorage.setItem(A_KEY, JSON.stringify(follow)); } catch (e) { stored = false; } }

  function merge(r) {
    r = r.slice().sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    r.forEach(function (p) {
      var l = out[out.length - 1];
      if (l && p[0] <= l[1] + 1) l[1] = Math.max(l[1], p[1]); else out.push([p[0], p[1]]);
    });
    return out;
  }
  function count(r) { return r.reduce(function (n, p) { return n + p[1] - p[0] + 1; }, 0); }
  function seen(r, n) { return r.some(function (p) { return n >= p[0] && n <= p[1]; }); }
  function label(p) { return p[0] === p[1] ? 'ép. ' + p[0] : 'ép. ' + p[0] + ' à ' + p[1]; }
  function slugify(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }

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
  var fmtDay = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' });
  var fmtHM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var eps = [];

  function keys() {
    var all = {};
    Object.keys(follow).forEach(function (k) { all[k] = follow[k]; });
    Object.keys(vus).forEach(function (k) { if (!all[k]) all[k] = vus[k].t || 'Anime'; });
    return Object.keys(all).map(function (k) { return { k: k, t: all[k], followed: !!follow[k] }; })
      .sort(function (a, b) { return a.t.localeCompare(b.t, 'fr'); });
  }
  function entry(k, t) { if (!vus[k]) vus[k] = { t: t, r: [] }; if (t) vus[k].t = t; return vus[k]; }
  function addRange(k, t, a, b) {
    var e = entry(k, t);
    e.r = merge(e.r.concat([[a, b]]));
    saveV(); render();
  }

  function info(k) {
    var now = Date.now() / 1000, mine = eps.filter(function (e) { return String(e.id) === k; }).sort(function (a, b) { return a.at - b.at; });
    var last = null, next = null;
    mine.forEach(function (e) { if (e.at <= now) last = e; else if (!next) next = e; });
    return { last: last, next: next };
  }

  function card(a) {
    var e = vus[a.k] || { t: a.t, r: [] }, n = count(e.r), inf = info(a.k);
    var head = [h('strong', { text: a.t }), h('span', { class: 'tome', text: ' ' + n + ' épisode' + (n > 1 ? 's' : '') + ' vu' + (n > 1 ? 's' : '') })];
    var meta = [];
    if (inf.last) {
      meta.push(h('span', { text: 'Dernier diffusé cette semaine : ép. ' + inf.last.e }));
      var miss = [];
      for (var i = 1; i <= inf.last.e && miss.length < 200; i++) if (!seen(e.r, i)) miss.push(i);
      meta.push(miss.length
        ? h('span', { class: 'badge s-reporte', text: miss.length + ' à rattraper' })
        : h('span', { class: 'badge s-confirme', text: 'À jour' }));
    }
    if (inf.next) meta.push(h('span', { text: 'Prochain : ép. ' + inf.next.e + ', ' + fmtDay.format(new Date(inf.next.at * 1000)).replace('.', '') + ' à ' + fmtHM.format(new Date(inf.next.at * 1000)).replace(':', ' h ') }));
    if (!inf.last && !inf.next) meta.push(h('span', { class: 'muted', text: 'Pas d’épisode diffusé cette semaine.' }));

    var chips = h('p', { class: 'vus-ranges' });
    if (!e.r.length) chips.appendChild(h('span', { class: 'muted', text: 'Aucun épisode noté pour l’instant.' }));
    e.r.forEach(function (p, idx) {
      var b = h('button', { type: 'button', class: 'chip vus-x', 'aria-label': 'Retirer ' + label(p), title: 'Retirer ' + label(p), text: label(p) + ' ✕' });
      b.addEventListener('click', function () { entry(a.k, a.t).r.splice(idx, 1); saveV(); render(); });
      chips.appendChild(b);
    });

    var from = h('input', { type: 'number', min: '1', max: String(MAXEP), inputmode: 'numeric', 'aria-label': 'Premier épisode vu', placeholder: 'de' });
    var to = h('input', { type: 'number', min: '1', max: String(MAXEP), inputmode: 'numeric', 'aria-label': 'Dernier épisode vu', placeholder: 'à' });
    var err = h('span', { class: 'vus-err', role: 'alert' });
    var add = h('button', { type: 'button', class: 'chip', text: 'Ajouter' });
    function go() {
      var x = parseInt(from.value, 10), y = to.value === '' ? x : parseInt(to.value, 10);
      if (!(x >= 1) || !(y >= x) || y > MAXEP) { err.textContent = 'Indique un premier épisode, puis un dernier supérieur ou égal.'; return; }
      addRange(a.k, a.t, x, y);
    }
    add.addEventListener('click', go);
    [from, to].forEach(function (i) { i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go(); } }); });
    var maxEp = e.r.length ? e.r[e.r.length - 1][1] : 0;
    var plus = h('button', { type: 'button', class: 'chip', text: '+1 : j’ai vu l’ép. ' + (maxEp + 1) });
    plus.addEventListener('click', function () { addRange(a.k, a.t, maxEp + 1, maxEp + 1); });
    var form = h('div', { class: 'vus-form' }, [h('span', { text: 'J’ai vu de' }), from, h('span', { text: 'à' }), to, add, plus, err]);

    var tools = [];
    if (a.followed) {
      var un = h('button', { type: 'button', class: 'chip', text: 'Ne plus suivre' });
      un.addEventListener('click', function () { delete follow[a.k]; saveA(); render(); });
      tools.push(un);
    }
    if (n || !a.followed) {
      var rm = h('button', { type: 'button', class: 'chip', text: a.followed ? 'Effacer mes épisodes vus' : 'Retirer de la liste' });
      rm.addEventListener('click', function () { if (a.followed && !window.confirm('Effacer les épisodes notés pour « ' + a.t + ' » ?')) return; delete vus[a.k]; saveV(); render(); });
      tools.push(rm);
    }
    return h('li', { class: 'rel p-anime vus-card' }, [h('div', { class: 'rel-main' }, [
      h('div', { class: 'rel-title' }, head), h('div', { class: 'meta' }, meta), chips, form, tools.length ? h('div', { class: 'vus-tools' }, tools) : null,
    ])]);
  }

  function render() {
    root.textContent = '';
    var list = keys(), total = 0;
    Object.keys(vus).forEach(function (k) { total += count(vus[k].r); });
    root.appendChild(h('p', { class: 'muted', text: list.length ? list.length + ' anime' + (list.length > 1 ? 's' : '') + ' · ' + total + ' épisode' + (total > 1 ? 's' : '') + ' vu' + (total > 1 ? 's' : '') + ' au total' : '' }));
    if (!stored) root.appendChild(h('p', { class: 'empty', text: 'Ton navigateur refuse d’enregistrer : tes réglages seront perdus en quittant la page.' }));
    if (!list.length) {
      root.appendChild(h('div', { class: 'empty' }, [
        'Aucun anime pour l’instant. Clique sur « Suivre » sous un anime de la page ',
        h('a', { href: '/anime/', text: 'Anime' }),
        ', ou ajoute-le toi-même ci-dessous.']));
    } else {
      var ul = h('ul', { class: 'list panel vus-list' });
      list.forEach(function (a) { ul.appendChild(card(a)); });
      root.appendChild(ul);
    }
    var name = h('input', { type: 'text', maxlength: '120', placeholder: 'Titre de l’anime', 'aria-label': 'Titre de l’anime à ajouter' });
    var go = h('button', { type: 'button', class: 'chip', text: 'Ajouter cet anime' });
    function addNew() {
      var t = name.value.trim(), s = slugify(t);
      if (!s) return;
      var k = 'x-' + s;
      entry(k, t); saveV(); render();
    }
    go.addEventListener('click', addNew);
    name.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addNew(); } });
    root.appendChild(h('h2', { text: 'Ajouter un anime' }));
    root.appendChild(h('p', { class: 'muted', text: 'Pour noter un anime qui n’est pas diffusé cette semaine (ou déjà terminé).' }));
    root.appendChild(h('div', { class: 'vus-form' }, [name, go]));
  }

  render();
  fetch('/data/anime-week.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : { eps: [] }; })
    .then(function (j) { eps = Array.isArray(j.eps) ? j.eps : []; render(); }).catch(function () {});
})();
