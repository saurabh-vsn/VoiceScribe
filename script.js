/* ═══════════════════════════════════════
   VoiceScribe · Landing Page Logic
   ═══════════════════════════════════════ */

(function () {
  // ── SCROLL REVEAL ───────────────────────
  function initReveal() {
    const els = document.querySelectorAll('[data-sr]');
    if (!els.length) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const delay = e.target.dataset.srDelay || '0ms';
          e.target.style.transitionDelay = delay;
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(el => io.observe(el));
  }

  // ── INIT ────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initReveal();
    // Note: Theme and Nav are now handled by shared.js
  });
})();