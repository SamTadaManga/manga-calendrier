/* Mesure d'audience anonyme : aucun cookie, aucun identifiant stocké, l'adresse IP n'est pas enregistrée.
   Envoie la page vue, puis le temps passé dessus (onglet visible) et la part de la page parcourue.
   Rien n'est envoyé si le navigateur demande « Ne pas me suivre » ou si l'on a refusé avec ?mesure=non. */
(function () {
  'use strict';
  var qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { return; }
  try {
    var m = qs.get('mesure');
    if (m === 'non') localStorage.setItem('mc-mesure', 'non');
    else if (m === 'oui') localStorage.removeItem('mc-mesure');
    if (localStorage.getItem('mc-mesure') === 'non') return;
  } catch (e) { /* stockage indisponible : on continue */ }
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true || navigator.webdriver) return;
  if (!/^https?:$/.test(location.protocol)) return;

  var id = '';
  try { var b = crypto.getRandomValues(new Uint8Array(10)); for (var i = 0; i < b.length; i++) id += (b[i] % 36).toString(36); }
  catch (e) { id = (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 16); }

  function send(o) {
    o.id = id;
    var body = JSON.stringify(o);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/vu', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/vu', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(function () {});
    } catch (e) { /* sans importance */ }
  }

  var nouveau = 0;
  try { nouveau = localStorage.getItem('mc-visit') ? 0 : 1; } catch (e) {}
  var ref = '';
  try { if (document.referrer) { var r = new URL(document.referrer); if (r.host !== location.host) ref = r.host; } } catch (e) {}
  var p = location.pathname;
  send({
    e: 'v', p: p, r: ref, u: qs.get('utm_source') || '', n: nouveau, w: screen.width || 0,
    q: p.indexOf('/recherche') === 0 ? (qs.get('q') || '') : '',
    x: document.body && document.body.hasAttribute('data-404') ? 1 : 0,
  });

  var vis = 0, since = document.visibilityState === 'visible' ? Date.now() : 0, maxScroll = 0, last = -1;
  function scrollPct() {
    var h = document.documentElement, total = h.scrollHeight - h.clientHeight;
    var pct = total > 0 ? Math.round(100 * (window.scrollY || h.scrollTop) / total) : 100;
    if (pct > maxScroll) maxScroll = Math.min(100, pct);
  }
  function charge() {
    try { var n = performance.getEntriesByType('navigation')[0]; return n && n.loadEventEnd > 0 ? Math.round(n.loadEventEnd) : 0; } catch (e) { return 0; }
  }
  function flush() {
    if (since) { vis += Date.now() - since; since = 0; }
    if (vis === last) return;
    last = vis;
    send({ e: 'f', d: vis, sc: maxScroll, c: charge() });
  }
  var t = 0;
  window.addEventListener('scroll', function () { if (!t) t = setTimeout(function () { t = 0; scrollPct(); }, 250); }, { passive: true });
  window.addEventListener('load', scrollPct);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(); else since = Date.now();
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener('pageshow', function (e) { if (e.persisted) since = Date.now(); });
})();
