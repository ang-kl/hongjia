
(function(){
'use strict';
/* Travel coffee-table page script. Everything shown is built with createElement and textContent:
   values from the trip data or from the weather answer are never parsed as HTML. */
var D;
try{ D=JSON.parse(document.getElementById('trip-data').textContent); }catch(e){ D={}; }
D.days=D.days||[]; D.safety=D.safety||[];
var UI=D.ui||{};
function t(k,fb){ var v=UI[k]; return typeof v==='string'?v:fb; }
function fill(s,o){ return String(s).replace(/\{(\w+)\}/g,function(m,k){ return Object.prototype.hasOwnProperty.call(o,k)?String(o[k]):m; }); }
var root=document.documentElement;
var reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
var GOLD='#0f6b5c';
function $(s,c){return (c||document).querySelector(s);}
function $$(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s));}
function el(tag,cls,text){ var e=document.createElement(tag); if(cls){e.className=cls;} if(text!==undefined&&text!==null){e.textContent=String(text);} return e; }
function clear(n){ while(n&&n.firstChild){n.removeChild(n.firstChild);} }
function link(href,text){ var a=el('a',null,text); a.href=href; a.target='_blank'; a.rel='noopener'; return a; }
function hostOf(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return ''; } }
var inFrame=false; try{ inFrame=window.parent!==window; }catch(e){ inFrame=true; }
/* ---- motion: the Web Animations API, and none at all when the reader asks for reduced motion.
   No animation keeps filling after it ends: each ends where the element's own style already is,
   or its end state is written to the element first (MDN: fill modes keep consuming resources). ---- */
function motion(e,frames,opts){ if(reduce||!e||typeof e.animate!=='function'){ return null; } try{ return e.animate(frames,opts); }catch(x){ return null; } }
var store={ get:function(k){ try{ return window.localStorage.getItem(k); }catch(e){ return null; } }, set:function(k,v){ try{ window.localStorage.setItem(k,v); }catch(e){} } };
var SKEY='tct:'+String(D.id||'trip').slice(0,40)+':';

/* ---- mode toggle (both modes keep the white page) ---- */
var printDetails=[];
function setMode(m){
  root.setAttribute('data-mode',m);
  $$('[data-set-mode]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-set-mode')===m));});
  if(m==='print'){ printDetails=$$('details:not([open])').filter(function(d){return !d.hasAttribute('data-pin');}); printDetails.forEach(function(d){d.open=true;}); }
  else { printDetails.forEach(function(d){d.open=false;}); printDetails=[]; }
  if(map){ setTimeout(function(){map.invalidateSize();},60); }
}
$$('[data-set-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.getAttribute('data-set-mode'));});});
var pb=$('#print-btn'); if(pb){pb.addEventListener('click',function(){try{window.print();}catch(e){}});}

/* ---- Google embeds ---- */
function pinURL(q){return 'https://maps.google.com/maps?q='+encodeURIComponent(q)+'&z=15&output=embed';}
function dirURL(a,b){return 'https://maps.google.com/maps?saddr='+encodeURIComponent(a)+'&daddr='+encodeURIComponent(b)+'&output=embed';}
function frame(box,src,title){
  if(!box){return;}
  var f=box.querySelector('iframe');
  if(f&&f.getAttribute('src')===src){return;}
  if(!f){f=document.createElement('iframe');f.setAttribute('loading','lazy');f.setAttribute('referrerpolicy','no-referrer-when-downgrade');f.setAttribute('allowfullscreen','');box.appendChild(f);}
  f.setAttribute('title',title); f.setAttribute('src',src);
}
$$('details[data-pin]').forEach(function(d){
  d.addEventListener('toggle',function(){ if(d.open){ frame(d.querySelector('.drawer-map'),pinURL(d.getAttribute('data-pin')),'Google Map: '+d.getAttribute('data-name')); } });
});

/* concierge drawers: filled from one template per area */
$$('details[data-cc]').forEach(function(d){
  d.addEventListener('toggle',function(){ var slot=d.querySelector('.cc-slot'); if(d.open&&slot&&!slot.firstChild){ var tp=document.getElementById('cc-'+d.getAttribute('data-cc')); if(tp&&tp.content){ slot.appendChild(tp.content.cloneNode(true)); } } });
});

/* ---- map command centre ---- */
var map=null, routeLayer=null, safetyLayer=null, nearbyLayer=null, markers=[], trail=null, dayIdx=0, flying=false, flyTimer=null, flight=0;
var CATS=D.cats||{}, activeCat='';
function hasCat(list,c){ return !!c&&Array.isArray(list)&&list.indexOf(c)>=0; }
var daySel=$('#mc-day'), stopSel=$('#mc-stop'), legSel=$('#mc-leg'), stopList=$('#mc-stops'), flyBtn=$('#fly');
D.days.forEach(function(d,i){var o=document.createElement('option');o.value=i;o.textContent=d.label+': '+d.title;daySel.appendChild(o);});

function fillSelectors(){
  var d=D.days[dayIdx]; if(!d){return;}
  clear(stopSel); clear(legSel); clear(stopList);
  d.stops.forEach(function(s,i){
    var o=document.createElement('option');o.value=i;o.textContent=s.letter+' · '+s.name;stopSel.appendChild(o);
    var li=document.createElement('li'),b=document.createElement('button');b.type='button';
    b.appendChild(el('b',null,s.letter)); b.appendChild(document.createTextNode(s.name));
    b.addEventListener('click',function(){focusStop(i);});li.appendChild(b);stopList.appendChild(li);
  });
  d.legs.forEach(function(l,i){
    var a=d.stops[i],b=d.stops[i+1],o=document.createElement('option');o.value=i;
    o.textContent=a.letter+' → '+b.letter+' · '+a.name+' '+t('to','to')+' '+b.name+(l.walk?' ('+t('short_walk','short walk')+')':(l.km!=null?' · '+l.km+' km':''));legSel.appendChild(o);
  });
}
function letterIcon(l,on,cats){return L.divIcon({className:'mk'+(on?' on':'')+(hasCat(cats,activeCat)?' lit':''),html:el('span',null,l),iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-14]});}
function popupNode(title,note){ var d=el('div'); d.appendChild(el('b',null,title)); if(note){ d.appendChild(el('br')); d.appendChild(el('span','pop-note',note)); } return d; }
function drawDay(){
  if(!map){return;}
  routeLayer.clearLayers(); markers=[]; if(trail){routeLayer.removeLayer(trail);trail=null;}
  D.days.forEach(function(d,i){ if(i===dayIdx){return;} d.legs.forEach(function(l){ L.polyline(l.path,{color:'#cfc5b3',weight:2,opacity:.8,interactive:false}).addTo(routeLayer); }); });
  var d=D.days[dayIdx], bounds=[]; if(!d){return;}
  d.legs.forEach(function(l){ L.polyline(l.path,{color:GOLD,weight:4,opacity:.95,dashArray:l.walk?'4 7':null}).addTo(routeLayer); l.path.forEach(function(p){bounds.push(p);}); });
  d.stops.forEach(function(s,i){
    var m=L.marker([s.lat,s.lng],{icon:letterIcon(s.letter,i===0,s.cats),title:s.letter+' '+s.name,keyboard:true}).addTo(routeLayer);
    m.bindPopup(popupNode(s.letter+' · '+s.name,s.note));
    markers.push(m); bounds.push([s.lat,s.lng]);
  });
  map.stop();
  if(bounds.length){ map.fitBounds(bounds,{padding:[30,30],maxZoom:14,animate:false}); }
}
function fit(){ var d=D.days[dayIdx],b=[]; d.legs.forEach(function(l){l.path.forEach(function(p){b.push(p);});}); d.stops.forEach(function(s){b.push([s.lat,s.lng]);}); if(b.length){map.fitBounds(b,{padding:[30,30],maxZoom:14,animate:!reduce});} }
function focusStop(i){
  var s=D.days[dayIdx]&&D.days[dayIdx].stops[i]; if(!s){return;}
  stopSel.value=i; if(currentTab==='pin'){ showTab('pin'); }
  if(!map){return;}
  if(reduce){map.setView([s.lat,s.lng],15,{animate:false});}else{map.flyTo([s.lat,s.lng],15,{duration:1.0});}
  if(markers[i]){markers[i].openPopup();}
}
function selectDay(i){
  // A route flight belongs to one day: changing the day ends it first.
  if(flying){ stopFly(); }
  dayIdx=Math.max(0,Math.min(D.days.length-1,i|0)); daySel.value=dayIdx; fillSelectors(); drawDay();
  if(currentTab!=='route'){ showTab(currentTab); }
}
daySel.addEventListener('change',function(){selectDay(+daySel.value);});
stopSel.addEventListener('change',function(){showTab('pin');});
legSel.addEventListener('change',function(){showTab('dir');});

function animatePath(path,ms,done){
  if(!trail){done();return;}
  if(ms<=0||path.length<2){ path.forEach(function(p){trail.addLatLng(p);}); done(); return; }
  var n=path.length, start=null, added=0, mine=flight;
  function step(ts){ if(!flying||mine!==flight){return;} if(start===null){start=ts;} var k=Math.min(1,(ts-start)/ms), want=Math.max(1,Math.round(k*n));
    while(added<want){trail.addLatLng(path[added]);added++;}
    if(k<1){requestAnimationFrame(step);}else{done();} }
  requestAnimationFrame(step);
}
function stopFly(){ flying=false; flight++; clearTimeout(flyTimer); if(map&&map.stop){map.stop();} if(flyBtn){flyBtn.disabled=false;flyBtn.textContent=t('fly','Fly route');} }
function flyRoute(){
  if(!map){return;}
  if(flying){ stopFly(); fit(); return; }
  showTab('route'); flying=true; flyBtn.textContent=t('fly_stop','Stop');
  // Each flight has its own number; callbacks left over from an earlier flight do nothing.
  var d=D.days[dayIdx], i=0, mine=++flight;
  var live=function(){ return flying&&mine===flight; };
  if(trail){routeLayer.removeLayer(trail);}
  trail=L.polyline([],{color:'#7a5c28',weight:6,opacity:.9}).addTo(routeLayer);
  function next(){
    if(!live()){return;}
    if(i>=d.stops.length){ stopFly(); fit(); return; }
    var s=d.stops[i], done=false;
    function arrived(){ if(done||!live()){return;} done=true; clearTimeout(flyTimer);
      markers.forEach(function(m,j){ if(d.stops[j]){ m.setIcon(letterIcon(d.stops[j].letter,j===i,d.stops[j].cats)); } });
      if(markers[i]){markers[i].openPopup();}
      var l=d.legs[i]; i++;
      if(l){ animatePath(l.path,reduce?0:1100,function(){ flyTimer=setTimeout(next,reduce?60:350); }); } else { flyTimer=setTimeout(next,reduce?60:700); }
    }
    if(reduce){ map.setView([s.lat,s.lng],13,{animate:false}); arrived(); }
    else { map.once('moveend',arrived); map.flyTo([s.lat,s.lng],i===0?11:13,{duration:1.5}); flyTimer=setTimeout(arrived,2600); }
  }
  next();
}
if(flyBtn){flyBtn.addEventListener('click',flyRoute);}

var safetyBox=$('#mc-safety');
function toggleSafety(){
  if(!map){return;}
  if(safetyBox.checked){
    D.safety.forEach(function(s){
      var ic=L.divIcon({className:'sk'+(s.kind==='pol'?' pol':''),html:el('span',null,s.kind==='pol'?'P':'H'),iconSize:[22,22],iconAnchor:[11,11]});
      L.marker([s.lat,s.lng],{icon:ic,title:s.name}).bindPopup(el('span',null,s.name)).addTo(safetyLayer);
    });
  } else { safetyLayer.clearLayers(); }
}
if(safetyBox){safetyBox.addEventListener('change',toggleSafety);}

/* nearby options and places of worship: their own pin layer, toggled like the safety layer and lit by the legend */
var nearbyBox=$('#mc-nearby');
function drawNearby(){
  if(!map||!nearbyLayer){return;}
  nearbyLayer.clearLayers();
  var all=!!(nearbyBox&&nearbyBox.checked);
  (D.nearby||[]).forEach(function(p){
    var lit=hasCat(p.cats,activeCat); if(!all&&!lit){return;}
    var c=(p.cats&&p.cats[0])||'sights', ic=CATS[c]?CATS[c][0]:'•';
    var m=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'nk'+(lit?' lit':''),html:el('span',null,ic),iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-14]}),title:p.name,keyboard:true});
    m.bindPopup(popupNode(p.name,(p.cats||[]).map(function(k){ return CATS[k]?CATS[k][1]:k; }).join(' · ')+(p.near?' · '+p.near:''))); m.addTo(nearbyLayer);
  });
}
if(nearbyBox){nearbyBox.addEventListener('change',drawNearby);}
function paintPins(){ var d=D.days[dayIdx]; markers.forEach(function(m,j){ var s=d&&d.stops[j], e=m.getElement&&m.getElement(); if(e&&s){ e.classList.toggle('lit',hasCat(s.cats,activeCat)); } }); }

/* tabs */
var currentTab='route';
var tabs={route:$('#tab-route'),pin:$('#tab-pin'),dir:$('#tab-dir')};
function showTab(k0){
  currentTab=k0;
  Object.keys(tabs).forEach(function(k){ var on=k===k0; tabs[k].setAttribute('aria-selected',String(on)); tabs[k].tabIndex=on?0:-1; $('#panel-'+k).hidden=!on; });
  var d=D.days[dayIdx]; if(!d){return;}
  if(k0==='pin'){ var s=d.stops[+stopSel.value||0]; if(s){ frame($('#pin-box'),pinURL(s.q),'Google Map pin: '+s.name); } }
  if(k0==='dir'){ var li=+legSel.value||0, a=d.stops[li], b=d.stops[li+1]; if(a&&b){ frame($('#dir-box'),dirURL(a.q,b.q),'Google directions: '+a.name+' to '+b.name); } }
  if(k0==='route'&&map){ setTimeout(function(){map.invalidateSize();},30); }
}
Object.keys(tabs).forEach(function(k){
  tabs[k].addEventListener('click',function(){showTab(k);});
  tabs[k].addEventListener('keydown',function(e){ var keys=['route','pin','dir'],i=keys.indexOf(k);
    if(e.key==='ArrowRight'||e.key==='ArrowLeft'){ e.preventDefault(); var n=keys[(i+(e.key==='ArrowRight'?1:2))%3]; showTab(n); tabs[n].focus(); } });
});

/* show-on-map buttons */
var mapc=$('#map-centre');
function showOnMap(di,idx,lat,lng,name,note){
  if(di<0){ di=dayIdx; idx=-1; }
  if(di!==dayIdx){selectDay(di);}
  if(currentTab!=='route'){showTab('route');}
  if(window.innerWidth<1100&&mapc){ mapc.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'}); }
  if(idx>=0){ focusStop(idx); }
  else if(map&&isFinite(lat)&&isFinite(lng)){ var ll=[lat,lng]; map.flyTo(ll,13,{animate:!reduce});
    L.popup().setLatLng(ll).setContent(el('span',null,(name||'')+' ('+(note||t('optional','optional'))+')')).openOn(map); }
}
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('.show-map'); if(!b){return;}
  showOnMap(+b.getAttribute('data-day'),+b.getAttribute('data-idx'),+b.getAttribute('data-lat'),+b.getAttribute('data-lng'),b.getAttribute('data-name')||'',b.getAttribute('data-note')||'');
});

function initMap(){
  var box=$('#leaflet');
  if(!window.L){ clear(box); box.appendChild(el('p','map-fallback',t('map_fallback','The route map could not load here.'))); if(flyBtn){flyBtn.disabled=true;} return; }
  map=L.map(box,{scrollWheelZoom:false,zoomControl:true,attributionControl:true});
  // Tiles. "site" (the default): OpenStreetMap through the family site's relay, with a ticket the
  // site gives this page when asked; anywhere else, no tile server is contacted. "carto": CARTO with
  // the trip's key. "osm": OpenStreetMap directly (refused inside the site's locked frame).
  // The credits are fixed here, never taken from the data, and always shown on the map.
  var T=D.tiles||{}, osmCredit='<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';
  if(T.provider==='site'){ siteTiles(box,osmCredit); }
  else {
    var carto=T.provider==='carto'&&/^https:\/\/basemaps\.cartocdn\.com\/rastertiles\/[a-z_]+\/\{z\}\/\{x\}\/\{y\}\{r\}\.png\?key=[A-Za-z0-9._-]+$/.test(T.url||'');
    L.tileLayer(carto?T.url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:carto?20:19,referrerPolicy:'strict-origin-when-cross-origin',
      attribution:carto?osmCredit+' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>':osmCredit}).addTo(map);
  }
  routeLayer=L.layerGroup().addTo(map); safetyLayer=L.layerGroup().addTo(map); nearbyLayer=L.layerGroup().addTo(map);
  map.on('focus',function(){map.scrollWheelZoom.enable();}); map.on('blur',function(){map.scrollWheelZoom.disable();});
  selectDay(0);
  window.addEventListener('resize',function(){ map.invalidateSize(); });
}
/* Tile relay protocol. Only inside a frame, once: parent.postMessage({type:'hj:tiles-want'},'*').
   Accepted only from window.parent: {type:'hj:tiles', ok:true, base, ticket, expires} or
   {type:'hj:tiles', ok:false}. base is the site's origin plus /tiles (https, or http on
   127.0.0.1/localhost for local tests); ticket is digits, a dot and 32 hex digits. Until a good
   answer, after ok:false, after 8 seconds without one, or outside a frame, the map keeps its
   routes and pins on a plain background with a notice, and no tile server is contacted. */
var TILES_BASE=/^(https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?|http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5})\/tiles$/;
var TILES_TICKET=/^[0-9]{1,12}\.[0-9a-f]{32}$/;
function siteTiles(box,credit){
  var layer=null, closed=false, timer=0, notice=null;
  box.classList.add('no-tiles');
  var Notice=L.Control.extend({options:{position:'topright'},onAdd:function(){ var n=el('p','tiles-notice',t('tiles_notice','Map pictures load inside the family site.')); n.setAttribute('role','status'); return n; }});
  notice=new Notice(); notice.addTo(map);
  var framed=false; try{ framed=window.parent!==window; }catch(e){ framed=true; }
  if(!framed){ return; }
  window.addEventListener('message',function(event){
    if(event.source!==window.parent){return;}
    var a=event.data; if(!a||typeof a!=='object'||a.type!=='hj:tiles'){return;}
    if(closed&&!layer){return;}
    var good=a.ok===true&&typeof a.base==='string'&&typeof a.ticket==='string'&&TILES_BASE.test(a.base)&&TILES_TICKET.test(a.ticket);
    if(!good){ if(!layer){ closed=true; clearTimeout(timer); } return; }
    var url=a.base+'/{z}/{x}/{y}.png?t='+a.ticket;
    if(layer){ layer.setUrl(url); return; }
    closed=true; clearTimeout(timer);
    layer=L.tileLayer(url,{maxZoom:19,attribution:credit}).addTo(map);
    box.classList.remove('no-tiles');
    if(notice){ map.removeControl(notice); notice=null; }
  });
  var asked=false;
  var ask=function(){ if(asked){return;} asked=true; timer=setTimeout(function(){ closed=true; },8000);
    try{ window.parent.postMessage({type:'hj:tiles-want'},'*'); }catch(e){} };
  if(document.readyState==='complete'){ ask(); } else { window.addEventListener('load',ask); }
}
fillSelectors();
initMap();

/* ---- photos: errors and the lightbox ---- */
function dropPhoto(img){
  var tl=img.closest('.tile, .near-photo, .clip'); if(!tl||!tl.parentNode){return;}
  var box=tl.parentNode; box.removeChild(tl);
  if(box.classList.contains('bento')){ var left=box.querySelectorAll('.tile').length; box.setAttribute('data-count',String(left)); if(!left&&box.parentNode){ box.parentNode.removeChild(box); } }
  if(box.classList.contains('clips')&&!box.querySelector('.clip')&&box.parentNode){ box.parentNode.removeChild(box); }
  if(window.railLayout){ setTimeout(window.railLayout,50); }
}
$$('.zoom img').forEach(function(img){ var done=function(){ var z=img.closest('.zoom'); if(z){z.classList.add('in');} }; if(img.complete&&img.naturalWidth>0){done();} else {img.addEventListener('load',done);} });
$$('.tile img, .near-photo img').forEach(function(img){ img.addEventListener('error',function(){dropPhoto(img);}); if(img.complete&&img.naturalWidth===0&&img.getAttribute('src')){ dropPhoto(img); } });
$$('.clip video').forEach(function(v){ var s=v.querySelectorAll('source'), last=s[s.length-1]; if(last){ last.addEventListener('error',function(){dropPhoto(v);}); } });

var lb=$('#lightbox'), lbImg=lb.querySelector('img'), lbCap=lb.querySelector('.lb-cap'), lbCredit=lb.querySelector('.lb-credit'), lbList=[], lbI=0, lbReturn=null;
function lbShow(){ var z=lbList[lbI], img=z.querySelector('img'); lbImg.src=img.currentSrc||img.src; lbImg.alt=img.alt; lbCap.textContent=z.getAttribute('data-cap')||'';
  clear(lbCredit); var fig=z.closest('figure'), c=fig&&fig.querySelector('.credit'); if(c){ Array.prototype.forEach.call(c.childNodes,function(n){ lbCredit.appendChild(n.cloneNode(true)); }); }
  var many=lbList.length>1; lb.querySelector('.lb-prev').hidden=!many; lb.querySelector('.lb-next').hidden=!many; }
function lbOpen(z){ var b=z.closest('.bento, .strip'); lbList=b?$$('[data-zoom]',b):[z]; lbI=Math.max(0,lbList.indexOf(z)); lbReturn=z; lbShow(); lb.hidden=false; document.body.style.overflow='hidden'; lb.querySelector('.lb-close').focus(); }
function lbClose(){ lb.hidden=true; document.body.style.overflow=''; lbImg.removeAttribute('src'); if(lbReturn){lbReturn.focus();} }
document.addEventListener('click',function(e){ var z=e.target.closest&&e.target.closest('[data-zoom]'); if(z){ lbOpen(z); } });
lb.querySelector('.lb-close').addEventListener('click',lbClose);
lb.querySelector('.lb-prev').addEventListener('click',function(){lbI=(lbI+lbList.length-1)%lbList.length;lbShow();});
lb.querySelector('.lb-next').addEventListener('click',function(){lbI=(lbI+1)%lbList.length;lbShow();});
lb.addEventListener('click',function(e){ if(e.target===lb){lbClose();} });
document.addEventListener('keydown',function(e){ if(lb.hidden){return;}
  if(e.key==='Escape'){lbClose();} else if(e.key==='ArrowRight'&&lbList.length>1){lbI=(lbI+1)%lbList.length;lbShow();} else if(e.key==='ArrowLeft'&&lbList.length>1){lbI=(lbI+lbList.length-1)%lbList.length;lbShow();}
  else if(e.key==='Tab'){ var f=$$('button:not([hidden])',lb); var i=f.indexOf(document.activeElement); if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus();} else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();} } });

/* ---- latest posts: frames load when their panel opens; on wide screens panels open as they come near ---- */
function fillSocial(d){ $$('iframe[data-src]',d).forEach(function(f){ if(!f.getAttribute('src')){ f.setAttribute('src',f.getAttribute('data-src')); } }); }
$$('details.social, details.ig-drawer').forEach(function(d){ d.addEventListener('toggle',function(){ if(d.open){ fillSocial(d); if(window.railLayout){ setTimeout(window.railLayout,400); } } }); });
if('IntersectionObserver' in window){
  var sio=new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting&&window.innerWidth>=700&&root.getAttribute('data-mode')!=='print'){ en.target.open=true; sio.unobserve(en.target); } }); },{rootMargin:'600px 0px'});
  $$('details.social[data-auto-open]').forEach(function(d){ sio.observe(d); });
}
/* ---- nav state: worked out from the scroll position, because observer margins are ignored inside the site's frame ---- */
var navLinks=$$('.topnav a:not(.tn-day)'), navSecs=$$('.layout > [id]'), navCur=null;
// a hidden section (the Gallery while reading, the reading view's sections in the Gallery) has no place on the page
function markNav(line){ var cur=''; navSecs.forEach(function(s){ if(s.getClientRects().length&&s.getBoundingClientRect().top+window.scrollY<=line){ cur=s.id; } });
  if(cur===navCur){return;} navCur=cur; navLinks.forEach(function(a){ a.classList.toggle('on',!!cur&&a.getAttribute('href')==='#'+cur); }); }
var dayLinks=$$('.topnav a.tn-day');
function markDay(i){ dayLinks.forEach(function(a,j){ var on=j===i; if(a.classList.contains('on')===on){return;} a.classList.toggle('on',on);
  if(on){ var bar=a.closest('.topnav'); if(bar){ var r=a.getBoundingClientRect(), br=bar.getBoundingClientRect(); if(r.left<br.left||r.right>br.right){ bar.scrollLeft+=r.left-br.left-br.width/2+r.width/2; } } } }); }
/* ---- timeline bar: fills as you read; tap or drag it to jump ---- */
var rail=$('.rail');
if(rail){
  var rfill=rail.querySelector('.rail-fill'), thumb=rail.querySelector('.rail-thumb'), tip=rail.querySelector('.rail-tip');
  var marks=$$('.rail-mark',rail), targets=marks.map(function(m){return document.getElementById(m.getAttribute('href').slice(1));});
  var span=function(){ return Math.max(1,document.documentElement.scrollHeight-window.innerHeight); };
  var docY=function(n){ return n.getBoundingClientRect().top+window.scrollY; };
  var railPaint=function(){
    var line=window.scrollY+window.innerHeight*0.35, cur=null, day=-1;
    if(root.getAttribute('data-view')==='gallery'){
      /* the Gallery (the owner, 7 November 2026: "fix the gallery date bar highlight"): the reading view is
         hidden, so the date bar follows the Gallery day being looked at, and no section is marked */
      $$('#gallery .g-day').forEach(function(g){ var n=+String(g.id).replace('g-day-',''); if(n>0&&docY(g)<=line){ day=n-1; } });
      markDay(day); markNav(-1);
      return;
    }
    var k=Math.min(1,Math.max(0,window.scrollY/span())); rfill.style.height=(k*100)+'%'; thumb.style.top=(k*100)+'%';
    marks.forEach(function(m,j){ var tg=targets[j]; if(tg&&docY(tg)<=line){ cur=m; if(m.classList.contains('day')){ day=+m.getAttribute('data-day'); } } });
    marks.forEach(function(m){ m.classList.toggle('on',m===cur); });
    tip.textContent=cur?cur.getAttribute('data-tip'):t('rail_start','Start of the guide');
    markDay(day); markNav(window.scrollY+window.innerHeight*0.45);
    var op=document.getElementById('opener'); root.classList.toggle('past-opener',!op||window.scrollY>op.offsetHeight-80);
    /* on wide screens the sticky map follows the day you are reading */
    if(day>=0&&day!==dayIdx&&window.innerWidth>=1100&&!flying&&root.getAttribute('data-mode')!=='print'){ selectDay(day); }
  };
  window.railLayout=function(){
    if(root.getAttribute('data-view')!=='gallery'){  // the timeline bar is hidden in the Gallery, and its places are the reading view's
      var h=span(); marks.forEach(function(m,j){ var tg=targets[j]; if(!tg){m.hidden=true;return;} m.style.top=(Math.min(1,Math.max(0,docY(tg)/h))*100)+'%'; });
    }
    railPaint();
  };
  var dragging=false;
  var toY=function(e){ var r=rail.getBoundingClientRect(); var k=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height)); window.scrollTo(0,k*span()); };
  rail.addEventListener('pointerdown',function(e){ dragging=true; rail.classList.add('drag'); try{rail.setPointerCapture(e.pointerId);}catch(x){} toY(e); e.preventDefault(); });
  rail.addEventListener('pointermove',function(e){ if(dragging){toY(e);} });
  var stopDrag=function(){ dragging=false; rail.classList.remove('drag'); };
  rail.addEventListener('pointerup',stopDrag); rail.addEventListener('pointercancel',stopDrag);
  rail.addEventListener('click',function(e){ e.preventDefault(); });
  window.addEventListener('scroll',function(){ window.requestAnimationFrame(railPaint); },{passive:true});
  window.addEventListener('resize',window.railLayout);
  window.addEventListener('load',window.railLayout);
  $$('img').forEach(function(i){ i.addEventListener('load',function(){ clearTimeout(rail._t); rail._t=setTimeout(window.railLayout,200); }); });
  window.railLayout();
}

/* ---- Plans A, B and C: the reader chooses by hand; the forecast only highlights ---- */
var PL=D.plans||null;
function choosePlan(day,p,save){
  if(!/^[abc]$/.test(p)||!day.querySelector('.plan[data-plan="'+p+'"]')){ return; }
  day.setAttribute('data-chosen',p);
  $$('.plan-btn',day).forEach(function(b){ b.setAttribute('aria-pressed',String(b.getAttribute('data-plan')===p)); });
  $$('.plan',day).forEach(function(x){ x.classList.toggle('on',x.getAttribute('data-plan')===p); });
  if(save){ store.set(SKEY+'plan:'+day.id,p); }
  if(window.railLayout){ setTimeout(window.railLayout,60); }
}
$$('.day[data-chosen]').forEach(function(day){ var saved=store.get(SKEY+'plan:'+day.id); if(saved){ choosePlan(day,String(saved),false); } });
document.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('.plan-btn'); if(!b){return;} var day=b.closest('.day'); if(day){ choosePlan(day,b.getAttribute('data-plan'),true); } });

/* ---- live weather: asked of the family site once on load, only inside its frame ---- */
var WX=D.weather||null, MONTH=Array.isArray(UI.months)?UI.months:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var ISO=/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
var RANGE={code:[0,99],tmax:[-90,60],tmin:[-90,60],rain_pct:[0,100],rain_mm:[0,2000],wind_kmh:[0,500],gust_kmh:[0,500],uv:[0,30]};
function num(v,k){ if(typeof v!=='number'||!isFinite(v)){return null;} var r=RANGE[k]; if(v<r[0]||v>r[1]){return null;} return k==='code'?Math.round(v):v; }
function fmtDate(iso){ var p=iso.split('-'); return (+p[2])+' '+(MONTH[(+p[1])-1]||p[1])+' '+p[0]; }
function addDays(iso,n){ var p=iso.split('-'), d=new Date(Date.UTC(+p[0],(+p[1])-1,+p[2])); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function wmo(code){ var w=UI.wmo&&code!==null?UI.wmo[String(code)]:null; return w&&w.length===2?{icon:String(w[0]),label:String(w[1])}:{icon:'🌡️',label:''}; }
function round(v){ return v===null?'–':String(Math.round(v)); }
function suggest(f){
  var rules=(PL&&PL.rules)||[];
  for(var i=0;i<rules.length;i++){ var r=rules[i], v=f[r.metric]; if(v===null||v===undefined){continue;}
    var hit=r.op==='in'?(Array.isArray(r.value)&&r.value.indexOf(v)>=0):r.op==='>='?v>=r.value:r.op==='>'?v>r.value:r.op==='<='?v<=r.value:r.op==='<'?v<r.value:false;
    if(hit){ return {plan:r.plan,why:String(r.text||'')}; } }
  return {plan:'a',why:''};
}
function boxesFor(key){ return $$('.wx[data-wx-place]').filter(function(b){ return b.getAttribute('data-wx-place')===key; }); }
function setMsg(box,icon,text){ clear(box); var p=el('p','wx-line'); var i=el('span','wx-ico',icon); i.setAttribute('aria-hidden','true'); p.appendChild(i); p.appendChild(el('span','wx-msg',text)); box.appendChild(p); return p; }
function rulesLine(box){ if(!PL||!PL.rules||!PL.rules.length){return;} var p=el('p','wx-rules'); p.appendChild(el('b',null,t('plans_rules','Rules')+': ')); p.appendChild(document.createTextNode(PL.rules.map(function(r){return String(r.text);}).join(' · '))); box.appendChild(p); }
function creditLine(box,ans){
  var src=typeof ans.source==='string'&&/^[A-Za-z0-9 .-]{1,40}$/.test(ans.source)?ans.source:'Open-Meteo.com';
  var href=typeof ans.link==='string'&&/^https:\/\/[A-Za-z0-9.-]+(\/[^\s"'<>]*)?$/.test(ans.link)&&ans.link.length<200?ans.link:'https://open-meteo.com/';
  var p=el('p','wx-credit',t('wx_credit','Weather data by')+' '); p.appendChild(link(href,src)); p.appendChild(document.createTextNode(' · ')); p.appendChild(link('https://creativecommons.org/licenses/by/4.0/',t('wx_licence','CC BY 4.0'))); box.appendChild(p);
}
function markSuggested(day,p){
  if(!day){return;}
  $$('.sugg-tag',day).forEach(function(s){ s.hidden=true; }); $$('[data-suggested]',day).forEach(function(x){ x.removeAttribute('data-suggested'); });
  var btn=day.querySelector('.plan-btn[data-plan="'+p+'"]'), blk=day.querySelector('.plan[data-plan="'+p+'"]');
  [btn,blk].forEach(function(x){ if(x){ x.setAttribute('data-suggested',''); var s=x.querySelector('.sugg-tag'); if(s){ s.hidden=false; } } });
}
function showDay(box,f,ans){
  var w=wmo(f.code); clear(box);
  var p=el('p','wx-line'), ic=el('span','wx-ico',w.icon); ic.setAttribute('aria-hidden','true'); p.appendChild(ic);
  if(w.label){ p.appendChild(el('span','wx-v',w.label)); }
  p.appendChild(el('span','wx-t',fill(t('wx_max_min','max {max}° / min {min}°'),{max:round(f.tmax),min:round(f.tmin)})));
  var bits=[];
  if(f.rain_pct!==null){ bits.push('💧 '+t('wx_rain','rain')+' '+Math.round(f.rain_pct)+'%'+(f.rain_mm!==null?' · '+(Math.round(f.rain_mm*10)/10)+' mm':'')); }
  if(f.gust_kmh!==null||f.wind_kmh!==null){ bits.push('💨 '+(f.wind_kmh!==null?t('wx_wind','wind')+' '+Math.round(f.wind_kmh)+' km/h':'')+(f.gust_kmh!==null?' '+t('wx_gust','gusts')+' '+Math.round(f.gust_kmh):'')); }
  if(f.uv!==null){ bits.push(t('wx_uv','UV')+' '+Math.round(f.uv)); }
  bits.forEach(function(b){ p.appendChild(el('span','wx-v',b)); });
  box.appendChild(p);
  var s=suggest(f), day=box.closest('.day'), has=day&&day.querySelector('.plan[data-plan="'+s.plan+'"]');
  var msg=s.plan==='a'?t('wx_fits','Fits Plan A'):has?fill(t('wx_suggests','Suggests Plan {p}: {why}'),{p:s.plan.toUpperCase(),why:s.why}):fill(t('wx_no_plan','Suggests Plan {p} ({why}); none is listed for this day yet.'),{p:s.plan.toUpperCase(),why:s.why});
  box.appendChild(el('p','wx-sugg',msg));
  markSuggested(day,has?s.plan:'');
  creditLine(box,ans); rulesLine(box);
}
function onAnswer(ans){
  if(!ans||typeof ans!=='object'||typeof ans.key!=='string'){return;}
  var boxes=boxesFor(ans.key); if(!boxes.length){return;}
  boxes.forEach(function(box){
    var iso=box.getAttribute('data-wx-date'); if(!ISO.test(iso||'')){return;}
    if(ans.ok!==true){ setMsg(box,'⚠️',fill(t('wx_error','No forecast just now: {error}'),{error:String(typeof ans.error==='string'?ans.error:'').slice(0,160)})); rulesLine(box); return; }
    if(ans.past===true){ setMsg(box,'🗓️',t('wx_past','This day is over; no forecast.')); return; }
    var from=addDays(iso,-15); if(typeof ans.from==='string'&&ISO.test(ans.from)&&ans.from>from){ from=ans.from; }
    if(ans.available!==true){ setMsg(box,'🗓️',fill(t('wx_from','Forecast from {date}'),{date:fmtDate(from)})); rulesLine(box); return; }
    var list=Array.isArray(ans.days)?ans.days.slice(0,64):[], f=null;
    list.forEach(function(x){ if(x&&typeof x==='object'&&x.date===iso){ f={}; ['code','tmax','tmin','rain_pct','rain_mm','wind_kmh','gust_kmh','uv'].forEach(function(k){ f[k]=num(x[k],k); }); } });
    if(f){ showDay(box,f,ans); }
    else { var last=list.length&&list[list.length-1]&&typeof list[list.length-1].date==='string'?list[list.length-1].date:''; setMsg(box,'🗓️',ISO.test(last)&&iso>last?fill(t('wx_from','Forecast from {date}'),{date:fmtDate(from)}):t('wx_none','No forecast for this day.')); rulesLine(box); }
  });
}
var inFrame=false; try{ inFrame=window.parent!==window; }catch(e){ inFrame=true; }
if(WX&&Array.isArray(WX.places)&&WX.places.length){
  if(inFrame){
    window.addEventListener('message',function(event){
      if(event.source!==window.parent){return;}
      var data=event.data; if(!data||typeof data!=='object'||data.type!=='hj:weather'){return;}
      onAnswer(data);
    });
    var asked=false;
    var ask=function(){ if(asked){return;} asked=true; try{ window.parent.postMessage({type:'hj:weather-want',places:WX.places.slice(0,12).map(function(p){ return {key:p.key,lat:p.lat,lon:p.lon,start:p.start,end:p.end}; })},'*'); }catch(e){} };
    if(document.readyState==='complete'){ ask(); } else { window.addEventListener('load',ask); }
  } else {
    var today=new Date().toISOString().slice(0,10);
    $$('.wx[data-wx-date]').forEach(function(box){ var iso=box.getAttribute('data-wx-date'); if(ISO.test(iso)&&today>=addDays(iso,-15)&&today<=iso){ var m=box.querySelector('.wx-msg'); if(m){ m.textContent=t('wx_frame','The live forecast shows when this page is opened on the family site.'); } } });
  }
}

/* ---- who is travelling: lenses highlight what suits each kind of traveller ---- */
var AU=D.audience||null;
if(AU&&AU.mode==='lenses'){
  var lenses={}; (AU.lenses||[]).forEach(function(l){ lenses[l.key]=l; });
  var NAMES=UI.marks||{};
  var applyLens=function(k,save){
    var lens=Object.prototype.hasOwnProperty.call(lenses,k)?lenses[k]:null;
    root.setAttribute('data-lens',lens?k:'');
    $$('.lens-btn').forEach(function(b){ b.setAttribute('aria-pressed',String((b.getAttribute('data-lens')||'')===(lens?k:''))); });
    $$('.lens-card').forEach(function(c){ c.classList.toggle('on',!!lens&&c.getAttribute('data-lens-card')===k); });
    $$('.stop').forEach(function(st){
      var chips=$$('.suit',st), need=lens?lens.needs:[];
      chips.forEach(function(c){ c.classList.toggle('need',need.indexOf(c.getAttribute('data-mark'))>=0); });
      $$('.lens-note[data-lens]',st).forEach(function(n){ n.hidden=!!lens&&n.getAttribute('data-lens')!==k; });
      var sum=st.querySelector('.suits-sum'); if(!sum){return;}
      clear(sum);
      if(!lens||!need.length){ sum.hidden=true; return; }
      var fits=[],check=[],unknown=[];
      need.forEach(function(m){ var c=chips.filter(function(x){return x.getAttribute('data-mark')===m;})[0];
        if(!c){ unknown.push(NAMES[m]||m); } else if(c.getAttribute('data-level')==='good'){ fits.push(c.textContent.trim()); } else { check.push(c.textContent.trim()); } });
      sum.appendChild(el('b',null,fill(t('lens_for','For {label}'),{label:lens.label})+': '));
      var parts=[]; if(fits.length){parts.push(t('lens_fits','fits')+' · '+fits.join(', '));} if(check.length){parts.push(t('lens_check','check')+' · '+check.join(', '));} if(unknown.length){parts.push(t('lens_unknown','not checked')+' · '+unknown.join(', '));}
      sum.appendChild(document.createTextNode(parts.join('; '))); sum.hidden=false;
    });
    if(save){ store.set(SKEY+'lens',lens?k:''); }
    if(window.railLayout){ setTimeout(window.railLayout,60); }
  };
  document.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('.lens-btn'); if(b){ applyLens(b.getAttribute('data-lens')||'',true); } });
  var savedLens=store.get(SKEY+'lens'); if(savedLens){ applyLens(String(savedLens),false); }
}

/* ==== the opener: globe, countdown, local time, slow-zoom photos; the legend; play the trip; coming alive ==== */
var OP=D.opener||null, RAD=Math.PI/180, SVGNS='http://www.w3.org/2000/svg';
function clampLat(v){ return Math.max(-70,Math.min(70,+v||0)); }

/* -- the Earth: our own orthographic projection over Natural Earth land, decoded from the page's globe data -- */
var GEO=null;
try{ var gdEl=document.getElementById('globe-data'); if(gdEl){ GEO=decodeGlobe(JSON.parse(gdEl.textContent)); } }catch(e){ GEO=null; }
function decodeGlobe(G){
  var coast=[], dots=[], grat=[], i, k, s, la, lo;
  (G.c||[]).forEach(function(a){ var x=a[0], y=a[1], pts=[[x/10*RAD,y/10*RAD]]; for(var j=2;j<a.length;j+=2){ x+=a[j]; y+=a[j+1]; pts.push([x/10*RAD,y/10*RAD]); } coast.push(pts); });
  var d=G.d||[]; for(i=0;i<d.length;i+=2){ dots.push([d[i]/10*RAD,d[i+1]/10*RAD]); }
  for(k=-180;k<180;k+=30){ s=[]; for(la=-80;la<=80;la+=4){ s.push([k*RAD,la*RAD]); } grat.push(s); }
  for(k=-60;k<=60;k+=30){ s=[]; for(lo=-180;lo<=180;lo+=4){ s.push([lo*RAD,k*RAD]); } grat.push(s); }
  return {coast:coast,dots:dots,grat:grat};
}
function unit(p){ var lo=p.lng*RAD, la=p.lat*RAD; return [Math.cos(la)*Math.cos(lo),Math.cos(la)*Math.sin(lo),Math.sin(la)]; }
function greatCircle(a,b,n){
  var p=unit(a), q=unit(b), dot=Math.max(-1,Math.min(1,p[0]*q[0]+p[1]*q[1]+p[2]*q[2])), om=Math.acos(dot), out=[];
  for(var i=0;i<=n;i++){
    var t=i/n, s1=om<1e-6?1-t:Math.sin((1-t)*om)/Math.sin(om), s2=om<1e-6?t:Math.sin(t*om)/Math.sin(om);
    var x=s1*p[0]+s2*q[0], y=s1*p[1]+s2*q[1], z=s1*p[2]+s2*q[2], r=Math.sqrt(x*x+y*y+z*z)||1;
    out.push([Math.atan2(y,x),Math.asin(Math.max(-1,Math.min(1,z/r)))]);
  }
  return out;
}
function Globe(svg){
  var g={svg:svg,lam:0,phi:0,arc:[],arcT:1,pins:[],raf:0}, R=180, C=200;
  var P={grat:svg.querySelector('.g-grat'),dots:svg.querySelector('.g-dots'),coast:svg.querySelector('.g-coast'),arc:svg.querySelector('.g-arc'),pins:svg.querySelector('.g-pins')};
  function proj(lo,la,sp,cp,l0){
    var cla=Math.cos(la), dl=lo-l0, cd=Math.cos(dl), cosc=sp*Math.sin(la)+cp*cla*cd;
    if(cosc<0){ return null; }
    return [C+R*cla*Math.sin(dl), C-R*(cp*Math.sin(la)-sp*cla*cd)];
  }
  function lines(sets,sp,cp,l0,limit){
    var out=[];
    sets.forEach(function(pts){ var pen=false, n=limit===undefined?pts.length:Math.min(limit,pts.length);
      for(var i=0;i<n;i++){ var q=proj(pts[i][0],pts[i][1],sp,cp,l0); if(q){ out.push((pen?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)); pen=true; } else { pen=false; } } });
    return out.join('');
  }
  g.render=function(){
    if(!GEO){ return; }
    var sp=Math.sin(g.phi*RAD), cp=Math.cos(g.phi*RAD), l0=g.lam*RAD, dd=[];
    P.grat.setAttribute('d',lines(GEO.grat,sp,cp,l0));
    P.coast.setAttribute('d',lines(GEO.coast,sp,cp,l0));
    GEO.dots.forEach(function(p){ var q=proj(p[0],p[1],sp,cp,l0); if(q){ dd.push('M'+q[0].toFixed(1)+' '+q[1].toFixed(1)+'h0'); } });
    P.dots.setAttribute('d',dd.join(''));
    P.arc.setAttribute('d',g.arc.length?lines([g.arc],sp,cp,l0,Math.round(g.arcT*g.arc.length)):'');
    g.pins.forEach(function(pin){ var q=proj(pin.lo,pin.la,sp,cp,l0);
      if(q){ pin.el.setAttribute('transform','translate('+q[0].toFixed(1)+' '+q[1].toFixed(1)+')'); pin.el.style.display=''; } else { pin.el.style.display='none'; } });
  };
  g.setPins=function(list){
    clear(P.pins); g.pins=[];
    list.forEach(function(p){
      var grp=document.createElementNS(SVGNS,'g'), c=document.createElementNS(SVGNS,'circle');
      grp.setAttribute('class','g-pin '+(p.kind||'')); c.setAttribute('r',p.kind==='base'?'3.5':'6'); grp.appendChild(c);
      if(p.label){ var tx=document.createElementNS(SVGNS,'text'); tx.setAttribute('x','10'); tx.setAttribute('y','4'); tx.textContent=String(p.label); grp.appendChild(tx); }
      P.pins.appendChild(grp); g.pins.push({lo:p.lng*RAD,la:p.lat*RAD,el:grp});
    });
  };
  g.stop=function(){ cancelAnimationFrame(g.raf); };
  g.spinTo=function(to,ms,done){
    g.stop();
    var from={lam:g.lam,phi:g.phi,arcT:g.arcT}, dl=((to.lam-from.lam)%360+540)%360-180, t0=null;
    function step(ts){
      if(t0===null){ t0=ts; }
      var k=Math.min(1,(ts-t0)/ms), e=1-Math.pow(1-k,3);
      g.lam=from.lam+dl*e; g.phi=from.phi+(to.phi-from.phi)*e;
      if(to.arcT!==undefined){ g.arcT=from.arcT+(to.arcT-from.arcT)*k; }
      g.render();
      if(k<1){ g.raf=requestAnimationFrame(step); } else if(done){ done(); }
    }
    g.raf=requestAnimationFrame(step);
  };
  // drag to turn (sideways drags turn it; the page still scrolls up and down), arrow keys too
  var down=null;
  svg.addEventListener('pointerdown',function(e){ g.stop(); down={x:e.clientX,y:e.clientY,lam:g.lam,phi:g.phi}; try{ svg.setPointerCapture(e.pointerId); }catch(x){} });
  svg.addEventListener('pointermove',function(e){ if(!down){return;} var k=0.45*400/(svg.getBoundingClientRect().width||400);
    g.lam=down.lam-(e.clientX-down.x)*k; g.phi=Math.max(-80,Math.min(80,down.phi+(e.clientY-down.y)*k)); g.render(); });
  ['pointerup','pointercancel'].forEach(function(ev){ svg.addEventListener(ev,function(){ down=null; }); });
  svg.addEventListener('keydown',function(e){ var m={ArrowLeft:[10,0],ArrowRight:[-10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];
    if(m){ e.preventDefault(); g.stop(); g.lam+=m[0]; g.phi=Math.max(-80,Math.min(80,g.phi+m[1])); g.render(); } });
  return g;
}
function dressGlobe(g){
  if(!OP||!OP.dest){ return; }
  var pins=[], route=[];
  if(OP.home){ pins.push({lat:OP.home.lat,lng:OP.home.lng,label:OP.home.name,kind:'home'}); route=greatCircle(OP.home,OP.dest,72); }
  pins.push({lat:OP.dest.lat,lng:OP.dest.lng,label:OP.dest.name,kind:'dest'});
  var last=OP.dest;
  (OP.bases||[]).forEach(function(b){ if(Math.abs(b.lat-last.lat)+Math.abs(b.lng-last.lng)>0.05){ route=route.concat(greatCircle(last,b,12)); last=b; } pins.push({lat:b.lat,lng:b.lng,kind:'base'}); });
  g.arc=route; g.setPins(pins);
}
var opGlobeSvg=$('#opener .globe');
if(opGlobeSvg&&GEO&&OP&&OP.dest){
  var og=Globe(opGlobeSvg), target={lam:OP.dest.lng,phi:clampLat(OP.dest.lat)};
  dressGlobe(og); og.arcT=1;
  if(reduce){ og.lam=target.lam; og.phi=target.phi; og.render(); }
  else {
    og.lam=target.lam-150; og.phi=target.phi*0.3; og.render();
    var spun=false, spin=function(){ if(spun){return;} spun=true; og.spinTo(target,7000); };
    if('IntersectionObserver' in window){ var gio=new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting){ spin(); gio.disconnect(); } }); },{threshold:0.2}); gio.observe(opGlobeSvg); }
    else { spin(); }
  }
}

/* -- countdown and the destination's local time -- */
function todayIn(tz){
  try{ var o={}; new Intl.DateTimeFormat('en-CA',{timeZone:tz||undefined,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).forEach(function(p){ o[p.type]=p.value; });
    if(o.year&&o.month&&o.day){ return o.year+'-'+o.month+'-'+o.day; } }catch(e){}
  return new Date().toISOString().slice(0,10);
}
function dayNo(iso){ var p=iso.split('-'); return Math.round(Date.UTC(+p[0],(+p[1])-1,+p[2])/86400000); }
var cdEl=$('#op-count');
if(cdEl&&OP){
  var cs=cdEl.getAttribute('data-start')||'', ce=cdEl.getAttribute('data-end')||cs;
  if(ISO.test(cs)&&ISO.test(ce)){
    var now=dayNo(todayIn(OP.tz)), a=dayNo(cs), b=dayNo(ce);
    if(now<a){ cdEl.textContent=a-now===1?t('cd_one','1 day to go'):fill(t('cd_to_go','{n} days to go'),{n:a-now}); cdEl.hidden=false; }
    else if(now<=b){ cdEl.textContent=fill(t('cd_during','Day {d} of {n}'),{d:now-a+1,n:b-a+1}); cdEl.hidden=false; }
  }
}
var ltEl=$('#op-time');
if(ltEl){
  var ltTick=function(){
    try{ var s=new Intl.DateTimeFormat('en-GB',{timeZone:ltEl.getAttribute('data-tz'),weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date());
      ltEl.textContent=fill(t('local_time','{time} in {place}'),{time:s,place:ltEl.getAttribute('data-place')||''}); ltEl.hidden=false; }
    catch(e){ ltEl.hidden=true; }
  };
  ltTick(); setInterval(ltTick,20000);
}

/* -- the hero: photos cross-fade and slowly zoom (still under reduced motion) -- */
var slides=$$('.hero-slide'), slideIdx=0, heroSeen=true;
if(slides.length>1&&!reduce){
  if('IntersectionObserver' in window){ new IntersectionObserver(function(es){ es.forEach(function(en){ heroSeen=en.isIntersecting; }); }).observe($('.hero')); }
  setInterval(function(){ if(!heroSeen||document.hidden){return;} slides[slideIdx].classList.remove('on'); slideIdx=(slideIdx+1)%slides.length; slides[slideIdx].classList.add('on'); },7000);
}

/* -- the legend: tap a category to light every matching place on the page and on the map; tap again to clear -- */
var lgBtns=$$('[data-legend]'), lgMsg=$('.lg-msg'), lgNext=$('.lg-next'), lgClear=$('.lg-clear'), litList=[], litAt=-1;
var COUNTED='.stop, .alt, .near, .upg, .plans-bar';
function catsOf(e){ return (e.getAttribute('data-cats')||'').split(/\s+/); }
function counted(e){ return e.matches&&e.matches(COUNTED)&&!e.closest('#opener'); }
lgBtns.forEach(function(b){
  var c=b.getAttribute('data-legend'), n=$$('[data-cats]').filter(function(e){ return counted(e)&&catsOf(e).indexOf(c)>=0; }).length;
  var badge=b.querySelector('.lg-n'); if(badge){ badge.textContent=String(n); } if(!n){ b.classList.add('empty'); }
});
function setCat(c){
  if(c===activeCat){ c=''; }
  activeCat=CATS[c]?c:'';
  if(activeCat){ root.setAttribute('data-cat',activeCat); } else { root.removeAttribute('data-cat'); }
  litList=[]; litAt=-1;
  $$('[data-cats]').forEach(function(e){ var on=!!activeCat&&catsOf(e).indexOf(activeCat)>=0; e.classList.toggle('lit',on); if(on&&counted(e)){ litList.push(e); } });
  $$('.cat-chip').forEach(function(ch){ ch.classList.toggle('on',!!activeCat&&ch.getAttribute('data-cat')===activeCat); });
  lgBtns.forEach(function(b){ b.setAttribute('aria-pressed',String(!!activeCat&&b.getAttribute('data-legend')===activeCat)); });
  if(lgMsg){ var lab=CATS[activeCat]?CATS[activeCat][1]:'';
    lgMsg.textContent=!activeCat?'':litList.length?fill(t('lg_lit','{n} lit: {label}'),{n:litList.length,label:lab}):fill(t('lg_none','Nothing marked {label} yet'),{label:lab}); }
  if(lgNext){ lgNext.hidden=!litList.length; }
  if(lgClear){ lgClear.hidden=!activeCat; }
  paintPins(); drawNearby();
  litList.slice(0,16).forEach(function(e,i){ motion(e,[{transform:'scale(1)'},{transform:'scale(1.012)'},{transform:'scale(1)'}],{duration:640,delay:i*45,easing:'ease-out'}); });
}
function glow(e,delay){ motion(e,[{boxShadow:'0 0 0 0 rgba(15,107,92,0)'},{boxShadow:'0 0 0 6px rgba(15,107,92,.28)'},{boxShadow:'0 0 0 0 rgba(15,107,92,0)'}],{duration:1400,delay:delay||0,easing:'ease-in-out'}); }
document.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('[data-legend]'); if(b){ setCat(b.getAttribute('data-legend')); } });
if(lgNext){ lgNext.addEventListener('click',function(){ if(!litList.length){return;} litAt=(litAt+1)%litList.length; var tg=litList[litAt]; tg.classList.add('in');
  tg.scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'}); glow(tg,300); }); }
if(lgClear){ lgClear.addEventListener('click',function(){ setCat(activeCat); }); }

/* -- play the trip: the globe flies to the destination, then the map goes day by day, stop by stop -- */
var tourEl=$('#tour'), playBtn=$('#play-trip');
if(tourEl&&playBtn){
  var steps=[], tAt=0, tTimer=null, tAnim=null, tPlaying=false, tGlobe=null, mapBox=$('#leaflet'), mapHome=null, tReturn=null, tScroll=0;
  if(OP&&OP.home&&OP.dest&&GEO){ steps.push({globe:true}); }
  (D.tour||[]).forEach(function(s){ steps.push(s); });
  var tk=tourEl.querySelector('.tour-k'), tt=tourEl.querySelector('.tour-t'), tl=tourEl.querySelector('.tour-l'), tImg=tourEl.querySelector('.tour-ph img'),
      tCredit=tourEl.querySelector('.tour-credit'), tBig=tourEl.querySelector('.tour-big img'), tBar=tourEl.querySelector('.tour-bar i'),
      tPause=tourEl.querySelector('.tour-pause'), tNext=tourEl.querySelector('.tour-next'), tPrev=tourEl.querySelector('.tour-prev'), tClose=tourEl.querySelector('.tour-close');
  var setPhoto=function(img){
    clear(tCredit);
    if(!img){ tImg.removeAttribute('src'); tImg.alt=''; return; }
    tImg.src=img.currentSrc||img.src; tImg.alt=img.alt||'';
    var fig=img.closest('figure'), c=fig&&fig.querySelector('.credit'); if(c){ Array.prototype.forEach.call(c.childNodes,function(n){ tCredit.appendChild(n.cloneNode(true)); }); }
  };
  var label=function(){ tPause.textContent=tPlaying?t('tour_pause','Pause'):t('tour_play','Play'); };
  var showStep=function(){
    clearTimeout(tTimer);
    if(tAnim){ var old=tAnim; tAnim=null; old.cancel(); }
    var s=steps[tAt]; if(!s){ return; }
    var dur=5200;
    if(s.globe){
      if(map){ map.stop(); }  // the map is hidden behind the globe: no animation may run on a hidden map
      tourEl.setAttribute('data-view','globe');
      tk.textContent=t('tour_way','The way there'); tt.textContent=fill(t('tour_from','From {home} to {dest}'),{home:OP.home.name,dest:OP.dest.name});
      var dates=$('.hero-dates'); tl.textContent=dates?dates.textContent:'';
      setPhoto($('.hero-slide img'));
      if(!tGlobe){ tGlobe=Globe(tourEl.querySelector('.globe')); dressGlobe(tGlobe); }
      tGlobe.lam=OP.home.lng; tGlobe.phi=clampLat(OP.home.lat); tGlobe.arcT=0;
      if(reduce){ tGlobe.lam=OP.dest.lng; tGlobe.phi=clampLat(OP.dest.lat); tGlobe.arcT=1; tGlobe.render(); }
      else { tGlobe.render(); tGlobe.spinTo({lam:OP.dest.lng,phi:clampLat(OP.dest.lat),arcT:1},4400); }
    } else {
      if(tGlobe){ tGlobe.stop(); }
      tourEl.setAttribute('data-view',map?'map':'photo');
      if(map){ map.invalidateSize(false); }  // measure the map now it is shown, before it flies
      tk.textContent=s.when||''; tt.textContent=s.name||''; tl.textContent=s.line||'';
      var card=document.getElementById(s.id), img=card&&card.querySelector('.tile img, .near-photo img');
      setPhoto(img);
      if(map){ if(s.d!==dayIdx){ selectDay(s.d); } if(s.idx>=0){ focusStop(s.idx); } else { map.flyTo([s.lat,s.lng],14,{animate:!reduce}); } }
      else if(img){ tBig.src=img.currentSrc||img.src; tBig.alt=img.alt||''; }
    }
    tPrev.disabled=tAt===0; tNext.disabled=tAt>=steps.length-1;
    motion(tt,[{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:520,easing:'cubic-bezier(.2,.7,.2,1)'});
    var from=(tAt/Math.max(1,steps.length-1)*100)+'%', to=((tAt+1)/Math.max(1,steps.length-1)*100)+'%';
    tBar.style.width=from;
    if(tPlaying){
      if(tAt>=steps.length-1){ tPlaying=false; }
      else {
        var a=motion(tBar,[{width:from},{width:to}],{duration:dur,easing:'linear'});
        if(a){ tAnim=a; a.finished.then(function(){ if(tAnim===a&&tPlaying){ tAnim=null; tBar.style.width=to; tAt++; showStep(); } },function(){}); }
        else { tTimer=setTimeout(function(){ tAt++; showStep(); },dur); }
      }
    }
    label();
  };
  // On the family site, the tour says when it opens and closes, so the site's own buttons fold away.
  var tellSite=function(open){ if(window.parent!==window){ try{ window.parent.postMessage({type:'hj:tour',open:open},'*'); }catch(e){} } };
  var openTour=function(){
    if(!steps.length){ return; }
    tellSite(true);
    tReturn=document.activeElement; tScroll=window.scrollY;
    tourEl.hidden=false; document.body.style.overflow='hidden';
    if(map&&mapBox&&!mapHome){ map.stop(); mapHome={parent:mapBox.parentNode,next:mapBox.nextSibling}; tourEl.querySelector('.tour-map').appendChild(mapBox); }
    tAt=0; tPlaying=!reduce; tPause.hidden=reduce; showStep(); (reduce?tNext:tPause).focus();
  };
  var closeTour=function(){
    clearTimeout(tTimer); tPlaying=false; if(tAnim){ var old=tAnim; tAnim=null; old.cancel(); } if(tGlobe){ tGlobe.stop(); }
    if(mapHome){ if(map){ map.stop(); } mapHome.parent.insertBefore(mapBox,mapHome.next); mapHome=null; if(map){ map.invalidateSize(false); } }
    tourEl.hidden=true; document.body.style.overflow=''; window.scrollTo(0,tScroll); tellSite(false);
    if(tReturn&&tReturn.focus){ tReturn.focus(); }
  };
  playBtn.addEventListener('click',openTour);
  tClose.addEventListener('click',closeTour);
  tNext.addEventListener('click',function(){ if(tAt<steps.length-1){ tAt++; showStep(); } });
  tPrev.addEventListener('click',function(){ if(tAt>0){ tAt--; showStep(); } });
  tPause.addEventListener('click',function(){
    tPlaying=!tPlaying;
    if(!tPlaying){ clearTimeout(tTimer); if(tAnim){ tAnim.pause(); } label(); }
    else if(tAnim&&tAnim.playState==='paused'){ tAnim.play(); label(); }
    else { if(tAt>=steps.length-1){ tAt=0; } showStep(); }
  });
  tourEl.addEventListener('keydown',function(e){
    if(e.key==='Escape'){ e.preventDefault(); closeTour(); }
    else if(e.key==='ArrowRight'&&!e.target.closest('.leaflet-container')){ tNext.click(); }
    else if(e.key==='ArrowLeft'&&!e.target.closest('.leaflet-container')){ tPrev.click(); }
    else if(e.key==='Tab'){ var f=$$('button:not([hidden]):not([disabled])',tourEl.querySelector('.tour-ctl')); var i=f.indexOf(document.activeElement);
      if(e.shiftKey&&i<=0){ e.preventDefault(); f[f.length-1].focus(); } else if(!e.shiftKey&&i===f.length-1){ e.preventDefault(); f[0].focus(); } }
  });
}

/* -- coming alive: sections rise in, photos breathe while in view, clips play muted only while seen -- */
if(!reduce&&'IntersectionObserver' in window){
  var rvEls=$$('.sec > h2, .sec > .kicker, .day-h, .stop, .near, .alt, .upg, .ocard, .pc, .plans-bar, .tldr li');
  rvEls.forEach(function(e){ e.classList.add('rv'); });
  var rio=new IntersectionObserver(function(es){ var k=0; es.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); rio.unobserve(en.target);
    motion(en.target,[{opacity:0,transform:'translateY(22px)'},{opacity:1,transform:'none'}],{duration:900,delay:Math.min(k++,6)*70,easing:'cubic-bezier(.2,.7,.2,1)'}); } }); },{threshold:0.04});
  rvEls.forEach(function(e){ rio.observe(e); });
  var tio=new IntersectionObserver(function(es){ es.forEach(function(en){ en.target.classList.toggle('inview',en.intersectionRatio>=0.5); }); },{threshold:[0,0.5]});
  $$('.tile').forEach(function(e){ tio.observe(e); });
  var vio=new IntersectionObserver(function(es){ es.forEach(function(en){ var v=en.target;
    if(en.intersectionRatio>=0.5&&root.getAttribute('data-mode')!=='print'){ v.muted=true; v.loop=true; var pr=v.play(); if(pr&&pr.catch){ pr.catch(function(){}); } }
    else if(!v.paused){ v.pause(); } }); },{threshold:[0,0.5]});
  $$('.clip video').forEach(function(v){ vio.observe(v); });
}

/* ==== place panels (the owner, 6 November 2026): every place name opens its facts here, in the page,
   instead of a new window that is hard to come back from on a tablet or phone. Built with text nodes
   only; outside links are grouped at the foot and marked as opening a new tab. ==== */
var P=D.panels||{}, sheet=$('#sheet'), sheetCard=sheet&&sheet.querySelector('.sheet-card'), sheetBody=sheet&&sheet.querySelector('.sheet-body'),
    sheetH=sheet&&sheet.querySelector('#sheet-h'), sheetK=sheet&&sheet.querySelector('.sheet-k'), sheetScrim=sheet&&sheet.querySelector('.sheet-scrim'),
    toastEl=$('.toast'), sheetReturn=null, sheetAnim=null, nearWaiting=false, drag=null;
function wideScreen(){ return !!(window.matchMedia&&window.matchMedia('(min-width: 760px)').matches); }
function toast(msg){
  if(!toastEl||!msg){ return; }
  toastEl.textContent=msg; toastEl.hidden=false; clearTimeout(toast.t);
  motion(toastEl,[{opacity:0,transform:'translate(-50%,10px)'},{opacity:1,transform:'translate(-50%,0)'}],{duration:260,easing:'ease-out'});
  toast.t=setTimeout(function(){ toastEl.hidden=true; },2600);
}
function sheetOpen(kicker,title,from){
  if(!sheet){ return false; }
  clear(sheetBody); sheetK.textContent=kicker||''; sheetH.textContent=title||'';
  if(sheet.hidden){
    sheetReturn=from||document.activeElement; sheet.hidden=false; root.classList.add('sheet-on');
    if(sheetAnim){ sheetAnim.cancel(); }
    sheetCard.style.transform='';
    sheetAnim=motion(sheetCard,[{transform:wideScreen()?'translateX(104%)':'translateY(104%)'},{transform:'none'}],{duration:380,easing:'cubic-bezier(.2,.8,.2,1)'});
    motion(sheetScrim,[{opacity:0},{opacity:1}],{duration:320});
  }
  sheetCard.scrollTop=0;
  sheetH.focus({preventScroll:true});
  return true;
}
function sheetClose(){
  if(!sheet||sheet.hidden){ return; }
  nearWaiting=false;
  var from=sheetCard.style.transform||'none', to=wideScreen()?'translateX(104%)':'translateY(104%)';
  var done=function(){ sheet.hidden=true; root.classList.remove('sheet-on'); sheetCard.style.transform=''; clear(sheetBody);
    if(sheetReturn&&sheetReturn.focus&&document.contains(sheetReturn)){ sheetReturn.focus({preventScroll:true}); } };
  if(sheetAnim){ sheetAnim.cancel(); }
  sheetCard.style.transform=to;  // the end state is the element's own style, so nothing is left filling
  var a=motion(sheetCard,[{transform:from},{transform:to}],{duration:260,easing:'cubic-bezier(.4,0,.7,.2)'});
  motion(sheetScrim,[{opacity:1},{opacity:0}],{duration:240});
  if(a){ sheetAnim=a; a.finished.then(done,done); } else { done(); }
}
function catLabel(c){ return (D.cats&&D.cats[c])?D.cats[c][1]:''; }
function canShare(){ return inFrame||typeof navigator.share==='function'||!!(navigator.clipboard&&navigator.clipboard.writeText); }
function localShare(data){
  if(typeof navigator.share==='function'){ navigator.share(data).then(function(){ toast(t('shared','Shared.')); },function(){}); return; }
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(data.url).then(function(){ toast(t('copied','Link copied.')); },function(){}); }
}
function sharePlace(p){
  var url=/^https:/.test(p.web||'')?p.web:p.maps, text=String(p.addr||p.what||'').slice(0,300);
  if(!/^https:/.test(url||'')){ return; }
  if(inFrame){ try{ window.parent.postMessage({type:'hj:share-want',kind:'place',title:String(p.name).slice(0,120),text:text,url:url},'*'); }catch(e){} return; }
  localShare({title:p.name,text:text,url:url});
}
function shareDay(n){
  var d=D.days[n-1]||{};
  shareAnchor('day-'+n,String((D.trip||'')+' · '+(d.label||'')).slice(0,120));
}
/* A link to one part of the page (the owner, 7 November 2026). On the family site the site shares its own
   address for this document with the part's # at the end; the frame sends only the title and that #. */
var ANCHOR_OK=/^[A-Za-z][A-Za-z0-9_-]{0,60}$/;
function shareAnchor(id,title){
  if(!ANCHOR_OK.test(id||'')){ return false; }
  if(inFrame){ try{ window.parent.postMessage({type:'hj:share-want',kind:'doc',title:title,hash:id},'*'); }catch(e){} return true; }
  if(/^https:/.test(location.href)&&canShare()){ localShare({title:title,url:location.href.split('#')[0]+'#'+id}); return true; }
  return false;
}
function placeOpen(pid,from){
  var p=P[pid]; if(!p||!sheet){ return false; }
  var kick=(p.cats||[]).map(catLabel).filter(Boolean).join(' · ');
  sheetOpen((p.icon?p.icon+' ':'')+kick,p.name,from);
  var b=sheetBody;
  if(p.photo&&/^(https:|data:image\/)/.test(p.photo.src||'')){
    var fig=el('figure','sh-ph'), im=el('img'); im.src=p.photo.src; im.alt=p.photo.alt||''; im.decoding='async'; im.referrerPolicy='no-referrer'; fig.appendChild(im);
    var cap=el('figcaption','credit'); if(/^https:/.test(p.photo.credit_url||'')){ cap.appendChild(link(p.photo.credit_url,p.photo.credit)); } else { cap.textContent=p.photo.credit||''; }
    fig.appendChild(cap); b.appendChild(fig);
    motion(im,[{transform:'scale(1.06)'},{transform:'none'}],{duration:1600,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  if(p.what){ b.appendChild(el('p','sh-what',p.what)); }
  if(p.dist){ b.appendChild(el('p','sh-dist',p.dist)); }
  var facts=el('dl','sh-facts');
  var row=function(label,node){ facts.appendChild(el('dt',null,label)); var dd=el('dd'); dd.appendChild(node); facts.appendChild(dd); };
  if(p.addr){ row(t('address','Address'),/^https:/.test(p.maps||'')?link(p.maps,p.addr+' ↗'):el('span',null,p.addr)); }
  if(p.hours){ var hs=el('span',null,p.hours+' '); if(/^https:/.test(p.hours_src||'')){ var hl=link(p.hours_src,hostOf(p.hours_src)); hl.className='src'; hs.appendChild(hl); } row(t('hours','Hours'),hs); }
  if(p.spot&&p.spot.spot){ var sp=el('span',null,p.spot.spot+(p.spot.tip?'. '+p.spot.tip:'')+' ');
    if(/^https:/.test(p.spot.src_url||'')){ var sl=link(p.spot.src_url,p.spot.src||hostOf(p.spot.src_url)); sl.className='src'; sp.appendChild(sl); }
    row('📸 '+t('photo_spot','Photo spot'),sp); }
  (p.awards||[]).forEach(function(a){ var aw=el('span',null,a.label+(a.body?' ('+a.body+')':'')+' ');
    if(/^https:/.test(a.src_url||'')){ var al=link(a.src_url,a.src||hostOf(a.src_url)); al.className='src'; aw.appendChild(al); } row('🏆 '+t('awards','Awards'),aw); });
  if(facts.firstChild){ b.appendChild(facts); }
  var acts=el('div','sh-acts');
  if(typeof p.lat==='number'&&typeof p.lng==='number'){ var sm=el('button','btn-gold','📍 '+t('alt_map','Show on map')); sm.type='button';
    sm.addEventListener('click',function(){ sheetClose(); showOnMap(p.day,p.idx,p.lat,p.lng,p.name,catLabel((p.cats||[])[0]||'')); }); acts.appendChild(sm); }
  if(canShare()){ var sh=el('button','btn-ghost','↗ '+t('share','Share')); sh.type='button'; sh.addEventListener('click',function(){ sharePlace(p); }); acts.appendChild(sh); }
  if(acts.firstChild){ b.appendChild(acts); }
  var out=el('p','sh-out');
  [[p.web,'🌐 '+t('website','Website')],[p.maps,'📍 '+t('google_maps','Google Maps')],[p.ig?'https://www.instagram.com/'+p.ig+'/':'','📸 @'+(p.ig||'')]].forEach(function(x){
    if(x[0]&&/^https:/.test(x[0])){ var a=link(x[0],x[1]+' ↗'); a.title=t('new_tab','opens a new tab'); out.appendChild(a); } });
  if(/^tel:\+?[0-9]{2,16}$/.test(p.tel||'')){ var tl2=el('a',null,'📞 '+t('call','Call')); tl2.href=p.tel; out.appendChild(tl2); }
  if(out.firstChild){ b.appendChild(out); }
  if(p.ig&&/^[A-Za-z0-9._]{1,30}$/.test(p.ig)){
    var ig=el('div','sh-ig'); ig.appendChild(el('p','mono kicker',fill(t('ig_posts','Latest posts from @{h} on Instagram'),{h:p.ig})));
    var fr=document.createElement('iframe'); fr.src='https://www.instagram.com/'+encodeURIComponent(p.ig)+'/embed/'; fr.title=fill(t('ig_posts','Instagram @{h}'),{h:p.ig});
    fr.loading='lazy'; fr.referrerPolicy='strict-origin-when-cross-origin'; fr.height='540'; ig.appendChild(fr);
    ig.appendChild(el('p','fine',t('embed_note',''))); b.appendChild(ig);
  }
  var tg=p.anchor&&document.getElementById(p.anchor);
  if(tg){
    var go=el('a','sh-more','↓ '+t('stop_details','Details below')); go.href='#'+p.anchor;
    go.addEventListener('click',function(e){ e.preventDefault(); sheetClose(); tg.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'}); glow(tg,450); });
    b.appendChild(go);
  }
  return true;
}
/* -- Near me: on the family site the site's own page asks the person and the device, and sends back
   only the nearest places' keys and rough distances; opened elsewhere, the page asks the browser. -- */
var NEAR_CATS={food:['food','snacks','drinks'],shopping:['shopping']};
function nearPlaces(filter){ var want=NEAR_CATS[filter]||null, out=[]; Object.keys(P).forEach(function(k){ var p=P[k];
  if(want&&!(p.cats||[]).some(function(c){ return want.indexOf(c)>=0; })){ return; }
  if(typeof p.lat==='number'&&typeof p.lng==='number'&&/^[a-z0-9][a-z0-9-]{0,29}$/.test(k)){ out.push({key:k,lat:p.lat,lon:p.lng}); } }); return out.slice(0,200); }
function distKm(a,b){ var r=function(d){ return d*Math.PI/180; }, dLat=r(b.lat-a.lat), dLon=r(b.lon-a.lon);
  var h=Math.pow(Math.sin(dLat/2),2)+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.pow(Math.sin(dLon/2),2); return 2*6371*Math.asin(Math.min(1,Math.sqrt(h))); }
function nearestTo(here,places){ return places.map(function(p){ return {key:p.key,d:distKm(here,p)}; }).sort(function(a,b){ return a.d-b.d; }).slice(0,20)
  .map(function(p){ return {key:p.key,km:Math.max(0.5,Math.round(p.d*2)/2)}; }); }
function nearShow(a){
  if(!sheet||sheet.hidden||sheet.getAttribute('data-view')!=='near'){ return; }  // the reader moved on
  clear(sheetBody);
  if(!a.ok){ var why={declined:'near_declined',denied:'near_denied',timeout:'near_unavailable',unavailable:'near_unavailable',unsupported:'near_unsupported'}[a.reason]||'near_unavailable';
    sheetBody.appendChild(el('p','sh-what',t(why,''))); return; }
  var ol=el('ol','near-list');
  (a.places||[]).slice(0,12).forEach(function(x,i){ var p=P[x.key]; if(!p){ return; }
    var li=el('li'), ln=el('a','pl',(p.icon?p.icon+' ':'')+p.name); ln.href='#'+(p.anchor||''); ln.setAttribute('data-place',x.key);
    li.appendChild(ln); li.appendChild(el('span','km',fill(t('about_km','about {km} km'),{km:x.km}))); ol.appendChild(li);
    motion(li,[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:420,delay:i*50,easing:'ease-out'}); });
  sheetBody.appendChild(ol); sheetBody.appendChild(el('p','fine',t('near_note','')));
}
function nearMe(from,filter){
  var places=nearPlaces(filter);
  var title=filter==='food'?t('near_food_title','Food nearest to you'):filter==='shopping'?t('near_shop_title','Shops nearest to you'):t('near_title','Nearest to you');
  sheetOpen('📍 '+(filter==='food'?t('near_food','Hungry?'):filter==='shopping'?t('near_shops','Shop nearby'):t('near_me','Near me')),title,from); sheet.setAttribute('data-view','near');
  if(!places.length){ sheetBody.appendChild(el('p','sh-what',t('near_none',''))); return; }
  sheetBody.appendChild(el('p','sh-what',t('near_wait','')));
  if(inFrame){ nearWaiting=true; try{ window.parent.postMessage({type:'hj:near-want',places:places},'*'); }catch(e){} return; }
  if(!('geolocation' in navigator)){ nearShow({ok:false,reason:'unsupported'}); return; }
  navigator.geolocation.getCurrentPosition(function(pos){ nearShow({ok:true,places:nearestTo({lat:pos.coords.latitude,lon:pos.coords.longitude},places)}); },
    function(err){ nearShow({ok:false,reason:err&&err.code===1?'denied':err&&err.code===3?'timeout':'unavailable'}); },
    {enableHighAccuracy:false,maximumAge:300000,timeout:15000});
}
if(sheet){
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('[data-place]');
    if(a&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&P[a.getAttribute('data-place')]){ e.preventDefault(); sheet.removeAttribute('data-view'); placeOpen(a.getAttribute('data-place'),sheet.contains(a)?sheetReturn:a); return; }
    var nm=e.target.closest&&e.target.closest('[data-near-me]'); if(nm){ e.preventDefault(); nearMe(nm,nm.getAttribute('data-near-me')||''); return; }
    var sd=e.target.closest&&e.target.closest('[data-share-day]'); if(sd){ shareDay(+sd.getAttribute('data-share-day')); }
  });
  sheet.addEventListener('click',function(e){ if(e.target.closest('[data-sheet-close]')){ sheetClose(); } });
  sheet.addEventListener('keydown',function(e){
    if(e.key==='Escape'){ e.preventDefault(); sheetClose(); return; }
    if(e.key!=='Tab'){ return; }
    var f=$$('a[href],button:not([disabled]),iframe,[tabindex="0"]',sheetCard).filter(function(x){ return x.offsetParent!==null; }); if(!f.length){ return; }
    var i=f.indexOf(document.activeElement);
    if(e.shiftKey&&i<=0){ e.preventDefault(); f[f.length-1].focus(); } else if(!e.shiftKey&&i===f.length-1){ e.preventDefault(); f[0].focus(); }
  });
  // a phone: drag the panel down by its handle or title to close it
  sheetCard.addEventListener('pointerdown',function(e){ if(wideScreen()||!e.target.closest('.sheet-grip, .sheet-top')||e.target.closest('button')){ return; }
    drag={y:e.clientY,dy:0,id:e.pointerId}; try{ sheetCard.setPointerCapture(e.pointerId); }catch(x){} });
  sheetCard.addEventListener('pointermove',function(e){ if(!drag||e.pointerId!==drag.id){ return; } drag.dy=Math.max(0,e.clientY-drag.y); sheetCard.style.transform='translateY('+drag.dy+'px)'; });
  var endDrag=function(){ if(!drag){ return; } var dy=drag.dy; drag=null;
    if(dy>90){ sheetClose(); } else { sheetCard.style.transform=''; if(dy>0){ motion(sheetCard,[{transform:'translateY('+dy+'px)'},{transform:'none'}],{duration:220,easing:'ease-out'}); } } };
  sheetCard.addEventListener('pointerup',endDrag); sheetCard.addEventListener('pointercancel',endDrag);
  if(canShare()&&(inFrame||/^https:/.test(location.href))){ $$('[data-share-day]').forEach(function(b){ b.hidden=false; }); }
  if(inFrame){ window.addEventListener('message',function(event){
    if(event.source!==window.parent){ return; }
    var a=event.data; if(!a||typeof a!=='object'){ return; }
    if(a.type==='hj:near'){
      if(!nearWaiting){ return; } nearWaiting=false;
      if(a.ok===true&&Array.isArray(a.places)){ nearShow({ok:true,places:a.places.filter(function(x){ return x&&typeof x.key==='string'&&P[x.key]&&typeof x.km==='number'&&isFinite(x.km); }).slice(0,20)}); }
      else { nearShow({ok:false,reason:typeof a.reason==='string'?a.reason:'unavailable'}); }
    } else if(a.type==='hj:shared'){
      if(a.how==='share'){ toast(t('shared','Shared.')); } else if(a.how==='copy'){ toast(t('copied','Link copied.')); }
    }
  }); }
}

/* ==== the Gallery view (the owner, 7 November 2026): one switch between reading and a picture book.
   Posts are official accounts' Instagram posts and Reels and TikTok videos; each loads only when
   tapped, and only from the two embed addresses below. ==== */
var gallery=$('#gallery'), readScroll=0;
var EMBED_OK=/^https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_-]{5,40}\/embed\/captioned\/$|^https:\/\/www\.tiktok\.com\/embed\/v2\/[0-9]{8,25}$/;
function setView(v,from){
  if(!gallery){ return; }
  var g=v==='gallery';
  if(g===(root.getAttribute('data-view')==='gallery')){ return; }
  if(g){ readScroll=window.scrollY; root.setAttribute('data-view','gallery'); window.scrollTo(0,0); }
  else { root.removeAttribute('data-view'); window.scrollTo(0,readScroll); }
  if(window.railLayout){ window.railLayout(); }  // the date bar follows the view now shown
  $$('button[data-view]').forEach(function(b){ b.setAttribute('aria-pressed',String(b.getAttribute('data-view')===(g?'gallery':'read'))); });
  if(g){ $$('.g-tile',gallery).slice(0,12).forEach(function(t2,i){ motion(t2,[{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'none'}],{duration:700,delay:i*60,easing:'cubic-bezier(.2,.7,.2,1)'}); }); }
  if(from&&from.focus){ from.focus({preventScroll:true}); }
}
function playTile(tile){
  var src=tile.getAttribute('data-embed')||'';
  if(!EMBED_OK.test(src)||tile.querySelector('iframe')){ return; }
  var fr=document.createElement('iframe'); fr.src=src; fr.loading='lazy'; fr.referrerPolicy='strict-origin-when-cross-origin';
  fr.title=(tile.getAttribute('data-kind')==='tiktok'?'TikTok':'Instagram')+' @'+(tile.getAttribute('data-by')||'');
  fr.setAttribute('allow','encrypted-media; picture-in-picture');
  var btn=tile.querySelector('.g-play'), img=tile.querySelector('img');
  if(btn&&btn.parentNode){ btn.parentNode.removeChild(btn); }
  if(img&&img.parentNode){ img.parentNode.removeChild(img); }
  tile.classList.add('g-live'); tile.insertBefore(fr,tile.firstChild);
  motion(fr,[{opacity:0},{opacity:1}],{duration:400});
}
if(gallery){
  document.addEventListener('click',function(e){
    var vb=e.target.closest&&e.target.closest('button[data-view]'); if(vb){ setView(vb.getAttribute('data-view'),vb); return; }
    var pb=e.target.closest&&e.target.closest('.g-tile button.g-play'); if(pb){ playTile(pb.closest('.g-tile')); }
  });
}

/* ==== # links beside headings (the owner, 7 November 2026: "every section of the page have a HTML hyperlink
   #hashtag that I can share"). A tap shares a link to that part; where the page cannot share (a saved copy
   opened from the device) the # is an ordinary link, so the address bar shows it. A link that names a part of
   the Gallery opens the Gallery there; any other part opens the reading view. ==== */
document.addEventListener('click',function(e){
  var a=e.target.closest&&e.target.closest('a[data-sec-link]'); if(!a||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey){ return; }
  var h=a.parentNode, words=String((h&&h.textContent)||'').replace(/\s+/g,' ').trim();
  if(shareAnchor(a.getAttribute('data-sec-link'),String((D.trip||'')+(words?' · '+words:'')).slice(0,120))){ e.preventDefault(); }
});
function goToHash(){
  var id=decodeURIComponent(String(location.hash||'').slice(1));
  if(!ANCHOR_OK.test(id)){ return; }
  var target=document.getElementById(id); if(!target){ return; }
  if(gallery){ setView(gallery.contains(target)?'gallery':'read'); }
  // Parts above can still change height just after the jump (drawers opening, pictures arriving). Browsers that
  // hold the page in place (scroll anchoring) sometimes hold the wrong spot, and iPhone Safari does not hold it at
  // all, so holding is off while the jump settles: the part is placed again shortly after, but only while nobody
  // has scrolled the page since.
  anchorHold(true);
  placeAt(target);
  hashSettle.forEach(clearTimeout);
  var settle=function(){ if(Math.abs(window.scrollY-placedY)<=2){ placeAt(target); } };
  hashSettle=[setTimeout(settle,120),setTimeout(settle,450),setTimeout(settle,1300),setTimeout(function(){ anchorHold(false); },1400)];
}
var hashSettle=[], placedY=-1;
function anchorHold(off){ [root,document.body].forEach(function(n){ if(n){ n.style.overflowAnchor=off?'none':''; } }); }
// the days bar stays at the top while reading, so the part starts just below it
function placeAt(target){
  var bar=$('.topnav'), over=bar&&getComputedStyle(bar).position==='sticky'?bar.getBoundingClientRect().height:0;
  window.scrollTo({top:Math.max(0,target.getBoundingClientRect().top+window.scrollY-over-12),behavior:'instant'});
  placedY=window.scrollY;
}
window.addEventListener('hashchange',goToHash);
if(location.hash){ if(document.readyState==='complete'){ goToHash(); } else { window.addEventListener('load',goToHash); } }

/* ==== Add to calendar (the owner, 7 November 2026): each Add opens the family site's /calendar.ics with
   the event in its address. On the site, the link also names this trip page so the event links back;
   anywhere else (a saved copy of the page) the buttons are hidden, with a note. ==== */
(function(){
  var links=$$('a[data-ics]'); if(!links.length){ return; }
  var m=/^(\/documents\/[0-9]{4}-[0-9]{4}_[0-9]+)\/raw$/.exec(location.pathname||'');
  if(!m || !/^https?:$/.test(location.protocol)){
    root.classList.add('cal-offsite');
    var off=$('.cal-off'); if(off){ off.hidden=false; }
    return;
  }
  links.forEach(function(a){ a.setAttribute('href', a.getAttribute('href')+'&u='+encodeURIComponent(m[1])); });
})();
})();
