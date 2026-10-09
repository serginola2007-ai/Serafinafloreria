import { h, setChildren } from '../../components/dom.js';
import { field, input, select, checkbox, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { productPicker } from '../../components/product-picker.js';
import { toast } from '../../components/toast.js';
import { recipesApi } from '../../api/resources.js';
import { formatGs, parseGs, parseQty, formatQty } from '../../utils/format.js';

/** Receta de una variante: componentes y cantidades, costos extra, costo total, margen y cuántas unidades se pueden armar. */
export async function openRecipe({ variant, product, canEdit, onChanged }) {
  const body = h('div', {}, skeletonRows(6));
  const save = h('button', { class: 'btn primary', type: 'button' }, 'Guardar receta');
  const m = openModal({ title: `Receta · ${product.name}${variant.label !== 'Único' ? ` (${variant.label})` : ''}`, wide: true, content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar'), canEdit && save].filter(Boolean) });
  let rec; try { rec = await recipesApi.get(variant.id); } catch (e) { setChildren(body, errorState(e.message)); return; }
  const rows = rec.components.map((c) => ({ productId: c.productId, name: c.name, unit: c.unit, qty: String(c.qty), avg: c.avgCostPyg }));
  const extras = rec.extras.map((e) => ({ concept: e.concept, amount: String(e.amountPyg) })); let enabled = rec.enabled;
  const summary = h('div', {}); const table = h('div', {}); const extraBox = h('div', {}); const err = h('div', { class: 'form-error', role: 'alert', hidden: true });

  const lineCost = (r) => { const q = parseQty(r.qty); return Number.isNaN(q) ? 0 : Math.round(q * r.avg); };
  function drawSummary() {
    const comp = rows.reduce((a, r) => a + lineCost(r), 0); const ex = extras.reduce((a, e) => a + (parseGs(e.amount) || 0), 0); const total = comp + ex; const margin = rec.pricePyg - total; const pct = rec.pricePyg > 0 ? Math.round((margin / rec.pricePyg) * 1000) / 10 : null;
    const stat = (l, v, cls) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value', style: `font-size:24px;${cls ?? ''}` }, v));
    setChildren(summary, h('div', { class: 'grid cols-4', style: 'margin:12px 0' }, stat('Costo (aprox.)', formatGs(total)), stat('Precio de venta', formatGs(rec.pricePyg)), stat('Margen', rows.length ? formatGs(margin) : '—', margin < 0 ? 'color:var(--err)' : ''), stat('% de margen', rows.length && pct != null ? `${pct}%` : '—')),
      rec.hasRecipe && h('p', { class: 'small muted' }, rec.costComplete ? '' : 'Hay componentes sin costo cargado: el margen no es confiable.', rec.buildable != null && ` Con el stock actual se pueden armar ${rec.buildable} unidad(es).`));
  }
  function drawRows() {
    setChildren(table, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ['Componente', 'Cantidad por unidad', 'Costo prom.', 'Costo', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows.length ? rows.map((r, i) => h('tr', {}, h('td', {}, r.name), h('td', {}, h('input', { class: 'input', style: 'max-width:110px', inputmode: 'decimal', value: r.qty, disabled: !canEdit, 'aria-label': `Cantidad de ${r.name}`, oninput: (e) => { r.qty = e.target.value; drawSummary(); const cell = e.target.closest('tr').querySelector('.lc'); if (cell) cell.textContent = formatGs(lineCost(r)); } }), ` ${r.unit}`),
        h('td', {}, r.avg ? formatGs(r.avg) : badge('Sin costo', 'warn')), h('td', { class: 'lc' }, formatGs(lineCost(r))), h('td', {}, canEdit && h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `Quitar ${r.name}`, onclick: () => { rows.splice(i, 1); drawRows(); drawSummary(); } }, '✕'))))
        : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Todavía no tiene componentes.'))]))));
  }
  function drawExtras() {
    setChildren(extraBox, h('h3', { style: 'margin:14px 0 6px' }, 'Otros costos (mano de obra, energía…)'), extras.map((e, i) => h('div', { class: 'pay-line' }, h('input', { class: 'input', value: e.concept, placeholder: 'Concepto', 'aria-label': 'Concepto del costo', disabled: !canEdit, oninput: (ev) => { e.concept = ev.target.value; } }),
      h('input', { class: 'input price-input', inputmode: 'numeric', value: e.amount, placeholder: 'Gs. por unidad', 'aria-label': 'Monto del costo', disabled: !canEdit, oninput: (ev) => { e.amount = ev.target.value; drawSummary(); } }), canEdit && h('button', { class: 'btn sm danger', type: 'button', 'aria-label': 'Quitar costo', onclick: () => { extras.splice(i, 1); drawExtras(); drawSummary(); } }, '✕'))),
      canEdit && h('button', { class: 'btn sm', type: 'button', onclick: () => { extras.push({ concept: '', amount: '' }); drawExtras(); } }, 'Agregar costo'));
  }
  const picker = productPicker({ id: 'rc-prod' }); const qtyNew = input({ inputmode: 'decimal', placeholder: 'Cantidad', 'aria-label': 'Cantidad del nuevo componente', style: 'max-width:120px' });
  const addBtn = h('button', { class: 'btn', type: 'button' }, 'Agregar componente');
  addBtn.addEventListener('click', () => { const it = picker.getItem(); const q = parseQty(qtyNew.value); if (!it) { toast('Elegí un componente', 'err'); return; } if (Number.isNaN(q)) { toast('Cantidad mayor que 0 (hasta 3 decimales)', 'err'); return; }
    if (rows.some((r) => r.productId === it.id)) { toast('Ese componente ya está en la receta', 'err'); return; } rows.push({ productId: it.id, name: it.name, unit: it.unit, qty: String(q), avg: 0 }); qtyNew.value = ''; drawRows(); drawSummary(); });
  const others = (product.variants || []).filter((v) => v.id !== variant.id); const src = select(others.map((v) => ({ value: v.id, label: v.label })), others[0]?.id); const factor = input({ value: '1', inputmode: 'decimal', style: 'max-width:90px', 'aria-label': 'Factor' });
  const copyBtn = h('button', { class: 'btn sm', type: 'button' }, 'Copiar receta');
  copyBtn.addEventListener('click', async () => { const f = Number(factor.value.replace(',', '.')); if (!(f > 0)) { toast('Factor inválido', 'err'); return; } try { await withBusy(copyBtn, () => recipesApi.copyFrom(variant.id, Number(src.value), f)); toast('Receta copiada'); m.close(); onChanged?.(); openRecipe({ variant, product, canEdit, onChanged }); } catch (e) { toast(e.message, 'err'); } });
  const enabledBox = checkbox('Descontar estos componentes al vender', { checked: enabled, disabled: !canEdit }); enabledBox.querySelector('input').addEventListener('change', (e) => { enabled = e.target.checked; });

  setChildren(body, err, h('p', { class: 'muted small' }, 'Al vender una unidad se descuentan estos componentes del inventario y se guarda su costo real en la venta.'), summary, table,
    canEdit && h('div', { class: 'card card-pad', style: 'margin:12px 0' }, h('div', { style: 'display:grid;grid-template-columns:2fr auto auto;gap:10px;align-items:start' }, picker, qtyNew, addBtn)),
    extraBox, h('div', { style: 'margin-top:12px' }, enabledBox), canEdit && others.length > 0 && h('div', { class: 'card card-pad', style: 'margin-top:12px' }, h('strong', {}, 'Copiar desde otra variante '), h('div', { class: 'actions', style: 'margin-top:6px' }, src, h('span', { class: 'small muted' }, '× factor'), factor, copyBtn)));
  drawRows(); drawExtras(); drawSummary();
  save.addEventListener('click', async () => {
    err.hidden = true;
    const components = []; for (const r of rows) { const q = parseQty(r.qty); if (Number.isNaN(q)) { err.hidden = false; err.textContent = `Cantidad inválida en “${r.name}”.`; return; } components.push({ productId: r.productId, qty: q }); }
    const ex = []; for (const e of extras) { if (!e.concept.trim() && !e.amount.trim()) continue; const a = parseGs(e.amount); if (!e.concept.trim() || Number.isNaN(a)) { err.hidden = false; err.textContent = 'Cada costo extra necesita concepto y un monto entero.'; return; } ex.push({ concept: e.concept.trim(), amountPyg: a }); }
    try { const r = await withBusy(save, () => recipesApi.save(variant.id, { enabled, components, extras: ex })); toast(`Receta guardada · costo ${formatGs(r.totalCostPyg)}${r.marginPct != null ? ` · margen ${r.marginPct}%` : ''}`); m.close(); onChanged?.(); } catch (e) { err.hidden = false; err.textContent = e.message; }
  });
  void formatQty;
}
