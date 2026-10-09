import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { customerPicker } from '../../components/customer-picker.js';
import { openReceipt } from '../../components/receipt.js';
import { icon } from '../../components/icons.js';
import { toast } from '../../components/toast.js';
import { salesApi, purchasingApi, customersApi } from '../../api/resources.js';
import { formatGs, parseGs, debounce } from '../../utils/format.js';

const CHANNELS = [['mostrador', 'Mostrador'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram'], ['telefono', 'Teléfono'], ['web', 'Web'], ['evento', 'Evento'], ['mayorista', 'Mayorista']];

export default async function mount({ view, session, query }) {
  const st = { cart: [], payments: [], delivery: 0, discount: 0, channel: 'mostrador', notes: '', due: '', q: '', received: '' }; let methods = []; let catalog = [];
  const grid = h('div', { class: 'pos-grid' }); const cartBox = h('aside', { class: 'card cart card-pad' }); const alertBox = h('div', {});
  const search = input({ type: 'search', class: 'input', placeholder: 'Buscar producto…', 'aria-label': 'Buscar producto' });
  const picker = customerPicker({ onChange: () => draw() });
  const canDiscount = session.can('ventas.discount');
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Ventas' }, { label: 'Nueva venta' }]), pageHead({ title: 'Nueva venta', subtitle: 'Punto de venta: stock, cobro y caja se actualizan juntos al confirmar.' }), alertBox,
    h('div', { class: 'pos' }, h('section', { class: 'card' }, h('div', { class: 'toolbar' }, search), grid), cartBox));
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); loadCatalog(); }, 300));

  const totals = () => { const sub = st.cart.reduce((a, l) => a + l.qty * l.pricePyg, 0); const lineDisc = st.cart.reduce((a, l) => a + l.discountPyg, 0); const disc = lineDisc + st.discount; const total = sub - disc + st.delivery;
    const paid = st.payments.reduce((a, p) => a + (parseGs(p.amount) || 0), 0); return { sub, disc, total, paid, balance: total - paid }; };

  async function loadCatalog() {
    setChildren(grid, skeletonRows(4));
    try {
      catalog = (await salesApi.catalog({ q: st.q })).data;
      setChildren(grid, catalog.length ? catalog.map((p) => {
        const av = p.availability; const out = av.qty !== null && av.qty <= 0;
        const b = h('button', { class: 'pos-card', type: 'button', disabled: out, 'aria-label': `Agregar ${p.name} ${p.label}` }, p.thumbUrl ? h('img', { src: p.thumbUrl, alt: '', loading: 'lazy' }) : h('div', { class: 'ph' }, icon('box')),
          h('div', { class: 'info' }, h('span', { class: 'nm' }, p.name), p.label !== 'Único' && h('span', { class: 'muted small' }, p.label), h('span', { class: 'pr' }, formatGs(p.pricePyg)),
            av.type === 'recipe' ? badge(out ? 'Sin materiales' : `Se pueden armar: ${av.qty}`, out ? 'err' : av.qty <= 2 ? 'warn' : 'ok') : av.type === 'stock' ? badge(out ? 'Agotado' : `Stock: ${av.qty}`, out ? 'err' : 'ok') : badge('Sin control de stock')));
        b.addEventListener('click', () => add(p)); return b;
      }) : emptyState('Sin productos', st.q ? 'No hay productos vendibles con ese nombre.' : 'No hay productos publicados para vender.'));
    } catch (e) { setChildren(grid, errorState(e.message, loadCatalog)); }
  }
  function add(p) { const l = st.cart.find((x) => x.variantId === p.variantId); if (l) l.qty += 1; else st.cart.push({ variantId: p.variantId, name: p.label !== 'Único' ? `${p.name} (${p.label})` : p.name, pricePyg: p.pricePyg, qty: 1, discountPyg: 0 }); draw(); }

  function draw() {
    const t = totals(); const cust = picker.getValue();
    const cashLine = st.payments.find((p) => methods.find((m) => m.code === p.methodCode)?.affectsCash);
    const receivedN = parseGs(st.received); const cashAmt = cashLine ? parseGs(cashLine.amount) || 0 : 0;
    setChildren(cartBox, h('h2', { style: 'margin-bottom:8px' }, 'Venta'), picker,
      st.cart.length ? st.cart.map((l, i) => h('div', { class: 'cart-line' }, h('div', {}, h('strong', {}, l.name), h('div', { class: 'small muted' }, `${formatGs(l.pricePyg)} c/u`)),
        h('div', { style: 'text-align:right' }, h('div', { class: 'qty' }, h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Menos', onclick: () => { l.qty -= 1; if (l.qty <= 0) st.cart.splice(i, 1); draw(); } }, '−'), h('strong', {}, String(l.qty)), h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Más', onclick: () => { l.qty += 1; draw(); } }, '+')),
          h('div', {}, formatGs(l.qty * l.pricePyg - l.discountPyg))),
        canDiscount && h('div', { style: 'grid-column:1/-1' }, h('input', { class: 'input price-input', inputmode: 'numeric', placeholder: 'Descuento de la línea (Gs.)', 'aria-label': `Descuento ${l.name}`, value: l.discountPyg ? String(l.discountPyg) : '', oninput: (e) => { l.discountPyg = parseGs(e.target.value) || 0; drawTotalsOnly(); } })))) : h('p', { class: 'muted', style: 'padding:14px 0' }, 'Tocá un producto para agregarlo.'),
      field({ id: 'pos-ch', label: 'Canal', control: select(CHANNELS.map(([value, label]) => ({ value, label })), st.channel) }),
      h('div', { class: 'grid cols-2' }, field({ id: 'pos-dl', label: 'Delivery (Gs.)', control: input({ inputmode: 'numeric', value: st.delivery ? String(st.delivery) : '' }) }), canDiscount && field({ id: 'pos-dc', label: 'Descuento general (Gs.)', control: input({ inputmode: 'numeric', value: st.discount ? String(st.discount) : '' }) })),
      h('div', { class: 'totals', id: 'pos-totals' }, totalsRows(t)),
      h('h3', { style: 'margin:14px 0 6px' }, 'Cobro'),
      h('div', { class: 'actions', style: 'margin-bottom:8px' }, methods.map((m) => h('button', { class: 'btn sm', type: 'button', onclick: () => { const rest = Math.max(0, totals().balance); if (rest > 0) { st.payments.push({ methodCode: m.code, amount: String(rest) }); draw(); } } }, `+ ${m.name}`))),
      st.payments.map((p, i) => h('div', { class: 'pay-line' }, h('select', { class: 'select', 'aria-label': 'Método', onchange: (e) => { p.methodCode = e.target.value; draw(); } }, methods.map((m) => h('option', { value: m.code, selected: m.code === p.methodCode }, m.name))),
        h('input', { class: 'input price-input', inputmode: 'numeric', 'aria-label': 'Monto cobrado', value: p.amount, oninput: (e) => { p.amount = e.target.value; drawTotalsOnly(); } }), h('button', { class: 'btn sm danger', type: 'button', 'aria-label': 'Quitar pago', onclick: () => { st.payments.splice(i, 1); draw(); } }, '✕'))),
      cashLine && h('div', { class: 'field' }, h('label', { for: 'pos-rc' }, 'Efectivo recibido (para el vuelto)'), h('input', { class: 'input price-input', id: 'pos-rc', inputmode: 'numeric', value: st.received, oninput: (e) => { st.received = e.target.value; drawChange(); } }), h('div', { class: 'small', id: 'pos-change' }, changeText(receivedN, cashAmt))),
      h('div', { id: 'pos-credit' }),
      field({ id: 'pos-notes', label: 'Notas', control: input({ maxlength: 1000, value: st.notes }) }),
      h('button', { class: 'btn primary block', id: 'pos-confirm', type: 'button', disabled: !st.cart.length, onclick: confirm }, 'Confirmar venta'));
    drawCredit();
    const bind = (id, fn, evt = 'input') => document.getElementById(id)?.addEventListener(evt, fn);
    bind('pos-ch', (e) => { st.channel = e.target.value; }, 'change'); bind('pos-dl', (e) => { st.delivery = parseGs(e.target.value) || 0; drawTotalsOnly(); }); bind('pos-dc', (e) => { st.discount = parseGs(e.target.value) || 0; drawTotalsOnly(); }); bind('pos-notes', (e) => { st.notes = e.target.value; });
  }
  const changeText = (rec, amt) => (Number.isNaN(rec) || !st.received ? '' : rec >= amt ? `Vuelto: ${formatGs(rec - amt)}` : `Faltan ${formatGs(amt - rec)}`);
  const totalsRows = (t) => [['Subtotal', formatGs(t.sub)], t.disc > 0 && ['Descuentos', `− ${formatGs(t.disc)}`], st.delivery > 0 && ['Delivery', formatGs(st.delivery)]].filter(Boolean).map(([l, v]) => h('div', { class: 'row' }, h('span', {}, l), h('span', {}, v)))
    .concat([h('div', { class: 'row grand' }, h('span', {}, 'Total'), h('span', {}, formatGs(t.total))), h('div', { class: 'row small muted' }, h('span', {}, 'Cobrado'), h('span', {}, formatGs(t.paid))), t.balance !== 0 && h('div', { class: 'row small', style: `color:${t.balance > 0 ? 'var(--warn)' : 'var(--err)'}` }, h('span', {}, t.balance > 0 ? 'Saldo' : 'Cobrado de más'), h('span', {}, formatGs(Math.abs(t.balance))))]);
  function drawCredit() {
    const box = document.getElementById('pos-credit'); if (!box) return; const t = totals(); const cust = picker.getValue();
    const had = box.querySelector('input'); if (had && t.balance > 0 && st.cart.length) { box.querySelector('strong').textContent = `Saldo a crédito: ${formatGs(t.balance)}. `; return; } // no recrear el campo de fecha mientras se escribe
    setChildren(box, t.balance > 0 && st.cart.length > 0 ? h('div', { class: 'alert warn' }, h('div', {}, h('strong', {}, `Saldo a crédito: ${formatGs(t.balance)}. `), cust ? 'Indicá el vencimiento.' : 'Elegí un cliente para vender a crédito.',
      h('input', { class: 'input', type: 'date', id: 'pos-due', 'aria-label': 'Vencimiento del saldo', value: st.due, style: 'margin-top:6px', oninput: (e) => { st.due = e.target.value; } }))) : null);
  }
  function drawTotalsOnly() { const box = document.getElementById('pos-totals'); if (box) setChildren(box, totalsRows(totals())); drawCredit(); }
  function drawChange() { const el = document.getElementById('pos-change'); const cl = st.payments.find((p) => methods.find((m) => m.code === p.methodCode)?.affectsCash); if (el && cl) el.textContent = changeText(parseGs(st.received), parseGs(cl.amount) || 0); }

  async function confirm(ev) {
    setChildren(alertBox); const t = totals(); const cust = picker.getValue();
    if (t.paid > t.total) { setChildren(alertBox, h('div', { class: 'alert err', role: 'alert' }, 'Los cobros superan el total. El vuelto no se carga: cobrá solo el importe de la venta.')); return; }
    if (t.balance > 0 && !cust) { setChildren(alertBox, h('div', { class: 'alert err', role: 'alert' }, 'Para dejar saldo pendiente elegí un cliente.')); return; }
    if (t.balance > 0 && !st.due) { setChildren(alertBox, h('div', { class: 'alert err', role: 'alert' }, 'Indicá el vencimiento del saldo pendiente.')); return; }
    const body = { customerId: cust?.id ?? null, channel: st.channel, notes: st.notes.trim() || null, discountPyg: st.discount, deliveryFeePyg: st.delivery, creditDueDate: t.balance > 0 ? st.due : null,
      items: st.cart.map((l) => ({ variantId: l.variantId, qty: l.qty, ...(l.discountPyg ? { discountPyg: l.discountPyg } : {}) })), payments: st.payments.filter((p) => parseGs(p.amount) > 0).map((p) => ({ methodCode: p.methodCode, amountPyg: parseGs(p.amount) })) };
    if (!canDiscount) { delete body.discountPyg; }
    try {
      const r = await withBusy(ev.currentTarget, () => salesApi.create(body));
      toast(`Venta ${r.number} confirmada`); const sale = await salesApi.get(r.id);
      Object.assign(st, { cart: [], payments: [], delivery: 0, discount: 0, notes: '', due: '', received: '' }); picker.clear(); draw(); loadCatalog(); openReceipt(sale);
    } catch (e) {
      if (e.code === 'INSUFFICIENT_STOCK') setChildren(alertBox, h('div', { class: 'alert err', role: 'alert' }, h('div', {}, h('strong', {}, 'No alcanza el stock. '), (e.details?.shortages ?? []).map((s) => h('div', {}, `${s.name}: se necesitan ${s.required} ${s.unit}, hay ${s.available}.`)))));
      else if (e.code === 'CASH_CLOSED') setChildren(alertBox, h('div', { class: 'alert err', role: 'alert' }, h('div', {}, 'La caja está cerrada: no se puede cobrar en efectivo. ', session.can('caja.open') && h('a', { href: '#/caja' }, 'Abrir caja'))));
      else setChildren(alertBox, h('div', { class: 'alert err', role: 'alert' }, e.message));
      alertBox.scrollIntoView?.({ block: 'nearest' });
    }
  }

  try { methods = (await purchasingApi.methods()).data; } catch (e) { setChildren(alertBox, h('div', { class: 'alert err' }, e.message)); }
  if (query.customerId) { try { const c = await customersApi.get(query.customerId); picker.set?.({ id: c.id, name: c.name, phone: c.phone }); } catch { /* cliente no encontrado: se ignora */ } }
  draw(); await loadCatalog();
}
