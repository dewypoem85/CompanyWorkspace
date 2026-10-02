(function () {
  'use strict';

  const STORAGE_KEY = 'company-ui-theme';
  const OPTIONS = new Set(['system', 'light', 'dark']);
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function preference() {
    if (window.CompanyWorkspace) return window.CompanyWorkspace.preference();
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return OPTIONS.has(value) ? value : 'system';
    } catch {
      return 'system';
    }
  }

  function apply(value) {
    const selected = OPTIONS.has(value) ? value : 'system';
    const resolved = selected === 'system' ? (media.matches ? 'dark' : 'light') : selected;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = selected;
    document.documentElement.style.colorScheme = resolved;
    document.querySelectorAll('[data-theme-select]').forEach((select) => { select.value = selected; });
  }

  function save(value) {
    if (window.CompanyWorkspace) {
      window.CompanyWorkspace.saveTheme(value);
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage may be unavailable */ }
    apply(value);
  }

  apply(preference());
  media.addEventListener?.('change', () => {
    if (preference() === 'system') apply('system');
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-select]').forEach((select) => {
      select.value = preference();
      select.addEventListener('change', (event) => save(event.target.value));
    });
  });
})();
