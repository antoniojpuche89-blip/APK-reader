(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const GUTENDEX = 'https://gutendex.com/books/';
  const CACHE_PREFIX = 'lextory-catalog-v4:';
  const CACHE_TTL = 8 * 60 * 1000;
  const SOURCE_NAMES = { gutenberg: 'Project Gutenberg' };
  const LANG_NAMES = { en: 'Inglés', es: 'Español', fr: 'Francés', de: 'Alemán', it: 'Italiano', pt: 'Portugués' };
  let activeController = null;
  let searchTimer = null;
  let sequence = 0;
  let nextGutenbergUrl = null;
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
    const safe = secureUrl(url, ['gutenberg.org']);
    if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
  }

  function catalogCard(book) {
    const card = document.createElement('article');
    card.className = 'catalog-card';
    const cover = document.createElement('div');
    cover.className = 'catalog-cover cover-' + (Math.abs(String(book.id).split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % 6);
    const imageUrl = secureUrl(book.coverUrl, ['gutenberg.org']);
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
      button.textContent = 'Ver ficha en Project Gutenberg ↗';
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
    $('catalog-results').innerHTML = '<div class="catalog-loading"><div class="spinner"></div><span>Buscando en Project Gutenberg…</span></div>';
    $('catalog-result-count').textContent = 'Buscando…';
    const sourceStatus = document.querySelector('.catalog-meta span:last-child');
    if (sourceStatus) sourceStatus.textContent = 'Project Gutenberg';
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
      if (sourceStatus) sourceStatus.textContent = 'Project Gutenberg · resultados recientes';
      return;
    }
    loadingState();

    const gutParams = new URLSearchParams({ sort: 'popular' });
    if (query) gutParams.set('search', query);
    else gutParams.set('copyright', 'false');
    if (language) gutParams.set('languages', language);

    try {
      const data = await fetchJson(GUTENDEX + '?' + gutParams.toString(), controller.signal, 8500);
      if (!current()) return;
      const raw = Array.isArray(data.results) ? data.results : [];
      const books = mergeSources([raw.map(normalizeGutenberg)]);
      renderBooks(books, false);
      nextGutenbergUrl = data.next || null;
      $('catalog-more').classList.toggle('hidden', !nextGutenbergUrl);
      $('catalog-more').disabled = false;
      $('catalog-more').textContent = 'Más resultados de Gutenberg';
      $('catalog-result-count').textContent = books.length + (query ? ' resultados para «' + query + '»' : ' libros gratuitos populares');
      const sourceStatus = document.querySelector('.catalog-meta span:last-child');
      if (sourceStatus) sourceStatus.textContent = 'Project Gutenberg · conexión correcta';
      setCache(cacheKey, books, nextGutenbergUrl);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (!current()) return;
      nextGutenbergUrl = null;
      $('catalog-more').classList.add('hidden');
      const sourceStatus = document.querySelector('.catalog-meta span:last-child');
      if (sourceStatus) sourceStatus.textContent = 'Project Gutenberg no responde';
      const results = $('catalog-results');
      results.innerHTML = '<div class="catalog-empty"><strong>No hemos podido conectar con Project Gutenberg</strong><span>Comprueba tu conexión o inténtalo de nuevo.</span><button type="button" class="secondary-button" id="catalog-retry-all">Reintentar búsqueda</button></div>';
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

  function openLocalBookDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('lector-biblioteca-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir la biblioteca.'));
      request.onblocked = () => reject(new Error('La biblioteca está ocupada.'));
    });
  }

  function normaliseBookKey(value) {
    return String(value || '')
      .replace(/\.epub$/i, '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  async function findStoredBook(title, fileName) {
    const db = await openLocalBookDatabase();
    try {
      const tx = db.transaction('books', 'readonly');
      const request = tx.objectStore('books').getAll();
      const rows = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('No se pudo consultar la biblioteca.'));
      });
      const wantedTitle = normaliseBookKey(title);
      const wantedFile = normaliseBookKey(fileName);
      return rows.find(row => {
        const hasFile = row.blob && Number(row.blob.size || 0) > 0;
        if (!hasFile) return false;
        return normaliseBookKey(row.title) === wantedTitle ||
          normaliseBookKey(row.fileName) === wantedFile;
      }) || null;
    } finally {
      db.close();
    }
  }

  async function waitForStoredBook(title, fileName, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 20000);
    while (Date.now() < deadline) {
      const saved = await findStoredBook(title, fileName);
      if (saved) return saved;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    return null;
  }

  async function importGutenberg(book, button) {
    if (button.disabled) return;
    const id = Number(String(book.id).replace('gut-', ''));
    if (!Number.isSafeInteger(id) || id <= 0) {
      notify('No se ha podido identificar el EPUB de Project Gutenberg.');
      return;
    }

    const input = $('file-input');
    if (!input || typeof DataTransfer === 'undefined') {
      notify('Este navegador no permite enviar el EPUB directamente a la biblioteca. Prueba con Chrome o Edge actualizado.');
      return;
    }

    const safeTitle = (book.title || 'Libro ' + id)
      .replace(/[\\/:*?"<>|]+/g, '-').trim();
    const fileName = safeTitle + '.epub';
    const original = button.textContent;
    let imported = false;
    button.disabled = true;
    button.textContent = 'Comprobando biblioteca…';

    try {
      const existing = await findStoredBook(book.title, fileName);
      if (existing) {
        imported = true;
        button.textContent = '✓ Descargado';
        button.classList.add('is-downloaded');
        notify('«' + book.title + '» ya está guardado en Lextory.');
        return;
      }

      button.textContent = 'Descargando EPUB…';
      const base = 'https://gutenberg.pglaf.org/cache/epub/' + id + '/';
      const names = ['pg' + id + '.epub', 'pg' + id + '-images.epub'];
      let blob = null;
      for (const name of names) {
        try {
          const response = await fetch(base + name, {
            mode: 'cors', credentials: 'omit', cache: 'no-store'
          });
          if (!response.ok) continue;
          const candidate = await response.blob();
          if (candidate.size && !(candidate.type || '').includes('text/html')) {
            blob = candidate;
            break;
          }
        } catch (_) {}
      }
      if (!blob) throw new Error('Project Gutenberg no ha permitido obtener el EPUB automáticamente.');

      const file = new File([blob], fileName, {
        type: 'application/epub+zip',
        lastModified: Date.now()
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      button.textContent = 'Guardando en Lextory…';
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const saved = await waitForStoredBook(book.title, fileName, 25000);
      if (!saved) {
        throw new Error('El EPUB se ha enviado al lector, pero no se ha podido confirmar su guardado. Revisa Mi biblioteca antes de volver a descargarlo.');
      }

      imported = true;
      button.textContent = '✓ Descargado';
      button.classList.add('is-downloaded');
      window.dispatchEvent(new CustomEvent('lextory:library-updated', {
        detail: { bookId: saved.id, title: saved.title || book.title }
      }));
      notify('«' + book.title + '» descargado y guardado en tu biblioteca.');
    } catch (error) {
      notify(error && error.message ? error.message : 'No se pudo guardar el EPUB en Lextory.');
    } finally {
      if (!imported) {
        button.disabled = false;
        button.textContent = original;
      }
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
    $('page-subheading').textContent = 'Busca en Project Gutenberg y añade los EPUB disponibles directamente a tu biblioteca.';
    searchAll();
  }

  function bind() {
    const meta = document.querySelector('.catalog-meta span:last-child');
    if (meta) meta.textContent = 'Project Gutenberg';
    const intro = document.querySelector('.catalog-intro');
    if (intro) intro.textContent = 'Busca por título o autor en Project Gutenberg. Añade los EPUB disponibles directamente a tu biblioteca o utiliza los enlaces externos para importar archivos.';

    const externalSources = document.createElement('section');
    externalSources.className = 'catalog-external-sources';
    externalSources.setAttribute('aria-labelledby', 'catalog-external-title');
    externalSources.innerHTML = `
      <div class="catalog-external-top">
        <div>
          <span class="catalog-external-eyebrow">OTRAS FUENTES</span>
          <h3 id="catalog-external-title">Descargas externas</h3>
          <p>Abre una web externa, descarga el archivo en tu dispositivo y después impórtalo en Lextory.</p>
        </div>
        <span class="catalog-external-format">EPUB · PDF</span>
      </div>
      <div class="catalog-external-links">
        <a class="catalog-external-link" href="https://ww3.ebookelo.com/" target="_blank" rel="noopener noreferrer">
          <span class="catalog-external-icon">E</span>
          <span><strong>Ebookelo</strong><small>Abrir catálogo externo</small></span>
          <span class="catalog-external-arrow" aria-hidden="true">↗</span>
        </a>
        <a class="catalog-external-link" href="https://ww3.lectulandia.com/" target="_blank" rel="noopener noreferrer">
          <span class="catalog-external-icon">L</span>
          <span><strong>Lectulandia</strong><small>Abrir catálogo externo</small></span>
          <span class="catalog-external-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
      <div class="catalog-external-import">
        <span>¿Ya has descargado el libro?</span>
        <button class="catalog-open-button" id="catalog-import-external" type="button">Importar archivo descargado ↓</button>
      </div>
      <p class="catalog-external-note">Lextory no accede ni descarga contenido de estas webs. Comprueba que tienes derecho a descargar cada obra. La importación se realiza desde un archivo EPUB o PDF guardado en tu dispositivo.</p>
    `;
    const catalogIntro = document.querySelector('.catalog-intro');
    if (catalogIntro && !document.querySelector('.catalog-external-sources')) {
      catalogIntro.insertAdjacentElement('afterend', externalSources);
    }

    const input = $('catalog-search');
    if (input) input.placeholder = 'Buscar en Project Gutenberg: título o autor…';

    document.addEventListener('click', event => {
      const trigger = event.target.closest('#catalog-tab,#open-catalog-button,#featured-view-all,#home-catalog-button');
      if (trigger) {
        event.preventDefault(); event.stopImmediatePropagation(); activateCatalog(); return;
      }
      if (event.target.closest('#catalog-import-external')) {
        event.preventDefault(); event.stopImmediatePropagation();
        const fileInput = $('file-input');
        if (fileInput) fileInput.click();
        else notify('No se ha encontrado el selector de archivos.');
        return;
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
    style.textContent = '.catalog-source-pill{background:rgba(131,92,214,.19);border-color:rgba(168,129,255,.38);color:#d8c3ff}.catalog-meta span:last-child{max-width:58%;text-align:right;line-height:1.4}.catalog-card-actions{flex-wrap:wrap}.catalog-card-actions .catalog-source-link{font-size:10px}.catalog-open-button:disabled{opacity:.55;cursor:wait}.catalog-external-sources{margin:14px 0 18px;padding:16px;border:1px solid rgba(163,132,255,.3);border-radius:16px;background:linear-gradient(145deg,rgba(44,38,91,.88),rgba(20,29,59,.94));box-shadow:0 8px 24px rgba(0,0,0,.13)}.catalog-external-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.catalog-external-eyebrow{font-size:9px;font-weight:850;letter-spacing:1.4px;color:#b89aff}.catalog-external-top h3{margin:4px 0;font-size:17px;color:#fff}.catalog-external-top p{margin:0;color:#bfc5dd;font-size:11px;line-height:1.5}.catalog-external-format{flex:none;padding:6px 9px;border-radius:999px;border:1px solid rgba(180,153,255,.3);background:rgba(131,92,214,.16);color:#d8c8ff;font-size:9px;font-weight:800}.catalog-external-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:13px}.catalog-external-link{display:flex;align-items:center;gap:10px;min-width:0;padding:10px 12px;border:1px solid rgba(166,146,255,.25);border-radius:12px;background:rgba(14,22,48,.54);text-decoration:none;color:#fff;transition:border-color .18s,transform .18s}.catalog-external-link:hover{border-color:#a98bff;transform:translateY(-1px)}.catalog-external-icon{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:10px;background:linear-gradient(135deg,#8b45e9,#4d64d8);color:#fff;font-weight:900}.catalog-external-link strong,.catalog-external-link small{display:block}.catalog-external-link strong{font-size:12px}.catalog-external-link small{margin-top:3px;color:#aeb8d2;font-size:9px}.catalog-external-arrow{margin-left:auto;color:#cbb6ff;font-size:18px}.catalog-external-import{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px;padding-top:12px;border-top:1px solid rgba(170,155,220,.16);color:#dbe0f4;font-size:11px}.catalog-external-import .catalog-open-button{padding:9px 13px;border:0;border-radius:999px;background:linear-gradient(110deg,#923ff0,#5930cf);color:#fff;font-size:10px;font-weight:850;cursor:pointer}.catalog-external-note{margin:10px 0 0;color:#929ebb;font-size:9px;line-height:1.5}@media(max-width:640px){.catalog-meta span:last-child{max-width:62%;font-size:9px}.catalog-external-links{grid-template-columns:1fr}.catalog-external-sources{padding:13px}.catalog-external-import{align-items:flex-start;flex-direction:column}.catalog-external-import .catalog-open-button{width:100%}}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();