(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let active = false, paused = false, chunks = [], index = 0, currentText = '', pageGuard = 0, timer = null, rate = 1;
  function pageText() {
    if (!$('reader-screen') || $('reader-screen').classList.contains('hidden')) return '';
    if (!$('pdf-viewer')?.classList.contains('hidden')) return ($('pdf-text-layer')?.innerText || '').replace(/\s+/g, ' ').trim();
    const frames = $('epub-viewer')?.querySelectorAll('iframe') || [];
    return Array.from(frames).map(frame => { try { return frame.contentDocument?.body?.innerText || ''; } catch (_) { return ''; } }).join(' ').replace(/\s+/g, ' ').trim();
  }
  function buttonState() {
    const play = $('audio-book-toggle'), pause = $('audio-book-pause');
    if (play) play.textContent = active ? '■ Detener' : '▶ Audiolibro';
    if (pause) { pause.textContent = paused ? '▶ Continuar' : 'Ⅱ Pausar'; pause.disabled = !active; }
  }
  function makeChunks(text) {
    const sentences = (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text]).map(part => part.trim()).filter(Boolean);
    const result = []; let buffer = '';
    for (const sentence of sentences) {
      if (buffer && (buffer + ' ' + sentence).length > 170) { result.push(buffer); buffer = sentence; }
      else buffer = buffer ? buffer + ' ' + sentence : sentence;
    }
    if (buffer) result.push(buffer);
    return result;
  }
  function stop() {
    active = false; paused = false; chunks = []; index = 0; clearTimeout(timer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    buttonState();
  }
  function bestVoice(language) {
    const voices = speechSynthesis.getVoices();
    const exact = voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase());
    return exact || voices.find(voice => voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()));
  }
  function readNextChunk() {
    if (!active || paused) return;
    if (index >= chunks.length) {
      const next = $('next-button');
      if (!next || next.disabled || $('reader-screen')?.classList.contains('hidden')) return stop();
      pageGuard++;
      if (pageGuard > 20000) return stop();
      next.click();
      let attempts = 0;
      const waitForNewPage = () => {
        if (!active || paused) return;
        const text = pageText();
        if (text && text !== currentText) {
          currentText = text; chunks = makeChunks(text); index = 0; readNextChunk(); return;
        }
        attempts++;
        if (attempts >= 12) return stop();
        timer = setTimeout(waitForNewPage, 250);
      };
      timer = setTimeout(waitForNewPage, 250);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index++]);
    const source = $('source-language')?.value || 'en';
    utterance.lang = source === 'en' ? 'en-GB' : source;
    const voice = bestVoice(utterance.lang);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.onend = () => { if (active && !paused) readNextChunk(); };
    utterance.onerror = event => {
      if (active && !paused && event.error !== 'canceled' && event.error !== 'interrupted') readNextChunk();
    };
    speechSynthesis.speak(utterance);
  }
  function start() {
    if (!('speechSynthesis' in window)) return;
    const text = pageText();
    if (!text) { toast('No se ha detectado texto para narrar en esta página.'); return; }
    stop(); active = true; paused = false; pageGuard = 0; currentText = text; chunks = makeChunks(text); index = 0;
    buttonState(); readNextChunk();
  }
  function toast(text) {
    const node = $('toast');
    if (node) { node.textContent = text; node.classList.add('show'); }
  }
  function bind() {
    const toolbar = document.querySelector('.reader-toolbar .toolbar-actions');
    if (toolbar && !$('audio-book-toggle')) {
      const play = document.createElement('button'); play.id = 'audio-book-toggle'; play.type = 'button'; play.className = 'small-tool'; play.textContent = '▶ Audiolibro';
      const pause = document.createElement('button'); pause.id = 'audio-book-pause'; pause.type = 'button'; pause.className = 'small-tool'; pause.textContent = 'Ⅱ Pausar'; pause.disabled = true;
      const speed = document.createElement('select'); speed.id = 'audio-book-speed'; speed.className = 'small-tool'; speed.setAttribute('aria-label', 'Velocidad del audiolibro');
      speed.innerHTML = '<option value="0.8">0,8×</option><option value="1" selected>1×</option><option value="1.15">1,15×</option><option value="1.3">1,3×</option><option value="1.5">1,5×</option><option value="1.75">1,75×</option>';
      toolbar.insertBefore(play, toolbar.firstChild); toolbar.insertBefore(pause, play.nextSibling); toolbar.insertBefore(speed, pause.nextSibling);
      play.addEventListener('click', () => active ? stop() : start());
      pause.addEventListener('click', () => {
        if (!active) return;
        paused = !paused;
        if (paused) speechSynthesis.pause();
        else { speechSynthesis.resume(); if (!speechSynthesis.speaking) readNextChunk(); }
        buttonState();
      });
      speed.addEventListener('change', () => {
        rate = Number(speed.value) || 1;
        if (active && !paused) {
          speechSynthesis.cancel();
          chunks = chunks.slice(Math.max(0, index - 1)); index = 0; readNextChunk();
        }
      });
    }
    $('back-button')?.addEventListener('click', stop);
    $('next-button')?.addEventListener('click', () => { if (active) { clearTimeout(timer); } });
    $('previous-button')?.addEventListener('click', stop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();