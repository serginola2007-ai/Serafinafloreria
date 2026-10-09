import { h } from '../components/dom.js';
import { field, input, withBusy, applyServerErrors } from '../components/form.js';
import { session } from './session.js';
import { authApi } from '../api/resources.js';
import { toast } from '../components/toast.js';

const brand = () => h('div', { class: 'brand' }, h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'S'),
  h('div', {}, h('div', { class: 'brand-name' }, 'Serafina'), h('div', { class: 'brand-sub' }, 'Panel de gestión')));

export function loginView({ notice, onDone }) {
  const email = field({ id: 'login-email', label: 'Correo electrónico', required: true, control: input({ type: 'email', autocomplete: 'username', maxlength: 254, autofocus: true }) });
  const pass = field({ id: 'login-pass', label: 'Contraseña', required: true, control: input({ type: 'password', autocomplete: 'current-password', maxlength: 256 }) });
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Ingresar');
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    const ev = email.querySelector('input').value.trim(); const pv = pass.querySelector('input').value;
    if (!ev || !pv) { err.hidden = false; err.textContent = 'Ingresá tu correo y contraseña'; return; }
    try { await withBusy(btn, () => session.login(ev, pv)); session.expired = false; onDone(); }
    catch (ex) { applyServerErrors(ex, {}, err); pass.querySelector('input').value = ''; pass.querySelector('input').focus(); }
  } }, err, email, pass, btn);
  return h('div', { class: 'auth-wrap' }, h('main', { class: 'auth-card' }, brand(),
    notice && h('div', { class: 'alert warn', role: 'status' }, notice), form));
}

/** Cambio de contraseña (obligatorio en el primer ingreso o voluntario desde la cuenta). */
export function passwordForm({ forced = false, onDone }) {
  const cur = field({ id: 'pw-cur', label: 'Contraseña actual', required: true, control: input({ type: 'password', autocomplete: 'current-password', maxlength: 256 }) });
  const nw = field({ id: 'pw-new', label: 'Nueva contraseña', required: true, help: 'Mínimo 12 caracteres. Evitá tu nombre, tu correo y claves comunes.', control: input({ type: 'password', autocomplete: 'new-password', maxlength: 256 }) });
  const rep = field({ id: 'pw-rep', label: 'Repetir nueva contraseña', required: true, control: input({ type: 'password', autocomplete: 'new-password', maxlength: 256 }) });
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Guardar contraseña');
  const v = (f) => f.querySelector('input').value;
  return h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true; [cur, nw, rep].forEach((f) => f.setError(''));
    if (v(nw) !== v(rep)) { rep.setError('Las contraseñas no coinciden'); return; }
    try {
      await withBusy(btn, () => authApi.changePassword(v(cur), v(nw)));
      await session.refresh(); toast('Contraseña actualizada'); onDone();
    } catch (ex) {
      if (ex.code === 'INVALID_CURRENT_PASSWORD') cur.setError(ex.message); else if (ex.code === 'WEAK_PASSWORD') nw.setError(ex.message); else applyServerErrors(ex, {}, err);
    }
  } }, forced && h('div', { class: 'alert info' }, 'Por seguridad tenés que elegir una contraseña nueva antes de continuar.'), err, cur, nw, rep, btn);
}

export function forcedPasswordView({ onDone }) {
  return h('div', { class: 'auth-wrap' }, h('main', { class: 'auth-card' }, brand(), h('h2', { style: 'margin-bottom:14px' }, 'Elegí tu contraseña'),
    passwordForm({ forced: true, onDone }),
    h('p', { class: 'small muted', style: 'margin-top:14px' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => session.logout() }, 'Cerrar sesión'))));
}
