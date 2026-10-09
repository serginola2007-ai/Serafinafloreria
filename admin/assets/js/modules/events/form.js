import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { customerPicker } from '../../components/customer-picker.js';
import { emptyState } from '../../components/states.js';
import { toast } from '../../components/toast.js';
import { eventsApi, salesApi } from '../../api/resources.js';
import { formatGs, parseGs } from '../../utils/format.js';

export default async function mount({ view, params, navigate, session }) {
  const editing = !!params.id; let catalog = []; let q = null; let cart = []; let customer = null;
  try { catalog = session.can('ventas.create') ? (await salesApi.catalog({})).data : []; if (editing) q = await eventsApi.quotation(params.id); } catch (e) { view.append(h('div', { class: 'alert err' }, e.message)); return; }
  if (q && q.status !== 'borrador') { view.append(h('div', { class: 'alert warn' }, 'Solo se puede editar una cotización en borrador.')); return; }
  if (q) { cart = q.items.map((i) => ({ variantId: i.variantId, description: i.description, qty: i.qty, unit: i.unitPricePyg, discount: i.discountPyg })); customer = q.customer; }
  const picker = customerPicker({ onChange: (c) => { customer = c; loadEvents(); } }); if (customer) picker.setValue?.(customer);
  const evSel = field({ id: 'qf-ev', label: 'Evento (opcional)', control: select([{ value: '', label: 'Sin evento' }], '') });
  async function loadEvents() { const s = evSel.querySelector('select'); s.replaceChildren(h('option', { value: '' }, 'Sin evento')); if (!customer) return;
    try { (await eventsApi.events({ limit: 100 })).data.filter((e) => e.customer.id === customer.id).forEach((e) => s.append(h('option', { value: String(e.id), selected: q?.event?.id === e.id }, `${e.number} · ${e.name}`))); } catch { /* sin eventos */ } }
  const valid = field({ id: 'qf-v', label: 'Válida hasta', help: 'Obligatoria para enviarla.', control: input({ type: 'date', value: q?.validUntil?.slice(0, 10) ?? '' }) }); const notes = field({ id: 'qf-n', label: 'Notas / condiciones', control: input({ maxlength: 1000, value: q?.notes ?? '' }) });
  const lines = h('div', {}); const total = h('strong', {}); const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const search = input({ type: 'search', class: 'input', placeholder: 'Buscar producto del catálogo…', 'aria-label': 'Buscar producto' }); const results = h('div', { class: 'card', style: 'margin-top:4px' });
  const freeDesc = input({ placeholder: 'Ítem libre (servicio, decoración…)', maxlength: 200, 'aria-label': 'Descripción del ítem libre' }); const freePrice = input({ inputmode: 'numeric', placeholder: 'Precio (Gs.)', 'aria-label': 'Precio del ítem libre', style: 'max-width:160px' });
  const draw = () => {
    setChildren(lines, cart.length ? cart.map((l, i) => h('div', { class: 'toolbar', style: 'border:0' }, h('span', { class: 'grow' }, l.description, !l.variantId && h('span', { class: 'muted small' }, ' · ítem libre')),
      h('input', { class: 'input', type: 'number', min: '1', value: String(l.qty), style: 'width:80px', 'aria-label': `Cantidad de ${l.description}`, onchange: (e) => { l.qty = Math.max(1, Number(e.target.value) || 1); draw(); } }),
      h('span', { class: 'nowrap' }, formatGs(l.qty * l.unit - l.discount)), h('button', { class: 'btn sm', type: 'button', onclick: () => { cart.splice(i, 1); draw(); } }, 'Quitar'))) : emptyState('Sin ítems', 'Agregá productos del catálogo o ítems libres.'));
    total.textContent = `Total ${formatGs(cart.reduce((s, l) => s + l.qty * l.unit - l.discount, 0))}`;
  };
  search.addEventListener('input', () => { const t = search.value.trim().toLowerCase(); setChildren(results, t.length < 2 ? [] : catalog.filter((p) => `${p.name} ${p.label}`.toLowerCase().includes(t)).slice(0, 8).map((p) => h('button', { class: 'menu-item', type: 'button', onclick: () => {
    const ex = cart.find((l) => l.variantId === p.variantId); if (ex) ex.qty += 1; else cart.push({ variantId: p.variantId, description: `${p.name} (${p.label})`, qty: 1, unit: p.pricePyg, discount: 0 }); search.value = ''; setChildren(results, []); draw(); } }, `${p.name} · ${p.label} · ${formatGs(p.pricePyg)}`))); });
  const addFree = h('button', { class: 'btn', type: 'button', onclick: () => { const n = parseGs(freePrice.value); if (freeDesc.value.trim().length < 2 || Number.isNaN(n)) { toast('Completá descripción y precio entero', 'err'); return; } cart.push({ variantId: null, description: freeDesc.value.trim(), qty: 1, unit: n, discount: 0 }); freeDesc.value = ''; freePrice.value = ''; draw(); } }, 'Agregar ítem libre');
  const save = h('button', { class: 'btn primary', type: 'button', onclick: async (ev) => {
    err.hidden = true; if (!customer) { err.hidden = false; err.textContent = 'Elegí el cliente'; return; } if (!cart.length) { err.hidden = false; err.textContent = 'Agregá al menos un ítem'; return; }
    const items = cart.map((l) => (l.variantId ? { variantId: l.variantId, qty: l.qty, ...(l.discount ? { discountPyg: l.discount } : {}) } : { description: l.description, qty: l.qty, unitPricePyg: l.unit }));
    const body = { validUntil: valid.querySelector('input').value || null, notes: notes.querySelector('input').value.trim() || null, items };
    try { const r = await withBusy(ev.currentTarget, () => (editing ? eventsApi.updateQuotation(params.id, body).then(() => ({ id: params.id })) : eventsApi.createQuotation({ ...body, customerId: customer.id, eventId: evSel.querySelector('select').value ? Number(evSel.querySelector('select').value) : null })));
      toast('Cotización guardada'); navigate(`/cotizaciones/${r.id}`); } catch (e) { err.hidden = false; err.textContent = e.message; } } }, editing ? 'Guardar cambios' : 'Crear cotización');
  draw(); if (!editing) loadEvents();
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Eventos', href: '#/eventos' }, { label: editing ? q.number : 'Nueva cotización' }]), pageHead({ title: editing ? `Editar ${q.number}` : 'Nueva cotización' }),
    h('form', { class: 'card', style: 'padding:16px;display:grid;gap:12px', novalidate: true, onsubmit: (e) => e.preventDefault() }, err, editing ? h('p', {}, h('strong', {}, customer.name)) : [h('h2', {}, 'Cliente'), picker, evSel],
      h('h2', {}, 'Ítems'), catalog.length ? search : h('div', { class: 'muted small' }, 'No tenés permiso para el catálogo: solo ítems libres.'), results, h('div', { class: 'toolbar', style: 'border:0' }, freeDesc, freePrice, addFree), lines, total, valid, notes, h('div', { class: 'toolbar', style: 'border:0' }, save)));
}
