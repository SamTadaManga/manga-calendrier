/* Fiche d'un tome : /serie/<série>/?tome=N#tome. Aucune page de plus à publier : la fiche est composée dans le navigateur à partir de la carte du tome (couverture, ISBN, boutons d'achat, autres éditions). */
(function () {
  'use strict';
  var m = /^\?(?:.*&)?tome=(\d{1,4})(?:&.*)?$/.exec(location.search);
  if (!m) return;
  var n = m[1];
  function run() {
    var main = document.querySelector('main') || document.body;
    var cards = [].slice.call(document.querySelectorAll('li.vcard[data-t]'));
    var card = null, i;
    for (i = 0; i < cards.length; i++) if (cards[i].getAttribute('data-t') === n) { card = cards[i]; break; }
    var head = document.querySelector('.series-head');
    if (!card || !head) return;
    var serie = card.getAttribute('data-sn') || '';
    var ed = card.getAttribute('data-ed') || '';
    var img = card.querySelector('img.cover-img');
    var meta = card.querySelector('.muted');
    var shops = card.querySelector('.shops');
    var eds = card.querySelector('.cv-ed');
    function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }

    var sec = el('section', 'series-head fiche-tome');
    sec.id = 'tome';
    if (img && img.getAttribute('src')) {
      var cv = el('div', 'cover series-cover');
      var im = new Image();
      im.className = 'cover-img'; im.alt = img.alt; im.width = 160; im.height = 240; im.decoding = 'async';
      im.referrerPolicy = 'no-referrer';
      im.src = img.currentSrc || img.src;
      cv.appendChild(im);
      sec.appendChild(cv);
    }
    var box = el('div');
    var h1 = el('h1');
    h1.appendChild(el('span', 'tome-num', 'Tome ' + n));
    h1.appendChild(document.createTextNode(' '));
    h1.appendChild(el('span', 'tome-serie', serie));
    box.appendChild(h1);
    var info = el('p', 'lead');
    info.textContent = (meta ? meta.textContent : '') + (ed ? ' · ' + ed : '');
    box.appendChild(info);
    if (shops) {
      var s = shops.cloneNode(true);
      s.className = 'shops shops-lg';
      [].forEach.call(s.querySelectorAll('a.stream'), function (a) { a.classList.add('stream-lg'); });
      var lab = el('span', 'shops-l', 'Acheter');
      s.insertBefore(lab, s.firstChild);
      box.appendChild(s);
    }
    if (eds) { var e2 = eds.cloneNode(true); e2.className = 'cv-ed fiche-ed'; box.appendChild(e2); }
    var nav = el('p', 'fiche-nav');
    var nums = cards.map(function (c) { return Number(c.getAttribute('data-t')); }).sort(function (a, b) { return a - b; });
    var cur = Number(n), idx = nums.indexOf(cur);
    function link(t, txt) { var a = el('a', 'chip', txt); a.href = location.pathname + '?tome=' + t + '#tome'; return a; }
    if (idx > 0) nav.appendChild(link(nums[idx - 1], '← Tome ' + nums[idx - 1]));
    var back = el('a', 'chip', 'Toute la série'); back.href = location.pathname; nav.appendChild(back);
    if (idx >= 0 && idx < nums.length - 1) nav.appendChild(link(nums[idx + 1], 'Tome ' + nums[idx + 1] + ' →'));
    box.appendChild(nav);
    sec.appendChild(box);

    head.hidden = true;
    head.parentNode.insertBefore(sec, head);
    var t = 'Tome ' + n + ' de ' + serie + ' : ISBN et où l\'acheter';
    var sn = document.querySelector('meta[property="og:site_name"]');
    document.title = t + ' | ' + (sn && sn.content ? sn.content : 'Prochain Tome');
    try { if (meta) { var d = document.querySelector('meta[name="description"]'); if (d) d.setAttribute('content', t + '.'); } } catch (e) { /* sans importance */ }
    var tgt = document.getElementById('tome'); if (tgt && tgt.scrollIntoView) tgt.scrollIntoView();
    // sur la fiche, la carte du tome en cours est repérée dans le carrousel
    card.classList.add('vcur');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
