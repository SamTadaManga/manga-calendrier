/* Compteur de clics anonyme sur les liens d'achat : aucun cookie, aucun identifiant, rien n'est enregistré si « Ne pas me suivre » est activé. */
(function () {
  'use strict';
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  var PAGES = { manga: 1, serie: 1, anime: 1, 'mon-planning': 1, recherche: 1, editeur: 1, 'sorties-manga': 1, semaine: 1, articles: 1 };
  function pageKind() { var s = location.pathname.split('/')[1] || 'home'; return PAGES[s] ? s : (s === 'home' ? 'home' : 'autre'); }
  function send(a) {
    var body = JSON.stringify({ sh: a.getAttribute('data-sh'), k: a.getAttribute('data-k') || '', p: pageKind() });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/clic', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/clic', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'application/json' } });
    } catch (e) { /* sans importance */ }
  }
  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-sh]') : null;
    if (a) send(a);
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);
})();
