import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable } from '../../components/table.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { openReceipt } from '../../components/receipt.js';
import { toast } from '../../components/toast.js';
import { salesApi, purchasingApi } from '../../api/resources.js';
import { formatGs, formatDateTime, parseGs } from '../../utils/format.js';
import { payBadge } from './index.js';

export async function openCollect(sale, onDone) {
  let methods = []; try { methods = (await purchasingApi.methods()).data; } catch (e) { toast(e.message, 'err'); return; }
  const amount = field({ id: 'cb-amt', label: 'Monto a cobrar (Gs.)', required: true, help: `Saldo pendiente: ${formatGs(sale.balancePyg)}`, control: input({ inputmode: 'numeric', value: String(sale.balancePyg) }) });
  const method = field({ id: 'cb-m', label: 'Método de cobro', control: select(methods.map((x) => ({ value: x.code, label: x.name })), methods[0]?.code) }); const ref = field({ id: 'cb-r', label: 'Referencia', control: input({ maxlength: 100 }) });
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Registrar cobro');
  const m = openModal({ title: `Cobrar ${sale.number}`, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err, amount, method, ref), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  save.addEventListener('click', async () => { err.hidden = true; amount.setError(''); const n = parseGs(amount.querySelector('input').value); if (Number.isNaN(n) || n <= 0) { amount.setError('Monto entero mayor que 0'); return; }
    try { await withBusy(save, () => salesApi.pay(sale.id, { methodCode: method.querySelector('select').value, amountPyg: n, reference: ref.querySelector('input').value.trim() || null })); toast('Cobro registrado'); m.close(); onDone(); }
    catch (e) { if (e.code === 'OVERPAYMENT') amount.setError(e.message); else { err.hidden = false; err.textContent = e.message; } } });
}

export default async function mount({ view, session, params }) {
  const root = h('div', {}, skeletonRows(8)); view.append(root);
  async function load() {
    let s; try { s = await salesApi.get(params.id); } catch (e) { setChildren(root, errorState(e.message, load)); return; }
    const seeCost = 'costPyg' in s;
    const actions = [h('button', { class: 'btn', type: 'button', onclick: () => openReceipt(s) }, 'Comprobante'),
      s.status === 'confirmada' && s.balancePyg > 0 && session.can('ventas.edit') && h('button', { class: 'btn primary', type: 'button', onclick: () => openCollect(s, load) }, 'Cobrar saldo'),
      s.status === 'confirmada' && session.can('ventas.cancel') && h('button', { class: 'btn danger', type: 'button', onclick: voidSale }, 'Anular venta')].filter(Boolean);
    setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Ventas' }, { label: 'Historial', href: '#/ventas' }, { label: s.number }]),
      pageHead({ title: s.number, subtitle: `${formatDateTime(s.createdAt)} · ${s.createdBy ?? ''} · canal ${s.channel}`, actions }),
      h('p', {}, payBadge(s.paymentState), ' ', s.customer && h('span', {}, 'Cliente: ', h('a', { href: `#/clientes/${s.customer.id}` }, s.customer.name)), s.notes && h('span', { class: 'muted' }, `  “${s.notes}”`)),
      s.status === 'anulada' && h('div', { class: 'alert err' }, `Venta anulada el ${formatDateTime(s.voidedAt)} por ${s.voidedBy}. Motivo: ${s.voidReason}`),
      h('section', { class: 'card', style: 'margin:16px 0' }, dataTable({ rows: s.items, columns: [
        { key: 'd', label: 'Producto', render: (i) => i.description }, { key: 'q', label: 'Cant.', render: (i) => String(i.qty) }, { key: 'p', label: 'Precio', render: (i) => formatGs(i.unitPricePyg) }, { key: 'dc', label: 'Desc.', render: (i) => (i.discountPyg ? formatGs(i.discountPyg) : '—') },
        { key: 't', label: 'Total', render: (i) => h('strong', {}, formatGs(i.totalPyg)) },
        ...(seeCost ? [{ key: 'c', label: 'Costo', render: (i) => (i.costKnown ? formatGs(i.costPyg) : badge('Sin costo', 'warn')) }, { key: 'm', label: 'Margen', render: (i) => (i.marginPyg == null ? '—' : formatGs(i.marginPyg)) }] : [])] }),
        h('div', { class: 'pager', style: 'display:grid;justify-content:end;gap:2px;text-align:right' }, h('span', {}, `Subtotal ${formatGs(s.subtotalPyg)}`), s.discountPyg > 0 && h('span', {}, `Descuento − ${formatGs(s.discountPyg)}`), s.deliveryFeePyg > 0 && h('span', {}, `Delivery ${formatGs(s.deliveryFeePyg)}`),
          h('strong', { style: 'font-size:18px;color:var(--text)' }, `Total ${formatGs(s.totalPyg)}`), seeCost && h('span', {}, s.costComplete ? `Costo ${formatGs(s.costPyg)} · margen ${formatGs(s.marginPyg)}` : 'Margen no disponible (hay líneas sin costo)'))),
      h('div', { class: 'grid cols-2' }, h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Pagos')), s.payments.length ? h('ul', { class: 'list' }, s.payments.map((p) => h('li', {}, h('span', {}, p.method, p.reference && h('span', { class: 'muted small' }, ` · ${p.reference}`)), h('span', { class: 'nowrap' }, h('strong', {}, formatGs(p.amountPyg)), h('span', { class: 'muted small' }, ` ${formatDateTime(p.receivedAt)}`))))) : emptyState('Sin pagos')),
        s.refunds.length ? h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Devoluciones')), h('ul', { class: 'list' }, s.refunds.map((r) => h('li', {}, h('span', {}, r.method), h('strong', {}, formatGs(r.amountPyg)))))) : null));
    function voidSale() {
      const reason = field({ id: 'v-reason', label: 'Motivo de la anulación', required: true, help: 'Se repone el stock y se devuelve el dinero cobrado (el efectivo sale de la caja abierta).', control: input({ maxlength: 300 }) });
      const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn danger solid', type: 'button' }, 'Anular venta');
      const m = openModal({ title: `Anular ${s.number}`, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err, reason), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Volver'), save] });
      save.addEventListener('click', async () => { err.hidden = true; const t = reason.querySelector('input').value.trim(); if (t.length < 3) { reason.setError('Indicá el motivo'); return; }
        try { await withBusy(save, () => salesApi.void(s.id, t)); toast('Venta anulada'); m.close(); load(); } catch (e) { err.hidden = false; err.textContent = e.code === 'CASH_CLOSED' ? 'La caja está cerrada: abrila para devolver el efectivo.' : e.message; } });
    }
  }
  await load();
}
