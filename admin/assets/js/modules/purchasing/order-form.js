import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState } from '../../components/states.js';
import { productPicker } from '../../components/product-picker.js';
import { toast } from '../../components/toast.js';
import { purchasingApi, suppliersApi } from '../../api/resources.js';
import { formatGs, parseGs, parseQty } from '../../utils/format.js';

/** Crear (/compras/nueva) o editar un borrador (/compras/:id/editar). */
export default async function mount({ view, params, query, navigate }) {
  const editing = !!params.id; const root = h('div', {}, skeletonRows(6)); view.append(root);
  let order = null; let suppliers = [];
  try {
    suppliers = (await suppliersApi.list({ limit: 100 })).data.filter((s) => s.active);
    if (editing) { order = await purchasingApi.get(params.id); if (order.status !== 'borrador') { navigate(`/compras/${order.id}`, true); return; } }
  } catch (e) { setChildren(root, errorState(e.message)); return; }

  const sup = field({ id: 'o-sup', label: 'Proveedor', required: true, control: select([{ value: '', label: 'Elegí un proveedor' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))], order?.supplier.id ?? query.supplierId ?? '') });
  const exp = field({ id: 'o-exp', label: 'Entrega estimada', control: input({ type: 'date', value: order?.expectedAt ?? '' }) });
  const notes = field({ id: 'o-notes', label: 'Notas', control: h('textarea', { class: 'textarea', rows: 2, maxlength: 1000 }, order?.notes ?? '') });
  const lines = []; const list = h('div', {}); const totalEl = h('strong', {});
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });

  function addLine(init = {}) {
    const picker = productPicker({ id: `l-prod-${lines.length}`, value: init.productId });
    const qty = input({ inputmode: 'decimal', placeholder: 'Cantidad', 'aria-label': 'Cantidad', value: init.qty != null ? String(init.qty) : '' });
    const cost = input({ class: 'input price-input', inputmode: 'numeric', placeholder: 'Costo unitario (Gs.)', 'aria-label': 'Costo unitario', value: init.unitCostPyg != null ? String(init.unitCostPyg) : '' });
    const sub = h('div', { class: 'small muted' });
    const row = h('div', { class: 'card card-pad', style: 'margin-bottom:10px' }, h('div', { class: 'grid', style: 'grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:start' }, picker, qty, h('div', {}, cost, sub),
      h('button', { class: 'btn sm danger', type: 'button', 'aria-label': 'Quitar línea', onclick: () => { lines.splice(lines.indexOf(line), 1); row.remove(); calc(); } }, 'Quitar')));
    const line = { picker, qty, cost, sub };
    const upd = () => { const q = parseQty(qty.value), c = parseGs(cost.value); sub.textContent = !Number.isNaN(q) && !Number.isNaN(c) ? `Subtotal ${formatGs(Math.round(q * c))}` : ''; calc(); };
    qty.addEventListener('input', upd); cost.addEventListener('input', upd);
    picker.addEventListener('change', () => { /* el costo lo ingresa la persona; no se inventa */ });
    lines.push(line); list.append(row); upd();
  }
  function calc() { const t = lines.reduce((a, l) => { const q = parseQty(l.qty.value), c = parseGs(l.cost.value); return a + (Number.isNaN(q) || Number.isNaN(c) ? 0 : Math.round(q * c)); }, 0); totalEl.textContent = formatGs(t); }
  (order?.items.length ? order.items : [{}]).forEach((i) => addLine({ productId: i.productId, qty: i.qtyOrdered, unitCostPyg: i.unitCostPyg }));

  const save = h('button', { class: 'btn primary', type: 'button' }, editing ? 'Guardar cambios' : 'Crear orden (borrador)');
  save.addEventListener('click', async () => {
    err.hidden = true; sup.setError('');
    if (!sup.querySelector('select').value) { sup.setError('Elegí un proveedor'); return; }
    const items = [];
    for (const [i, l] of lines.entries()) {
      const pid = l.picker.getValue(), q = parseQty(l.qty.value), c = parseGs(l.cost.value);
      if (!pid || Number.isNaN(q) || Number.isNaN(c)) { err.hidden = false; err.textContent = `Línea ${i + 1}: elegí el producto, una cantidad (hasta 3 decimales) y un costo entero en guaraníes.`; return; }
      items.push({ productId: pid, qty: q, unitCostPyg: c });
    }
    if (!items.length) { err.hidden = false; err.textContent = 'Agregá al menos una línea.'; return; }
    const body = { supplierId: Number(sup.querySelector('select').value), expectedAt: exp.querySelector('input').value || null, notes: notes.querySelector('textarea').value.trim() || null, items };
    try { const r = await withBusy(save, () => (editing ? purchasingApi.update(order.id, body) : purchasingApi.create(body))); toast(editing ? 'Orden actualizada' : `Orden ${r.number} creada`); navigate(`/compras/${r.id}`); }
    catch (e) { err.hidden = false; err.textContent = e.message; }
  });

  setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Compras' }, { label: 'Órdenes de compra', href: '#/compras' }, { label: editing ? order.number : 'Nueva orden' }]),
    pageHead({ title: editing ? `Editar ${order.number}` : 'Nueva orden de compra' }),
    h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err, h('section', { class: 'card card-pad', style: 'margin-bottom:16px' }, h('div', { class: 'grid cols-2' }, sup, exp), notes),
      h('section', { class: 'card card-pad' }, h('div', { class: 'card-head', style: 'padding:0 0 12px;border:0' }, h('h2', {}, 'Productos'), h('button', { class: 'btn sm', type: 'button', onclick: () => addLine() }, 'Agregar línea')), list,
        h('p', { style: 'text-align:right;margin:8px 0 0' }, 'Total estimado: ', totalEl)),
      h('div', { class: 'actions', style: 'margin-top:16px' }, save, h('a', { class: 'btn', href: editing ? `#/compras/${order.id}` : '#/compras' }, 'Cancelar'))));
}
