
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
var GOLD='#b08d57';
function $(s,c){return (c||document).querySelector(s);}
function $$(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s));}
function el(tag,cls,text){ var e=document.createElement(tag); if(cls){e.className=cls;} if(text!==undefined&&text!==null){e.textContent=String(text);} return e; }
function clear(n){ while(n&&n.firstChild){n.removeChild(n.firstChild);} }
function link(href,text){ var a=el('a',null,text); a.href=href; a.target='_blank'; a.rel='noopener'; return a; }
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
var map=null, routeLayer=null, safetyLayer=null, markers=[], trail=null, dayIdx=0, flying=false, flyTimer=null;
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
function letterIcon(l,on){return L.divIcon({className:'mk'+(on?' on':''),html:el('span',null,l),iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-14]});}
function popupNode(title,note){ var d=el('div'); d.appendChild(el('b',null,title)); if(note){ d.appendChild(el('br')); d.appendChild(el('span','pop-note',note)); } return d; }
function drawDay(){
  if(!map){return;}
  routeLayer.clearLayers(); markers=[]; if(trail){routeLayer.removeLayer(trail);trail=null;}
  D.days.forEach(function(d,i){ if(i===dayIdx){return;} d.legs.forEach(function(l){ L.polyline(l.path,{color:'#cfc5b3',weight:2,opacity:.8,interactive:false}).addTo(routeLayer); }); });
  var d=D.days[dayIdx], bounds=[]; if(!d){return;}
  d.legs.forEach(function(l){ L.polyline(l.path,{color:GOLD,weight:4,opacity:.95,dashArray:l.walk?'4 7':null}).addTo(routeLayer); l.path.forEach(function(p){bounds.push(p);}); });
  d.stops.forEach(function(s,i){
    var m=L.marker([s.lat,s.lng],{icon:letterIcon(s.letter,i===0),title:s.letter+' '+s.name,keyboard:true}).addTo(routeLayer);
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
  dayIdx=Math.max(0,Math.min(D.days.length-1,i|0)); daySel.value=dayIdx; fillSelectors(); drawDay();
  if(currentTab!=='route'){ showTab(currentTab); }
}
daySel.addEventListener('change',function(){selectDay(+daySel.value);});
stopSel.addEventListener('change',function(){showTab('pin');});
legSel.addEventListener('change',function(){showTab('dir');});

function animatePath(path,ms,done){
  if(!trail){done();return;}
  if(ms<=0||path.length<2){ path.forEach(function(p){trail.addLatLng(p);}); done(); return; }
  var n=path.length, start=null, added=0;
  function step(ts){ if(!flying){return;} if(start===null){start=ts;} var k=Math.min(1,(ts-start)/ms), want=Math.max(1,Math.round(k*n));
    while(added<want){trail.addLatLng(path[added]);added++;}
    if(k<1){requestAnimationFrame(step);}else{done();} }
  requestAnimationFrame(step);
}
function stopFly(){ flying=false; clearTimeout(flyTimer); if(flyBtn){flyBtn.disabled=false;flyBtn.textContent=t('fly','Fly route');} }
function flyRoute(){
  if(!map){return;}
  if(flying){ stopFly(); fit(); return; }
  showTab('route'); flying=true; flyBtn.textContent=t('fly_stop','Stop');
  var d=D.days[dayIdx], i=0;
  if(trail){routeLayer.removeLayer(trail);}
  trail=L.polyline([],{color:'#7a5c28',weight:6,opacity:.9}).addTo(routeLayer);
  function next(){
    if(!flying){return;}
    if(i>=d.stops.length){ stopFly(); fit(); return; }
    var s=d.stops[i], done=false;
    function arrived(){ if(done||!flying){return;} done=true; clearTimeout(flyTimer);
      markers.forEach(function(m,j){m.setIcon(letterIcon(d.stops[j].letter,j===i));});
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
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('.show-map'); if(!b){return;}
  var di=+b.getAttribute('data-day'), idx=+b.getAttribute('data-idx');
  if(di!==dayIdx){selectDay(di);}
  if(currentTab!=='route'){showTab('route');}
  if(window.innerWidth<1100&&mapc){ mapc.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'}); }
  if(idx>=0){ focusStop(idx); }
  else if(map){ var ll=[+b.getAttribute('data-lat'),+b.getAttribute('data-lng')]; map.flyTo(ll,13,{animate:!reduce});
    L.popup().setLatLng(ll).setContent(el('span',null,(b.getAttribute('data-name')||'')+' ('+(b.getAttribute('data-note')||t('optional','optional'))+')')).openOn(map); }
});

function initMap(){
  var box=$('#leaflet');
  if(!window.L){ clear(box); box.appendChild(el('p','map-fallback',t('map_fallback','The route map could not load here.'))); if(flyBtn){flyBtn.disabled=true;} return; }
  map=L.map(box,{scrollWheelZoom:false,zoomControl:true,attributionControl:true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
  routeLayer=L.layerGroup().addTo(map); safetyLayer=L.layerGroup().addTo(map);
  map.on('focus',function(){map.scrollWheelZoom.enable();}); map.on('blur',function(){map.scrollWheelZoom.disable();});
  selectDay(0);
  window.addEventListener('resize',function(){ map.invalidateSize(); });
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
function lbOpen(z){ var b=z.closest('.bento'); lbList=b?$$('[data-zoom]',b):[z]; lbI=Math.max(0,lbList.indexOf(z)); lbReturn=z; lbShow(); lb.hidden=false; document.body.style.overflow='hidden'; lb.querySelector('.lb-close').focus(); }
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
$$('details.social').forEach(function(d){ d.addEventListener('toggle',function(){ if(d.open){ fillSocial(d); if(window.railLayout){ setTimeout(window.railLayout,400); } } }); });
if('IntersectionObserver' in window){
  var sio=new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting&&window.innerWidth>=700&&root.getAttribute('data-mode')!=='print'){ en.target.open=true; sio.unobserve(en.target); } }); },{rootMargin:'600px 0px'});
  $$('details.social[data-auto-open]').forEach(function(d){ sio.observe(d); });
}
/* ---- nav state ---- */
var navLinks=$$('.topnav a:not(.tn-day)');
if('IntersectionObserver' in window){
  var io=new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting){ var id=en.target.id; navLinks.forEach(function(a){ a.classList.toggle('on',a.getAttribute('href')==='#'+id); }); } }); },{rootMargin:'-40% 0px -55% 0px'});
  $$('.layout > [id]').forEach(function(s){ io.observe(s); });
}
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
    var k=Math.min(1,Math.max(0,window.scrollY/span())); rfill.style.height=(k*100)+'%'; thumb.style.top=(k*100)+'%';
    var line=window.scrollY+window.innerHeight*0.35, cur=null, day=-1;
    marks.forEach(function(m,j){ var tg=targets[j]; if(tg&&docY(tg)<=line){ cur=m; if(m.classList.contains('day')){ day=+m.getAttribute('data-day'); } } });
    marks.forEach(function(m){ m.classList.toggle('on',m===cur); });
    tip.textContent=cur?cur.getAttribute('data-tip'):t('rail_start','Start of the guide');
    markDay(day);
  };
  window.railLayout=function(){ var h=span(); marks.forEach(function(m,j){ var tg=targets[j]; if(!tg){m.hidden=true;return;} m.style.top=(Math.min(1,Math.max(0,docY(tg)/h))*100)+'%'; }); railPaint(); };
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
/* on wide screens the sticky map follows the day you are reading */
if('IntersectionObserver' in window){
  var dio=new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting&&window.innerWidth>=1100&&!flying&&root.getAttribute('data-mode')!=='print'){ var i=+en.target.getAttribute('data-day'); if(i!==dayIdx){ selectDay(i); } } }); },{rootMargin:'-35% 0px -60% 0px'});
  $$('.day').forEach(function(d){dio.observe(d);});
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
})();
