/* Bouton clair / sombre. Le choix est gardé dans ce navigateur ; sans choix, on suit le réglage de l'appareil. */
(function () {
  'use strict';
  var root = document.documentElement;
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function label(b) { b.setAttribute('aria-label', isDark() ? 'Passer en thème clair' : 'Passer en thème sombre'); b.title = b.getAttribute('aria-label'); }
  function init() {
    var bar = document.querySelector('.site-header .tools');
    if (!bar) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'theme-btn';
    b.innerHTML = '<svg class="sun" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2L16 16M16 4l-1.8 1.8M5.8 14.2L4 16"/></g></svg><svg class="moon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z" fill="currentColor"/></svg>';
    label(b);
    b.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('mc-theme', next); } catch (e) {}
      label(b);
    });
    bar.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
