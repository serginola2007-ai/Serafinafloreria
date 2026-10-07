import { h, setChildren } from '../../components/dom.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { select, withBusy } from '../../components/form.js';
import { usersApi, rolesApi } from '../../api/resources.js';
import { skeletonRows, badge } from '../../components/states.js';
import { session } from '../../auth/session.js';

/**
 * Permisos individuales de un usuario: por cada permiso, "Según rol" / "Permitir" / "Denegar".
 * Es la forma de armar el rol Personalizado. La anti-escalada la hace el backend; acá solo se deshabilita "Permitir"
 * en lo que el operador no tiene.
 */
export async function openPermissionsEditor({ userId, onSaved }) {
  const body = h('div', {}, skeletonRows(6));
  const save = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Guardar permisos');
  const m = openModal({ title: 'Permisos del usuario', wide: true, content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar'), save] });
  let user, roles, perms;
  try { [user, roles, perms] = await Promise.all([usersApi.get(userId), rolesApi.list(), rolesApi.permissions()]); }
  catch (e) { setChildren(body, h('div', { class: 'alert err' }, e.message)); return; }

  if (user.role.isSuperuser) { setChildren(body, h('div', { class: 'alert info' }, 'El Administrador tiene todos los permisos; no admite ajustes individuales.')); return; }
  const roleBase = new Set(roles.data.find((r) => r.code === user.role.code)?.permissions ?? []);
  const selects = new Map();
  setChildren(body, h('p', { class: 'muted' }, `${user.fullName} · rol `, badge(user.role.name, 'info'), '. Elegí qué permisos agregar o quitar respecto de su rol.'),
    Object.entries(perms.modules).map(([mod, list]) => h('section', { class: 'perm-module' }, h('header', {}, mod),
      list.map((p) => {
        const sel = select([{ value: 'inherit', label: roleBase.has(p.code) ? 'Según rol (sí)' : 'Según rol (no)' }, { value: 'allow', label: 'Permitir' }, { value: 'deny', label: 'Denegar' }],
          user.overrides.allow.includes(p.code) ? 'allow' : user.overrides.deny.includes(p.code) ? 'deny' : 'inherit', { 'aria-label': p.code });
        if (!session.can(p.code) && !session.user.role.isSuperuser) sel.querySelector('option[value="allow"]').disabled = true;
        selects.set(p.code, sel);
        return h('div', { class: 'perm-row' }, h('div', {}, h('div', {}, p.description), h('div', { class: 'code mono' }, p.code)), h('div', { style: 'min-width:150px' }, sel));
      }))));
  save.disabled = false;
  save.addEventListener('click', async () => {
    const allow = [], deny = [];
    for (const [code, sel] of selects) { if (sel.value === 'allow') allow.push(code); else if (sel.value === 'deny') deny.push(code); }
    try { await withBusy(save, () => usersApi.setPermissions(userId, allow, deny)); toast('Permisos actualizados'); m.close(); onSaved(); }
    catch (e) { toast(e.message, 'err'); }
  });
}
