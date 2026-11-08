(() => {
'use strict';
const $ = id => document.getElementById(id);
const KEY = 'lector-vocabulary-v1';
let words = [], index = 0, flipped = false, filter = 'all', query = '';
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
 if(index>=due().length)index=0;updateCard();updateWeek();
}
function filterBooks(){
 const list=$('book-list');if(!list)return;
 list.querySelectorAll('.book-card').forEach(card=>{
  const txt=(card.textContent||'').toLowerCase();
  const pct=parseFloat(card.querySelector('.book-progress span')?.style.width||'0')||0;
  const ok=(!query||txt.includes(query))&&(filter==='all'||(filter==='reading'&&pct>0&&pct<100)||(filter==='pending'&&pct<=0)||(filter==='completed'&&pct>=100));
  card.classList.toggle('dash-filter-hidden',!ok);
  const cover=card.querySelector('.book-cover-mini');
  if(cover&&!cover.querySelector('.dash-status')){const badge=document.createElement('span');badge.className='dash-status'+(pct>=100?' done':pct===0?' pending':'');badge.textContent=pct>=100?'Completado':pct>0?'Leyendo':'Pendiente';cover.appendChild(badge);}
 });
 const count=$('book-count');if(count)count.textContent=list.querySelectorAll('.book-card').length;
}
function init(){
 const lib=$('my-library-section'),main=document.querySelector('.library-main');if(!lib||!main)return;
 document.title='LEXTORY — Lee, traduce y aprende';
 const logo=document.querySelector('.sidebar-logo');if(logo)logo.src='icon.svg';
 if($('page-heading'))$('page-heading').textContent='¡Hola de nuevo!';
 if($('page-subheading'))$('page-subheading').textContent='Hoy es un buen día para leer algo nuevo.';
 const title=lib.querySelector('.section-heading h2');if(title&&title.firstChild)title.firstChild.textContent='Mi Biblioteca ';
 document.querySelector('.welcome-card')?.classList.add('dash-hide-hero');
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
 const obs=new MutationObserver(()=>{layout.classList.toggle('hidden',lib.classList.contains('hidden'));filterBooks();});
 obs.observe(lib,{attributes:true,attributeFilter:['class']});obs.observe($('book-list'),{childList:true,subtree:true});
 const v=$('vocabulary-list');if(v)new MutationObserver(refresh).observe(v,{childList:true,subtree:true,characterData:true});
 document.addEventListener('click',e=>{if(e.target.closest('#save-vocabulary,#clear-vocabulary'))setTimeout(refresh,180);},true);
 window.addEventListener('storage',e=>{if(e.key===KEY)refresh();});
 refresh();filterBooks();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();