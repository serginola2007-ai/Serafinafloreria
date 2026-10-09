import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable } from '../../components/table.js';
import { field, input, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { confirmDialog } from '../../components/confirm.js';
import { toast } from '../../components/toast.js';
import { purchasingApi } from '../../api/resources.js';
import { formatGs, formatQty, formatDate, formatDateTime, parseGs, parseQty } from '../../utils/format.js';
import { orderBadge } from './index.js';

export default async function mount({ view, session, params, navigate }) {
  const root = h('div', {}, skeletonRows(8)); view.append(root);
  async function load() {
    let o;
    try { o = await purchasingApi.get(params.id); } catch (e) { setChildren(root, errorState(e.message, load)); return; }
    const run = (fn, ok) => async (ev) => { try { await withBusy(ev.currentTarget, fn); toast(ok); load(); } catch (e) { toast(e.message, 'err'); } };
    const act = [];
    if (o.status === 'borrador' && session.can('compras.edit')) act.push(h('a', { class: 'btn', href: `#/compras/${o.id}/editar` }, 'Editar'), h('button', { class: 'btn primary', type: 'button', onclick: run(() => purchasingApi.send(o.id), 'Orden marcada como enviada') }, 'Marcar como enviada'));
    if (['enviada', 'parcial'].includes(o.status) && session.can('compras.receive')) act.push(h('button', { class: 'btn primary', type: 'button', onclick: () => receive(o) }, 'Recibir mercadería'));
    if (o.status === 'parcial' && session.can('compras.edit')) act.push(h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Cerrar orden', message: 'Se da por finalizada: lo que falta recibir ya no se espera.', confirmLabel: 'Cerrar orden' })) run(() => purchasingApi.close(o.id), 'Orden cerrada')({ currentTarget: h('button') }); } }, 'Cerrar con lo recibido'));
    if (['borrador', 'enviada'].includes(o.status) && session.can('compras.edit')) act.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Cancelar orden', message: `${o.number} quedará cancelada.`, confirmLabel: 'Cancelar orden', danger: true })) run(() => purchasingApi.cancel(o.id), 'Orden cancelada')({ currentTarget: h('button') }); } }, 'Cancelar orden'));
    setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Compras' }, { label: 'Órdenes de compra', href: '#/compras' }, { label: o.number }]),
      pageHead({ title: o.number, subtitle: `${o.supplier.name} · creada ${formatDate(o.createdAt)}${o.expectedAt ? ` · entrega estimada ${formatDate(o.expectedAt)}` : ''}`, actions: act }),
      h('p', {}, orderBadge(o.status), o.notes && h('span', { class: 'muted' }, `  ${o.notes}`)),
      h('section', { class: 'card', style: 'margin:16px 0' }, dataTable({ rows: o.items, columns: [
        { key: 'name', label: 'Producto', render: (i) => i.name }, { key: 'ordered', label: 'Pedido', render: (i) => `${formatQty(i.qtyOrdered)} ${i.unit}` },
        { key: 'received', label: 'Recibido', render: (i) => `${formatQty(i.qtyReceived)} ${i.unit}` }, { key: 'pending', label: 'Pendiente', render: (i) => (i.qtyPending > 0 ? badge(formatQty(i.qtyPending), 'warn') : badge('Completo', 'ok')) },
        { key: 'cost', label: 'Costo unit.', render: (i) => formatGs(i.unitCostPyg) }, { key: 'total', label: 'Total', render: (i) => formatGs(i.totalPyg) },
      ] }), h('div', { class: 'pager' }, h('span', {}), h('strong', {}, `Total: ${formatGs(o.totalPyg)}`))),
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Recepciones')),
        o.receipts.length ? h('ul', { class: 'list' }, o.receipts.map((r) => h('li', {}, h('span', {}, h('strong', {}, r.number), ` · factura ${r.supplierInvoiceNo || 's/n'}`, h('span', { class: 'muted small' }, ` · ${formatDateTime(r.receivedAt)}${r.receivedBy ? ' · ' + r.receivedBy : ''}`)),
          h('span', { class: 'nowrap' }, formatGs(r.totalPyg), ' ', r.payableId ? (r.paidPyg >= r.totalPyg ? badge('Pagada', 'ok') : badge(`Vence ${formatDate(r.dueDate)}`, 'warn')) : null)))) : emptyState('Sin recepciones', 'Cuando llegue la mercadería, usá “Recibir mercadería”.')));
  }
  function receive(o) {
    const pending = o.items.filter((i) => i.qtyPending > 0);
    const inv = field({ id: 'r-inv', label: 'N.º de factura del proveedor', control: input({ maxlength: 60 }) });
    const idate = field({ id: 'r-idate', label: 'Fecha de factura', control: input({ type: 'date' }) });
    const due = field({ id: 'r-due', label: 'Vencimiento de pago', help: 'Vacío = fecha de factura + plazo del proveedor.', control: input({ type: 'date' }) });
    const rows = pending.map((i) => ({ i, qty: input({ inputmode: 'decimal', value: String(i.qtyPending), 'aria-label': `Cantidad recibida de ${i.name}` }), cost: input({ class: 'input price-input', inputmode: 'numeric', value: String(i.unitCostPyg), 'aria-label': `Costo real de ${i.name}` }), exp: input({ type: 'date', 'aria-label': `Vencimiento de ${i.name}` }) }));
    const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Confirmar recepción');
    const m = openModal({ title: `Recibir mercadería · ${o.number}`, wide: true, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err,
      h('p', { class: 'muted small' }, 'Poné la cantidad realmente recibida (0 = no llegó) y el costo según la factura. Se actualizan el stock, el costo promedio y la cuenta por pagar.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ['Producto', 'Pendiente', 'Recibido', 'Costo unit. (Gs.)', 'Vence / se deteriora'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.i.name), h('td', {}, `${formatQty(r.i.qtyPending)} ${r.i.unit}`), h('td', {}, r.qty), h('td', {}, r.cost), h('td', {}, r.exp)))))),
      h('div', { class: 'grid cols-2', style: 'margin-top:14px' }, inv, idate), due),
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
    save.addEventListener('click', async () => {
      err.hidden = true; const items = [];
      for (const r of rows) {
        const raw = r.qty.value.trim().replace(',', '.'); if (raw === '' || Number(raw) === 0) continue;
        const q = parseQty(raw), c = parseGs(r.cost.value);
        if (Number.isNaN(q) || Number.isNaN(c)) { err.hidden = false; err.textContent = `${r.i.name}: cantidad (hasta 3 decimales) y costo entero en guaraníes.`; return; }
        items.push({ poItemId: r.i.id, qty: q, unitCostPyg: c, ...(r.exp.value ? { expiresAt: r.exp.value } : {}) });
      }
      if (!items.length) { err.hidden = false; err.textContent = 'Indicá al menos una cantidad recibida.'; return; }
      const v = (f) => f.querySelector('input').value.trim();
      try { const res = await withBusy(save, () => purchasingApi.receive(o.id, { items, supplierInvoiceNo: v(inv) || null, invoiceDate: v(idate) || null, dueDate: v(due) || null })); toast(`Recepción ${res.number} registrada · ${formatGs(res.totalPyg)}`); m.close(); load(); }
      catch (e) { err.hidden = false; err.textContent = e.message; }
    });
  }
  void navigate;
  await load();
}
