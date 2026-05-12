/* ═══════════════════════════════════════
   VoiceScribe · Shared Utilities
   ═══════════════════════════════════════ */

const Shared = {
  theme: {
    key: 'vs-theme',
    init() {
      const saved = localStorage.getItem(this.key) || 'dark';
      this.apply(saved);
    },
    apply(t) {
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem(this.key, t);
      
      // Update toggle buttons if they exist
      const pillIcon = document.querySelector('.theme-pill-dot');
      const pillLabel = document.querySelector('.theme-pill-label');
      if (pillIcon) pillIcon.textContent = t === 'dark' ? '🌙' : '☀️';
      if (pillLabel) pillLabel.textContent = t === 'dark' ? 'Dark' : 'Light';
      
      const btn = document.getElementById('themeBtn');
      if (btn) btn.textContent = t === 'dark' ? '🌙' : '☀️';
    },
    toggle() {
      const cur = document.documentElement.getAttribute('data-theme');
      this.apply(cur === 'dark' ? 'light' : 'dark');
    }
  },

  nav: {
    markActive() {
      const page = window.location.pathname.split('/').pop() || 'index.html';
      document.querySelectorAll('.nav-links a').forEach(a => {
        const href = a.getAttribute('href');
        if (href === page || (page === '' && href === 'index.html')) {
          a.classList.add('active');
        } else {
          a.classList.remove('active');
        }
      });
    }
  },

  ui: {
    notify(msg) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      if (this._toastTm) clearTimeout(this._toastTm);
      this._toastTm = setTimeout(() => el.classList.remove('show'), 2500);
    }
  }
};

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => {
  Shared.theme.init();
  Shared.nav.markActive();
  
  // Attach listeners to theme togglers
  const pill = document.getElementById('themePill');
  if (pill) pill.addEventListener('click', () => Shared.theme.toggle());
  
  const btn = document.getElementById('themeBtn');
  if (btn) btn.addEventListener('click', () => Shared.theme.toggle());
});
