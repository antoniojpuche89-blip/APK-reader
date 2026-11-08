(() => {
  'use strict';
  const CONFIG = window.LEXTORY_SUPABASE_CONFIG || {};
  const $ = id => document.getElementById(id);
  const VOCAB_KEY = 'lector-vocabulary-v1';
  let client = null, session = null, syncing = false, syncTimer = null, lastSyncAt = 0;
  let lastSnapshot = '', lastVocab = localStorage.getItem(VOCAB_KEY) || '[]';

  const configured = Boolean(
    window.supabase && typeof window.supabase.createClient === 'function' &&
    /^https:\/\//i.test(CONFIG.url || '') &&
    typeof CONFIG.publishableKey === 'string' &&
    CONFIG.publishableKey.length > 20 &&
    !/YOUR_|REPLACE_ME|PENDING/i.test(CONFIG.publishableKey)
  );

  function toast(text) {
    const node = $('toast');
    if (!node) return;
    node.textContent = text; node.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 3600);
  }
  function status(text, state) {
    const tag = $('dash-sync-tag'), cloud = $('cloud-sync-status');
    if (tag) {
      tag.textContent = state === 'ok' ? 'SINCRONIZADO' : state === 'busy' ? 'ACTUALIZANDO' : state === 'error' ? 'ERROR' : state === 'off' ? 'SIN CUENTA' : 'LOCAL';
      tag.dataset.state = state || 'local';
    }
    if (cloud) cloud.textContent = text;
  }
  function message(text, error) {
    const node = $('account-message');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('is-error', Boolean(error));
    node.classList.toggle('is-success', Boolean(text) && !error);
  }
  function createModal() {
    if (!$('account-modal')) {
      const modal = document.createElement('div');
      modal.className = 'modal-backdrop hidden account-backdrop';
      modal.id = 'account-modal';
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'account-title');
      modal.innerHTML =
        '<section class="account-card">' +
          '<div class="account-top"><div class="account-brand-mark">L</div><button class="account-close" id="account-close" type="button" aria-label="Cerrar">×</button></div>' +
          '<span class="account-eyebrow">TU LECTURA TE ACOMPAÑA</span><h2 id="account-title">Tu cuenta Lextory</h2>' +
          '<p class="account-intro">Sincroniza tu progreso y vocabulario entre dispositivos. Los archivos EPUB/PDF permanecen en cada dispositivo.</p>' +
          '<div class="account-config-warning" id="account-config-warning"><strong>Conexión de cuentas pendiente</strong><span>La interfaz está preparada, pero el servicio de autenticación y la base de datos aún deben conectarse y configurarse. Tus libros siguen guardados localmente.</span></div>' +
          '<div id="account-auth-panel"><div class="account-mode"><button type="button" data-account-mode="login" class="active">Iniciar sesión</button><button type="button" data-account-mode="signup">Crear cuenta</button></div>' +
            '<form id="account-form"><label for="account-email">Correo electrónico</label><input id="account-email" name="email" type="email" autocomplete="email" placeholder="tu@email.com" required>' +
            '<label for="account-password">Contraseña</label><input id="account-password" name="password" type="password" autocomplete="current-password" minlength="8" placeholder="Mínimo 8 caracteres" required>' +
            '<button id="account-submit" class="account-primary" type="submit">Entrar en mi cuenta</button></form>' +
            '<button id="account-reset" class="account-text-button" type="button">He olvidado mi contraseña</button></div>' +
          '<div id="account-user-panel" class="hidden"><div class="account-user-row"><div class="account-avatar" id="account-avatar">L</div><div><strong id="account-user-email"></strong><small>Cuenta Lextory</small></div></div>' +
            '<div class="account-sync-box"><span class="account-sync-dot"></span><div><strong id="cloud-sync-status">Preparado para sincronizar</strong><small>Progreso y vocabulario · nunca el archivo del libro</small></div></div>' +
            '<button id="account-sync-now" class="account-primary" type="button">Sincronizar ahora ↻</button><button id="account-signout" class="account-secondary" type="button">Cerrar sesión</button>' +
            '<button id="account-delete" class="account-danger" type="button">Eliminar mi cuenta y datos en la nube</button></div>' +
          '<p class="account-legal">Al crear una cuenta aceptas la <a href="./privacy.html" target="_blank" rel="noopener">Política de privacidad</a>. También puedes <a href="./delete-account.html" target="_blank" rel="noopener">eliminar tu cuenta desde la web</a>.</p>' +
          '<p class="account-message" id="account-message" role="status" aria-live="polite"></p></section>';
      document.body.appendChild(modal);
    }
    const header = document.querySelector('.app-header .header-actions');
    if (header && !$('account-button')) {
      const button = document.createElement('button');
      button.id = 'account-button'; button.type = 'button'; button.className = 'header-account-button';
      button.innerHTML = '<span class="header-account-avatar">L</span><span class="account-button-label">Iniciar sesión</span>';
      header.insertBefore(button, header.firstChild);
    }
    if (header && !$('premium-button')) {
      const button = document.createElement('button');
      button.id = 'premium-button'; button.type = 'button'; button.className = 'header-premium-button'; button.textContent = '✦ Premium';
      header.insertBefore(button, header.firstChild);
    }
  }
  function openModal() {
    $('account-modal')?.classList.remove('hidden');
    message('');
    renderAccount();
    setTimeout(() => $('account-email')?.focus(), 60);
  }
  function closeModal() { $('account-modal')?.classList.add('hidden'); }
  function setMode(mode) {
    const signup = mode === 'signup';
    document.querySelectorAll('[data-account-mode]').forEach(button => button.classList.toggle('active', button.dataset.accountMode === (signup ? 'signup' : 'login')));
    $('account-title').textContent = signup ? 'Crea tu cuenta Lextory' : 'Tu cuenta Lextory';
    $('account-submit').textContent = signup ? 'Crear cuenta gratuita' : 'Entrar en mi cuenta';
    $('account-password').autocomplete = signup ? 'new-password' : 'current-password';
    message('');
  }
  function renderAccount() {
    const logged = Boolean(session && session.user);
    $('account-auth-panel')?.classList.toggle('hidden', logged);
    $('account-user-panel')?.classList.toggle('hidden', !logged);
    $('account-config-warning')?.classList.toggle('hidden', configured);
    const button = $('account-button');
    if (button) {
      const label = button.querySelector('.account-button-label'), avatar = button.querySelector('.header-account-avatar');
      if (label) label.textContent = logged ? (session.user.email || 'Mi cuenta') : 'Iniciar sesión';
      if (avatar) avatar.textContent = logged ? String(session.user.email || 'L').slice(0, 1).toUpperCase() : 'L';
      button.title = logged ? 'Cuenta: ' + (session.user.email || '') : 'Iniciar sesión o crear una cuenta';
    }
    if (logged) {
      $('account-user-email').textContent = session.user.email || 'Cuenta Lextory';
      $('account-avatar').textContent = String(session.user.email || 'L').slice(0, 1).toUpperCase();
    }
  }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('lector-biblioteca-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function getLocalBooks(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('books', 'readonly');
      const req = tx.objectStore('books').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function saveLocalBook(db, book) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('books', 'readwrite');
      const req = tx.objectStore('books').put(book);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function fingerprint(blob) {
    const part = 1024 * 1024;
    const first = await blob.slice(0, Math.min(part, blob.size)).arrayBuffer();
    const last = blob.size > part ? await blob.slice(Math.max(part, blob.size - part)).arrayBuffer() : new ArrayBuffer(0);
    const bytes = new Uint8Array(first.byteLength + last.byteLength + 8);
    bytes.set(new Uint8Array(first), 0);
    bytes.set(new Uint8Array(last), first.byteLength);
    new DataView(bytes.buffer).setBigUint64(bytes.byteLength - 8, BigInt(blob.size), false);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return 'sha256:' + Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  }
  function readWords() {
    try { const data = JSON.parse(localStorage.getItem(VOCAB_KEY) || '[]'); return Array.isArray(data) ? data : []; }
    catch (_) { return []; }
  }
  function vocabularyIdentity(word) {
    if (typeof word === 'string') return 'text:' + word.trim().toLocaleLowerCase();
    if (!word || typeof word !== 'object') return 'raw:' + String(word);
    const original = String(word.original || word.word || word.term || '').trim().toLocaleLowerCase();
    if (!original) return 'raw:' + JSON.stringify(word);
    const translated = String(word.translated || word.translation || '').trim().toLocaleLowerCase();
    const source = String(word.source || word.sourceLanguage || '').trim().toLocaleLowerCase();
    const book = String(word.bookId || word.bookTitle || word.book || '').trim().toLocaleLowerCase();
    return [original, translated, source, book].join('|');
  }
  function mergeVocabulary(localWords, remoteWords) {
    const merged = new Map();
    for (const word of [...(Array.isArray(remoteWords) ? remoteWords : []), ...(Array.isArray(localWords) ? localWords : [])]) {
      const key = vocabularyIdentity(word);
      const previous = merged.get(key);
      if (!previous || typeof word !== 'object' || typeof previous !== 'object') {
        if (!previous) merged.set(key, word);
        continue;
      }
      const timestamp = item => {
        const value = item.updatedAt || item.savedAt || item.lastReviewed || 0;
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : (Date.parse(value) || 0);
      };
      const newest = timestamp(word) >= timestamp(previous) ? word : previous;
      const combined = { ...previous, ...word, ...newest };
      if (previous.mastery === 'known' || word.mastery === 'known') combined.mastery = 'known';
      merged.set(key, combined);
    }
    return Array.from(merged.values());
  }
  function localVocabularyTimestamp(words) {
    const stored = Number(localStorage.getItem('lector-vocabulary-updated-at') || 0);
    if (stored) return stored;
    return (words || []).reduce((max, word) => Math.max(max, Number(word.updatedAt || word.lastReviewed || word.savedAt || 0)), 0);
  }
  function paintProgress(book) {
    const card = document.querySelector('.book-card[data-book-id="' + CSS.escape(String(book.id)) + '"]');
    if (!card) return;
    const meta = card.querySelector('.book-meta'), fill = card.querySelector('.book-progress span');
    if (meta) meta.textContent = String(book.format || 'EPUB').toUpperCase() + ' · ' + (book.progress || 0) + '% leído';
    if (fill) fill.style.width = Math.max(0, Math.min(100, Number(book.progress || 0))) + '%';
  }
  async function syncNow(manual) {
    if (!configured) {
      status('La sincronización necesita conectar Supabase.', 'off');
      if (manual) message('Todavía falta configurar el servicio de cuentas. Tus datos siguen en este dispositivo.', true);
      return;
    }
    if (!session || syncing) return;
    syncing = true; status('Sincronizando progreso y vocabulario…', 'busy');
    let applyingRemote = false;
    try {
      const db = await openDatabase();
      const books = await getLocalBooks(db);
      const remoteResult = await client.from('reading_progress').select('content_hash,title,file_name,format,progress,last_page,last_cfi,total_pages,updated_at');
      if (remoteResult.error) throw remoteResult.error;
      const remoteByHash = new Map((remoteResult.data || []).map(row => [row.content_hash, row]));
      for (const original of books) {
        if (!original.blob) continue;
        const book = { ...original };
        if (!book.contentHash) {
          book.contentHash = await fingerprint(book.blob);
          await saveLocalBook(db, book);
        }
        const remote = remoteByHash.get(book.contentHash);
        const localTime = Number(book.updatedAt || book.addedAt || 0);
        const remoteTime = remote ? Date.parse(remote.updated_at || '') : 0;
        const localIsFreshImport = Number(book.progress || 0) === 0 && Number(book.lastPage || 1) <= 1 && !book.lastCfi;
        if (remote && (localIsFreshImport || remoteTime > localTime)) {
          Object.assign(book, {
            progress: Number(remote.progress || 0),
            lastPage: Number(remote.last_page || 1),
            lastCfi: remote.last_cfi || null,
            totalPages: remote.total_pages || null,
            updatedAt: remoteTime || Date.now()
          });
          applyingRemote = true;
          await saveLocalBook(db, book);
          paintProgress(book);
        } else if (!remote || localTime >= remoteTime) {
          const formatHint = String(book.format || book.fileName || book.blob.type || 'epub').toLowerCase();
          const safeFormat = formatHint.includes('pdf') ? 'pdf' : 'epub';
          const safeProgress = Math.max(0, Math.min(100, Number(book.progress || 0)));
          const safeLastPage = Math.max(1, Math.floor(Number(book.lastPage || 1)));
          const payload = {
            user_id: session.user.id,
            content_hash: book.contentHash,
            title: book.title || 'Libro',
            file_name: book.fileName || '',
            format: safeFormat,
            progress: safeProgress,
            last_page: safeLastPage,
            last_cfi: book.lastCfi || null,
            total_pages: book.totalPages ? Math.max(1, Math.floor(Number(book.totalPages))) : null,
            updated_at: new Date(Math.max(localTime, Date.now())).toISOString()
          };
          const saved = await client.from('reading_progress').upsert(payload, { onConflict: 'user_id,content_hash' });
          if (saved.error) throw saved.error;
        }
      }

      const localWords = readWords();
      const remoteStateResult = await client.from('user_learning_state').select('vocabulary,updated_at').maybeSingle();
      if (remoteStateResult.error) throw remoteStateResult.error;
      const remoteState = remoteStateResult.data;
      const remoteWords = remoteState && Array.isArray(remoteState.vocabulary) ? remoteState.vocabulary : [];
      const mergedWords = mergeVocabulary(localWords, remoteWords);
      const mergedJson = JSON.stringify(mergedWords);
      const localJson = JSON.stringify(localWords);
      const remoteJson = JSON.stringify(remoteWords);
      const localChanged = localJson !== mergedJson;
      const remoteChanged = !remoteState || remoteJson !== mergedJson;

      if (localChanged) {
        localStorage.setItem(VOCAB_KEY, mergedJson);
        lastVocab = mergedJson;
        localStorage.setItem('lector-vocabulary-updated-at', String(Date.now()));
        applyingRemote = true;
        window.dispatchEvent(new CustomEvent('lextory:cloud-vocabulary-restored'));
      } else if (remoteState) {
        localStorage.setItem('lector-vocabulary-updated-at', String(Date.parse(remoteState.updated_at || '') || Date.now()));
      }

      if (remoteChanged) {
        const statePayload = {
          user_id: session.user.id,
          vocabulary: mergedWords,
          updated_at: new Date().toISOString()
        };
        const savedState = await client.from('user_learning_state').upsert(statePayload, { onConflict: 'user_id' });
        if (savedState.error) throw savedState.error;
      }
      status('Sincronizado · ' + new Date().toLocaleTimeString('es-IE', { hour: '2-digit', minute: '2-digit' }), 'ok');
      lastSyncAt = Date.now();
      lastVocab = localStorage.getItem(VOCAB_KEY) || '[]';
      lastSnapshot = localSnapshot();
      if (manual) message('Sincronización completada. Los archivos no se han subido.', false);
    } catch (error) {
      console.error('Lextory cloud sync:', error);
      status('No se ha podido sincronizar. Reintenta más tarde.', 'error');
      if (manual) message(error.message || 'No se pudo completar la sincronización.', true);
    } finally {
      syncing = false;
    }
  }
  function localSnapshot() {
    const books = Array.from(document.querySelectorAll('.book-card')).map(card =>
      (card.dataset.bookId || '') + ':' + (card.querySelector('.book-progress span')?.style.width || '0%')
    ).join('|');
    return books + '::' + (localStorage.getItem(VOCAB_KEY) || '[]');
  }
  function scheduleSync(force) {
    if (!session || !configured || syncing) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const words = localStorage.getItem(VOCAB_KEY) || '[]';
      if (words !== lastVocab) {
        localStorage.setItem('lector-vocabulary-updated-at', String(Date.now()));
        lastVocab = words;
      }
      const snapshot = localSnapshot();
      if (force || snapshot !== lastSnapshot || Date.now() - lastSyncAt > 5 * 60 * 1000) syncNow(false);
    }, 1800);
  }
  async function submitAuth(event) {
    event.preventDefault();
    if (!configured) { message('Falta conectar y configurar el proyecto de autenticación. No hemos enviado ningún dato.', true); return; }
    const signup = document.querySelector('[data-account-mode="signup"]')?.classList.contains('active');
    const email = $('account-email').value.trim(), password = $('account-password').value;
    if (password.length < 8) return message('Usa una contraseña de al menos 8 caracteres.', true);
    const submit = $('account-submit');
    submit.disabled = true; submit.textContent = signup ? 'Creando cuenta…' : 'Entrando…';
    try {
      let result;
      if (signup) {
        result = await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
        if (result.error) throw result.error;
        message(result.data.session ? 'Cuenta creada. Sincronizando tus datos…' : 'Cuenta creada. Revisa tu correo para confirmar la dirección.');
      } else {
        result = await client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        session = result.data.session; renderAccount();
        await syncNow(false);
        message('Sesión iniciada correctamente.');
      }
    } catch (error) { message(error.message || 'No se pudo completar el acceso.', true); }
    finally { submit.disabled = false; submit.textContent = signup ? 'Crear cuenta gratuita' : 'Entrar en mi cuenta'; }
  }
  async function resetPassword() {
    if (!configured) return message('La recuperación se activará al configurar el servicio.', true);
    const email = $('account-email').value.trim();
    if (!email) return message('Escribe primero tu correo electrónico.', true);
    const result = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    message(result.error ? result.error.message : 'Te hemos enviado un enlace para restablecer tu contraseña.', Boolean(result.error));
  }
  async function deleteAccount() {
    if (!session || !configured) return;
    if (!confirm('¿Eliminar definitivamente tu cuenta y los datos de sincronización en la nube? Los archivos locales no se borrarán.')) return;
    const result = await client.functions.invoke('delete-account', { body: {} });
    if (result.error) return message(result.error.message || 'No se pudo eliminar la cuenta.', true);
    try { await client.auth.signOut(); } catch (_) {}
    session = null; renderAccount();
    status('Cuenta eliminada. Los datos locales se mantienen.', 'off');
    message('Cuenta y datos en la nube eliminados.');
  }
  function bind() {
    createModal();
    $('account-close')?.addEventListener('click', closeModal);
    $('account-modal')?.addEventListener('click', event => { if (event.target === $('account-modal')) closeModal(); });
    $('account-form')?.addEventListener('submit', submitAuth);
    $('account-reset')?.addEventListener('click', resetPassword);
    $('account-sync-now')?.addEventListener('click', () => syncNow(true));
    $('account-signout')?.addEventListener('click', async () => {
      if (!configured) return;
      await client.auth.signOut(); session = null; renderAccount(); status('Sesión cerrada.', 'off');
    });
    $('account-delete')?.addEventListener('click', deleteAccount);
    document.querySelectorAll('[data-account-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.accountMode)));
    document.addEventListener('click', event => {
      if (event.target.closest('#account-button')) openModal();
    }, true);
    const list = $('book-list'), progress = $('progress-fill'), vocab = $('vocabulary-list');
    if (list) new MutationObserver(() => scheduleSync(true)).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    if (progress) new MutationObserver(() => scheduleSync(true)).observe(progress, { attributes: true, attributeFilter: ['style'] });
    if (vocab) new MutationObserver(() => scheduleSync(true)).observe(vocab, { childList: true, subtree: true, characterData: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(); });
    setInterval(scheduleSync, 25000);
    if (!configured) {
      status('Conecta Supabase para activar la nube.', 'off');
      renderAccount();
      $('account-submit').disabled = true; $('account-reset').disabled = true;
      $('account-submit').title = 'Cuentas pendientes de configuración';
      return;
    }
    client = window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    client.auth.getSession().then(({ data }) => {
      session = data.session; renderAccount();
      if (session) syncNow(false);
      else status('Inicia sesión para activar la sincronización.', 'off');
    }).catch(error => { console.warn(error); status('No se pudo consultar la sesión.', 'error'); });
    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession; renderAccount();
      if (event === 'SIGNED_IN' && session) setTimeout(() => syncNow(false), 200);
      if (event === 'SIGNED_OUT') status('Sesión cerrada.', 'off');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
  window.LEXTORY_CLOUD = { isConfigured: () => configured, sync: () => syncNow(true), openAccount: openModal };
})();