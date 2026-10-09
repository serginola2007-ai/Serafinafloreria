import { h } from './dom.js';
import { openModal } from './modal.js';
import { formatGs, formatDateTime } from '../utils/format.js';

/**
 * Comprobante INTERNO de venta (imprimible). NO es un documento fiscal: la facturación electrónica real
 * (SIFEN) todavía no está integrada y este comprobante lo aclara explícitamente.
 */
export function openReceipt(sale, { business = 'Serafina Florería' } = {}) {
  const row = (l, v, strong) => h('div', { class: 'rc-row' }, h('span', {}, l), h(strong ? 'strong' : 'span', {}, v));
  const paper = h('div', { class: 'receipt', id: 'receipt-print' },
    h('div', { class: 'rc-title' }, business), h('div', { class: 'rc-sub' }, 'COMPROBANTE INTERNO'),
    h('div', { class: 'rc-warn' }, 'No es un documento fiscal ni una factura.'),
    h('div', { class: 'rc-meta' }, `N.º ${sale.number}`, h('br'), formatDateTime(sale.createdAt), sale.customer && h('br'), sale.customer && `Cliente: ${sale.customer.name}`),
    h('hr'), ...sale.items.map((i) => h('div', { class: 'rc-item' }, h('div', {}, `${i.qty} × ${i.description}`), row(`  ${formatGs(i.unitPricePyg)} c/u${i.discountPyg ? ` − desc. ${formatGs(i.discountPyg)}` : ''}`, formatGs(i.totalPyg)))),
    h('hr'), row('Subtotal', formatGs(sale.subtotalPyg)), sale.discountPyg > 0 && row('Descuento', `− ${formatGs(sale.discountPyg)}`), sale.deliveryFeePyg > 0 && row('Delivery', formatGs(sale.deliveryFeePyg)),
    row('TOTAL', formatGs(sale.totalPyg), true), h('hr'), ...sale.payments.map((p) => row(p.method, formatGs(p.amountPyg))),
    sale.balancePyg > 0 && row('Saldo pendiente', formatGs(sale.balancePyg), true), sale.creditDueDate && h('div', { class: 'rc-sub' }, `Vence: ${sale.creditDueDate}`),
    sale.status === 'anulada' && h('div', { class: 'rc-warn' }, `VENTA ANULADA — ${sale.voidReason ?? ''}`), h('div', { class: 'rc-sub', style: 'margin-top:10px' }, '¡Gracias por elegirnos!'));
  const print = h('button', { class: 'btn primary', type: 'button', onclick: () => { document.body.classList.add('printing'); window.print(); document.body.classList.remove('printing'); } }, 'Imprimir');
  const m = openModal({ title: `Comprobante ${sale.number}`, content: paper, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar'), print] });
  return m;
}
