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
/** Cantidades con hasta 3 decimales ("1,5" o "1.5"). NaN si no es válido o no es > 0. */
export function parseQty(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(t)) return NaN;
  const n = Number(t); return n > 0 ? n : NaN;
}
export const formatQty = (n) => (Number.isFinite(n) ? n.toLocaleString('es-PY', { maximumFractionDigits: 3 }) : '—');
export const MOVEMENT_TYPES = { compra: 'Compra', venta: 'Venta', produccion: 'Producción', consumo: 'Consumo', devolucion: 'Devolución', merma: 'Merma', ajuste_positivo: 'Ajuste (+)', ajuste_negativo: 'Ajuste (−)', transferencia: 'Transferencia', uso_interno: 'Uso interno', evento: 'Evento' };
