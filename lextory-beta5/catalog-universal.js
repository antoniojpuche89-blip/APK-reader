(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const GUTENDEX = 'https://gutendex.com/books/';
  const GOOGLE = 'https://www.googleapis.com/books/v1/volumes';
  const OPEN_LIBRARY = 'https://openlibrary.org/search.json';
  const CACHE_PREFIX = 'lextory-catalog-v2:';
  const CACHE_TTL = 8 * 60 * 1000;
  const SOURCE_NAMES = { gutenberg: 'Project Gutenberg', google: 'Google Books', openlibrary: 'Open Library' };
  const OL_LANG = { en: 'eng', es: 'spa', fr: 'fre', de: 'ger', it: 'ita', pt: 'por' };
  const LANG_NAMES = { en: 'Inglés', es: 'Español', fr: 'Francés', de: 'Alemán', it: 'Italiano', pt: 'Portugués' };
  let activeController = null;
  let searchTimer = null;
  let sequence = 0;
  let nextGutenbergUrl = null;
  let lastOpenLibraryAt = 0;
  let activeQuery = '';
  let activeLanguage = 'en';
  let activeCacheKey = '';

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function abortError() {
    try { return new DOMException('Búsqueda cancelada', 'AbortError'); }
    catch (_) { const error = new Error('Búsqueda cancelada'); error.name = 'AbortError'; return error; }
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const timer = setTimeout(done, Math.max(0, ms));
      function done() {
        if (signal) signal.removeEventListener('abort', cancelled);
        resolve();
      }
      function cancelled() {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', cancelled, { once: true });
    });
  }

  async function fetchJson(url, parentSignal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const stop = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) throw abortError();
      parentSignal.addEventListener('abort', stop, { once: true });
    }
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs || 8500);
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Respuesta HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      if (timedOut) throw new Error('Tiempo de espera agotado');
      if (parentSignal && parentSignal.aborted) throw abortError();
      throw error;
    } finally {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', stop);
    }
  }

  async function fetchOpenLibrary(url, signal) {
    const elapsed = Date.now() - lastOpenLibraryAt;
    if (elapsed < 1050) await wait(1050 - elapsed, signal);
    if (signal.aborted) throw abortError();
    lastOpenLibraryAt = Date.now();
    return fetchJson(url, signal, 8500);
  }

  function secureUrl(value, hosts) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return '';
      const hostOk = hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      return hostOk ? url.href : '';
    } catch (_) { return ''; }
  }

  function normalizeLanguage(code) {
    const map = { eng:'en', spa:'es', fre:'fr', fra:'fr', ger:'de', deu:'de', ita:'it', por:'pt' };
    return map[code] || code;
  }

  function normalizeGutenberg(book) {
    const id = Number(book.id);
    return {
      id: 'gut-' + id,
      sourceKey: 'gutenberg',
      title: book.title || 'Sin título',
      authors: (book.authors || []).map(a => a.name).filter(Boolean),
      languages: (book.languages || []).map(normalizeLanguage),
      formats: book.formats || {},
      coverUrl: book.formats && (book.formats['image/jpeg'] || book.formats['image/png']) || '',
      sourceUrl: 'https://www.gutenberg.org/ebooks/' + encodeURIComponent(id),
      copyright: typeof book.copyright === 'boolean' ? book.copyright : null,
      downloadCount: Number(book.download_count || 0),
      publishedYear: '',
      epub: !!(book.formats && Object.keys(book.formats).some(k => k.toLowerCase().includes('epub'))),
      accessLabel: book.copyright === false ? 'Dominio público en EE. UU.' : (book.copyright === true ? 'Derechos vigentes en EE. UU.' : 'Derechos por comprobar'),
      sources: []
    };
  }

  function normalizeGoogle(item) {
    const info = item.volumeInfo || {};
    const access = item.accessInfo || {};
    const status = access.accessViewStatus || 'NONE';
    let accessLabel = 'Ficha bibliográfica';
    if (status === 'FULL_PUBLIC_DOMAIN') accessLabel = 'Texto completo de dominio público';
    else if (status === 'FULL_PURCHASED') accessLabel = 'Texto completo (compra o cuenta)';
    else if (status === 'SAMPLE' || access.viewability === 'PARTIAL') accessLabel = 'Vista previa disponible';
    else if (access.epub && access.epub.isAvailable) accessLabel = 'EPUB indicado en Google Books';
    const images = info.imageLinks || {};
    const cover = (images.extraLarge || images.large || images.medium || images.thumbnail || images.smallThumbnail || '').replace(/^http:/i, 'https:');
    const id = item.id || '';
    return {
      id: 'gbook-' + id,
      sourceKey: 'google',
      title: info.title || 'Sin título',
      authors: Array.isArray(info.authors) ? info.authors : [],
      languages: info.language ? [normalizeLanguage(info.language)] : [],
      formats: {},
      coverUrl: cover,
      sourceUrl: secureUrl(info.infoLink || item.selfLink || ('https://books.google.com/books?id=' + encodeURIComponent(id)), ['books.google.com','google.com']) || ('https://books.google.com/books?id=' + encodeURIComponent(id)),
      copyright: null,
      downloadCount: 0,
      publishedYear: info.publishedDate || '',
      epub: !!(access.epub && access.epub.isAvailable),
      accessLabel,
      accessLevel: status,
      sources: []
    };
  }

  function normalizeOpenLibrary(doc) {
    const key = String(doc.key || '');
    const cover = doc.cover_i ? 'https://covers.openlibrary.org/b/id/' + encodeURIComponent(doc.cover_i) + '-M.jpg' : '';
    const langs = Array.isArray(doc.language) ? doc.language.slice(0, 3).map(normalizeLanguage) : [];
    let accessLabel = doc.has_fulltext ? 'Texto digital indicado (puede requerir préstamo)' : (doc.public_scan_b ? 'Escaneo público indicado' : 'Ficha bibliográfica');
    return {
      id: 'ol-' + key.replace(/[^a-zA-Z0-9]/g, ''),
      sourceKey: 'openlibrary',
      title: doc.title || 'Sin título',
      authors: Array.isArray(doc.author_name) ? doc.author_name.slice(0, 3) : [],
      languages: langs,
      formats: {},
      coverUrl: cover,
      sourceUrl: key.startsWith('/works/') ? 'https://openlibrary.org' + key : 'https://openlibrary.org/search?q=' + encodeURIComponent(doc.title || ''),
      copyright: null,
      downloadCount: 0,
      publishedYear: doc.first_publish_year ? String(doc.first_publish_year) : '',
      epub: false,
      accessLabel,
      hasFullText: !!doc.has_fulltext,
      sources: []
    };
  }

  function mergeSources(groups) {
    const merged = new Map();
    groups.flat().forEach(book => {
      const title = (book.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const author = (book.authors && book.authors[0] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const key = title + '|' + author;
      const source = { key: book.sourceKey, label: SOURCE_NAMES[book.sourceKey], url: book.sourceUrl };
      const old = merged.get(key);
      if (old) {
        if (!old.sources.some(item => item.key === source.key)) old.sources.push(source);
        if (!old.coverUrl && book.coverUrl) old.coverUrl = book.coverUrl;
        if ((!old.accessLabel || old.accessLabel === 'Ficha bibliográfica') && book.accessLabel) old.accessLabel = book.accessLabel;
      } else {
        book.sources = [source];
        merged.set(key, book);
      }
    });
    return Array.from(merged.values());
  }

  function makeFallback(cover, title, author) {
    cover.innerHTML = '';
    cover.classList.remove('has-image');
    const over = document.createElement('span'); over.className = 'cover-overline'; over.textContent = 'A GOOD BOOK';
    const titleNode = document.createElement('span'); titleNode.className = 'cover-title'; titleNode.textContent = title || 'Untitled';
    const authorNode = document.createElement('span'); authorNode.className = 'cover-author'; authorNode.textContent = author || 'Autor desconocido';
    cover.append(over, titleNode, authorNode);
  }

  function openBookSource(url) {
    const safe = secureUrl(url, ['gutenberg.org','google.com','openlibrary.org']);
    if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
  }

  function catalogCard(book) {
    const card = document.createElement('article');
    card.className = 'catalog-card';
    const cover = document.createElement('div');
    cover.className = 'catalog-cover cover-' + (Math.abs(String(book.id).split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % 6);
    const imageUrl = secureUrl(book.coverUrl, ['gutenberg.org','books.google.com','googleusercontent.com','covers.openlibrary.org']);
    if (imageUrl) {
      cover.classList.add('has-image');
      const img = document.createElement('img');
      img.src = imageUrl; img.alt = 'Portada de ' + book.title; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = () => makeFallback(cover, book.title, book.authors[0] || '');
      cover.appendChild(img);
    } else makeFallback(cover, book.title, book.authors[0] || '');

    const body = document.createElement('div'); body.className = 'catalog-card-body';
    const title = document.createElement('h3'); title.textContent = book.title;
    const author = document.createElement('p'); author.className = 'catalog-author'; author.textContent = book.authors.join(', ') || 'Autor desconocido';
    const meta = document.createElement('div'); meta.className = 'catalog-book-meta';
    const language = book.languages.slice(0,2).map(code => LANG_NAMES[code] || String(code).toUpperCase()).join(' · ') || 'Idioma no indicado';
    meta.textContent = language + (book.publishedYear ? ' · ' + book.publishedYear.slice(0,4) : (book.downloadCount ? ' · ' + book.downloadCount.toLocaleString('es-IE') + ' lecturas/descargas' : ''));

    const tags = document.createElement('div'); tags.className = 'catalog-tags';
    book.sources.forEach(source => {
      const pill = document.createElement('span'); pill.className = 'catalog-tag catalog-source-pill'; pill.textContent = source.label; tags.appendChild(pill);
    });
    const access = document.createElement('span');
    access.className = 'catalog-tag ' + (book.sourceKey === 'gutenberg' && book.copyright === false ? 'tag-good' : 'tag-caution');
    access.textContent = book.accessLabel || 'Acceso por comprobar';
    tags.appendChild(access);
    if (book.epub) {
      const epub = document.createElement('span'); epub.className = 'catalog-tag'; epub.textContent = 'EPUB indicado'; tags.appendChild(epub);
    }

    const actions = document.createElement('div'); actions.className = 'catalog-card-actions';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-open-button';
    if (book.sourceKey === 'gutenberg' && book.epub) {
      button.textContent = 'Añadir EPUB al lector ↓';
      button.addEventListener('click', () => importGutenberg(book, button));
    } else {
      button.textContent = book.sourceKey === 'google' && (book.accessLevel === 'SAMPLE' || book.accessLevel === 'FULL_PUBLIC_DOMAIN') ? 'Ver libro / vista previa ↗' :
        (book.sourceKey === 'openlibrary' && book.hasFullText ? 'Comprobar lectura o préstamo ↗' : 'Ver ficha de la edición ↗');
      button.addEventListener('click', () => openBookSource(book.sourceUrl));
    }
    actions.appendChild(button);
    book.sources.filter(s => s.url && s.url !== book.sourceUrl).forEach(source => {
      const link = document.createElement('a');
      link.className = 'catalog-source-link'; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = source.label + ' ↗'; actions.appendChild(link);
    });
    const sourceLink = document.createElement('a');
    sourceLink.className = 'catalog-source-link'; sourceLink.href = book.sourceUrl; sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = 'Abrir fuente original ↗'; actions.appendChild(sourceLink);
    body.append(title, author, meta, tags, actions);
    card.append(cover, body);
    return card;
  }

  function renderBooks(books, append) {
    const results = $('catalog-results');
    if (!append) results.innerHTML = '';
    if (!books.length && !append) {
      const empty = document.createElement('div'); empty.className = 'catalog-empty';
      empty.innerHTML = '<strong>No encontramos libros</strong><span>Prueba con otro título o autor, o cambia el idioma.</span>';
      results.appendChild(empty);
      return;
    }
    books.forEach(book => results.appendChild(catalogCard(book)));
  }

  function getCache(key) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.time > CACHE_TTL || !Array.isArray(parsed.books)) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function setCache(key, books, next) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ time: Date.now(), books, next: next || null }));
    } catch (_) { /* La búsqueda sigue funcionando sin caché. */ }
  }

  function loadingState() {
    $('catalog-results').innerHTML = '<div class="catalog-loading"><div class="spinner"></div><span>Buscando en varios catálogos…</span></div>';
    $('catalog-result-count').textContent = 'Buscando…';
    const sourceStatus = document.querySelector('.catalog-meta span:last-child');
    if (sourceStatus) sourceStatus.textContent = 'Gutenberg · Google Books · Open Library';
    $('catalog-more').classList.add('hidden');
  }

  async function searchAll() {
    const query = $('catalog-search').value.trim();
    const language = $('catalog-language').value;
    const cacheKey = query.toLowerCase() + '|' + language;
    activeQuery = query; activeLanguage = language; activeCacheKey = cacheKey;
    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;
    const requestId = ++sequence;
    const current = () => requestId === sequence && !controller.signal.aborted;
    const cache = getCache(cacheKey);
    if (cache) {
      renderBooks(cache.books, false);
      nextGutenbergUrl = cache.next;
      $('catalog-result-count').textContent = cache.books.length + ' resultados guardados para «' + (query || 'libros populares') + '»';
      $('catalog-more').classList.toggle('hidden', !nextGutenbergUrl);
      const sourceStatus = document.querySelector('.catalog-meta span:last-child');
      if (sourceStatus) sourceStatus.textContent = 'Resultados recientes · actualizados hace menos de 8 min';
      return;
    }
    loadingState();

    const tasks = [];
    const names = [];
    const gutParams = new URLSearchParams({ sort: 'popular' });
    if (query) gutParams.set('search', query);
    else gutParams.set('copyright', 'false');
    if (language) gutParams.set('languages', language);
    tasks.push(fetchJson(GUTENDEX + '?' + gutParams.toString(), controller.signal, 8500)); names.push('Project Gutenberg');

    if (query) {
      const googleParams = new URLSearchParams({ q: query, maxResults: '12', printType: 'books', projection: 'lite', orderBy: 'relevance' });
      if (language) googleParams.set('langRestrict', language);
      tasks.push(fetchJson(GOOGLE + '?' + googleParams.toString(), controller.signal, 8500)); names.push('Google Books');

      const olParams = new URLSearchParams({
        q: query,
        fields: 'key,title,author_name,first_publish_year,cover_i,language,has_fulltext,public_scan_b',
        limit: '12'
      });
      if (OL_LANG[language]) olParams.set('language', OL_LANG[language]);
      tasks.push(fetchOpenLibrary(OPEN_LIBRARY + '?' + olParams.toString(), controller.signal)); names.push('Open Library');
    }

    const settled = await Promise.allSettled(tasks);
    if (!current()) return;
    const groups = [];
    const failures = [];
    let gutNext = null;
    settled.forEach((result, index) => {
      if (result.status !== 'fulfilled') { failures.push(names[index]); return; }
      const data = result.value;
      if (index === 0) {
        const raw = Array.isArray(data.results) ? data.results : [];
        groups.push(raw.map(normalizeGutenberg));
        gutNext = data.next || null;
      } else if (names[index] === 'Google Books') {
        groups.push((Array.isArray(data.items) ? data.items : []).map(normalizeGoogle));
      } else {
        groups.push((Array.isArray(data.docs) ? data.docs : []).map(normalizeOpenLibrary));
      }
    });
    const books = mergeSources(groups);
    if (!current()) return;
    renderBooks(books, false);
    nextGutenbergUrl = gutNext;
    $('catalog-more').classList.toggle('hidden', !nextGutenbergUrl);
    $('catalog-more').disabled = false;
    $('catalog-more').textContent = 'Más resultados de Gutenberg';
    $('catalog-result-count').textContent = books.length + (query ? ' resultados para «' + query + '»' : ' libros gratuitos populares');
    const sourceStatus = document.querySelector('.catalog-meta span:last-child');
    if (sourceStatus) {
      const successful = names.length - failures.length;
      sourceStatus.textContent = successful + '/' + names.length + ' catálogos respondieron' + (failures.length ? ' · Sin respuesta: ' + failures.join(', ') : '');
    }
    if (books.length || failures.length < names.length) setCache(cacheKey, books, gutNext);
    if (!books.length && failures.length === names.length) {
      const results = $('catalog-results');
      results.innerHTML = '<div class="catalog-empty"><strong>No hemos podido conectar con los catálogos</strong><span>Comprueba tu conexión o inténtalo de nuevo.</span><button type="button" class="secondary-button" id="catalog-retry-all">Reintentar búsqueda</button></div>';
      $('catalog-retry-all').addEventListener('click', searchAll);
    }
  }

  async function loadMoreGutenberg() {
    if (!nextGutenbergUrl || !activeController) return;
    const controller = activeController;
    const requestId = sequence;
    const button = $('catalog-more');
    button.disabled = true; button.textContent = 'Cargando…';
    try {
      const data = await fetchJson(nextGutenbergUrl, controller.signal, 8500);
      if (requestId !== sequence || controller.signal.aborted) return;
      const books = (Array.isArray(data.results) ? data.results : []).map(normalizeGutenberg);
      renderBooks(mergeSources([books]), true);
      nextGutenbergUrl = data.next || null;
      button.classList.toggle('hidden', !nextGutenbergUrl);
      button.textContent = 'Más resultados de Gutenberg';
    } catch (error) {
      if (error.name !== 'AbortError') notify('No se pudieron cargar más libros de Gutenberg. Prueba de nuevo.');
    } finally {
      if (requestId === sequence) button.disabled = false;
    }
  }

  async function importGutenberg(book, button) {
    if (button.disabled) return;
    const id = Number(String(book.id).replace('gut-', ''));
    if (!Number.isSafeInteger(id) || id <= 0) return openBookSource(book.sourceUrl);
    const base = 'https://gutenberg.pglaf.org/cache/epub/' + id + '/';
    const candidates = book.formats && book.formats['application/epub+zip'] || '';
    const noImages = /noimages/i.test(candidates);
    const names = noImages ? ['pg' + id + '.epub','pg' + id + '-images.epub'] : ['pg' + id + '.epub','pg' + id + '-images.epub'];
    let fallback = null;
    try { fallback = window.open('about:blank', '_blank'); } catch (_) {}
    const original = button.textContent;
    button.disabled = true; button.textContent = 'Preparando EPUB…';
    try {
      let blob = null;
      for (const name of names) {
        try {
          const response = await fetch(base + name, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
          if (!response.ok) continue;
          const candidate = await response.blob();
          if (candidate.size && !(candidate.type || '').includes('text/html')) { blob = candidate; break; }
        } catch (_) {}
      }
      if (!blob) throw new Error('El servidor no permite importar automáticamente.');
      if (fallback && !fallback.closed) fallback.close();
      const safeTitle = (book.title || 'Libro ' + id).replace(/[\\/:*?"<>|]+/g, '-').trim();
      const file = new File([blob], safeTitle + '.epub', { type: 'application/epub+zip', lastModified: Date.now() });
      const input = $('file-input');
      if (input && typeof DataTransfer !== 'undefined') {
        const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        notify('Añadiendo «' + book.title + '» a tu biblioteca…');
      } else {
        const link = document.createElement('a'); const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl; link.download = safeTitle + '.epub'; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
        notify('EPUB descargado. Impórtalo desde Mi biblioteca.');
      }
    } catch (error) {
      if (fallback && !fallback.closed) fallback.location.replace(book.sourceUrl);
      else openBookSource(book.sourceUrl);
      notify('Hemos abierto la ficha oficial de Gutenberg para descargar el EPUB.');
    } finally {
      button.disabled = false; button.textContent = original;
    }
  }

  function activateCatalog() {
    $('my-library-section').classList.add('hidden');
    $('catalog-section').classList.remove('hidden');
    $('vocabulary-section').classList.add('hidden');
    $('library-tab').classList.remove('active');
    $('catalog-tab').classList.add('active');
    $('vocab-tab').classList.remove('active');
    $('flashcards-tab')?.classList.remove('active');
    document.querySelector('.welcome-card')?.classList.add('hidden');
    $('page-heading').textContent = 'Catálogo de libros';
    $('page-subheading').textContent = 'Busca a la vez en varias bibliotecas y catálogos.';
    searchAll();
  }

  function bind() {
    const meta = document.querySelector('.catalog-meta span:last-child');
    if (meta) meta.textContent = 'Project Gutenberg · Google Books · Open Library';
    const intro = document.querySelector('.catalog-intro');
    if (intro) intro.textContent = 'Busca por título o autor en tres catálogos. Lextory indica si hay EPUB descargable, vista previa o acceso sujeto a préstamo o compra.';
    const input = $('catalog-search');
    if (input) input.placeholder = 'Buscar en 3 catálogos: título o autor…';

    document.addEventListener('click', event => {
      const trigger = event.target.closest('#catalog-tab,#open-catalog-button,#featured-view-all,#home-catalog-button');
      if (trigger) {
        event.preventDefault(); event.stopImmediatePropagation(); activateCatalog(); return;
      }
      if (event.target.closest('#clear-catalog-search')) {
        event.preventDefault(); event.stopImmediatePropagation();
        $('catalog-search').value = ''; searchAll(); return;
      }
      if (event.target.closest('#catalog-more')) {
        event.preventDefault(); event.stopImmediatePropagation(); loadMoreGutenberg(); return;
      }
    }, true);

    document.addEventListener('input', event => {
      if (!event.target || event.target.id !== 'catalog-search') return;
      event.stopImmediatePropagation();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(searchAll, 720);
    }, true);

    document.addEventListener('change', event => {
      if (!event.target || event.target.id !== 'catalog-language') return;
      event.stopImmediatePropagation(); searchAll();
    }, true);

    const style = document.createElement('style');
    style.textContent = '.catalog-source-pill{background:rgba(131,92,214,.19);border-color:rgba(168,129,255,.38);color:#d8c3ff}.catalog-meta span:last-child{max-width:58%;text-align:right;line-height:1.4}.catalog-card-actions{flex-wrap:wrap}.catalog-card-actions .catalog-source-link{font-size:10px}.catalog-open-button:disabled{opacity:.55;cursor:wait}@media(max-width:640px){.catalog-meta span:last-child{max-width:62%;font-size:9px}}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();