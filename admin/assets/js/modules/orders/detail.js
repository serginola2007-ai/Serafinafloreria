import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable } from '../../components/table.js';
import { field, input, select, checkbox, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { ordersApi, purchasingApi } from '../../api/resources.js';
import { formatGs, formatDate, formatDateTime, parseGs } from '../../utils/format.js';
import { orderBadge } from './index.js';

const modalForm = (title, body, submitLabel, onSubmit, danger = false) => {
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: danger ? 'btn danger solid' : 'btn primary', type: 'button' }, submitLabel);
  const m = openModal({ title, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err, ...body), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Volver'), save] });
  save.addEventListener('click', async () => { err.hidden = true; try { await withBusy(save, onSubmit); m.close(); } catch (e) { if (e.__shown) return; err.hidden = false; err.textContent = e.message; } });
  return m;
};

export default async function mount({ view, session, params }) {
  const root = h('div', {}, skeletonRows(8)); view.append(root);
  async function load() {
    let o; try { o = await ordersApi.get(params.id); } catch (e) { setChildren(root, errorState(e.message, load)); return; }
    const can = (p) => session.can(p); const st = o.status;
    const open = !['entregado', 'cancelado'].includes(st);
    const act = (label, fn, cls = 'btn') => h('button', { class: cls, type: 'button', onclick: async (ev) => { try { await withBusy(ev.currentTarget, fn); toast('Hecho'); load(); } catch (e) { toast(e.message, 'err'); } } }, label);
    const actions = [
      can('pedidos.edit') && ['consulta', 'cotizacion'].includes(st) && act('Pasar a pendiente', () => ordersApi.transition(o.id, 'pendiente')),
      can('pedidos.edit') && st === 'pendiente' && act('Confirmar y reservar stock', () => ordersApi.confirm(o.id), 'btn primary'),
      can('pedidos.edit') && ['pendiente', 'confirmado', 'pagado', 'pendiente_pago'].includes(st) && !o.production.some((p) => p.status !== 'pendiente') && h('a', { class: 'btn', href: `#/pedidos/${o.id}/editar` }, 'Editar'),
      can('pedidos.edit') && open && o.balancePyg > 0 && st !== 'consulta' && h('button', { class: 'btn', type: 'button', onclick: pay }, 'Registrar cobro'),
      can('pedidos.edit') && st === 'listo' && o.deliveryType === 'retiro' && h('button', { class: 'btn primary', type: 'button', onclick: complete }, 'Entregar en el local'),
      can('pedidos.cancel') && open && h('button', { class: 'btn danger', type: 'button', onclick: cancel }, 'Cancelar pedido')].filter(Boolean);
    setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Pedidos', href: '#/pedidos' }, { label: o.number }]),
      pageHead({ title: o.number, subtitle: `${o.deliveryType === 'delivery' ? 'Delivery' : 'Retiro'} para el ${formatDate(o.requestedDate)}${o.timeSlot ? ` · ${o.timeSlot}` : ''} · canal ${o.channel}`, actions }),
      h('p', {}, orderBadge(st), ' ', o.customer && h('span', {}, 'Cliente: ', h('a', { href: `#/clientes/${o.customer.id}` }, o.customer.name)), o.sale && h('span', {}, ' · Venta ', h('a', { href: `#/ventas/${o.sale.id}` }, o.sale.number))),
      st === 'cancelado' && h('div', { class: 'alert err' }, `Pedido cancelado. Motivo: ${o.cancelReason ?? '—'}`),
      o.cardMessage && h('div', { class: 'alert info' }, `Tarjeta: “${o.cardMessage}”`),
      h('section', { class: 'card', style: 'margin:16px 0' }, dataTable({ rows: o.items, columns: [{ key: 'd', label: 'Producto', render: (i) => i.description }, { key: 'q', label: 'Cant.', render: (i) => String(i.qty) }, { key: 'p', label: 'Precio', render: (i) => formatGs(i.unitPricePyg) }, { key: 't', label: 'Total', render: (i) => h('strong', {}, formatGs(i.totalPyg)) }] }),
        h('div', { style: 'display:grid;justify-content:end;gap:2px;text-align:right;padding:12px' }, h('span', {}, `Subtotal ${formatGs(o.subtotalPyg)}`), o.discountPyg > 0 && h('span', {}, `Descuento − ${formatGs(o.discountPyg)}`), o.deliveryFeePyg > 0 && h('span', {}, `Delivery ${formatGs(o.deliveryFeePyg)}`),
          h('strong', { style: 'font-size:18px' }, `Total ${formatGs(o.totalPyg)}`), h('span', {}, `Cobrado ${formatGs(o.paidPyg)} · Saldo ${formatGs(o.balancePyg)}`))),
      h('div', { class: 'grid cols-2' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Destinatario')), h('div', { style: 'padding:12px' }, h('div', {}, o.shipping.name ?? '—'), o.shipping.phone && h('div', { class: 'muted' }, o.shipping.phone), o.shipping.address && h('div', {}, o.shipping.address), o.shipping.reference && h('div', { class: 'muted small' }, o.shipping.reference), o.notes && h('div', { class: 'muted small' }, `Notas: ${o.notes}`))),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Stock reservado')), o.reservations.length ? h('ul', { class: 'list' }, o.reservations.map((r) => h('li', {}, h('span', {}, r.name), h('span', {}, `${r.qty} ${r.unit} `, badge(r.status, r.status === 'active' ? 'info' : ''))))) : emptyState('Sin reservas', 'El stock se reserva al confirmar el pedido.')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Producción')), o.production.length ? h('ul', { class: 'list' }, o.production.map((p) => h('li', {}, h('span', {}, p.description), h('span', {}, `${p.checklistDone}/${p.checklistTotal} `, badge(p.status, p.status === 'listo' ? 'ok' : 'info'))))) : emptyState('Sin producción')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Entrega')), o.delivery ? h('div', { style: 'padding:12px' }, badge(o.delivery.status, 'info'), ' ', o.delivery.courier ? `Repartidor: ${o.delivery.courier.name}` : 'Sin repartidor', o.delivery.failureReason && h('div', { class: 'muted small' }, `Motivo: ${o.delivery.failureReason}`)) : emptyState('Sin entrega', o.deliveryType === 'retiro' ? 'Retiro en el local.' : 'Se crea al confirmar.')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Cobros')), o.payments.length ? h('ul', { class: 'list' }, o.payments.map((p) => h('li', {}, h('span', {}, p.method), h('span', { class: 'nowrap' }, h('strong', {}, formatGs(p.amountPyg)), h('span', { class: 'muted small' }, ` ${formatDateTime(p.receivedAt)}`))))) : emptyState('Sin cobros')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Historial')), h('ul', { class: 'list' }, o.history.map((x) => h('li', {}, h('span', {}, `${x.from ?? '—'} → ${x.to}`, x.note && h('span', { class: 'muted small' }, ` · ${x.note}`)), h('span', { class: 'muted small nowrap' }, `${x.user ?? 'Web'} · ${formatDateTime(x.at)}`)))))));

    async function pay() {
      let methods = []; try { methods = (await purchasingApi.methods()).data; } catch (e) { toast(e.message, 'err'); return; }
      const amt = field({ id: 'op-a', label: 'Monto (Gs.)', required: true, help: `Saldo: ${formatGs(o.balancePyg)}`, control: input({ inputmode: 'numeric', value: String(o.balancePyg) }) });
      const mth = field({ id: 'op-m', label: 'Método', control: select(methods.map((x) => ({ value: x.code, label: x.name })), methods[0]?.code) });
      modalForm(`Cobro de ${o.number}`, [amt, mth], 'Registrar cobro', async () => { const n = parseGs(amt.querySelector('input').value); if (Number.isNaN(n) || n <= 0) { amt.setError('Monto entero mayor que 0'); throw Object.assign(new Error('x'), { __shown: true }); }
        await ordersApi.pay(o.id, { methodCode: mth.querySelector('select').value, amountPyg: n }); toast('Cobro registrado'); load(); });
    }
    function complete() {
      const due = field({ id: 'oc-d', label: 'Vencimiento del saldo', help: o.balancePyg > 0 ? `Queda un saldo de ${formatGs(o.balancePyg)}: se pasa a cuentas por cobrar.` : 'Sin saldo pendiente.', control: input({ type: 'date' }) });
      modalForm(`Entregar ${o.number}`, [due], 'Entregar y generar venta', async () => { const r = await ordersApi.complete(o.id, { creditDueDate: due.querySelector('input').value || undefined }); toast(`Venta ${r.saleNumber} generada`); load(); });
    }
    function cancel() {
      const produced = o.production.some((p) => !['pendiente', 'cancelado'].includes(p.status));
      const reason = field({ id: 'oc-r', label: 'Motivo', required: true, control: input({ maxlength: 300 }) });
      const restock = checkbox('Los materiales se pueden reutilizar (volver al stock). Si no, se registran como merma.', { checked: true });
      modalForm(`Cancelar ${o.number}`, [reason, produced && restock, o.paidPyg > 0 && h('div', { class: 'alert info' }, `Se reembolsarán ${formatGs(o.paidPyg)} (el efectivo sale de la caja abierta).`)].filter(Boolean), 'Cancelar pedido', async () => {
        const t = reason.querySelector('input').value.trim(); if (t.length < 3) { reason.setError('Indicá el motivo'); throw Object.assign(new Error('x'), { __shown: true }); }
        await ordersApi.cancel(o.id, { reason: t, ...(produced ? { restock: restock.querySelector('input').checked } : {}) }); toast('Pedido cancelado'); load(); }, true);
    }
  }
  await load();
}
