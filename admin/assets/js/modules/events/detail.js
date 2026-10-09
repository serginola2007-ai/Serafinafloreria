import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable } from '../../components/table.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { eventsApi } from '../../api/resources.js';
import { formatGs, formatDate, formatDateTime } from '../../utils/format.js';
import { qBadge } from './index.js';

export default async function mount({ view, session, params }) {
  const root = h('div', {}, skeletonRows(6)); view.append(root);
  async function load() {
    let q; try { q = await eventsApi.quotation(params.id); } catch (e) { setChildren(root, errorState(e.message, load)); return; }
    const can = (p) => session.can(p); const st = q.status;
    const act = (label, fn, cls = 'btn') => h('button', { class: cls, type: 'button', onclick: async (ev) => { try { await withBusy(ev.currentTarget, fn); toast('Hecho'); load(); } catch (e) { toast(e.message, 'err'); } } }, label);
    const actions = [can('eventos.edit') && st === 'borrador' && h('a', { class: 'btn', href: `#/cotizaciones/${q.id}/editar` }, 'Editar'), can('eventos.edit') && st === 'borrador' && act('Marcar como enviada', () => eventsApi.send(q.id), 'btn primary'),
      can('eventos.edit') && st === 'enviada' && !q.expired && act('Cliente aceptó', () => eventsApi.accept(q.id), 'btn primary'), can('eventos.edit') && ['borrador', 'enviada'].includes(st) && h('button', { class: 'btn danger', type: 'button', onclick: reject }, 'Rechazar'),
      can('eventos.edit') && can('pedidos.create') && st === 'aceptada' && h('button', { class: 'btn primary', type: 'button', onclick: convert }, 'Convertir en pedido')].filter(Boolean);
    setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Eventos', href: '#/eventos' }, { label: q.number }]), pageHead({ title: q.number, subtitle: `${q.customer.name}${q.event ? ` · ${q.event.name}` : ''} · válida hasta ${formatDate(q.validUntil)}`, actions }),
      h('p', {}, qBadge(q), q.order && h('span', {}, ' · Pedido ', h('a', { href: `#/pedidos/${q.order.id}` }, q.order.number)), q.decidedAt && h('span', { class: 'muted small' }, ` · ${formatDateTime(q.decidedAt)}`)),
      q.decisionNote && h('div', { class: 'alert warn' }, `Motivo: ${q.decisionNote}`), q.notes && h('p', { class: 'muted' }, q.notes),
      h('section', { class: 'card', style: 'margin:16px 0' }, dataTable({ rows: q.items, columns: [{ key: 'd', label: 'Descripción', render: (i) => h('span', {}, i.description, !i.variantId && h('span', { class: 'muted small' }, ' · libre')) }, { key: 'q', label: 'Cant.', render: (i) => String(i.qty) },
        { key: 'p', label: 'Precio', render: (i) => formatGs(i.unitPricePyg) }, { key: 'dc', label: 'Desc.', render: (i) => (i.discountPyg ? formatGs(i.discountPyg) : '—') }, { key: 't', label: 'Total', render: (i) => h('strong', {}, formatGs(i.totalPyg)) }] }),
        h('div', { style: 'text-align:right;padding:12px' }, h('strong', { style: 'font-size:18px' }, `Total ${formatGs(q.totalPyg)}`))));
    function reject() { const r = field({ id: 'qr-r', label: 'Motivo', required: true, control: input({ maxlength: 300 }) }); const save = h('button', { class: 'btn danger solid', type: 'button' }, 'Rechazar'); const m = openModal({ title: `Rechazar ${q.number}`, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, r), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Volver'), save] });
      save.addEventListener('click', async () => { const t = r.querySelector('input').value.trim(); if (t.length < 3) { r.setError('Indicá el motivo'); return; } try { await withBusy(save, () => eventsApi.reject(q.id, t)); m.close(); load(); } catch (e) { toast(e.message, 'err'); } }); }
    function convert() {
      const date = field({ id: 'qc-d', label: 'Fecha del pedido', required: true, control: input({ type: 'date' }) }); const type = field({ id: 'qc-t', label: 'Entrega', control: select([{ value: 'retiro', label: 'Retiro en el local' }, { value: 'delivery', label: 'Delivery' }], 'retiro') });
      const addr = field({ id: 'qc-a', label: 'Dirección (si es delivery)', control: input({ maxlength: 300 }) }); const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Crear pedido');
      const m = openModal({ title: `Convertir ${q.number}`, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err, date, type, addr), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Volver'), save] });
      save.addEventListener('click', async () => { err.hidden = true; const d = date.querySelector('input').value; if (!d) { date.setError('Indicá la fecha'); return; }
        try { const r = await withBusy(save, () => eventsApi.convert(q.id, { requestedDate: d, deliveryType: type.querySelector('select').value, shipping: { name: q.customer.name, address: addr.querySelector('input').value.trim() || null } })); toast(`Pedido ${r.orderNumber} creado`); m.close(); load(); }
        catch (e) { err.hidden = false; err.textContent = e.code === 'FREE_ITEMS' ? 'Tiene ítems libres (servicios/decoración): no se pueden convertir en pedido.' : e.message; } });
    }
  }
  await load();
}
