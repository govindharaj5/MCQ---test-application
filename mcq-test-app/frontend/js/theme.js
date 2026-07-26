// ============================================================================
// theme.js — dark/light mode toggle, persisted in localStorage.
// ============================================================================

const THEME_KEY = 'mcq_theme';

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

/** Call once on every page load, as early as possible, to avoid a flash of the wrong theme. */
export function initTheme() {
  applyTheme(getPreferredTheme());
}

/** Wires up a theme-toggle button/element by id (default: 'themeToggle'). */
export function bindThemeToggle(elementId = 'themeToggle') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

initTheme();
