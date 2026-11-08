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
  let activeTopic = '';
  let renderSequence = 0;

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

  const CATEGORY_MARKUP = "<details class=\"catalog-category-group\" open><summary>Literatura</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Adventure\" aria-pressed=\"false\">Aventuras</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"American Literature\" aria-pressed=\"false\">Literatura estadounidense</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"British Literature\" aria-pressed=\"false\">Literatura británica</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"French Literature\" aria-pressed=\"false\">Literatura francesa</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"German Literature\" aria-pressed=\"false\">Literatura alemana</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Russian Literature\" aria-pressed=\"false\">Literatura rusa</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Classics of Literature\" aria-pressed=\"false\">Clásicos de la literatura</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Biographies\" aria-pressed=\"false\">Biografías</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Novels\" aria-pressed=\"false\">Novelas</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Short Stories\" aria-pressed=\"false\">Relatos cortos</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Poetry\" aria-pressed=\"false\">Poesía</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Plays/Films/Dramas\" aria-pressed=\"false\">Teatro y dramas</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Romance\" aria-pressed=\"false\">Romance</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Science-Fiction &amp; Fantasy\" aria-pressed=\"false\">Ciencia ficción y fantasía</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Crime, Thrillers &amp; Mystery\" aria-pressed=\"false\">Misterio y suspense</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Mythology, Legends &amp; Folklore\" aria-pressed=\"false\">Mitología y folclore</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Humour\" aria-pressed=\"false\">Humor</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Children &amp; Young Adult Reading\" aria-pressed=\"false\">Infantil y juvenil</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Literature - Other\" aria-pressed=\"false\">Otros de literatura</button></div></details><details class=\"catalog-category-group\"><summary>Ciencia y tecnología</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Engineering &amp; Technology\" aria-pressed=\"false\">Ingeniería y tecnología</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Mathematics\" aria-pressed=\"false\">Matemáticas</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Science - Physics\" aria-pressed=\"false\">Física</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Science - Chemistry/Biochemistry\" aria-pressed=\"false\">Química y bioquímica</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Science - Biology\" aria-pressed=\"false\">Biología</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Science - Earth/Agricultural/Farming\" aria-pressed=\"false\">Tierra y agricultura</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Research Methods/Statistics/Information Sys\" aria-pressed=\"false\">Investigación, estadística e informática</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Environmental Issues\" aria-pressed=\"false\">Medio ambiente</button></div></details><details class=\"catalog-category-group\"><summary>Historia y arqueología</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - American\" aria-pressed=\"false\">Historia de América</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - British\" aria-pressed=\"false\">Historia británica</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - European\" aria-pressed=\"false\">Historia europea</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Ancient\" aria-pressed=\"false\">Historia antigua</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Medieval/Middle Ages\" aria-pressed=\"false\">Edad Media</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Early Modern (c. 1450-1750)\" aria-pressed=\"false\">Edad moderna temprana</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Modern (1750+)\" aria-pressed=\"false\">Historia moderna</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Religious\" aria-pressed=\"false\">Historia religiosa</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Royalty\" aria-pressed=\"false\">Monarquías</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Warfare\" aria-pressed=\"false\">Historia militar</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Schools &amp; Universities\" aria-pressed=\"false\">Escuelas y universidades</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"History - Other\" aria-pressed=\"false\">Otros de historia</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Archaeology &amp; Anthropology\" aria-pressed=\"false\">Arqueología y antropología</button></div></details><details class=\"catalog-category-group\"><summary>Sociedad y ciencias sociales</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Business/Management\" aria-pressed=\"false\">Empresa y gestión</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Economics\" aria-pressed=\"false\">Economía</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Law &amp; Criminology\" aria-pressed=\"false\">Derecho y criminología</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Gender &amp; Sexuality Studies\" aria-pressed=\"false\">Género y sexualidad</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Psychiatry/Psychology\" aria-pressed=\"false\">Psicología y psiquiatría</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Sociology\" aria-pressed=\"false\">Sociología</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Politics\" aria-pressed=\"false\">Política</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Parenthood &amp; Family Relations\" aria-pressed=\"false\">Familia y crianza</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Old Age &amp; the Elderly\" aria-pressed=\"false\">Vejez</button></div></details><details class=\"catalog-category-group\"><summary>Arte y cultura</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Art\" aria-pressed=\"false\">Arte</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Architecture\" aria-pressed=\"false\">Arquitectura</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Music\" aria-pressed=\"false\">Música</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Fashion\" aria-pressed=\"false\">Moda</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Journalism/Media/Writing\" aria-pressed=\"false\">Periodismo y escritura</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Language &amp; Communication\" aria-pressed=\"false\">Lenguaje y comunicación</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Essays, Letters &amp; Speeches\" aria-pressed=\"false\">Ensayos, cartas y discursos</button></div></details><details class=\"catalog-category-group\"><summary>Religión y filosofía</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Religion/Spirituality\" aria-pressed=\"false\">Religión y espiritualidad</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Philosophy &amp; Ethics\" aria-pressed=\"false\">Filosofía y ética</button></div></details><details class=\"catalog-category-group\"><summary>Estilo de vida y aficiones</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Cooking &amp; Drinking\" aria-pressed=\"false\">Cocina</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Sports/Hobbies\" aria-pressed=\"false\">Deportes y aficiones</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"How To ...\" aria-pressed=\"false\">Guías prácticas</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Travel Writing\" aria-pressed=\"false\">Literatura de viajes</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Nature/Gardening/Animals\" aria-pressed=\"false\">Naturaleza, jardinería y animales</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Sexuality &amp; Erotica\" aria-pressed=\"false\">Sexualidad y erotismo</button></div></details><details class=\"catalog-category-group\"><summary>Salud y medicina</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Health &amp; Medicine\" aria-pressed=\"false\">Salud y medicina</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Drugs/Alcohol/Pharmacology\" aria-pressed=\"false\">Farmacología</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Nutrition\" aria-pressed=\"false\">Nutrición</button></div></details><details class=\"catalog-category-group\"><summary>Educación y consulta</summary><div class=\"catalog-category-chips\"><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Encyclopedias/Dictionaries/Reference\" aria-pressed=\"false\">Enciclopedias y diccionarios</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Teaching &amp; Education\" aria-pressed=\"false\">Enseñanza y educación</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Reports &amp; Conference Proceedings\" aria-pressed=\"false\">Informes y congresos</button><button type=\"button\" class=\"catalog-category-chip\" data-topic=\"Journals\" aria-pressed=\"false\">Revistas académicas</button></div></details>";
  function renderCategoryPanel() {
    if (document.getElementById('catalog-category-panel')) return;
    const row = document.querySelector('.catalog-search-row');
    if (!row) return;
    const panel = document.createElement('section');
    panel.id = 'catalog-category-panel';
    panel.className = 'catalog-category-panel';
    panel.innerHTML = '<div class="catalog-category-heading"><div><strong>Explorar por categorías</strong><small>Las mismas categorías de Project Gutenberg</small></div><a href="https://www.gutenberg.org/ebooks/categories" target="_blank" rel="noopener noreferrer">Ver en Gutenberg ↗</a></div><div class="catalog-category-groups">' + CATEGORY_MARKUP + '</div>';
    row.insertAdjacentElement('afterend', panel);
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
      button.textContent = 'Descargar en Mi Biblioteca ↓';
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

  function normaliseBookKey(value) {
    return String(value || '')
      .replace(/\.(epub|pdf)$/i, '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  async function getLocalBookRows() {
    try {
      if (window.LEXTORY_BOOKS && typeof window.LEXTORY_BOOKS.getAll === 'function') {
        return await window.LEXTORY_BOOKS.getAll();
      }
      const db = await openLocalBookDatabase();
      try {
        if (!db.objectStoreNames.contains('books')) return [];
        const tx = db.transaction('books', 'readonly');
        const request = tx.objectStore('books').getAll();
        return await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || new Error('No se pudo consultar la biblioteca.'));
        });
      } finally { db.close(); }
    } catch (error) {
      console.warn('No se pudo consultar la biblioteca local:', error);
      return [];
    }
  }

  function isBookStored(book, rows) {
    const id = String(book.id || '').replace(/^gut-/, '');
    const title = normaliseBookKey(book.title);
    return rows.some(row => {
      if (!row.blob || !Number(row.blob.size || 0)) return false;
      if (row.sourceKey === 'gutenberg' && String(row.sourceId || '') === id) return true;
      return normaliseBookKey(row.title || row.fileName) === title;
    });
  }

  async function findStoredBook(book) {
    const rows = await getLocalBookRows();
    const id = String(book.id || '').replace(/^gut-/, '');
    return rows.find(row => {
      if (!row.blob || !Number(row.blob.size || 0)) return false;
      if (row.sourceKey === 'gutenberg' && String(row.sourceId || '') === id) return true;
      return normaliseBookKey(row.title || row.fileName) === normaliseBookKey(book.title);
    }) || null;
  }

  async function renderBooks(books, append) {
    const token = ++renderSequence;
    const rows = await getLocalBookRows();
    if (token !== renderSequence) return 0;
    const visible = books.filter(book => !isBookStored(book, rows));
    const results = $('catalog-results');
    if (!append) results.innerHTML = '';

    visible.forEach(book => {
      const id = String(book.id || '');
      if (results.querySelector('.catalog-card[data-source-id="' + CSS.escape(id.replace(/^gut-/, '')) + '"]')) return;
      const card = catalogCard(book);
      card.dataset.sourceId = id.replace(/^gut-/, '');
      card.dataset.bookId = id;
      results.appendChild(card);
    });

    if (!append && !results.querySelector('.catalog-card')) {
      const empty = document.createElement('div');
      empty.className = 'catalog-empty';
      empty.innerHTML = '<strong>Estos libros ya están en tu biblioteca</strong><span>En Explorar solo mostramos libros que todavía no has añadido. Busca otra categoría o título.</span>';
      results.appendChild(empty);
    }
    return results.querySelectorAll('.catalog-card').length;
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
    const cacheKey = query.toLowerCase() + '|' + language + '|' + activeTopic;
    activeQuery = query; activeLanguage = language; activeCacheKey = cacheKey;
    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;
    const requestId = ++sequence;
    const current = () => requestId === sequence && !controller.signal.aborted;
    const cache = getCache(cacheKey);
    if (cache) {
      const visibleCount = await renderBooks(cache.books, false);
      nextGutenbergUrl = cache.next;
      $('catalog-result-count').textContent = visibleCount + (activeTopic ? ' libros de ' + activeTopic : query ? ' resultados para «' + query + '»' : ' libros populares');
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
    if (activeTopic) gutParams.set('topic', activeTopic);
    gutParams.set('mime_type', 'application/epub+zip');

    try {
      const data = await fetchJson(GUTENDEX + '?' + gutParams.toString(), controller.signal, 8500);
      if (!current()) return;
      const raw = Array.isArray(data.results) ? data.results : [];
      const books = mergeSources([raw.map(normalizeGutenberg)]);
      const visibleCount = await renderBooks(books, false);
      nextGutenbergUrl = data.next || null;
      $('catalog-more').classList.toggle('hidden', !nextGutenbergUrl);
      $('catalog-more').disabled = false;
      $('catalog-more').textContent = 'Más resultados de Gutenberg';
      $('catalog-result-count').textContent = visibleCount + (activeTopic ? ' libros en ' + activeTopic : query ? ' resultados para «' + query + '»' : ' libros populares');
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
      const visibleCount = await renderBooks(mergeSources([books]), true);
      $('catalog-result-count').textContent = visibleCount + ' libros disponibles para explorar';
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
    const importFile = window.LEXTORY_BOOKS && window.LEXTORY_BOOKS.importFile;
    if (typeof importFile !== 'function') {
      notify('La biblioteca todavía se está iniciando. Espera un momento y vuelve a intentarlo.');
      return;
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Comprobando biblioteca…';
    try {
      const existing = await findStoredBook(book);
      if (existing) {
        button.textContent = '✓ Descargado';
        button.classList.add('is-downloaded');
        button.closest('.catalog-card')?.remove();
        notify('«' + book.title + '» ya está guardado en Mi Biblioteca.');
        return;
      }

      const safeTitle = (book.title || 'Libro ' + id).replace(/[\\/:*?"<>|]+/g, '-').trim();
      const fileName = safeTitle + '.epub';
      const urls = [];
      const official = book.formats && book.formats['application/epub+zip'];
      if (official) urls.push(official);
      const mirror = 'https://gutenberg.pglaf.org/cache/epub/' + id + '/';
      urls.push(mirror + 'pg' + id + '.epub', mirror + 'pg' + id + '-images.epub');

      button.textContent = 'Descargando EPUB…';
      let blob = null, lastError = null;
      for (const url of [...new Set(urls)]) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 35000);
          let response;
          try {
            response = await fetch(url, {
              method: 'GET',
              mode: 'cors',
              credentials: 'omit',
              cache: 'no-store',
              signal: controller.signal,
              headers: { Accept: 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.8' }
            });
          } finally { clearTimeout(timeout); }

          if (!response.ok) throw new Error('Respuesta HTTP ' + response.status);
          const candidate = await response.blob();
          if (!candidate.size || (candidate.type || '').toLowerCase().includes('text/html')) {
            throw new Error('El servidor devolvió una página web, no un EPUB.');
          }
          const signature = new Uint8Array(await candidate.slice(0, 4).arrayBuffer());
          if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
            throw new Error('El archivo recibido no tiene formato EPUB/ZIP.');
          }
          blob = candidate;
          break;
        } catch (error) {
          lastError = error;
          console.warn('No se pudo descargar desde una fuente EPUB:', url, error);
        }
      }

      if (!blob) {
        const detail = lastError && lastError.message ? ' (' + lastError.message + ')' : '';
        throw new Error('No se pudo descargar este EPUB directamente de Project Gutenberg' + detail + '.');
      }

      const file = new File([blob], fileName, {
        type: 'application/epub+zip',
        lastModified: Date.now()
      });
      button.textContent = 'Guardando en Mi Biblioteca…';
      const saved = await importFile(file, {
        title: book.title,
        sourceKey: 'gutenberg',
        sourceId: String(id)
      }, { openReader: false });

      if (!saved || !saved.blob || !Number(saved.blob.size || 0)) {
        throw new Error('Lextory no confirmó el guardado del archivo. Comprueba el espacio disponible e inténtalo de nuevo.');
      }

      button.textContent = '✓ Descargado';
      button.classList.add('is-downloaded');
      button.closest('.catalog-card')?.remove();
      const count = $('catalog-result-count');
      const remaining = $('catalog-results')?.querySelectorAll('.catalog-card').length || 0;
      if (count) count.textContent = remaining + (remaining === 1 ? ' libro disponible para explorar' : ' libros disponibles para explorar');
      if (!remaining) {
        const empty = document.createElement('div');
        empty.className = 'catalog-empty';
        empty.innerHTML = '<strong>¡Todo añadido!</strong><span>Los libros descargados están en Mi Biblioteca. Elige otra categoría para seguir explorando.</span>';
        $('catalog-results')?.appendChild(empty);
      }
      notify('«' + book.title + '» descargado y guardado en Mi Biblioteca.');
    } catch (error) {
      console.error('Error al incorporar un libro de Gutenberg:', error);
      button.disabled = false;
      button.textContent = original;
      notify(error && error.message ? error.message : 'No se pudo guardar el EPUB en Lextory.');
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
    if (intro) intro.textContent = 'Busca libros por título, autor o categoría. Descarga los EPUB directamente en tu biblioteca personal.';
    renderCategoryPanel();

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
      const category = event.target.closest('.catalog-category-chip');
      if (category) {
        event.preventDefault(); event.stopImmediatePropagation();
        const topic = category.dataset.topic || '';
        activeTopic = activeTopic === topic ? '' : topic;
        document.querySelectorAll('.catalog-category-chip').forEach(chip => {
          const selected = chip.dataset.topic === activeTopic;
          chip.classList.toggle('active', selected);
          chip.setAttribute('aria-pressed', String(selected));
        });
        searchAll();
        return;
      }
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

    window.addEventListener('lextory:library-updated', () => {
      if (!$('catalog-section')?.classList.contains('hidden')) searchAll();
    });

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
    style.textContent = '.catalog-category-panel{margin:14px 0 17px;padding:14px 15px;border:1px solid rgba(163,132,255,.24);border-radius:15px;background:rgba(25,31,62,.62)}.catalog-category-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.catalog-category-heading strong,.catalog-category-heading small{display:block}.catalog-category-heading strong{font-size:12px;color:#f1edff}.catalog-category-heading small{margin-top:3px;font-size:9px;color:#aeb8d2}.catalog-category-heading a{font-size:9px;font-weight:800;color:#c6acff;text-decoration:none}.catalog-category-group{padding:7px 0;border-top:1px solid rgba(160,150,205,.12)}.catalog-category-group summary{cursor:pointer;color:#ded7f5;font-size:10px;font-weight:850;list-style:none}.catalog-category-group summary::-webkit-details-marker{display:none}.catalog-category-group summary:after{content:"＋";float:right;color:#b9a1f1}.catalog-category-group[open] summary:after{content:"−"}.catalog-category-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.catalog-category-chip{padding:6px 9px;border:1px solid rgba(164,145,220,.22);border-radius:999px;background:rgba(255,255,255,.035);color:#cfd1e8;font-size:9px;font-weight:700}.catalog-category-chip.active{background:#6846c7;border-color:#9879ed;color:#fff}.catalog-open-button:disabled{opacity:.55;cursor:wait}.catalog-open-button.is-downloaded{background:#176b50;color:#fff}.catalog-source-pill{background:rgba(131,92,214,.19);border-color:rgba(168,129,255,.38);color:#d8c3ff}.catalog-meta span:last-child{max-width:58%;text-align:right;line-height:1.4}.catalog-card-actions{flex-wrap:wrap}.catalog-card-actions .catalog-source-link{font-size:10px}.catalog-open-button:disabled{opacity:.55;cursor:wait}.catalog-external-sources{margin:14px 0 18px;padding:16px;border:1px solid rgba(163,132,255,.3);border-radius:16px;background:linear-gradient(145deg,rgba(44,38,91,.88),rgba(20,29,59,.94));box-shadow:0 8px 24px rgba(0,0,0,.13)}.catalog-external-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.catalog-external-eyebrow{font-size:9px;font-weight:850;letter-spacing:1.4px;color:#b89aff}.catalog-external-top h3{margin:4px 0;font-size:17px;color:#fff}.catalog-external-top p{margin:0;color:#bfc5dd;font-size:11px;line-height:1.5}.catalog-external-format{flex:none;padding:6px 9px;border-radius:999px;border:1px solid rgba(180,153,255,.3);background:rgba(131,92,214,.16);color:#d8c8ff;font-size:9px;font-weight:800}.catalog-external-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:13px}.catalog-external-link{display:flex;align-items:center;gap:10px;min-width:0;padding:10px 12px;border:1px solid rgba(166,146,255,.25);border-radius:12px;background:rgba(14,22,48,.54);text-decoration:none;color:#fff;transition:border-color .18s,transform .18s}.catalog-external-link:hover{border-color:#a98bff;transform:translateY(-1px)}.catalog-external-icon{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:10px;background:linear-gradient(135deg,#8b45e9,#4d64d8);color:#fff;font-weight:900}.catalog-external-link strong,.catalog-external-link small{display:block}.catalog-external-link strong{font-size:12px}.catalog-external-link small{margin-top:3px;color:#aeb8d2;font-size:9px}.catalog-external-arrow{margin-left:auto;color:#cbb6ff;font-size:18px}.catalog-external-import{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px;padding-top:12px;border-top:1px solid rgba(170,155,220,.16);color:#dbe0f4;font-size:11px}.catalog-external-import .catalog-open-button{padding:9px 13px;border:0;border-radius:999px;background:linear-gradient(110deg,#923ff0,#5930cf);color:#fff;font-size:10px;font-weight:850;cursor:pointer}.catalog-external-note{margin:10px 0 0;color:#929ebb;font-size:9px;line-height:1.5}@media(max-width:640px){.catalog-meta span:last-child{max-width:62%;font-size:9px}.catalog-external-links{grid-template-columns:1fr}.catalog-external-sources{padding:13px}.catalog-external-import{align-items:flex-start;flex-direction:column}.catalog-external-import .catalog-open-button{width:100%}}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();