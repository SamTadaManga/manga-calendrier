/* Date juste même si la page a été construite hier : GitHub peut retarder les mises à jour planifiées de plusieurs heures.
   Si la date de construction (data-built) n'est plus celle d'aujourd'hui à Paris, on corrige ce qui en dépend :
   le bandeau de la semaine, le repère « aujourd'hui » des listes par jour et le bloc « sorties du jour ». */
(function () {
  var t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  var b = document.documentElement.getAttribute('data-built');
  if (!b || b >= t) return;
  var i, el;
  // bandeau de la semaine : les jours passés disparaissent, aujourd'hui prend la place du jour courant
  var panels = document.querySelectorAll('.day-panel[data-d]');
  for (i = 0; i < panels.length; i++) {
    el = panels[i];
    var d = el.getAttribute('data-d'), w = el.querySelector('.d-wd');
    if (d < t) { el.hidden = true; el.style.display = 'none'; }
    else {
      el.classList.toggle('today', d === t);
      if (w) w.textContent = d === t ? "aujourd'hui" : el.getAttribute('data-wd') || w.textContent;
    }
  }
  // listes par jour : le repère « aujourd'hui » suit la vraie date
  var olds = document.querySelectorAll('.chip-day .now');
  for (i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
  var h = document.getElementById('j-' + t);
  if (h) { var c = h.matches('.chip-day') ? h : h.querySelector('.chip-day'); if (c) { var s = document.createElement('span'); s.className = 'now'; s.textContent = "aujourd'hui"; c.appendChild(document.createTextNode(' ')); c.appendChild(s); } }
  // bloc « sorties du jour » de l'accueil : celui de la veille ne doit pas passer pour celui d'aujourd'hui
  var blocks = document.querySelectorAll('section[data-day]');
  for (i = 0; i < blocks.length; i++) {
    if (blocks[i].getAttribute('data-day') !== t) blocks[i].innerHTML = '<p class="empty">Les sorties du jour sont en cours de mise à jour. <a href="/semaine/#j-' + t + '">Voir le détail du jour</a></p>';
  }
})();
