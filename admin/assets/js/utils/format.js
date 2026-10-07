/** Formato de guaraníes (enteros) y fechas en es-PY. */
export const formatGs = (n) => (Number.isSafeInteger(n) ? n.toLocaleString('es-PY') + ' Gs.' : '—');
const dtf = new Intl.DateTimeFormat('es-PY', { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('es-PY', { dateStyle: 'medium' });
export const formatDateTime = (v) => (v ? dtf.format(new Date(v)) : '—');
export const formatDate = (v) => (v ? df.format(new Date(v)) : '—');
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
/** Interpreta lo que escribe el usuario ("180000", "180.000", "180.000 Gs.") como guaraníes enteros. NaN si no es válido. */
export function parseGs(text) {
  const t = String(text ?? '').replace(/gs\.?/i, '').replace(/[.\s]/g, '');
  return /^\d{1,13}$/.test(t) ? Number(t) : NaN;
}
