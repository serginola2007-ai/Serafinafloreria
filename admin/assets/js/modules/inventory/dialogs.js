import { h, setChildren } from '../../components/dom.js';
import { field, input, select, applyServerErrors, withBusy } from '../../components/form.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { productPicker } from '../../components/product-picker.js';
import { skeletonRows, badge } from '../../components/states.js';
import { inventoryApi, categoriesApi, productsApi } from '../../api/resources.js';
import { parseQty, parseGs, formatGs, formatQty, formatDate, formatDateTime, MOVEMENT_TYPES } from '../../utils/format.js';
import { session } from '../../auth/session.js';

const KINDS = [['raw_flower', 'Flor'], ['foliage', 'Follaje'], ['supply', 'Insumo'], ['accessory', 'Accesorio'], ['packaging', 'Packaging'], ['finished', 'Producto terminado']];
export const STATUS = { out: ['Agotado', 'err'], low: ['Stock bajo', 'warn'], excess: ['Exceso', 'info'], ok: ['Normal', 'ok'] };
export const statusBadge = (s) => badge(...(STATUS[s] || [s, '']));
const errBox = () => h('div', { class: 'form-error', role: 'alert', hidden: true });

/** Ajuste manual de stock (+/−), siempre con motivo. */
export function openAdjust({ item, onDone }) {
  const dir = field({ id: 'a-dir', label: 'Tipo de ajuste', control: select([{ value: 'in', label: 'Ingreso (suma stock)' }, { value: 'out', label: 'Egreso (resta stock)' }], 'in') });
  const qty = field({ id: 'a-qty', label: `Cantidad (${item.unit})`, required: true, help: 'Hasta 3 decimales.', control: input({ inputmode: 'decimal' }) });
  const cost = field({ id: 'a-cost', label: 'Costo unitario (Gs.)', help: item.avgCostPyg ? `Vacío = costo promedio actual (${formatGs(item.avgCostPyg)}).` : 'Obligatorio: el producto todavía no tiene costo.', control: input({ inputmode: 'numeric' }) });
  const exp = field({ id: 'a-exp', label: 'Vencimiento / deterioro estimado (opcional)', control: input({ type: 'date' }) });
  const reason = field({ id: 'a-reason', label: 'Motivo', required: true, help: 'Ej.: carga inicial, conteo físico, hallazgo.', control: input({ maxlength: 200 }) });
  const err = errBox();
  const v = (f) => f.querySelector('input,select').value;
  const sync = () => { const out = v(dir) === 'out'; cost.hidden = out; exp.hidden = out; };
  dir.querySelector('select').addEventListener('change', sync);
  const save = h('button', { class: 'btn primary', type: 'button' }, 'Registrar ajuste');
  const m = openModal({ title: `Ajustar stock · ${item.name}`, content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } },
    h('p', { class: 'muted small' }, `Stock físico actual: ${formatQty(item.onHand)} ${item.unit} · disponible ${formatQty(item.available)}`), err, dir, qty, cost, exp, reason),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  sync();
  save.addEventListener('click', async () => {
    err.hidden = true; [qty, cost, reason].forEach((f) => f.setError(''));
    const q = parseQty(v(qty)); if (Number.isNaN(q)) { qty.setError('Ingresá una cantidad mayor que 0 (hasta 3 decimales)'); return; }
    if (v(reason).trim().length < 3) { reason.setError('Indicá el motivo (mínimo 3 caracteres)'); return; }
    const body = { productId: item.id, direction: v(dir), qty: q, reason: v(reason).trim() };
    if (body.direction === 'in') {
      if (v(cost).trim()) { const c = parseGs(v(cost)); if (Number.isNaN(c)) { cost.setError('Costo entero en guaraníes'); return; } body.unitCostPyg = c; }
      if (v(exp)) body.expiresAt = v(exp);
    }
    try { await withBusy(save, () => inventoryApi.adjust(body)); toast('Ajuste registrado'); m.close(); onDone(); }
    catch (e) { if (e.code === 'COST_REQUIRED') cost.setError(e.message); else if (e.code === 'INSUFFICIENT_STOCK') qty.setError(e.message); else applyServerErrors(e, { qty, reason }, err); }
  });
}

/** Registro de merma (pérdida) con motivo configurable. item opcional: si falta, se elige producto. */
export async function openWaste({ item, onDone }) {
  let reasons = [];
  try { reasons = (await inventoryApi.wasteReasons()).data.filter((r) => r.active); } catch (e) { toast(e.message, 'err'); return; }
  const picker = item ? null : productPicker({ id: 'w-prod' });
  const qty = field({ id: 'w-qty', label: item ? `Cantidad (${item.unit})` : 'Cantidad', required: true, control: input({ inputmode: 'decimal' }) });
  const reason = field({ id: 'w-reason', label: 'Motivo', required: true, control: select(reasons.map((r) => ({ value: r.code, label: r.name })), reasons[0]?.code) });
  const note = field({ id: 'w-note', label: 'Observación', control: input({ maxlength: 500 }) });
  const err = errBox(); const save = h('button', { class: 'btn primary', type: 'button' }, 'Registrar merma');
  const m = openModal({ title: item ? `Registrar merma · ${item.name}` : 'Registrar merma', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } },
    err, !item && h('div', { class: 'field' }, h('label', { for: 'w-prod' }, 'Producto *'), picker), qty, reason, note, h('p', { class: 'small muted' }, 'El costo se toma de los lotes que se descuentan (primero lo que vence antes).')),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  const v = (f) => f.querySelector('input,select').value;
  save.addEventListener('click', async () => {
    err.hidden = true; qty.setError('');
    const pid = item ? item.id : picker.getValue(); if (!pid) { err.hidden = false; err.textContent = 'Elegí un producto'; return; }
    const q = parseQty(v(qty)); if (Number.isNaN(q)) { qty.setError('Ingresá una cantidad mayor que 0 (hasta 3 decimales)'); return; }
    try { const r = await withBusy(save, () => inventoryApi.waste({ productId: pid, qty: q, reasonCode: v(reason), note: v(note).trim() || null })); toast(`Merma registrada · costo ${formatGs(r.costPyg)}`); m.close(); onDone(); }
    catch (e) { if (e.code === 'INSUFFICIENT_STOCK') qty.setError(e.message); else applyServerErrors(e, { qty }, err); }
  });
}

/** Incorporar un producto existente al control de stock. */
export function openEnroll({ onDone }) {
  const picker = productPicker({ id: 'e-prod', stockableOnly: false });
  const unit = field({ id: 'e-unit', label: 'Unidad de medida', required: true, help: 'Ej.: tallo, unidad, metro, caja.', control: input({ value: 'unidad', maxlength: 20 }) });
  const min = field({ id: 'e-min', label: 'Stock mínimo (alerta)', control: input({ inputmode: 'decimal', value: '0' }) });
  const err = errBox(); const save = h('button', { class: 'btn primary', type: 'button' }, 'Incorporar');
  const m = openModal({ title: 'Incorporar producto al inventario', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err,
    h('div', { class: 'field' }, h('label', { for: 'e-prod' }, 'Producto *'), picker), unit, min),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  save.addEventListener('click', async () => {
    err.hidden = true; const pid = picker.getValue(); if (!pid) { err.hidden = false; err.textContent = 'Elegí un producto'; return; }
    const mn = Number((min.querySelector('input').value || '0').replace(',', '.')); if (Number.isNaN(mn) || mn < 0) { min.setError('Número válido'); return; }
    try { await withBusy(save, () => inventoryApi.enroll({ productId: pid, unit: unit.querySelector('input').value.trim() || 'unidad', minStock: mn })); toast('Producto incorporado al inventario'); m.close(); onDone(); }
    catch (e) { err.hidden = false; err.textContent = e.message; }
  });
}

/** Crear un insumo nuevo (flor, follaje, packaging…) y dejarlo directamente en inventario. */
export async function openNewSupply({ onDone }) {
  let cats = [];
  try { cats = (await categoriesApi.list()).data.filter((c) => !c.archived); } catch (e) { toast(e.message, 'err'); return; }
  if (!cats.length) { toast('Primero creá una categoría (Catálogo → Categorías).', 'err'); return; }
  const f = {
    name: field({ id: 'n-name', label: 'Nombre', required: true, control: input({ maxlength: 120 }) }),
    kind: field({ id: 'n-kind', label: 'Tipo', control: select(KINDS.map(([value, label]) => ({ value, label })).filter((k) => k.value !== 'finished'), 'raw_flower') }),
    categoryId: field({ id: 'n-cat', label: 'Categoría', required: true, control: select(cats.map((c) => ({ value: c.id, label: c.name })), cats[0].id) }),
    unit: field({ id: 'n-unit', label: 'Unidad de medida', required: true, control: input({ value: 'unidad', maxlength: 20 }) }),
    min: field({ id: 'n-min', label: 'Stock mínimo (alerta)', control: input({ inputmode: 'decimal', value: '0' }) }),
  };
  const err = errBox(); const save = h('button', { class: 'btn primary', type: 'button' }, 'Crear insumo');
  const v = (k) => f[k].querySelector('input,select').value;
  const m = openModal({ title: 'Nuevo insumo', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, Object.values(f)),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  save.addEventListener('click', async () => {
    err.hidden = true; Object.values(f).forEach((x) => x.setError(''));
    if (!v('name').trim()) { f.name.setError('El nombre es obligatorio'); return; }
    const mn = Number(v('min').replace(',', '.')); if (Number.isNaN(mn) || mn < 0) { f.min.setError('Número válido'); return; }
    try {
      await withBusy(save, async () => {
        const p = await productsApi.create({ name: v('name').trim(), categoryId: Number(v('categoryId')), kind: v('kind') });
        await inventoryApi.enroll({ productId: p.id, unit: v('unit').trim() || 'unidad', minStock: mn });
      });
      toast('Insumo creado e incorporado al inventario'); m.close(); onDone();
    } catch (e) { applyServerErrors(e, f, err); }
  });
}

/** Detalle: cifras, límites editables, lotes y últimos movimientos. */
export async function openDetail({ item, onChanged }) {
  const body = h('div', {}, skeletonRows(5));
  const m = openModal({ title: item.name, wide: true, content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar')] });
  try {
    const [d, mv] = await Promise.all([inventoryApi.item(item.id), inventoryApi.movements({ productId: item.id, limit: 8 })]);
    const min = field({ id: 'd-min', label: 'Stock mínimo', control: input({ inputmode: 'decimal', value: String(d.minStock), disabled: !session.can('inventario.edit') }) });
    const max = field({ id: 'd-max', label: 'Stock máximo (opcional)', control: input({ inputmode: 'decimal', value: d.maxStock ?? '', disabled: !session.can('inventario.edit') }) });
    const unit = field({ id: 'd-unit', label: 'Unidad', control: input({ value: d.unit, maxlength: 20, disabled: !session.can('inventario.edit') }) });
    const save = h('button', { class: 'btn sm primary', type: 'button' }, 'Guardar límites');
    save.addEventListener('click', async () => {
      const mn = Number(min.querySelector('input').value.replace(',', '.')); const mxRaw = max.querySelector('input').value.trim(); const mx = mxRaw === '' ? null : Number(mxRaw.replace(',', '.'));
      if (Number.isNaN(mn) || mn < 0 || (mx !== null && (Number.isNaN(mx) || mx < mn))) { toast('Revisá los límites: el máximo no puede ser menor que el mínimo', 'err'); return; }
      try { await withBusy(save, () => inventoryApi.settings(d.id, { minStock: mn, maxStock: mx, unit: unit.querySelector('input').value.trim() || d.unit })); toast('Límites guardados'); m.close(); onChanged(); }
      catch (e) { toast(e.message, 'err'); }
    });
    setChildren(body,
      h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' },
        ...[['Físico', `${formatQty(d.onHand)} ${d.unit}`], ['Reservado', formatQty(d.reserved)], ['Disponible', formatQty(d.available)], ['Valor', formatGs(d.valuePyg)]].map(([l, val]) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value', style: 'font-size:24px' }, val)))),
      h('p', {}, 'Costo promedio: ', h('strong', {}, formatGs(d.avgCostPyg)), ' por ', d.unit, ' · ', statusBadge(d.status)),
      session.can('inventario.edit') && h('div', { class: 'card card-pad', style: 'margin:12px 0' }, h('div', { class: 'grid', style: 'grid-template-columns:repeat(3,1fr);gap:10px' }, min, max, unit), save),
      h('h3', { style: 'margin:14px 0 6px' }, 'Lotes con stock'),
      d.lots.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ['Ingreso', 'Quedan', 'Costo', 'Vence', 'Proveedor'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, d.lots.map((l) => h('tr', {}, h('td', {}, formatDate(l.receivedAt)), h('td', {}, `${formatQty(l.qtyRemaining)} / ${formatQty(l.qtyInitial)}`), h('td', {}, formatGs(l.unitCostPyg)), h('td', {}, l.expiresAt ? formatDate(l.expiresAt) : '—'), h('td', {}, l.supplier || '—')))))) : h('p', { class: 'muted' }, 'Sin lotes con stock.'),
      h('h3', { style: 'margin:14px 0 6px' }, 'Últimos movimientos'),
      mv.data.length ? h('ul', { class: 'list' }, mv.data.map((x) => h('li', {}, h('span', {}, h('strong', {}, MOVEMENT_TYPES[x.type] || x.type), ` · ${x.qty > 0 ? '+' : ''}${formatQty(x.qty)} ${x.unit}`, x.reason && h('span', { class: 'muted small' }, ` · ${x.reason}`)), h('span', { class: 'muted small nowrap' }, `${formatDateTime(x.occurredAt)}${x.user ? ' · ' + x.user : ''}`)))) : h('p', { class: 'muted' }, 'Sin movimientos.'));
  } catch (e) { setChildren(body, h('div', { class: 'alert err' }, e.message)); }
}
