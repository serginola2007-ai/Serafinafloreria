import { h } from '../../components/dom.js';
import { field, input, select, checkbox, applyServerErrors, withBusy } from '../../components/form.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { usersApi } from '../../api/resources.js';

/** Alta y edición de usuario. roles: [{code,name,isSuperuser}] */
export function openUserForm({ user, roles, canGrantAdmin, onSaved }) {
  const editing = !!user;
  const visibleRoles = roles.filter((r) => canGrantAdmin || !r.isSuperuser || user?.role.code === r.code);
  const f = {
    fullName: field({ id: 'u-name', label: 'Nombre completo', required: true, control: input({ maxlength: 120, value: user?.fullName ?? '' }) }),
    email: field({ id: 'u-email', label: 'Correo electrónico', required: true, control: input({ type: 'email', maxlength: 254, value: user?.email ?? '', disabled: editing }), help: editing ? 'El correo no se puede cambiar.' : null }),
    roleCode: field({ id: 'u-role', label: 'Rol', required: true, control: select(visibleRoles.map((r) => ({ value: r.code, label: r.name })), user?.role.code ?? 'personalizado') }),
  };
  if (!editing) f.password = field({ id: 'u-pass', label: 'Contraseña inicial', required: true, help: 'Mínimo 12 caracteres. La persona deberá cambiarla en su primer ingreso.', control: input({ type: 'text', autocomplete: 'off', maxlength: 256 }) });
  const active = editing ? checkbox('Usuario activo', { checked: user.active }) : null;
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const val = (k) => f[k].querySelector('input,select').value;
  const save = h('button', { class: 'btn primary', type: 'button' }, editing ? 'Guardar cambios' : 'Crear usuario');
  const m = openModal({ title: editing ? 'Editar usuario' : 'Nuevo usuario', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, Object.values(f), active),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  save.addEventListener('click', async () => {
    err.hidden = true; Object.values(f).forEach((x) => x.setError(''));
    try {
      await withBusy(save, async () => {
        if (editing) {
          const body = { fullName: val('fullName').trim(), roleCode: val('roleCode') };
          if (active.querySelector('input').checked !== user.active) body.active = active.querySelector('input').checked;
          await usersApi.update(user.id, body);
        } else await usersApi.create({ email: val('email').trim(), fullName: val('fullName').trim(), roleCode: val('roleCode'), password: val('password') });
      });
      toast(editing ? 'Usuario actualizado' : 'Usuario creado'); m.close(); onSaved();
    } catch (e) {
      if (e.code === 'WEAK_PASSWORD' && f.password) f.password.setError(e.message);
      else if (e.code === 'CONFLICT') f.email.setError('Ya existe un usuario con ese correo');
      else applyServerErrors(e, f, err);
    }
  });
}

export function openResetPassword({ user, onSaved }) {
  const pw = field({ id: 'rp-pass', label: 'Nueva contraseña temporal', required: true, help: 'Se cerrarán sus sesiones y tendrá que elegir una nueva al ingresar.', control: input({ type: 'text', autocomplete: 'off', maxlength: 256 }) });
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'button' }, 'Restablecer');
  const m = openModal({ title: `Restablecer contraseña · ${user.fullName}`, content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); btn.click(); } }, err, pw),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), btn] });
  btn.addEventListener('click', async () => {
    err.hidden = true; pw.setError('');
    try { await withBusy(btn, () => usersApi.resetPassword(user.id, pw.querySelector('input').value)); toast('Contraseña restablecida'); m.close(); onSaved(); }
    catch (e) { if (e.code === 'WEAK_PASSWORD') pw.setError(e.message); else applyServerErrors(e, { password: pw }, err); }
  });
}
