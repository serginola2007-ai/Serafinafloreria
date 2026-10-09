import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { rolesApi } from '../../api/resources.js';
import { skeletonRows, errorState, badge } from '../../components/states.js';
import { toast } from '../../components/toast.js';
import { withBusy } from '../../components/form.js';

export default async function mount({ view, session }) {
  const body = h('div', {}, skeletonRows(6));
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Administración' }, { label: 'Roles y permisos' }]),
    pageHead({ title: 'Roles y permisos', subtitle: 'Qué puede hacer cada rol. Los ajustes por persona se hacen desde Usuarios → Permisos.' }), body);
  let roles, perms; let selected = 'ventas';

  async function load() {
    setChildren(body, skeletonRows(6));
    try { [roles, perms] = [(await rolesApi.list()).data, await rolesApi.permissions()]; } catch (e) { setChildren(body, errorState(e.message, load)); return; }
    if (!roles.find((r) => r.code === selected)) selected = roles[0].code;
    draw();
  }
  function draw() {
    const role = roles.find((r) => r.code === selected);
    const editable = session.can('roles.edit') && !role.isSuperuser;
    const checks = new Map();
    const save = h('button', { class: 'btn primary', type: 'button', disabled: !editable }, 'Guardar permisos');
    save.addEventListener('click', async () => {
      const list = [...checks].filter(([, c]) => c.checked).map(([code]) => code);
      try { await withBusy(save, () => rolesApi.setPermissions(role.code, list)); toast('Permisos del rol actualizados'); await load(); } catch (e) { toast(e.message, 'err'); }
    });
    setChildren(body, h('div', { class: 'grid', style: 'grid-template-columns:minmax(200px,260px) 1fr;align-items:start' },
      h('nav', { class: 'card', 'aria-label': 'Roles' }, h('ul', { class: 'list' }, roles.map((r) => h('li', { style: 'padding:0' },
        h('button', { class: 'menu-item', type: 'button', 'aria-current': r.code === selected ? 'true' : null, style: `padding:12px 20px;${r.code === selected ? 'font-weight:600;background:var(--surface-2)' : ''}`, onclick: () => { selected = r.code; draw(); } },
          h('span', {}, r.name), h('span', { class: 'muted small', style: 'margin-left:auto' }, `${r.activeUsers} usr.`)))))),
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, role.name), h('div', { class: 'small muted' }, role.description)), editable && save),
        h('div', { style: 'padding:16px 20px' },
          role.isSuperuser ? h('div', { class: 'alert info' }, 'El Administrador tiene acceso total y no se puede restringir.')
            : !editable && h('div', { class: 'alert info' }, 'Tenés permiso para ver, pero no para editar roles.'),
          Object.entries(perms.modules).map(([mod, list]) => h('section', { class: 'perm-module' }, h('header', {}, mod, badge(role.isSuperuser ? `${list.length}/${list.length}` : `${list.filter((p) => role.permissions.includes(p.code)).length}/${list.length}`)),
            list.map((p) => {
              const cb = h('input', { type: 'checkbox', checked: role.isSuperuser || role.permissions.includes(p.code), disabled: !editable || (!session.user.role.isSuperuser && !session.can(p.code) && !role.permissions.includes(p.code)), 'aria-label': p.description });
              checks.set(p.code, cb);
              return h('label', { class: 'perm-row' }, h('div', {}, h('div', {}, p.description), h('div', { class: 'code mono' }, p.code)), cb);
            })))))));
  }
  await load();
}
