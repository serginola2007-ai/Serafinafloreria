const KEY = 'serafina-admin-theme';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export function initTheme() {
  const saved = read();
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* modo privado */ }
}
