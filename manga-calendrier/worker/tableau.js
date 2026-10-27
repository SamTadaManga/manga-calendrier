// Tableau de bord privé de la mesure d'audience, servi par le Worker sur /api/tableau.
// La page elle-même ne contient aucune donnée : elle demande la clé STATS_KEY (gardée dans ce navigateur)
// et lit /api/stats. Ouvrir cette page exclut aussi ce navigateur de la mesure (?mesure=non).
export const TABLEAU = String.raw`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Audience Prochain Tome</title>
<style>
:root{color-scheme:light;--paper:#fbfaf6;--panel:#fff;--ink:#111;--muted:#5b5b5b;--line:#e6e3da;--brand:#ffd21f;--on-brand:#111;
--s1:#2a78d6;--s1-soft:rgba(42,120,214,.12);--prev:#9a978e;--track:#efece4;--good:#0a7a3d;--bad:#c22b2b;--shadow:#111}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--paper:#0f0f10;--panel:#19191b;--ink:#f6f4ee;--muted:#a8a8a8;--line:#2c2c2f;
--s1:#3987e5;--s1-soft:rgba(57,135,229,.18);--prev:#77756f;--track:#26262a;--good:#4cc77f;--bad:#ff7b7b;--shadow:#000}}
:root[data-theme="dark"]{color-scheme:dark;--paper:#0f0f10;--panel:#19191b;--ink:#f6f4ee;--muted:#a8a8a8;--line:#2c2c2f;
--s1:#3987e5;--s1-soft:rgba(57,135,229,.18);--prev:#77756f;--track:#26262a;--good:#4cc77f;--bad:#ff7b7b;--shadow:#000}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px 48px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:20px 0 16px}
h1{font-size:1.35rem;margin:0;display:flex;align-items:center;gap:10px;letter-spacing:-.01em}
h1 .mark{width:18px;height:18px;background:var(--brand);border:2px solid var(--ink);border-radius:4px;display:inline-block}
h1 small{font-weight:500;color:var(--muted);font-size:.9rem}
.live{display:inline-flex;align-items:center;gap:8px;border:2px solid var(--ink);border-radius:999px;padding:4px 12px;font-weight:700;font-size:.9rem;background:var(--panel)}
.live i{width:9px;height:9px;border-radius:50%;background:var(--good);box-shadow:0 0 0 3px color-mix(in srgb,var(--good) 25%,transparent);animation:p 2s infinite}
@keyframes p{50%{opacity:.4}}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:18px}
.seg{display:inline-flex;border:2px solid var(--ink);border-radius:10px;overflow:hidden;background:var(--panel)}
.seg button{white-space:nowrap;font:inherit;font-weight:600;font-size:.88rem;border:0;background:none;color:var(--ink);padding:7px 12px;cursor:pointer;border-right:1px solid var(--line)}
.seg button:last-child{border-right:0}
.seg button[aria-pressed="true"]{background:var(--brand);color:var(--on-brand)}
.btn{font:inherit;font-weight:600;font-size:.88rem;border:2px solid var(--ink);border-radius:10px;background:var(--panel);color:var(--ink);padding:6px 12px;cursor:pointer}
.btn:hover,.seg button:hover{filter:brightness(.96)}
.range{color:var(--muted);font-size:.88rem;margin-left:auto}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.card{background:var(--panel);border:2px solid var(--ink);border-radius:14px;box-shadow:3px 3px 0 var(--shadow);padding:14px 16px;min-width:0}
.kpi .l{font-size:.82rem;color:var(--muted);font-weight:600;display:flex;gap:6px;align-items:center}
.kpi .v{font-size:1.75rem;font-weight:800;letter-spacing:-.02em;margin-top:2px;font-variant-numeric:tabular-nums}
.kpi .d{font-size:.8rem;color:var(--muted);margin-top:2px}
.up{color:var(--good);font-weight:700}.down{color:var(--bad);font-weight:700}
.q{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;border:1px solid var(--muted);font-size:10px;cursor:help}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}
.grid3{grid-template-columns:repeat(3,minmax(0,1fr))}
.full{margin-bottom:16px}
h2{font-size:1rem;margin:0 0 4px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.sub{font-size:.82rem;color:var(--muted);margin:0 0 12px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.tabs button{font:inherit;font-size:.82rem;font-weight:600;border:1px solid var(--line);border-radius:999px;background:none;color:var(--ink);padding:4px 10px;cursor:pointer}
.tabs button[aria-pressed="true"]{border-color:var(--ink);background:var(--ink);color:var(--paper)}
.chart{position:relative;height:240px}
.chart svg{display:block;width:100%;height:100%;overflow:visible}
.legend{display:flex;gap:16px;font-size:.8rem;color:var(--muted);margin-top:8px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend b{display:inline-block;width:16px;height:0;border-top:2px solid var(--s1)}
.legend b.p{border-top:2px dashed var(--prev)}
.tip{position:absolute;pointer-events:none;background:var(--panel);border:2px solid var(--ink);border-radius:8px;padding:6px 9px;font-size:.8rem;white-space:nowrap;box-shadow:2px 2px 0 var(--shadow);z-index:2;display:none}
.tip strong{font-variant-numeric:tabular-nums}
.cols{display:flex;align-items:flex-end;gap:2px;height:150px;padding-top:6px}
.cols div{flex:1;position:relative;height:100%;display:flex;align-items:flex-end}
.cols span{display:block;width:100%;background:var(--s1);border-radius:4px 4px 0 0;min-height:1px}
.cols div:hover span{filter:brightness(1.15)}
.axis{display:flex;gap:2px;font-size:.72rem;color:var(--muted);margin-top:4px}
.axis div{flex:1;text-align:center}
.list{list-style:none;margin:0;padding:0}
.list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:.88rem}
.list li:last-child{border-bottom:0}
.list .k{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list .k a{color:inherit;text-decoration:none}.list .k a:hover{text-decoration:underline}
.list .n{font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
.list .n small{font-weight:500;color:var(--muted);margin-left:6px}
.list .t{grid-column:1/-1;height:6px;background:var(--track);border-radius:3px;overflow:hidden}
.list .t i{display:block;height:100%;background:var(--s1);border-radius:3px}
.empty{color:var(--muted);font-size:.88rem;padding:8px 0}
.tw{overflow-x:auto;margin:0 -4px}
table{width:100%;border-collapse:collapse;font-size:.88rem;font-variant-numeric:tabular-nums}
th{text-align:right;font-size:.75rem;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:2px solid var(--ink);white-space:nowrap}
td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal;word-break:break-all;min-width:180px}
td a{color:inherit}
.login{max-width:420px;margin:12vh auto 0}
.login label{display:block;font-weight:700;margin:12px 0 6px}
.login input{width:100%;font:inherit;padding:9px 12px;border:2px solid var(--ink);border-radius:10px;background:var(--panel);color:var(--ink)}
.login .btn{margin-top:12px;background:var(--brand);color:var(--on-brand)}
.err{color:var(--bad);font-weight:600;margin-top:10px}
.note{font-size:.82rem;color:var(--muted)}
.note dt{font-weight:700;color:var(--ink);margin-top:8px}.note dd{margin:0}
.banner{background:var(--brand);color:var(--on-brand);border:2px solid var(--ink);border-radius:12px;padding:10px 14px;margin-bottom:16px;font-weight:600}
[hidden]{display:none!important}
@media (max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.grid,.grid3{grid-template-columns:1fr}.range{margin-left:0;width:100%}}
@media (max-width:560px){#per{display:grid;grid-template-columns:repeat(3,1fr);width:100%}#per button{border-bottom:1px solid var(--line)}}
@media (max-width:420px){.kpi .v{font-size:1.4rem}}
</style></head>
<body><div class="wrap">
<section id="login" class="login card" hidden>
<h1><span class="mark"></span>Audience Prochain Tome</h1>
<form id="lf"><label for="cle">Clé d'accès (STATS_KEY)</label>
<input id="cle" type="password" autocomplete="current-password" required>
<p class="note">La clé reste dans ce navigateur. Ouvrir ce tableau de bord exclut aussi ce navigateur des statistiques.</p>
<button class="btn" type="submit">Afficher les statistiques</button><p id="lerr" class="err" hidden></p></form>
</section>
<main id="app" hidden>
<header><h1><span class="mark"></span>Audience <small>prochaintome.fr</small></h1>
<span class="live" title="Visiteurs actifs sur les 5 dernières minutes"><i></i><span id="live">0</span>&nbsp;en ce moment</span></header>
<div class="bar">
<div class="seg" id="per" role="group" aria-label="Période">
<button data-p="jour">Aujourd'hui</button><button data-p="hier">Hier</button><button data-p="7">7 jours</button><button data-p="30">30 jours</button><button data-p="90">90 jours</button><button data-p="365">12 mois</button></div>
<button class="btn" id="refresh" type="button">Actualiser</button>
<button class="btn" id="logout" type="button">Changer de clé</button>
<span class="range" id="range"></span></div>
<div id="banner" class="banner" hidden></div>
<div class="kpis" id="kpis"></div>
<section class="card full"><h2>Évolution <span class="note" id="chartnote"></span></h2>
<div class="tabs" id="metric"><button data-m="visiteurs">Visiteurs uniques</button><button data-m="sessions">Visites</button><button data-m="vues">Pages vues</button><button data-m="duree">Durée moyenne</button></div>
<div class="chart" id="chart"></div>
<div class="legend"><span><b></b>Période choisie</span><span><b class="p"></b>Période précédente</span></div></section>
<div class="grid">
<section class="card"><h2>Heures de visite</h2><p class="sub">Pages vues selon l'heure (heure de Paris)</p><div id="hours"></div></section>
<section class="card"><h2>Jours de la semaine</h2><p class="sub">Pages vues selon le jour</p><div id="week"></div></section></div>
<section class="card full"><h2>Pages les plus vues</h2><p class="sub">Temps moyen = temps passé avec l'onglet visible · Lu = part de la page parcourue</p><div class="tw" id="pages"></div></section>
<div class="grid grid3">
<section class="card"><h2>Rubriques</h2><p class="sub">Pages vues par partie du site</p><ul class="list" id="rubriques"></ul></section>
<section class="card"><h2>Pages d'entrée</h2><p class="sub">Première page de la visite · rebond</p><ul class="list" id="entrees"></ul></section>
<section class="card"><h2>Pages de sortie</h2><p class="sub">Dernière page de la visite</p><ul class="list" id="sorties"></ul></section></div>
<div class="grid grid3">
<section class="card"><h2>Canaux</h2><p class="sub">D'où arrivent les visites · durée moyenne</p><ul class="list" id="canaux"></ul></section>
<section class="card"><h2>Sites référents</h2><p class="sub">Visites venues d'un lien</p><ul class="list" id="referents"></ul></section>
<section class="card"><h2>Campagnes</h2><p class="sub">Liens marqués ?utm_source=</p><ul class="list" id="campagnes"></ul></section></div>
<div class="grid">
<section class="card"><h2>Pays</h2><p class="sub">Visites</p><ul class="list" id="pays"></ul></section>
<section class="card"><h2>Appareils</h2><p class="sub">Visites</p><ul class="list" id="appareils"></ul>
<h2 style="margin-top:16px">Navigateurs</h2><ul class="list" id="navigateurs"></ul>
<h2 style="margin-top:16px">Systèmes</h2><ul class="list" id="systemes"></ul></section></div>
<div class="grid">
<section class="card"><h2>Recherches sur le site</h2><p class="sub">Ce que les visiteurs tapent dans la recherche</p><ul class="list" id="recherches"></ul></section>
<section class="card"><h2>Pages introuvables (404)</h2><p class="sub">Liens cassés à corriger · site d'origine</p><ul class="list" id="introuvables"></ul></section></div>
<div class="grid">
<section class="card"><h2>Clics d'achat <span class="note" id="ctaux"></span></h2><p class="sub">Par boutique (compteur de clics anonyme)</p><ul class="list" id="boutiques"></ul></section>
<section class="card"><h2>Séries les plus cliquées</h2><p class="sub">Clics vers une boutique</p><ul class="list" id="cseries"></ul></section></div>
<div class="grid">
<section class="card"><h2>En ce moment</h2><p class="sub">Pages ouvertes ces 5 dernières minutes</p><ul class="list" id="direct"></ul></section>
<section class="card note"><h2>Comment lire ces chiffres</h2><dl>
<dt>Visiteurs uniques</dt><dd>Personnes distinctes dans la journée. Sans cookie, un visiteur revenu un autre jour est recompté : sur plusieurs jours, c'est la somme des visiteurs de chaque jour.</dd>
<dt>Visite</dt><dd>Suite de pages vues sans pause de plus de 30 minutes.</dd>
<dt>Durée moyenne</dt><dd>Temps passé avec l'onglet visible, toutes pages de la visite comprises (comptée aussi sur la dernière page).</dd>
<dt>Rebond</dt><dd>Visite d'une seule page. Visite engagée : au moins 2 pages ou 10 secondes.</dd>
<dt>Non comptés</dt><dd>Robots, navigateurs « Ne pas me suivre », et tes propres navigateurs une fois ce tableau ouvert (ou après /?mesure=non).</dd></dl></section></div>
</main>
<div class="tip" id="tip"></div>
</div>
<script>
(function(){
'use strict';
var KEY='mc-cle',PKEY='mc-tb-p',MKEY='mc-tb-m';
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(e){return null;}}
ls('mc-mesure','non');
var $=function(id){return document.getElementById(id);};
var state={p:ls(PKEY)||'30',m:ls(MKEY)||'visiteurs',data:null};
var NF=new Intl.NumberFormat('fr-FR');
var PF=new Intl.NumberFormat('fr-FR',{style:'percent',maximumFractionDigits:0});
var DF=new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
var DFL=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
var REG=null;try{REG=new Intl.DisplayNames(['fr'],{type:'region'});}catch(e){}
function n(x){return NF.format(Math.round(x||0));}
function dur(ms){ms=Math.round((ms||0)/1000);if(ms<60)return ms+' s';var m=Math.floor(ms/60),s=ms%60;if(m<60)return m+' min'+(s?' '+(s<10?'0':'')+s+' s':'');return Math.floor(m/60)+' h '+(m%60)+' min';}
function day(d){return DF.format(new Date(d+'T12:00:00Z'));}
function el(t,c,txt){var e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e;}
function flag(cc){if(!/^[A-Z]{2}$/.test(cc)||cc==='XX')return '';return String.fromCodePoint(127397+cc.charCodeAt(0),127397+cc.charCodeAt(1))+' ';}
function country(cc){if(cc==='XX'||!cc)return 'Inconnu';try{return flag(cc)+(REG?REG.of(cc):cc);}catch(e){return cc;}}
var DAYS=['','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

function showLogin(msg){$('app').hidden=true;$('login').hidden=false;var e=$('lerr');e.hidden=!msg;e.textContent=msg||'';$('cle').focus();}
$('lf').addEventListener('submit',function(ev){ev.preventDefault();ls(KEY,$('cle').value.trim());load();});
$('logout').addEventListener('click',function(){ls(KEY,null);$('cle').value='';showLogin('');});
$('refresh').addEventListener('click',function(){load();});
Array.prototype.forEach.call(document.querySelectorAll('#per button'),function(b){b.addEventListener('click',function(){state.p=b.getAttribute('data-p');ls(PKEY,state.p);load();});});
Array.prototype.forEach.call(document.querySelectorAll('#metric button'),function(b){b.addEventListener('click',function(){state.m=b.getAttribute('data-m');ls(MKEY,state.m);mark();if(state.data)chart(state.data);});});
function mark(){
  Array.prototype.forEach.call(document.querySelectorAll('#per button'),function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-p')===state.p));});
  Array.prototype.forEach.call(document.querySelectorAll('#metric button'),function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-m')===state.m));});
}
var busy=false;
function load(){
  var key=ls(KEY);if(!key){showLogin('');return;}
  if(busy)return;busy=true;$('refresh').textContent='Chargement…';
  fetch('/api/stats?p='+encodeURIComponent(state.p),{headers:{'X-Cle':key},cache:'no-store'}).then(function(r){
    if(r.status===404){ls(KEY,null);throw new Error('cle');}
    if(!r.ok)throw new Error('http '+r.status);return r.json();
  }).then(function(d){state.data=d;$('login').hidden=true;$('app').hidden=false;mark();render(d);})
  .catch(function(e){if(e.message==='cle')showLogin('Clé refusée. Vérifie la valeur du secret STATS_KEY du Worker.');else{$('banner').hidden=false;$('banner').textContent='Impossible de charger les statistiques ('+e.message+'). Réessaie dans un instant.';}})
  .then(function(){busy=false;$('refresh').textContent='Actualiser';});
}

function delta(cur,prev,lowerIsBetter,isRate){
  var d=el('div','d');
  if(!prev&&!cur){d.textContent='—';return d;}
  if(!prev){d.textContent='nouveau sur la période';return d;}
  var diff=isRate?(cur-prev):(cur-prev)/prev;
  if(Math.abs(diff)<0.005){d.textContent='= stable vs période précédente';return d;}
  var good=lowerIsBetter?diff<0:diff>0;
  var s=el('span',good?'up':'down',(diff>0?'▲ +':'▼ −')+(isRate?Math.round(Math.abs(diff)*100)+' pt':PF.format(Math.abs(diff))));
  d.appendChild(s);d.appendChild(document.createTextNode(' vs période précédente'));return d;
}
function kpi(label,value,cur,prev,help,lower,isRate){
  var c=el('div','card kpi');var l=el('div','l',label);
  if(help){var q=el('span','q','?');q.title=help;l.appendChild(q);}
  c.appendChild(l);c.appendChild(el('div','v',value));c.appendChild(delta(cur,prev,lower,isRate));return c;
}
function render(d){
  $('banner').hidden=true;
  var t=d.totaux,p=d.precedent;
  $('range').textContent=d.de===d.a?DFL.format(new Date(d.a+'T12:00:00Z')):'Du '+DFL.format(new Date(d.de+'T12:00:00Z'))+' au '+DFL.format(new Date(d.a+'T12:00:00Z'));
  $('live').textContent=n(d.direct.visiteurs);
  if(!t.vues){$('banner').hidden=false;$('banner').textContent='Aucune visite enregistrée sur cette période. La mesure a démarré à la mise en ligne de ce compteur : les chiffres apparaissent au fil des visites.';}
  var k=$('kpis');k.textContent='';
  var clics=d.clics?d.clics.total:0;
  k.appendChild(kpi('Visiteurs uniques',n(t.visiteurs),t.visiteurs,p.visiteurs,'Personnes distinctes par jour, additionnées sur la période'));
  k.appendChild(kpi('Visites',n(t.sessions),t.sessions,p.sessions,'Suite de pages sans pause de plus de 30 min'));
  k.appendChild(kpi('Pages vues',n(t.vues),t.vues,p.vues));
  k.appendChild(kpi('Durée moyenne de visite',dur(t.dureeMoy),t.dureeMoy,p.dureeMoy,'Temps onglet visible. Médiane : '+dur(t.dureeMed)));
  k.appendChild(kpi('Pages par visite',t.pagesParVisite.toFixed(1).replace('.',','),t.pagesParVisite,p.pagesParVisite));
  k.appendChild(kpi('Taux de rebond',PF.format(t.rebond),t.rebond,p.rebond,'Visites d\'une seule page (plus bas = mieux)',true,true));
  k.appendChild(kpi('Visites engagées',PF.format(t.engagement),t.engagement,p.engagement,'Au moins 2 pages ou 10 secondes',false,true));
  k.appendChild(kpi('Nouveaux visiteurs',PF.format(t.nouveaux),t.nouveaux,p.nouveaux,'Part des visites faites par quelqu\'un qui n\'était jamais venu sur ce navigateur',false,true));
  chart(d);hours(d);week(d);pages(d);
  list('rubriques',d.rubriques.map(function(r){return{k:r.cle==='accueil'?'Accueil':'/'+r.cle+'/',n:r.n,s:r.duree?dur(r.duree)+' / page':''};}));
  list('entrees',d.entrees.map(function(r){return{k:r.cle,href:r.cle,n:r.n,s:r.n?PF.format(r.rebonds/r.n)+' rebond':''};}));
  list('sorties',d.sorties.map(function(r){return{k:r.cle,href:r.cle,n:r.n};}));
  list('canaux',d.canaux.map(function(r){return{k:r.cle,n:r.n,s:dur(r.duree)};}));
  list('referents',d.referents.map(function(r){return{k:r.cle,n:r.n,s:dur(r.duree)};}));
  list('campagnes',d.campagnes.map(function(r){return{k:r.cle,n:r.n,s:dur(r.duree)};}),'Aucune. Ajoute ?utm_source=tiktok (par exemple) à tes liens partagés pour les suivre ici.');
  list('pays',d.pays.map(function(r){return{k:country(r.cle),n:r.n};}));
  list('appareils',d.appareils.map(function(r){return{k:r.cle,n:r.n,s:dur(r.duree)};}));
  list('navigateurs',d.navigateurs.map(function(r){return{k:r.cle,n:r.n};}));
  list('systemes',d.systemes.map(function(r){return{k:r.cle,n:r.n};}));
  list('recherches',d.recherches.map(function(r){return{k:r.cle,href:'/recherche/?q='+encodeURIComponent(r.cle),n:r.n};}),'Aucune recherche sur la période.');
  list('introuvables',d.introuvables.map(function(r){return{k:r.cle,n:r.n,s:r.ref?'depuis '+r.ref:''};}),'Aucune page introuvable. 👍');
  list('direct',d.direct.pages.map(function(r){return{k:r.cle,href:r.cle,n:r.n};}),'Personne en ce moment.');
  if(d.clics){
    $('ctaux').textContent=t.sessions?n(clics)+' clics · '+PF.format(clics/t.sessions)+' des visites':n(clics)+' clics';
    list('boutiques',d.clics.boutiques.map(function(r){return{k:r[0],n:r[1]};}),'Aucun clic d\'achat sur la période.');
    list('cseries',d.clics.series.map(function(r){return{k:r[0],href:/^[a-z0-9-]+$/.test(r[0])?'/serie/'+r[0]+'/':'',n:r[1]};}),'Aucun clic d\'achat sur la période.');
  }
}
function list(id,rows,empty){
  var ul=$(id);ul.textContent='';
  if(!rows.length){ul.appendChild(el('li','empty',empty||'Pas encore de données.'));return;}
  var max=Math.max.apply(null,rows.map(function(r){return r.n;}))||1;
  rows.forEach(function(r){
    var li=el('li');var k=el('span','k');
    if(r.href&&r.href.charAt(0)==='/'){var a=el('a',null,r.k);a.href=r.href;a.target='_blank';a.rel='noopener';k.appendChild(a);}else k.textContent=r.k;
    k.title=r.k;li.appendChild(k);
    var v=el('span','n',n(r.n));if(r.s)v.appendChild(el('small',null,r.s));li.appendChild(v);
    var tr=el('span','t');var i=el('i');i.style.width=Math.max(1,Math.round(100*r.n/max))+'%';tr.appendChild(i);li.appendChild(tr);
    ul.appendChild(li);
  });
}
function pages(d){
  var w=$('pages');w.textContent='';
  if(!d.pages.length){w.appendChild(el('p','empty','Pas encore de données.'));return;}
  var tb=el('table');var hr=el('tr');['Page','Vues','Visiteurs','Temps moyen','Lu','Chargement'].forEach(function(h){hr.appendChild(el('th',null,h));});
  var th=el('thead');th.appendChild(hr);tb.appendChild(th);var bd=el('tbody');
  d.pages.forEach(function(r){var tr=el('tr');var c=el('td');var a=el('a',null,r.cle);a.href=r.cle;a.target='_blank';a.rel='noopener';c.appendChild(a);tr.appendChild(c);
    [n(r.vues),n(r.visiteurs),r.temps?dur(r.temps):'—',r.scroll?r.scroll+' %':'—',r.charge?(r.charge/1000).toFixed(1).replace('.',',')+' s':'—'].forEach(function(x){tr.appendChild(el('td',null,x));});bd.appendChild(tr);});
  tb.appendChild(bd);w.appendChild(tb);
}
var tip=$('tip');
function showTip(html,x,y,box){
  tip.textContent='';html.forEach(function(line){var div=el('div');if(line.b){div.appendChild(el('strong',null,line.b));if(line.t)div.appendChild(document.createTextNode(' '+line.t));}else div.textContent=line.t;if(line.c)div.style.color=line.c;tip.appendChild(div);});
  tip.style.display='block';var r=box.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
  var left=r.left+window.scrollX+x+14,top=r.top+window.scrollY+y-h-10;
  if(left+w>window.scrollX+document.documentElement.clientWidth-8)left=r.left+window.scrollX+x-w-14;
  if(top<window.scrollY+4)top=r.top+window.scrollY+y+14;
  tip.style.left=left+'px';tip.style.top=top+'px';
}
function hideTip(){tip.style.display='none';}
function cols(id,data,labels,fmtLabel,axisEvery){
  var box=$(id);box.textContent='';var max=Math.max.apply(null,data.map(function(x){return x.v;}))||1;
  var c=el('div','cols');
  data.forEach(function(x,i){var d=el('div');var s=el('span');s.style.height=(x.v?Math.max(2,100*x.v/max):0)+'%';d.appendChild(s);
    d.addEventListener('mousemove',function(e){var r=box.getBoundingClientRect();showTip([{b:fmtLabel(i)},{b:n(x.v),t:'pages vues'},{b:n(x.u),t:'visiteurs'}],e.clientX-r.left,e.clientY-r.top,box);});
    d.addEventListener('mouseleave',hideTip);c.appendChild(d);});
  box.appendChild(c);var ax=el('div','axis');labels.forEach(function(l,i){ax.appendChild(el('div',null,i%axisEvery===0?l:''));});box.appendChild(ax);
}
function hours(d){var m={};d.heures.forEach(function(r){m[r.cle]=r;});var data=[],lab=[];for(var h=0;h<24;h++){data.push({v:m[h]?m[h].vues:0,u:m[h]?m[h].visiteurs:0});lab.push(h+'h');}
  cols('hours',data,lab,function(i){return i+' h – '+(i+1)+' h';},3);}
function week(d){var m={};d.semaine.forEach(function(r){m[r.cle]=r;});var data=[],lab=[];for(var j=1;j<=7;j++){data.push({v:m[j]?m[j].vues:0,u:m[j]?m[j].visiteurs:0});lab.push(DAYS[j].slice(0,3)+'.');}
  cols('week',data,lab,function(i){return DAYS[i+1];},1);}

function addDay(s,k){var t=new Date(s+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+k);return t.toISOString().slice(0,10);}
function chart(d){
  var box=$('chart');box.textContent='';var m=state.m;var pts=[],prev=null,labels=[],hourly=d.de===d.a;
  if(hourly){
    var hm={};d.heures.forEach(function(r){hm[r.cle]=r;});
    var hmax=24;try{var ph=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(d.genere));var o={};ph.forEach(function(x){o[x.type]=x.value;});if(o.year+'-'+o.month+'-'+o.day===d.a)hmax=parseInt(o.hour,10)+1;}catch(e){}
    for(var h=0;h<hmax;h++){var r=hm[h]||{};pts.push(m==='vues'?r.vues||0:m==='visiteurs'||m==='sessions'?r.visiteurs||0:0);labels.push(h+' h');}
    $('chartnote').textContent=m==='duree'?'non disponible heure par heure':'heure par heure'+(m==='sessions'?' (visiteurs)':'');
  }else{
    var dm={};d.jours.forEach(function(r){dm[r.jour]=r;});
    var pm={};(d.joursPrecedents||[]).forEach(function(r){pm[r.jour]=r;});prev=[];
    for(var x=d.de,y=d.precedent.de;x<=d.a;x=addDay(x,1),y=addDay(y,1)){var r2=dm[x]||{},r3=pm[y]||{};pts.push(r2[m]||0);prev.push({j:y,v:r3[m]||0});labels.push(x);}
    $('chartnote').textContent='jour par jour';
  }
  var W=box.clientWidth||600,H=box.clientHeight||240,L=44,R=10,T=10,B=26;
  var max=Math.max.apply(null,pts.concat(prev?prev.map(function(p){return p.v;}):[]))||1;var nice=niceMax(max,m);var N=pts.length;
  var SL=hourly?24:N;var X=function(i){return SL<=1?L+(W-L-R)/2:L+i*(W-L-R)/(SL-1);};var Y=function(v){return T+(H-T-B)*(1-v/nice);};
  var NS='http://www.w3.org/2000/svg';var svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Évolution : '+(document.querySelector('#metric button[aria-pressed="true"]')||{}).textContent);
  function add(tag,attrs,txt){var e=document.createElementNS(NS,tag);for(var a in attrs)e.setAttribute(a,attrs[a]);if(txt!=null)e.textContent=txt;svg.appendChild(e);return e;}
  for(var g=0;g<=4;g++){var v=nice*g/4,y=Y(v);add('line',{x1:L,x2:W-R,y1:y,y2:y,stroke:'var(--line)','stroke-width':1});
    add('text',{x:L-8,y:y+4,'text-anchor':'end','font-size':11,fill:'var(--muted)'},m==='duree'?shortDur(v):compact(v));}
  var every=Math.max(1,Math.ceil(N/(W<500?5:9)));
  var AX=hourly?24:N,axl=hourly?[]:labels;if(hourly)for(var hh=0;hh<24;hh++)axl.push(hh+' h');if(hourly)every=3;
  axl.forEach(function(l,i){var last=AX-1;if(i%every!==0&&i!==last)return;if(i!==last&&last-i<every/2)return;add('text',{x:X(i),y:H-6,'text-anchor':i===0?'start':i===last?'end':'middle','font-size':11,fill:'var(--muted)'},hourly?l:day(l).replace('.',''));});
  if(prev&&N>1)add('path',{d:prev.map(function(p,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(p.v).toFixed(1);}).join(' '),fill:'none',stroke:'var(--prev)','stroke-width':1.5,'stroke-dasharray':'5 4'});
  if(N>1){
    var line=pts.map(function(v,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);}).join(' ');
    add('path',{d:line+' L'+X(N-1)+' '+Y(0)+' L'+X(0)+' '+Y(0)+' Z',fill:'var(--s1-soft)',stroke:'none'});
    var partial=!hourly&&N>2&&labels[N-1]===todayParis(d.genere);
    var solid=partial?line.split(' L').slice(0,N-1).join(' L'):line;
    add('path',{d:solid,fill:'none',stroke:'var(--s1)','stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'});
    if(partial)add('path',{d:'M'+X(N-2)+' '+Y(pts[N-2])+' L'+X(N-1)+' '+Y(pts[N-1]),fill:'none',stroke:'var(--s1)','stroke-width':2,'stroke-dasharray':'4 4'});
  }else if(hourly){add('circle',{cx:X(0),cy:Y(pts[0]),r:5,fill:'var(--s1)'});}else{add('rect',{x:X(0)-14,y:Y(pts[0]),width:28,height:Math.max(1,Y(0)-Y(pts[0])),rx:4,fill:'var(--s1)'});}
  var cross=add('line',{y1:T,y2:H-B,stroke:'var(--muted)','stroke-width':1,'stroke-dasharray':'3 3',visibility:'hidden'});
  var dot=add('circle',{r:5,fill:'var(--s1)',stroke:'var(--panel)','stroke-width':2,visibility:'hidden'});
  var hit=add('rect',{x:0,y:0,width:W,height:H,fill:'transparent'});
  hit.addEventListener('mousemove',function(e){var r=svg.getBoundingClientRect();var px=(e.clientX-r.left)*W/r.width;
    var i=SL<=1?0:Math.round((px-L)/((W-L-R)/(SL-1)));i=Math.max(0,Math.min(N-1,i));
    cross.setAttribute('x1',X(i));cross.setAttribute('x2',X(i));cross.setAttribute('visibility','visible');
    dot.setAttribute('cx',X(i));dot.setAttribute('cy',Y(pts[i]));dot.setAttribute('visibility','visible');
    var val=m==='duree'?dur(pts[i]):n(pts[i]);
    showTip([{b:hourly?labels[i]+' – '+(i+1)+' h':DFL.format(new Date(labels[i]+'T12:00:00Z'))+(labels[i]===todayParis(d.genere)?' (en cours)':'')},{b:val,t:({visiteurs:'visiteurs',sessions:hourly?'visiteurs':'visites',vues:'pages vues',duree:'par visite'})[m]}].concat(prev?[{t:'Précédente ('+day(prev[i].j)+') : '+(m==='duree'?dur(prev[i].v):n(prev[i].v)),c:'var(--muted)'}]:[]),X(i)*r.width/W,Y(pts[i])*r.height/H,box);});
  hit.addEventListener('mouseleave',function(){cross.setAttribute('visibility','hidden');dot.setAttribute('visibility','hidden');hideTip();});
  box.appendChild(svg);
  document.querySelector('.legend').style.display=prev?'':'none';
}
function todayParis(ms){try{var o={};new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)).forEach(function(x){o[x.type]=x.value;});return o.year+'-'+o.month+'-'+o.day;}catch(e){return '';}}
function niceMax(v,m){if(m==='duree'){var s=[30e3,60e3,120e3,300e3,600e3,900e3,1800e3,3600e3];for(var i=0;i<s.length;i++)if(v<=s[i])return s[i];return Math.ceil(v/3600e3)*3600e3;}
  if(v<=4)return 4;var p=Math.pow(10,Math.floor(Math.log10(v))),f=v/p;var k=f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10;var r=k*p;return r%4===0?r:Math.ceil(r/4)*4;}
function compact(v){return v>=1e4?Math.round(v/1e3)+' k':v>=1e3?(v/1e3).toFixed(1).replace('.',',')+' k':String(Math.round(v));}
function shortDur(ms){var s=Math.round(ms/1000);return s<60?s+' s':Math.round(s/60)+' min';}
var rt=0;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(function(){if(state.data)chart(state.data);},150);});
setInterval(function(){if(document.visibilityState==='visible'&&!$('app').hidden)load();},120000);
mark();load();
})();
</script></body></html>`;
