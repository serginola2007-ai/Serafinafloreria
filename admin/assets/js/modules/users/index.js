import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { confirmDialog } from '../../components/confirm.js';
import { toast } from '../../components/toast.js';
import { icon } from '../../components/icons.js';
import { usersApi, rolesApi } from '../../api/resources.js';
import { formatDateTime, debounce } from '../../utils/format.js';
import { openUserForm, openResetPassword } from './user-form.js';
import { openPermissionsEditor } from './permissions-editor.js';

export default async function mount({ view, session }) {
  const st = { page: 1, q: '', active: '', sort: { key: 'name', dir: 'asc' } };
  let roles = []; let rolesError = null;
  const holder = h('div', { class: 'card' });
  const search = input({ type: 'search', placeholder: 'Buscar por nombre o correo…', 'aria-label': 'Buscar usuarios', class: 'input grow' });
  const status = select([{ value: '', label: 'Todos' }, { value: 'true', label: 'Activos' }, { value: 'false', label: 'Inactivos' }], '', { 'aria-label': 'Estado' });
  const newBtn = session.can('usuarios.create') ? h('button', { class: 'btn primary', type: 'button', onclick: () => openUserForm({ roles, canGrantAdmin: session.user.role.isSuperuser, onSaved: load }) }, icon('plus'), 'Nuevo usuario') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Administración' }, { label: 'Usuarios' }]),
    pageHead({ title: 'Usuarios', subtitle: 'Personas con acceso al panel y su rol.', actions: newBtn }), holder);

  const reload = () => { st.page = 1; load(); };
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); reload(); }, 300));
  status.addEventListener('change', () => { st.active = status.value; reload(); });

  async function load() {
    setChildren(holder, h('div', { class: 'toolbar' }, search, status), skeletonRows(6));
    try {
      const r = await usersApi.list({ page: st.page, limit: 15, q: st.q, active: st.active, sort: st.sort.key, dir: st.sort.dir });
      const actions = (u) => [
        session.can('usuarios.edit') && h('button', { class: 'btn sm', type: 'button', onclick: () => openUserForm({ user: u, roles, canGrantAdmin: session.user.role.isSuperuser, onSaved: load }) }, 'Editar'),
        session.can('roles.edit') && !u.role.isSuperuser && h('button', { class: 'btn sm', type: 'button', onclick: () => openPermissionsEditor({ userId: u.id, onSaved: load }) }, 'Permisos'),
        session.can('usuarios.edit') && h('button', { class: 'btn sm', type: 'button', onclick: () => openResetPassword({ user: u, onSaved: load }) }, 'Contraseña'),
        u.id !== session.user.id && (u.active
          ? session.can('usuarios.delete') && h('button', { class: 'btn sm danger', type: 'button', onclick: () => deactivate(u) }, 'Desactivar')
          : session.can('usuarios.edit') && h('button', { class: 'btn sm', type: 'button', onclick: () => reactivate(u) }, 'Reactivar')),
      ].filter(Boolean);
      const content = r.data.length
        ? dataTable({ rows: r.data, actions, sort: st.sort, onSort: (key, dir) => { st.sort = { key, dir }; load(); }, columns: [
          { key: 'name', sortKey: 'name', label: 'Nombre', render: (u) => h('span', {}, h('strong', {}, u.fullName), h('br'), h('span', { class: 'muted small' }, u.email), u.id === session.user.id && ' ', u.id === session.user.id && badge('Vos', 'info')) },
          { key: 'role', sortKey: 'role', label: 'Rol', render: (u) => badge(u.role.name, u.role.isSuperuser ? 'warn' : '') },
          { key: 'active', label: 'Estado', render: (u) => u.active ? badge('Activo', 'ok') : badge('Inactivo', 'err') },
          { key: 'lastLogin', sortKey: 'lastLogin', label: 'Último ingreso', render: (u) => h('span', { class: 'small' }, u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Nunca') },
        ] })
        : emptyState('Sin resultados', st.q || st.active ? 'Probá con otros filtros.' : 'Todavía no hay usuarios.');
      setChildren(holder, h('div', { class: 'toolbar' }, search, status), content, pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, h('div', { class: 'toolbar' }, search, status), errorState(e.message, load)); }
  }
  async function deactivate(u) {
    if (!(await confirmDialog({ title: 'Desactivar usuario', message: `${u.fullName} no podrá ingresar y se cerrarán sus sesiones. Su historial se conserva.`, confirmLabel: 'Desactivar', danger: true }))) return;
    try { await usersApi.deactivate(u.id); toast('Usuario desactivado'); load(); } catch (e) { toast(e.message, 'err'); }
  }
  async function reactivate(u) { try { await usersApi.update(u.id, { active: true }); toast('Usuario reactivado'); load(); } catch (e) { toast(e.message, 'err'); } }

  try { roles = (await rolesApi.options()).data; } catch (e) { rolesError = e; }
  if (rolesError && newBtn) newBtn.disabled = true;
  await load();
}
