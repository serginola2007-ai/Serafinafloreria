import { h } from './dom.js';

/** Campo con label, ayuda y mensaje de error accesibles. control: Node (input/select/textarea). */
export function field({ id, label, control, help, required }) {
  control.id = id;
  if (required) control.required = true;
  const err = h('div', { class: 'error', id: `${id}-err`, role: 'alert', hidden: true });
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, label, required && ' *'), control, help && h('div', { class: 'help', id: `${id}-help` }, help), err);
  wrap.setError = (msg) => {
    err.hidden = !msg; err.textContent = msg || '';
    wrap.classList.toggle('invalid', !!msg);
    control.setAttribute('aria-invalid', msg ? 'true' : 'false');
    control.setAttribute('aria-describedby', msg ? `${id}-err` : (help ? `${id}-help` : ''));
  };
  return wrap;
}
export const input = (props = {}) => h('input', { class: 'input', ...props });
export const select = (options, value, props = {}) => {
  const s = h('select', { class: 'select', ...props }, options.map((o) => h('option', { value: o.value }, o.label)));
  if (value !== undefined) s.value = value;
  return s;
};
export const checkbox = (label, props = {}) => h('label', { class: 'check' }, h('input', { type: 'checkbox', ...props }), label);

/** Muestra errores de validación del servidor ({details:[{field,message}]}) sobre los campos. Devuelve el mensaje general si queda. */
export function applyServerErrors(err, fields, formErrorEl) {
  Object.values(fields).forEach((f) => f.setError(''));
  let general = err.message || 'Ocurrió un error';
  const det = Array.isArray(err.details) ? err.details : [];
  let matched = 0;
  for (const d of det) if (d.field && fields[d.field]) { fields[d.field].setError(d.message); matched++; }
  if (matched && err.code === 'VALIDATION_ERROR') general = 'Revisá los campos marcados';
  if (formErrorEl) { formErrorEl.hidden = false; formErrorEl.textContent = general; }
  return general;
}

/** Deshabilita un botón y muestra spinner mientras corre la promesa. */
export async function withBusy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ' ', label);
  try { return await fn(); } finally { btn.disabled = false; btn.replaceChildren(label); }
}
