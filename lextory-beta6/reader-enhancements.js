(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let active = false, paused = false, chunks = [], index = 0, currentText = '';
  let timer = null, rate = 1, waitingForAutoPage = false;

  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();

  function pageText() {
    const currentPageReader = window.LEXTORY_READER?.getCurrentPageText;
    if (typeof currentPageReader === 'function') {
      try {
        // If the exact active-page range is unavailable, do not fall back to the
        // full EPUB chapter: that would start narration from the wrong place.
        return normalize(currentPageReader());
      } catch (_) {
        return '';
      }
    }
    if (!$('reader-screen') || $('reader-screen').classList.contains('hidden')) return '';
    if (!$('pdf-viewer')?.classList.contains('hidden')) {
      return normalize($('pdf-text-layer')?.innerText || $('pdf-text-layer')?.textContent || '');
    }
    const frames = $('epub-viewer')?.querySelectorAll('iframe') || [];
    return normalize(Array.from(frames).map(frame => {
      try { return frame.contentDocument?.body?.innerText || ''; }
      catch (_) { return ''; }
    }).join(' '));
  }

  function pageMarker() {
    return normalize($('page-indicator')?.textContent || '');
  }

  function makeChunks(text) {
    const sentences = (normalize(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text])
      .map(part => part.trim()).filter(Boolean);
    const result = [];
    let buffer = '';
    for (const sentence of sentences) {
      if (buffer && (buffer + ' ' + sentence).length > 170) {
        result.push(buffer);
        buffer = sentence;
      } else {
        buffer = buffer ? buffer + ' ' + sentence : sentence;
      }
    }
    if (buffer) result.push(buffer);
    return result;
  }

  function buttonState() {
    const play = $('audio-book-toggle');
    const pause = $('audio-book-pause');
    if (play) {
      play.textContent = active ? '■ Detener' : '▶ Audiolibro';
      play.title = active ? 'Detener audiolibro' : 'Empezar desde la página abierta';
    }
    if (pause) {
      pause.textContent = paused ? '▶ Continuar' : 'Ⅱ Pausar';
      pause.disabled = !active;
    }
  }

  function stop() {
    active = false;
    paused = false;
    waitingForAutoPage = false;
    chunks = [];
    index = 0;
    currentText = '';
    clearTimeout(timer);
    timer = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    buttonState();
  }

  function bestVoice(language) {
    const voices = speechSynthesis.getVoices();
    return voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase()) ||
      voices.find(voice => voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()));
  }

  function readNextChunk() {
    if (!active || paused) return;
    if (index >= chunks.length) {
      advancePage();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index++]);
    const source = $('source-language')?.value || 'en';
    utterance.lang = source === 'en' ? 'en-GB' : source;
    const voice = bestVoice(utterance.lang);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.onend = () => {
      if (active && !paused) timer = setTimeout(readNextChunk, 35);
    };
    utterance.onerror = event => {
      if (!active || paused || event.error === 'canceled' || event.error === 'interrupted') return;
      timer = setTimeout(readNextChunk, 80);
    };
    speechSynthesis.speak(utterance);
  }

  function waitForNextPage(previousText, previousMarker) {
    let attempts = 0;
    const check = () => {
      if (!active || paused) return;
      const text = pageText();
      const marker = pageMarker();
      if (text && (text !== previousText || (marker && marker !== previousMarker))) {
        waitingForAutoPage = false;
        currentText = text;
        chunks = makeChunks(text);
        index = 0;
        if (chunks.length) readNextChunk();
        else stop();
        return;
      }
      attempts++;
      if (attempts >= 24) {
        waitingForAutoPage = false;
        stop();
        return;
      }
      timer = setTimeout(check, 180);
    };
    timer = setTimeout(check, 180);
  }

  function advancePage() {
    if (!active || paused) return;
    const next = $('next-button');
    if (!next || next.disabled || $('reader-screen')?.classList.contains('hidden')) {
      stop();
      return;
    }
    const previousText = currentText;
    const previousMarker = pageMarker();
    waitingForAutoPage = true;
    next.click();
    waitForNextPage(previousText, previousMarker);
  }

  function start() {
    if (!('speechSynthesis' in window)) return;
    const text = pageText();
    if (!text) {
      toast('No se ha detectado texto en la página que tienes abierta.');
      return;
    }
    stop();
    active = true;
    paused = false;
    currentText = text;
    chunks = makeChunks(text);
    index = 0;
    buttonState();
    readNextChunk();
  }

  function toast(message) {
    const node = $('toast');
    if (node) {
      node.textContent = message;
      node.classList.add('show');
    }
  }

  function installSelectionFix() {
    if (document.getElementById('lextory-selection-zones-fix')) return;
    const style = document.createElement('style');
    style.id = 'lextory-selection-zones-fix';
    style.textContent = '.page-turn-zone{display:none!important;}';
    document.head.appendChild(style);
  }

  function bind() {
    installSelectionFix();
    const toolbar = document.querySelector('.reader-toolbar .toolbar-actions');
    if (toolbar && !$('audio-book-toggle')) {
      const play = document.createElement('button');
      play.id = 'audio-book-toggle';
      play.type = 'button';
      play.className = 'small-tool';
      play.textContent = '▶ Audiolibro';

      const pause = document.createElement('button');
      pause.id = 'audio-book-pause';
      pause.type = 'button';
      pause.className = 'small-tool';
      pause.textContent = 'Ⅱ Pausar';
      pause.disabled = true;

      const speed = document.createElement('select');
      speed.id = 'audio-book-speed';
      speed.className = 'small-tool speech-speed';
      speed.setAttribute('aria-label', 'Velocidad del audiolibro');
      speed.title = 'Velocidad del audiolibro';
      speed.innerHTML = '<option value="0.8">0,8×</option><option value="1" selected>1×</option><option value="1.15">1,15×</option><option value="1.3">1,3×</option><option value="1.5">1,5×</option><option value="1.75">1,75×</option>';

      toolbar.insertBefore(play, toolbar.firstChild);
      toolbar.insertBefore(pause, play.nextSibling);
      toolbar.insertBefore(speed, pause.nextSibling);

      play.addEventListener('click', () => active ? stop() : start());
      pause.addEventListener('click', () => {
        if (!active) return;
        paused = !paused;
        if (paused) {
          clearTimeout(timer);
          speechSynthesis.pause();
        } else {
          speechSynthesis.resume();
          if (!speechSynthesis.speaking) readNextChunk();
        }
        buttonState();
      });
      speed.addEventListener('change', () => {
        rate = Number(speed.value) || 1;
        if (active && !paused) {
          const currentIndex = Math.max(0, index - 1);
          clearTimeout(timer);
          speechSynthesis.cancel();
          index = currentIndex;
          readNextChunk();
        }
      });
    }

    // Manual page changes stop the player; pressing Play resumes from the new visible page.
    ['next-button', 'previous-button', 'tap-next', 'tap-previous',
      'immersive-next', 'immersive-previous', 'back-button', 'read-page-button']
      .forEach(id => $(id)?.addEventListener('click', () => {
        if (active && !waitingForAutoPage) stop();
      }, true));

    const indicator = $('page-indicator');
    if (indicator && !indicator.dataset.audioObserver) {
      indicator.dataset.audioObserver = '1';
      new MutationObserver(() => {
        if (!active) return;
        if (waitingForAutoPage) waitingForAutoPage = false;
        else stop();
      }).observe(indicator, { childList: true, characterData: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();