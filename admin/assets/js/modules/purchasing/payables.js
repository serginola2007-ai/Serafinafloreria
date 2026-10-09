import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { purchasingApi } from '../../api/resources.js';
import { formatGs, formatDate, parseGs, formatDateTime } from '../../utils/format.js';

const ST = { pending: ['Por vencer', 'info'], overdue: ['Vencida', 'err'], paid: ['Pagada', 'ok'] };

export default async function mount({ view, session }) {
  const st = { page: 1, status: 'open' }; const holder = h('div', {});
  const status = select([{ value: 'open', label: 'Pendientes' }, { value: 'overdue', label: 'Vencidas' }, { value: 'pending', label: 'Por vencer' }, { value: 'paid', label: 'Pagadas' }, { value: 'all', label: 'Todas' }], 'open', { 'aria-label': 'Estado' });
  status.addEventListener('change', () => { st.status = status.value; st.page = 1; load(); });
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Compras' }, { label: 'Cuentas por pagar' }]), pageHead({ title: 'Cuentas por pagar', subtitle: 'Facturas de proveedores generadas por las recepciones.' }), holder);
  const toolbar = () => h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, status));
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(6));
    try {
      const r = await purchasingApi.payables({ page: st.page, limit: 15, status: st.status });
      setChildren(holder, toolbar(), h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Saldo (según filtro)'), h('div', { class: 'value', style: 'font-size:28px' }, formatGs(r.balancePyg)))),
        h('div', { class: 'card' }, r.data.length ? dataTable({ rows: r.data, columns: [
          { key: 'supplier', label: 'Proveedor', render: (p) => h('a', { href: `#/proveedores/${p.supplier.id}` }, p.supplier.name) },
          { key: 'inv', label: 'Factura', render: (p) => p.invoiceNo || '—' }, { key: 'po', label: 'Orden', render: (p) => h('span', { class: 'small muted' }, `${p.purchaseOrder} · ${p.receipt}`) },
          { key: 'total', label: 'Total', render: (p) => formatGs(p.totalPyg) }, { key: 'paid', label: 'Pagado', render: (p) => formatGs(p.paidPyg) },
          { key: 'bal', label: 'Saldo', render: (p) => h('strong', {}, formatGs(p.balancePyg)) }, { key: 'due', label: 'Vence', render: (p) => formatDate(p.dueDate) },
          { key: 'st', label: 'Estado', render: (p) => badge(...ST[p.status]) },
        ], actions: (p) => [h('button', { class: 'btn sm', type: 'button', onclick: () => detail(p) }, 'Detalle'), p.balancePyg > 0 && session.can('finanzas.edit') && h('button', { class: 'btn sm primary', type: 'button', onclick: () => pay(p) }, 'Registrar pago')].filter(Boolean) })
          : emptyState('No hay cuentas', 'No hay facturas en este estado.'), pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } })));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  async function detail(p) {
    const body = h('div', {}, skeletonRows(3)); const m = openModal({ title: `Cuenta · ${p.supplier.name}`, content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar')] });
    try { const d = await purchasingApi.payable(p.id);
      setChildren(body, h('p', {}, `Total ${formatGs(d.totalPyg)} · pagado ${formatGs(d.paidPyg)} · saldo `, h('strong', {}, formatGs(d.balancePyg))),
        d.payments.length ? h('ul', { class: 'list' }, d.payments.map((x) => h('li', {}, h('span', {}, h('strong', {}, formatGs(x.amountPyg)), ` · ${x.method}`, x.reference && h('span', { class: 'muted small' }, ` · ${x.reference}`)), h('span', { class: 'muted small nowrap' }, `${formatDateTime(x.paidAt)}${x.user ? ' · ' + x.user : ''}`)))) : emptyState('Sin pagos todavía'));
    } catch (e) { setChildren(body, errorState(e.message)); }
  }
  async function pay(p) {
    let methods = []; try { methods = (await purchasingApi.methods()).data; } catch (e) { toast(e.message, 'err'); return; }
    const amount = field({ id: 'p-amt', label: 'Monto (Gs.)', required: true, help: `Saldo: ${formatGs(p.balancePyg)}`, control: input({ inputmode: 'numeric', value: String(p.balancePyg) }) });
    const method = field({ id: 'p-method', label: 'Método de pago', control: select(methods.map((x) => ({ value: x.code, label: x.name })), methods[0]?.code) });
    const ref = field({ id: 'p-ref', label: 'Referencia (N.º de transferencia, recibo…)', control: input({ maxlength: 100 }) });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Registrar pago');
    const m = openModal({ title: `Pagar a ${p.supplier.name}`, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, h('div', { class: 'alert info' }, 'Los pagos en efectivo se vincularán a la caja cuando ese módulo esté disponible.'), amount, method, ref), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
    save.addEventListener('click', async () => {
      amount.setError(''); const a = parseGs(amount.querySelector('input').value); if (Number.isNaN(a) || a <= 0) { amount.setError('Monto entero en guaraníes mayor que 0'); return; }
      try { await withBusy(save, () => purchasingApi.pay(p.id, { amountPyg: a, methodCode: method.querySelector('select').value, reference: ref.querySelector('input').value.trim() || null })); toast('Pago registrado'); m.close(); load(); }
      catch (e) { if (e.code === 'OVERPAYMENT') amount.setError(e.message); else toast(e.message, 'err'); }
    });
  }
  await load();
}
