(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  function open() {
    let modal = $('premium-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-backdrop hidden premium-backdrop';
      modal.id = 'premium-modal';
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'premium-title');
      modal.innerHTML =
        '<section class="premium-modal-card"><button class="premium-close" id="premium-close" type="button" aria-label="Cerrar">×</button>' +
        '<span class="premium-eyebrow">LEXTORY PLUS · TU PRÓXIMO NIVEL</span><h2 id="premium-title">Más que leer.<br><em>Vívelo como un audiolibro.</em></h2>' +
        '<p class="premium-lead">Una experiencia diseñada para leer más, recordar mejor y escuchar de una forma más natural.</p>' +
        '<div class="premium-benefits">' +
          '<article><span>◖))</span><div><strong>Voces neuronales de IA</strong><small>Voces naturales, acentos y narración expresiva para tus libros.</small></div></article>' +
          '<article><span>♫</span><div><strong>Modo audiolibro avanzado</strong><small>Lectura continua, control de capítulos, temporizador y reproducción en segundo plano.</small></div></article>' +
          '<article><span>✦</span><div><strong>Sin anuncios</strong><small>Una experiencia limpia y sin interrupciones.</small></div></article>' +
          '<article><span>☁</span><div><strong>Aprendizaje ampliado</strong><small>Sincronización, listas, repasos inteligentes y estadísticas detalladas.</small></div></article>' +
        '</div>' +
        '<div class="premium-status"><strong>Premium está en preparación.</strong><span>Las suscripciones se activarán en Android mediante Google Play. Esta versión web no procesa pagos.</span></div>' +
        '<button id="premium-account-link" class="premium-secondary" type="button">Configurar mi cuenta y sincronización</button></section>';
      document.body.appendChild(modal);
      $('premium-close').addEventListener('click', () => modal.classList.add('hidden'));
      modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
      $('premium-account-link').addEventListener('click', () => {
        modal.classList.add('hidden'); window.LEXTORY_CLOUD?.openAccount?.();
      });
    }
    modal.classList.remove('hidden');
  }
  document.addEventListener('click', event => {
    if (event.target.closest('#premium-button')) { event.preventDefault(); open(); }
  }, true);
  window.LEXTORY_PREMIUM = { open };
})();