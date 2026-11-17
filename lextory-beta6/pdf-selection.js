(() => {
  'use strict';

  function selectWordAtPoint(doc, x, y, layer) {
    try {
      let caret = typeof doc.caretRangeFromPoint === 'function' ? doc.caretRangeFromPoint(x, y) : null;
      if (!caret && typeof doc.caretPositionFromPoint === 'function') {
        const point = doc.caretPositionFromPoint(x, y);
        if (point) {
          caret = doc.createRange();
          caret.setStart(point.offsetNode, point.offset);
          caret.collapse(true);
        }
      }
      if (!caret || caret.startContainer.nodeType !== 3 || !layer.contains(caret.startContainer)) return '';

      const walker = doc.createTreeWalker(layer, doc.defaultView.NodeFilter.SHOW_TEXT);
      const segments = [];
      let text = '';
      let lastRect = null;
      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue || '';
        if (!value) continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (lastRect && rect.width > 0 && rect.height > 0) {
          const fontSize = parseFloat(doc.defaultView.getComputedStyle(node.parentElement).fontSize) || 12;
          if (Math.abs(rect.top - lastRect.top) > Math.max(3, fontSize * 0.55)) text += '\n';
          else if (rect.left - lastRect.right > Math.max(2, fontSize * 0.28)) text += ' ';
        }
        const start = text.length;
        text += value;
        segments.push({ node, start, end: text.length });
        if (rect.width > 0 && rect.height > 0) lastRect = rect;
      }

      const hit = segments.find(part => part.node === caret.startContainer);
      if (!hit) return '';
      let index = Math.min(hit.start + caret.startOffset, hit.end - 1);
      const isWord = char => !!char && /[\p{L}\p{M}\p{N}'’\-]/u.test(char);
      if (!isWord(text[index]) && index > hit.start && isWord(text[index - 1])) index--;
      else if (!isWord(text[index]) && isWord(text[index + 1])) index++;
      if (!isWord(text[index])) return '';

      let start = index, end = index + 1;
      while (start > 0 && isWord(text[start - 1])) start--;
      while (end < text.length && isWord(text[end])) end++;
      const first = segments.find(part => start >= part.start && start < part.end);
      const last = segments.find(part => end > part.start && end <= part.end);
      if (!first || !last) return '';

      const range = doc.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      const word = range.toString().replace(/\s+/g, ' ').trim();
      if (!word) return '';
      const selection = doc.defaultView.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return word;
    } catch (error) {
      console.debug('No se pudo seleccionar la palabra del PDF:', error);
      return '';
    }
  }

  function bind() {
    const reader = document.getElementById('reader-screen');
    const viewer = document.getElementById('pdf-viewer');
    const layer = document.getElementById('pdf-text-layer');
    if (!reader || !viewer || !layer) return false;

    const style = document.createElement('style');
    style.textContent = '.reader-screen.pdf-reading .page-turn-zone{display:none!important;pointer-events:none!important}.reader-screen.pdf-reading .pdf-viewer .textLayer{z-index:2}';
    document.head.appendChild(style);

    const updateMode = () => reader.classList.toggle('pdf-reading', !viewer.classList.contains('hidden'));
    updateMode();
    new MutationObserver(updateMode).observe(viewer, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('pointerdown', event => {
      if (!layer.contains(event.target) || event.button !== 0) return;
      window.getSelection()?.removeAllRanges();
      document.getElementById('selection-bar')?.classList.add('hidden');
    }, true);

    document.addEventListener('click', event => {
      if (!layer.contains(event.target)) return;
      const current = window.getSelection()?.toString().trim();
      if (current) return; // Keep a phrase selected manually by dragging.
      const word = selectWordAtPoint(document, event.clientX, event.clientY, layer);
      if (!word) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent('lextory:pdf-word-selected', { detail: word }));
    }, true);
    return true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
