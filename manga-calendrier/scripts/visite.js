/* « Nouveau depuis ta dernière visite », « mis à jour il y a… » et mode hors ligne.
   Seule donnée gardée : la date de ta dernière visite, dans ton navigateur. Rien n'est envoyé. */
(function () {
  'use strict';
  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'à l’instant';
    if (m < 60) return 'il y a ' + m + ' min';
    var h = Math.round(m / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    var d = Math.round(h / 24);
    return 'il y a ' + d + (d > 1 ? ' jours' : ' jour');
  }
  var up = document.getElementById('updated');
  if (up && up.getAttribute('data-t')) {
    var a = ago(up.getAttribute('data-t'));
    if (a) up.textContent = 'Mis à jour ' + a;
  }

  var box = document.getElementById('since');
  if (box) {
    var prev = null, now = today();
    try {
      prev = sessionStorage.getItem('mc-prev');
      if (!prev) {
        prev = localStorage.getItem('mc-visit') || '';
        sessionStorage.setItem('mc-prev', prev || now);
      }
      localStorage.setItem('mc-visit', now);
    } catch (e) { prev = null; }
    if (prev && prev < now) {
      fetch('/data/recent.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j) return;
        var ev = (j.events || []).filter(function (e) { return e.day > prev; });
        var ar = (j.articles || []).filter(function (e) { return e.date > prev; });
        if (!ev.length && !ar.length) return;
        var parts = [];
        if (ev.length) parts.push(ev.length + (ev.length > 1 ? ' changements de planning' : ' changement de planning'));
        if (ar.length) parts.push(ar.length + (ar.length > 1 ? ' articles' : ' article'));
        var h = document.createElement('strong');
        h.textContent = 'Nouveau depuis ta dernière visite : ' + parts.join(' et ') + '.';
        var ul = document.createElement('ul');
        ev.slice(0, 4).forEach(function (e) {
          var li = document.createElement('li');
          var lab = e.type === 'nouveau' ? 'Annoncé' : e.type === 'retire' ? 'Retiré' : (e.to > e.from ? 'Reporté' : 'Avancé');
          li.textContent = lab + ' : ' + e.s + (e.t ? ' tome ' + e.t : '');
          ul.appendChild(li);
        });
        ar.slice(0, 2).forEach(function (e) {
          var li = document.createElement('li'), l = document.createElement('a');
          l.href = '/articles/' + e.slug + '/'; l.textContent = e.title;
          li.appendChild(document.createTextNode('Article : ')); li.appendChild(l);
          ul.appendChild(li);
        });
        var more = document.createElement('a');
        more.href = '/changements/'; more.textContent = 'Voir tous les changements';
        box.appendChild(h); box.appendChild(ul); box.appendChild(more);
        box.hidden = false;
      }).catch(function () {});
    }
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
