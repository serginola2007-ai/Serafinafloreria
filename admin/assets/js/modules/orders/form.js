import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { customerPicker } from '../../components/customer-picker.js';
import { emptyState } from '../../components/states.js';
import { toast } from '../../components/toast.js';
import { ordersApi, salesApi } from '../../api/resources.js';
import { formatGs, parseGs } from '../../utils/format.js';

export default async function mount({ view, params, navigate }) {
  const editing = !!params.id; let zones = []; let catalog = []; let cart = []; let customer = null; let order = null;
  try { zones = (await ordersApi.zones()).data.filter((z) => z.active); catalog = (await salesApi.catalog({})).data; if (editing) order = await ordersApi.get(params.id); } catch (e) { view.append(h('div', { class: 'alert err' }, e.message)); return; }
  if (order) { cart = order.items.map((i) => ({ variantId: i.variantId, name: i.description, qty: i.qty, price: i.unitPricePyg })); customer = order.customer; }
  const picker = customerPicker({ onChange: (c) => { customer = c; } }); if (customer) picker.setValue?.(customer);
  const f = (id, label, props = {}, extra = {}) => field({ id, label, control: input(props), ...extra });
  const type = select([{ value: 'delivery', label: 'Delivery' }, { value: 'retiro', label: 'Retiro en el local' }], order?.deliveryType ?? 'delivery');
  const date = f('o-date', 'Fecha de entrega', { type: 'date', value: order?.requestedDate?.slice(0, 10) ?? '' }, { required: true }); const slot = f('o-slot', 'Horario', { value: order?.timeSlot ?? '', maxlength: 60 });
  const rname = f('o-rn', 'Destinatario', { value: order?.shipping.name ?? '', maxlength: 120 }); const rphone = f('o-rp', 'Teléfono del destinatario', { value: order?.shipping.phone ?? '', maxlength: 40 });
  const addr = f('o-addr', 'Dirección', { value: order?.shipping.address ?? '', maxlength: 300 }); const ref = f('o-ref', 'Referencia', { value: order?.shipping.reference ?? '', maxlength: 300 });
  const zone = field({ id: 'o-zone', label: 'Zona (define la tarifa)', control: select([{ value: '', label: 'Sin zona / tarifa manual' }, ...zones.map((z) => ({ value: String(z.id), label: `${z.name} · ${formatGs(z.feePyg)}` }))], '') });
  const fee = f('o-fee', 'Costo de delivery (Gs.)', { inputmode: 'numeric', value: String(order?.deliveryFeePyg ?? 0) });
  const card = f('o-card', 'Mensaje de la tarjeta', { value: order?.cardMessage ?? '', maxlength: 500 }); const notes = f('o-notes', 'Notas internas', { value: order?.notes ?? '', maxlength: 1000 });
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const lines = h('div', {}); const total = h('strong', {});
  const search = input({ type: 'search', class: 'input', placeholder: 'Buscar producto para agregar…', 'aria-label': 'Buscar producto' }); const results = h('div', { class: 'card', style: 'margin-top:4px' });
  const draw = () => {
    setChildren(lines, cart.length ? cart.map((l, i) => h('div', { class: 'toolbar', style: 'border:0' }, h('span', { class: 'grow' }, l.name), h('input', { class: 'input', type: 'number', min: '1', max: '1000', value: String(l.qty), style: 'width:80px', 'aria-label': `Cantidad de ${l.name}`, onchange: (e) => { l.qty = Math.max(1, Number(e.target.value) || 1); draw(); } }),
      h('span', { class: 'nowrap' }, formatGs(l.price * l.qty)), h('button', { class: 'btn sm', type: 'button', onclick: () => { cart.splice(i, 1); draw(); } }, 'Quitar'))) : emptyState('Sin productos', 'Buscá y agregá productos al pedido.'));
    total.textContent = `Subtotal ${formatGs(cart.reduce((s, l) => s + l.price * l.qty, 0))} (el total final lo calcula el servidor)`;
  };
  search.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); setChildren(results, q.length < 2 ? [] : catalog.filter((p) => `${p.name} ${p.label}`.toLowerCase().includes(q)).slice(0, 8).map((p) => h('button', { class: 'menu-item', type: 'button', onclick: () => {
    const ex = cart.find((l) => l.variantId === p.variantId); if (ex) ex.qty += 1; else cart.push({ variantId: p.variantId, name: `${p.name} (${p.label})`, qty: 1, price: p.pricePyg }); search.value = ''; setChildren(results, []); draw(); } }, `${p.name} · ${p.label} · ${formatGs(p.pricePyg)}`))); });
  zone.querySelector('select').addEventListener('change', (e) => { const z = zones.find((x) => String(x.id) === e.target.value); if (z) fee.querySelector('input').value = String(z.feePyg); });
  const save = (status) => h('button', { class: status === 'pendiente' ? 'btn primary' : 'btn', type: 'button', onclick: async (ev) => {
    err.hidden = true; const n = parseGs(fee.querySelector('input').value);
    if (!cart.length) { err.hidden = false; err.textContent = 'Agregá al menos un producto'; return; }
    const body = { customerId: customer?.id ?? null, deliveryType: type.value, requestedDate: date.querySelector('input').value || null, timeSlot: slot.querySelector('input').value.trim() || null, cardMessage: card.querySelector('input').value.trim() || null, notes: notes.querySelector('input').value.trim() || null,
      shipping: { name: rname.querySelector('input').value.trim() || null, phone: rphone.querySelector('input').value.trim() || null, address: addr.querySelector('input').value.trim() || null, reference: ref.querySelector('input').value.trim() || null }, deliveryFeePyg: Number.isNaN(n) ? 0 : n,
      items: cart.map((l) => ({ variantId: l.variantId, qty: l.qty })) };
    try { const r = await withBusy(ev.currentTarget, () => (editing ? ordersApi.update(params.id, body).then(() => ({ id: params.id })) : ordersApi.create({ ...body, status })));
      toast(editing ? 'Pedido actualizado' : 'Pedido creado'); navigate(`/pedidos/${r.id}`); } catch (e) { err.hidden = false; err.textContent = e.message; } } }, status === 'consulta' ? 'Guardar como consulta' : editing ? 'Guardar cambios' : 'Crear pedido');
  draw();
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Pedidos', href: '#/pedidos' }, { label: editing ? order.number : 'Nuevo' }]), pageHead({ title: editing ? `Editar ${order.number}` : 'Nuevo pedido' }),
    h('form', { class: 'card', style: 'padding:16px;display:grid;gap:12px', novalidate: true, onsubmit: (e) => e.preventDefault() }, err,
      h('h2', {}, 'Cliente'), picker, h('h2', {}, 'Productos'), search, results, lines, total,
      h('h2', {}, 'Entrega'), field({ id: 'o-type', label: 'Tipo', control: type }), date, slot, rname, rphone, addr, ref, zone, fee, card, notes,
      h('div', { class: 'toolbar', style: 'border:0' }, save('pendiente'), !editing && save('consulta'))));
}
