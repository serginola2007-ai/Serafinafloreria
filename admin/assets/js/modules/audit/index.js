import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input } from '../../components/form.js';
import { skeletonRows, errorState, emptyState } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { auditApi } from '../../api/resources.js';
import { formatDateTime, debounce } from '../../utils/format.js';
import { actionLabel } from '../dashboard/index.js';

export default async function mount({ view }) {
  const st = { page: 1, action: '', entity: '', from: '', to: '' };
  const holder = h('div', { class: 'card' });
  const f = {
    action: input({ placeholder: 'Acción (ej. user.created)', 'aria-label': 'Acción', maxlength: 80 }),
    entity: input({ placeholder: 'Entidad (ej. user)', 'aria-label': 'Entidad', maxlength: 60 }),
    from: input({ type: 'date', 'aria-label': 'Desde' }), to: input({ type: 'date', 'aria-label': 'Hasta' }),
  };
  const apply = debounce(() => { st.action = f.action.value.trim(); st.entity = f.entity.value.trim(); st.from = f.from.value; st.to = f.to.value; st.page = 1; load(); }, 350);
  Object.values(f).forEach((i) => i.addEventListener('input', apply));
  const toolbar = () => h('div', { class: 'toolbar' }, f.action, f.entity, h('label', { class: 'small muted' }, 'Desde ', f.from), h('label', { class: 'small muted' }, 'Hasta ', f.to));
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Administración' }, { label: 'Auditoría' }]),
    pageHead({ title: 'Auditoría', subtitle: 'Registro inmutable de acciones importantes. No se puede editar ni borrar.' }), holder);

  async function load() {
    setChildren(holder, toolbar(), skeletonRows(8));
    try {
      const q = { page: st.page, limit: 20, action: st.action, entity: st.entity };
      if (st.from) q.from = new Date(st.from + 'T00:00:00').toISOString();
      if (st.to) q.to = new Date(st.to + 'T23:59:59').toISOString();
      const r = await auditApi.list(q);
      setChildren(holder, toolbar(), r.data.length ? dataTable({ rows: r.data,
        actions: (a) => [(a.before || a.after) && h('button', { class: 'btn sm', type: 'button', onclick: () => detail(a) }, 'Detalle')].filter(Boolean),
        columns: [
          { key: 'at', label: 'Fecha', render: (a) => h('span', { class: 'nowrap small' }, formatDateTime(a.at)) },
          { key: 'user', label: 'Usuario', render: (a) => a.userName || 'Sistema' },
          { key: 'action', label: 'Acción', render: (a) => h('span', {}, actionLabel(a.action), h('br'), h('span', { class: 'mono muted' }, a.action)) },
          { key: 'entity', label: 'Entidad', render: (a) => a.entity ? `${a.entity}${a.entityId ? ' #' + a.entityId : ''}` : '—' },
        ] }) : emptyState('Sin registros', 'No hay actividad que coincida con los filtros.'),
      pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  function detail(a) {
    const pre = (t, v) => v ? h('div', {}, h('h3', { style: 'margin:10px 0 4px' }, t), h('pre', { class: 'mono', style: 'white-space:pre-wrap;word-break:break-word;background:var(--surface-2);padding:10px;border-radius:6px;margin:0' }, JSON.stringify(v, null, 2))) : null;
    const m = openModal({ title: actionLabel(a.action), wide: true, content: h('div', {}, h('p', { class: 'muted small' }, `${formatDateTime(a.at)} · ${a.userName || 'Sistema'}${a.ip ? ' · ' + a.ip : ''}${a.requestId ? ' · ' + a.requestId : ''}`), pre('Antes', a.before), pre('Después', a.after)),
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar')] });
  }
  await load();
}
