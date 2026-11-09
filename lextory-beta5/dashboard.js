(() => {
'use strict';
const $ = id => document.getElementById(id);
const KEY = 'lector-vocabulary-v1';
let words = [], index = 0, flipped = false, filter = 'all', query = '';
let localBookRows = new Map();
const getWords = () => { try { const v=JSON.parse(localStorage.getItem(KEY)||'[]'); return Array.isArray(v)?v:[]; } catch (_) { return []; } };
const due = () => { const a=words.filter(x=>x.mastery!=='known'); return a.length?a:words; };
function updateCard(){
 const deck=due(), item=deck.length?deck[index%deck.length]:null;
 if(!item){$('dash-word').textContent='Guarda una palabra';$('dash-meaning').textContent='Tus palabras aparecerán aquí.';$('dash-meaning').classList.remove('hidden');$('dash-reveal').classList.add('hidden');$('dash-count').textContent='TU PRIMERA TARJETA';$('dash-speak').disabled=true;return;}
 $('dash-word').textContent=item.original||'—';$('dash-meaning').textContent=item.translated||'Sin traducción';$('dash-meaning').classList.toggle('hidden',!flipped);$('dash-reveal').classList.toggle('hidden',flipped);$('dash-count').textContent=(index+1)+' / '+deck.length;$('dash-speak').disabled=false;
}
function updateWeek(){
 const chart=$('dash-week');chart.innerHTML='<div class="dash-chart-empty" id="dash-week-empty">Tus avances aparecerán aquí.</div>';
 const now=new Date(),monday=new Date(now.getFullYear(),now.getMonth(),now.getDate());monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
 const labels=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
 const counts=labels.map((_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return words.filter(w=>{if(!w.savedAt)return false;const x=new Date(w.savedAt);return x.getFullYear()===d.getFullYear()&&x.getMonth()===d.getMonth()&&x.getDate()===d.getDate();}).length;});
 const max=Math.max(1,...counts),total=counts.reduce((a,b)=>a+b,0);$('dash-week-total').textContent=total;
 counts.forEach((n,i)=>{const wrap=document.createElement('div');wrap.className='dash-week-bar-wrap';const bar=document.createElement('span');bar.className='dash-week-bar';bar.style.height=Math.max(4,n/max*70)+'px';bar.title=labels[i]+': '+n;if(i===(now.getDay()+6)%7)bar.classList.add('today');wrap.appendChild(bar);chart.appendChild(wrap);});
 $('dash-week-empty').classList.toggle('hidden',total>0);
}
function refresh(){
 words=getWords();const known=words.filter(w=>w.mastery==='known').length;
 $('dash-total').textContent=words.length;$('dash-review').textContent=words.length-known;$('dash-known').textContent=known;
 if($('vocab-count'))$('vocab-count').textContent=words.length;
 if($('header-vocab-count'))$('header-vocab-count').textContent=words.length;
 if(index>=due().length)index=0;updateCard();updateWeek();if($('dash-stat-words'))$('dash-stat-words').textContent=words.length.toLocaleString('es-IE');
}
function filterBooks(){
 const list=$('book-list');if(!list)return;
 list.querySelectorAll('.book-card').forEach(card=>{
  const txt=(card.textContent||'').toLowerCase();
  const row=localBookRows.get(String(card.dataset.bookId||''));
  const savedPct=row&&Number.isFinite(Number(row.progress))?Math.max(0,Math.min(100,Number(row.progress))):null;
  const fill=card.querySelector('.book-progress span');
  let pct=savedPct!==null?savedPct:(parseFloat(fill?.style.width||'0')||0);
  pct=Math.max(0,Math.min(100,pct));
  const width=pct+'%';
  if(fill&&savedPct!==null&&fill.style.width!==width)fill.style.width=width;
  const ok=(!query||txt.includes(query))&&(filter==='all'||(filter==='reading'&&pct>0&&pct<100)||(filter==='pending'&&pct<=0)||(filter==='completed'&&pct>=100));
  card.classList.toggle('dash-filter-hidden',!ok);
  const cover=card.querySelector('.book-cover-mini');
  if(cover){
   let badge=cover.querySelector('.dash-status');
   if(!badge){badge=document.createElement('span');badge.className='dash-status';cover.appendChild(badge);}
   badge.className='dash-status'+(pct>=100?' done':pct===0?' pending':'');
   badge.textContent=pct>=100?'Completado':pct>0?'Leyendo':'Pendiente';
   const hasStoredFile=Boolean(row&&row.hasBlob&&Number(row.size||0)>0);
   let downloadBadge=cover.querySelector('.dash-download-status');
   if(hasStoredFile&&!downloadBadge){
    downloadBadge=document.createElement('span');
    downloadBadge.className='dash-download-status';
    downloadBadge.textContent='Descargado';
    cover.appendChild(downloadBadge);
   }else if(!hasStoredFile&&downloadBadge){
    downloadBadge.remove();
   }
  }
  const progress=card.querySelector('.book-progress');
  const detail=card.querySelector('.book-detail');
  if(detail&&progress){
   let label=detail.querySelector('.dash-progress-label');
   if(!label){label=document.createElement('small');label.className='dash-progress-label';progress.insertAdjacentElement('afterend',label);}
   const labelText=pct.toLocaleString('es-IE',{maximumFractionDigits:0})+'% leído';
   if(label.textContent!==labelText)label.textContent=labelText;
   label.setAttribute('aria-label',pct.toFixed(0)+' por ciento leído');
  }
 });
 const count=$('book-count');if(count)count.textContent=list.querySelectorAll('.book-card').length;
}
function initReadingStats(){
 const ACTIVITY_KEY='lextory-reading-activity-v1',DB_NAME='lector-biblioteca-v1',IDLE_MS=75000;
 let data={totalSeconds:0,days:{}},lastTick=Date.now(),lastActivity=lastTick,readerOpen=false;
 try{const saved=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'{}');data={totalSeconds:Math.max(0,Number(saved.totalSeconds)||0),days:saved.days&&typeof saved.days==='object'?saved.days:{}};}catch(_){}
 const dayKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const isOpen=()=>{const r=$('reader-screen');return Boolean(r&&!r.classList.contains('hidden'));};
 function streak(){
  let d=new Date(),cursor=new Date(d.getFullYear(),d.getMonth(),d.getDate()),count=0;
  if((Number(data.days[dayKey(cursor)])||0)<60)cursor.setDate(cursor.getDate()-1);
  while((Number(data.days[dayKey(cursor)])||0)>=60&&count<3650){count++;cursor.setDate(cursor.getDate()-1);}
  return count;
 }
 function renderTime(){
  if($('dash-stat-minutes'))$('dash-stat-minutes').textContent=Math.floor(data.totalSeconds/60).toLocaleString('es-IE');
  const s=streak();if($('dash-stat-streak'))$('dash-stat-streak').textContent=s+(s===1?' día':' días');
 }
 function updateBookStats(){
  const rows=Array.from(localBookRows.values());
  const completed=rows.filter(b=>Number(b.progress||0)>=100).length;
  const activeBooks=rows.filter(b=>Number(b.progress||0)>0&&Number(b.progress||0)<100).length;
  if($('dash-stat-books'))$('dash-stat-books').textContent=completed.toLocaleString('es-IE');
  if($('dash-stat-books-sub'))$('dash-stat-books-sub').textContent=rows.length+' en biblioteca';
  if($('dash-stats-note'))$('dash-stats-note').textContent=activeBooks+' '+(activeBooks===1?'libro en lectura':'libros en lectura')+' · Tiempo y racha registrados en este dispositivo desde esta actualización.';
 }
 function renderBooks(event){
  const summaries=event&&event.detail&&Array.isArray(event.detail.books)?event.detail.books:null;
  if(!summaries)return;
  localBookRows=new Map(summaries.map(row=>[String(row.id),row]));
  filterBooks();
  updateBookStats();
 }
 function applyProgressUpdate(event){
  const detail=event.detail||{};
  const row=localBookRows.get(String(detail.bookId||''));
  if(!row){renderBooks();return;}
  if(Number.isFinite(Number(detail.progress)))row.progress=Number(detail.progress);
  if(Number.isFinite(Number(detail.lastPage)))row.lastPage=Number(detail.lastPage);
  if(detail.updatedAt)row.updatedAt=detail.updatedAt;
  filterBooks();
  updateBookStats();
 }
 function tick(force){
  const now=Date.now(),active=(force?readerOpen:isOpen())&&!document.hidden;
  if(active){
   const start=Math.max(lastTick,lastActivity),end=Math.min(now,lastActivity+IDLE_MS),elapsed=Math.max(0,end-start);
   if(elapsed>=1000){const seconds=elapsed/1000;data.totalSeconds+=seconds;const key=dayKey(new Date());data.days[key]=(Number(data.days[key])||0)+seconds;try{localStorage.setItem(ACTIVITY_KEY,JSON.stringify(data));}catch(_){}renderTime();}
  }
  lastTick=now;
 }
 function markActivity(){if(readerOpen&&!document.hidden){tick();lastActivity=Date.now();}}
 const reader=$('reader-screen');readerOpen=isOpen();
 if(reader)new MutationObserver(()=>{const open=isOpen();if(readerOpen&&!open)tick(true);if(!readerOpen&&open){lastActivity=Date.now();lastTick=lastActivity;}readerOpen=open;}).observe(reader,{attributes:true,attributeFilter:['class']});
 document.addEventListener('pointerdown',markActivity,{passive:true,capture:true});
 document.addEventListener('keydown',markActivity,true);
 document.addEventListener('touchstart',markActivity,{passive:true,capture:true});
 document.addEventListener('wheel',markActivity,{passive:true,capture:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)tick(true);lastTick=Date.now();if(!document.hidden&&isOpen())lastActivity=lastTick;readerOpen=isOpen();});
 document.addEventListener('click',e=>{if(e.target.closest('#back-button'))tick(true);},true);
 window.addEventListener('beforeunload',()=>tick(true));
 setInterval(()=>{tick();},15000);
 window.addEventListener('lextory:library-rendered',renderBooks);
 window.addEventListener('lextory:reading-progress-updated',applyProgressUpdate);
 window.addEventListener('storage',e=>{if(e.key===ACTIVITY_KEY){try{data=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'{}');}catch(_){}renderTime();}});
 window.addEventListener('lextory:cloud-vocabulary-restored',()=>{if($('dash-stat-words'))$('dash-stat-words').textContent=getWords().length.toLocaleString('es-IE');});
 renderTime();
}
function init(){
 const lib=$('my-library-section'),main=document.querySelector('.library-main');if(!lib||!main)return;
 document.title='LEXTORY — Lee, traduce y aprende';
 const logo=document.querySelector('.sidebar-logo');if(logo)logo.src='icon.svg';
 if($('page-heading'))$('page-heading').textContent='¡Hola de nuevo!';
 if($('page-subheading'))$('page-subheading').textContent='Hoy es un buen día para leer algo nuevo.';
 const title=lib.querySelector('.section-heading h2');if(title&&title.firstChild)title.firstChild.textContent='Mi Biblioteca ';
 document.querySelector('.welcome-card')?.classList.add('dash-hide-hero');
 const hero=document.createElement('section');hero.className='dash-hero dash-stats-hero';hero.innerHTML=
  '<div class="dash-stats-heading"><div class="dash-hero-kicker"><i></i> TU UNIVERSO DE LECTURA</div><div><h2>Tu progreso, <em>en cifras.</em></h2><p>Cada página, cada palabra y cada minuto cuentan. Así avanza tu viaje lector.</p></div><img class="dash-bobby-image" src="bobby-reading.webp" alt="Bobby, el schnauzer blanco de Lextory leyendo" /></div>'+
  '<div class="dash-stat-grid">'+
   '<article class="dash-stat-card"><span class="dash-stat-icon books">▣</span><div><strong id="dash-stat-books">0</strong><small>Libros leídos</small></div><span class="dash-stat-sub" id="dash-stat-books-sub">Biblioteca</span></article>'+
   '<article class="dash-stat-card"><span class="dash-stat-icon minutes">◷</span><div><strong id="dash-stat-minutes">0</strong><small>Minutos de lectura</small></div><span class="dash-stat-sub">Tiempo activo</span></article>'+
   '<article class="dash-stat-card"><span class="dash-stat-icon streak">♨</span><div><strong id="dash-stat-streak">0 días</strong><small>Racha actual</small></div><span class="dash-stat-sub">Días consecutivos</span></article>'+
   '<article class="dash-stat-card"><span class="dash-stat-icon words">Aa</span><div><strong id="dash-stat-words">0</strong><small>Palabras guardadas</small></div><span class="dash-stat-sub">Tu vocabulario</span></article>'+
  '</div><div class="dash-stats-note" id="dash-stats-note">El tiempo y la racha empiezan a contarse desde esta actualización.</div>';
 main.insertBefore(hero,main.firstChild);
 const layout=document.createElement('div');layout.className='dash-layout';layout.id='dash-layout';
 const centre=document.createElement('div');centre.className='dash-centre';
 const aside=document.createElement('aside');aside.className='dash-aside';aside.id='dash-aside';
 main.insertBefore(layout,lib);layout.append(centre,aside);centre.appendChild(lib);
 const tools=document.createElement('div');tools.className='dash-tools';
 tools.innerHTML='<label class="dash-search"><span>⌕</span><input id="dash-search" placeholder="Buscar libros…" type="search"></label><button class="dash-grid-button" type="button" aria-label="Vista cuadrícula">▦</button>';
 const add=$('add-book-button'),catalog=$('open-catalog-button'),file=$('file-input');
 if(add){add.classList.add('dash-add');tools.appendChild(add);}if(catalog){catalog.classList.add('dash-catalog');tools.appendChild(catalog);}if(file)tools.appendChild(file);
 lib.querySelector('.section-heading')?.after(tools);
 const filters=document.createElement('div');filters.className='dash-filters';filters.innerHTML='<button class="dash-filter active" data-filter="all">Todos</button><button class="dash-filter" data-filter="reading">Leyendo</button><button class="dash-filter" data-filter="pending">Pendientes</button><button class="dash-filter" data-filter="completed">Completados</button>';
 tools.after(filters);
 aside.innerHTML='<section class="dash-panel"><header><span>▱</span><h3>Mi vocabulario</h3><button id="dash-open-vocab">›</button></header><div class="dash-metrics"><div><b id="dash-total">0</b><small>palabras</small></div><div class="review"><b id="dash-review">0</b><small>en repaso</small></div><div class="known"><b id="dash-known">0</b><small>aprendidas</small></div></div></section><section class="dash-panel"><header><span>▣</span><h3>Tarjetas de vocabulario</h3></header><p class="dash-copy">Repasa y memoriza las palabras de tus libros.</p><div class="dash-flash"><div class="dash-flash-top"><span id="dash-count">0</span><button id="dash-speak">◖))</button></div><strong id="dash-word">Guarda una palabra</strong><div id="dash-meaning" class="hidden"></div><button id="dash-reveal">Ver significado</button></div><div class="dash-arrows"><button id="dash-prev">‹</button><button id="dash-next">›</button></div><button id="dash-start-game">▶ Empezar juego</button></section><section class="dash-panel"><header><span>▥</span><h3>Estadísticas de aprendizaje</h3></header><div class="dash-week-title"><span>Palabras guardadas esta semana</span><b id="dash-week-total">0</b></div><div class="dash-week" id="dash-week"></div><div class="dash-week-days"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div></section><div class="dash-goal"><span>◎</span><div><b>Mi objetivo</b><small>30 min de lectura al día</small></div></div>';
 const nav=document.querySelector('.sidebar-nav');if(nav&&!$('dash-reader-tab')){const reader=document.createElement('button');reader.id='dash-reader-tab';reader.className='sidebar-link';reader.innerHTML='<span class="nav-icon">▯</span><span>Lectura</span>';reader.onclick=()=>document.querySelector('#book-list .open-book')?.click();nav.insertBefore(reader,$('catalog-tab'));}
 $('dash-search').oninput=e=>{query=e.target.value.toLowerCase();filterBooks();};
 filters.querySelectorAll('button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;filters.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));filterBooks();});
 $('dash-open-vocab').onclick=()=>$('vocab-tab').click();$('dash-start-game').onclick=()=>$('flashcards-tab').click();
 $('dash-reveal').onclick=()=>{flipped=true;updateCard();};
 $('dash-next').onclick=()=>{if(due().length)index=(index+1)%due().length;flipped=false;updateCard();};
 $('dash-prev').onclick=()=>{if(due().length)index=(index-1+due().length)%due().length;flipped=false;updateCard();};
 $('dash-speak').onclick=()=>{const item=due()[index];if(item&&window.speechSynthesis){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(item.original);u.lang=item.source==='es'?'es-ES':'en-GB';speechSynthesis.speak(u);}};
 const cloudPanel=document.createElement('section');cloudPanel.className='dash-panel dash-cloud-panel';cloudPanel.innerHTML='<header><span>☁</span><h3>Tu progreso en todos tus dispositivos</h3><span class="dash-panel-tag" id="dash-sync-tag">LOCAL</span></header><p class="dash-copy">Inicia sesión para sincronizar el avance de tus libros y tu vocabulario. Los archivos siguen guardados en tu dispositivo.</p><button id="dash-sync-open" class="dash-panel-action" type="button">Configurar sincronización <span>→</span></button>';
 aside.append(cloudPanel);
 $('dash-sync-open').onclick=()=>window.LEXTORY_CLOUD?.openAccount?.();
 const obs=new MutationObserver(()=>{layout.classList.toggle('hidden',lib.classList.contains('hidden'));filterBooks();});
 obs.observe(lib,{attributes:true,attributeFilter:['class']});
 const v=$('vocabulary-list');if(v)new MutationObserver(refresh).observe(v,{childList:true,subtree:true,characterData:true});
 document.addEventListener('click',e=>{if(e.target.closest('#save-vocabulary,#clear-vocabulary'))setTimeout(refresh,180);},true);
 window.addEventListener('storage',e=>{if(e.key===KEY)refresh();});
 refresh();filterBooks();initReadingStats();
}
init();
})();