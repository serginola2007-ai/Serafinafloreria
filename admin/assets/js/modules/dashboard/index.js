import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dashboardApi } from '../../api/resources.js';
import { skeletonRows, errorState, emptyState } from '../../components/states.js';
import { formatDateTime } from '../../utils/format.js';

const stat = (label, value, hint) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, String(value)), hint && h('div', { class: 'hint' }, hint));
const ACTIONS = { 'auth.login': 'Inició sesión', 'auth.logout': 'Cerró sesión', 'auth.login_failed': 'Intento de ingreso fallido', 'auth.password_changed': 'Cambió su contraseña',
  'user.created': 'Creó un usuario', 'user.updated': 'Modificó un usuario', 'user.deactivated': 'Desactivó un usuario', 'user.permissions_set': 'Cambió permisos de un usuario',
  'user.password_reset': 'Restableció una contraseña', 'role.permissions_set': 'Cambió permisos de un rol', 'media.uploaded': 'Subió un archivo', 'media.deleted': 'Eliminó un archivo' };
export const actionLabel = (a) => ACTIONS[a] || a;

export default async function mount({ view, session }) {
  const root = h('div', {}, breadcrumbs([{ label: 'Dashboard' }]),
    pageHead({ title: `Hola, ${session.user.fullName.split(' ')[0]}`, subtitle: 'Resumen de lo que podés ver con tu rol.' }));
  const body = h('div', {}, skeletonRows(4)); root.append(body); view.append(root);

  async function load() {
    setChildren(body, skeletonRows(4));
    let d;
    try { d = await dashboardApi.summary(); } catch (e) { setChildren(body, errorState(e.message, load)); return; }
    const cards = [];
    if (d.catalog) {
      cards.push(stat('Productos publicados', d.catalog.published, `${d.catalog.categories} categorías`));
      cards.push(stat('Productos a revisar', d.catalog.needs_review, d.catalog.needs_review ? 'Requieren revisión manual' : 'Nada pendiente'));
    }
    if (d.users) cards.push(stat('Usuarios activos', d.users.active, `${d.users.inactive} inactivos`));
    if (d.integrations) cards.push(stat('Integraciones con credenciales', `${d.integrations.withCredentials}/${d.integrations.total}`, 'Sin credenciales, no se muestran métricas'));
    setChildren(body);
    if (cards.length) body.append(h('div', { class: 'grid cols-4' }, cards));
    else if (!d.recentActivity) body.append(h('div', { class: 'card' }, emptyState('Todavía no hay indicadores para tu rol', 'Usá el menú de la izquierda para acceder a tus secciones.')));
    if (d.recentActivity) {
      body.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-head' }, h('h2', {}, 'Actividad reciente'), session.canAny(['auditoria.view']) && h('a', { href: '#/auditoria' }, 'Ver todo')),
        d.recentActivity.length ? h('ul', { class: 'list' }, d.recentActivity.map((a) => h('li', {}, h('span', {}, h('strong', {}, a.userName || 'Sistema'), ' · ', actionLabel(a.action)), h('span', { class: 'muted small nowrap' }, formatDateTime(a.at)))))
          : emptyState('Sin actividad registrada')));
    }
  }
  await load();
}
