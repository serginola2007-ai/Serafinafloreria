import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select, field, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { inventoryApi } from '../../api/resources.js';
import { formatGs, formatQty, formatDateTime, debounce } from '../../utils/format.js';
import { openWaste } from './dialogs.js';

export default async function mount({ view, session }) {
  const st = { page: 1, reasonCode: '', from: '', to: '' };
  const holder = h('div', {});
  const reason = select([{ value: '', label: 'Todos los motivos' }], '', { 'aria-label': 'Motivo' });
  const from = input({ type: 'date', 'aria-label': 'Desde' }); const to = input({ type: 'date', 'aria-label': 'Hasta' });
  const apply = debounce(() => { st.reasonCode = reason.value; st.from = from.value; st.to = to.value; st.page = 1; load(); }, 250);
  [reason, from, to].forEach((e) => e.addEventListener('input', apply));
  const toolbar = () => h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, reason, h('label', { class: 'small muted' }, 'Desde ', from), h('label', { class: 'small muted' }, 'Hasta ', to)));
  const actions = [session.can('inventario.edit') && h('button', { class: 'btn', type: 'button', onclick: manageReasons }, 'Motivos'),
    session.can('inventario.merma') && h('button', { class: 'btn primary', type: 'button', onclick: () => openWaste({ onDone: load }) }, 'Registrar merma')].filter(Boolean);
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Inventario' }, { label: 'Merma' }]),
    pageHead({ title: 'Merma', subtitle: 'Pérdidas valorizadas al costo real de los lotes.', actions }), holder);

  const breakdown = (title, rows, key) => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, title)),
    rows.length ? h('ul', { class: 'list' }, rows.map((r) => h('li', {}, h('span', {}, r[key], h('span', { class: 'muted small' }, ` · ${r.records} reg.`)), h('strong', {}, formatGs(r.costPyg))))) : emptyState('Sin datos'));

  async function load() {
    setChildren(holder, toolbar(), skeletonRows(6));
    try {
      const q = { page: st.page, limit: 15, reasonCode: st.reasonCode };
      if (st.from) q.from = new Date(st.from + 'T00:00:00').toISOString(); if (st.to) q.to = new Date(st.to + 'T23:59:59').toISOString();
      const r = await inventoryApi.wasteReport(q);
      setChildren(holder, toolbar(),
        h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Costo total de merma'), h('div', { class: 'value' }, formatGs(r.totalCostPyg))),
          h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Registros'), h('div', { class: 'value' }, String(r.meta.total)))),
        r.meta.total ? h('div', { class: 'grid cols-2', style: 'margin-bottom:16px' }, breakdown('Por motivo', r.byReason, 'reason'), breakdown('Por producto', r.byProduct, 'product'), breakdown('Por categoría', r.byCategory, 'category'), breakdown('Por usuario', r.byUser, 'user')) : null,
        h('div', { class: 'card' }, r.data.length ? dataTable({ rows: r.data, columns: [
          { key: 'at', label: 'Fecha', render: (w) => h('span', { class: 'nowrap small' }, formatDateTime(w.occurredAt)) },
          { key: 'product', label: 'Producto', render: (w) => w.product }, { key: 'qty', label: 'Cantidad', render: (w) => `${formatQty(w.qty)} ${w.unit}` },
          { key: 'cost', label: 'Costo', render: (w) => formatGs(w.costPyg) }, { key: 'reason', label: 'Motivo', render: (w) => badge(w.reason) },
          { key: 'user', label: 'Usuario', render: (w) => w.user || '—' }, { key: 'note', label: 'Observación', render: (w) => w.note || '—' },
        ] }) : emptyState('Sin mermas registradas', 'No hay pérdidas en el período elegido.'), pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } })));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  async function manageReasons() {
    const body = h('div', {}); const name = field({ id: 'r-name', label: 'Nuevo motivo', control: input({ maxlength: 60, placeholder: 'Ej.: plaga' }) });
    const add = h('button', { class: 'btn primary', type: 'button' }, 'Agregar'); const m = openModal({ title: 'Motivos de merma', content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => { m.close(); fillReasons(); } }, 'Cerrar')] });
    async function draw() {
      const { data } = await inventoryApi.wasteReasons();
      setChildren(body, h('ul', { class: 'list' }, data.map((r) => h('li', {}, h('span', {}, r.name, !r.active && h('span', { class: 'muted small' }, ' (inactivo)')),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await inventoryApi.updateWasteReason(r.id, { active: !r.active }); draw(); } catch (e) { toast(e.message, 'err'); } } }, r.active ? 'Desactivar' : 'Activar')))),
        h('div', { style: 'margin-top:12px' }, name, add));
    }
    add.addEventListener('click', async () => { try { await withBusy(add, () => inventoryApi.createWasteReason(name.querySelector('input').value.trim())); toast('Motivo agregado'); draw(); } catch (e) { toast(e.message, 'err'); } });
    draw();
  }
  async function fillReasons() { try { const { data } = await inventoryApi.wasteReasons(); setChildren(reason, h('option', { value: '' }, 'Todos los motivos'), data.map((r) => h('option', { value: r.code }, r.name))); } catch { /* sin filtro de motivos */ } }
  await fillReasons(); await load();
}
