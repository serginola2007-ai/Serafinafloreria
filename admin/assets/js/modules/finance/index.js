import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { financeApi, purchasingApi } from '../../api/resources.js';
import { formatGs, formatDate, parseGs } from '../../utils/format.js';

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA'); };
const todayStr = () => new Date().toLocaleDateString('en-CA');
const bad = () => Object.assign(new Error('x'), { __shown: true });

export default async function mount({ view, session }) {
  const canEdit = session.can('finanzas.edit'); const st = { from: monthStart(), to: todayStr(), page: 1, categoryId: '' }; const sumBox = h('div', {}); const listBox = h('div', {});
  const from = input({ type: 'date', value: st.from, 'aria-label': 'Desde' }); const to = input({ type: 'date', value: st.to, 'aria-label': 'Hasta' });
  const cat = select([{ value: '', label: 'Todas las categorías' }], '', { 'aria-label': 'Categoría' });
  let categories = []; try { categories = (await financeApi.categories()).data; } catch { /* se muestra vacío */ }
  const fillCats = () => { cat.replaceChildren(...[{ value: '', label: 'Todas las categorías' }, ...categories.map((c) => ({ value: String(c.id), label: c.name + (c.active ? '' : ' (inactiva)') }))].map((o) => h('option', { value: o.value }, o.label))); };
  fillCats();
  [from, to, cat].forEach((e) => e.addEventListener('input', () => { if (from.value && to.value && from.value <= to.value) { Object.assign(st, { from: from.value, to: to.value, categoryId: cat.value, page: 1 }); load(); } }));
  const actions = canEdit ? [h('button', { class: 'btn', type: 'button', onclick: manageCats }, 'Categorías'), h('button', { class: 'btn primary', type: 'button', onclick: newExpense }, 'Registrar gasto')] : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Finanzas' }]), pageHead({ title: 'Finanzas', subtitle: 'Resumen de gestión y gastos operativos (no es un balance contable).', actions }),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, h('label', { class: 'small muted' }, 'Desde ', from), h('label', { class: 'small muted' }, 'Hasta ', to), cat)), sumBox, listBox);
  const stat = (l, v, s) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value', style: 'font-size:24px' }, v), s && h('div', { class: 'muted small' }, s));

  async function load() {
    setChildren(sumBox, skeletonRows(2)); setChildren(listBox, skeletonRows(5));
    try {
      const [s, e] = await Promise.all([financeApi.summary({ from: st.from, to: st.to }), financeApi.expenses({ from: st.from, to: st.to, categoryId: st.categoryId || undefined, page: st.page, limit: 15, status: 'all' })]);
      setChildren(sumBox, !s.costComplete && h('div', { class: 'alert warn', role: 'alert' }, `Hay ${s.unknownCostLines} línea(s) vendida(s) sin costo conocido: el margen y el resultado no se calculan para no inventar números. Cargá recetas o costos de esos productos.`),
        h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, stat('Ventas', formatGs(s.salesPyg), `${s.salesCount} venta(s)`), stat('Costo de lo vendido', formatGs(s.costPyg), s.costComplete ? 'Costo congelado al vender' : 'Incompleto'),
          stat('Margen bruto', s.grossMarginPyg == null ? 'No disponible' : formatGs(s.grossMarginPyg)), stat('Gastos', formatGs(s.expensesPyg)),
          stat('Resultado operativo', s.operatingResultPyg == null ? 'No disponible' : formatGs(s.operatingResultPyg), 'Margen − gastos'), stat('Por cobrar', formatGs(s.receivablePyg), 'Total a la fecha'), stat('Por pagar', formatGs(s.payablePyg), 'Total a la fecha')),
        s.expensesByCategory.length ? h('section', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'card-head' }, h('h2', {}, 'Gastos por categoría')), h('ul', { class: 'list' }, s.expensesByCategory.map((x) => h('li', {}, h('span', {}, x.name), h('strong', {}, formatGs(x.totalPyg)))))) : null,
        h('p', { class: 'muted small' }, s.note));
      setChildren(listBox, h('div', { class: 'card' }, e.data.length ? dataTable({ rows: e.data, columns: [
        { key: 'n', label: 'Número', render: (x) => h('strong', {}, x.number) }, { key: 'd', label: 'Fecha', render: (x) => formatDate(x.date) }, { key: 'c', label: 'Categoría', render: (x) => x.category.name },
        { key: 'co', label: 'Concepto', render: (x) => h('span', {}, x.concept, x.supplier && h('span', { class: 'muted small' }, ` · ${x.supplier.name}`), x.status === 'anulado' && h('span', { class: 'muted small' }, ` · ${x.voidReason}`)) },
        { key: 'm', label: 'Pago', render: (x) => x.method }, { key: 'a', label: 'Monto', render: (x) => h('strong', {}, formatGs(x.amountPyg)) }, { key: 's', label: 'Estado', render: (x) => (x.status === 'anulado' ? badge('Anulado', 'err') : badge('Registrado', 'ok')) }],
        actions: (x) => (canEdit && x.status === 'registrado' ? [h('button', { class: 'btn sm danger', type: 'button', onclick: () => voidExpense(x) }, 'Anular')] : []) }) : emptyState('Sin gastos', 'No hay gastos en el período.'), pager({ meta: e.meta, onPage: (p) => { st.page = p; load(); } })));
    } catch (er) { setChildren(sumBox, errorState(er.message, load)); setChildren(listBox); }
  }
  const dialog = (title, body, label, fn, danger) => {
    const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: danger ? 'btn danger solid' : 'btn primary', type: 'button' }, label);
    const m = openModal({ title, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err, ...body), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Volver'), save] });
    save.addEventListener('click', async () => { err.hidden = true; try { await withBusy(save, fn); m.close(); load(); } catch (e) { if (e.__shown) return; err.hidden = false; err.textContent = e.code === 'CASH_CLOSED' ? 'La caja está cerrada: abrila para registrar gastos en efectivo.' : e.message; } });
  };
  async function newExpense() {
    let methods = []; try { methods = (await purchasingApi.methods()).data; } catch (e) { toast(e.message, 'err'); return; }
    const active = categories.filter((c) => c.active); if (!active.length) { toast('Primero creá una categoría de gastos', 'err'); manageCats(); return; }
    const c = field({ id: 'ex-c', label: 'Categoría', required: true, control: select(active.map((x) => ({ value: String(x.id), label: x.name })), String(active[0].id)) });
    const con = field({ id: 'ex-con', label: 'Concepto', required: true, control: input({ maxlength: 200 }) }); const amt = field({ id: 'ex-a', label: 'Monto (Gs.)', required: true, control: input({ inputmode: 'numeric' }) });
    const dt = field({ id: 'ex-d', label: 'Fecha', control: input({ type: 'date', value: todayStr(), max: todayStr() }) }); const m = field({ id: 'ex-m', label: 'Forma de pago', help: 'El efectivo sale de la caja abierta.', control: select(methods.map((x) => ({ value: x.code, label: x.name })), methods[0]?.code) });
    const doc = field({ id: 'ex-doc', label: 'Nº de factura o recibo', control: input({ maxlength: 60 }) });
    dialog('Registrar gasto', [c, con, amt, dt, m, doc], 'Registrar', async () => {
      const n = parseGs(amt.querySelector('input').value); const t = con.querySelector('input').value.trim();
      if (t.length < 2) { con.setError('Indicá el concepto'); throw bad(); } if (Number.isNaN(n) || n <= 0) { amt.setError('Monto entero mayor que 0'); throw bad(); }
      await financeApi.createExpense({ categoryId: Number(c.querySelector('select').value), concept: t, amountPyg: n, date: dt.querySelector('input').value || undefined, methodCode: m.querySelector('select').value, documentNo: doc.querySelector('input').value.trim() || null }); toast('Gasto registrado'); });
  }
  function voidExpense(x) {
    const r = field({ id: 'xv-r', label: 'Motivo de la anulación', required: true, help: 'Si se pagó en efectivo, el dinero vuelve a la caja abierta.', control: input({ maxlength: 300 }) });
    dialog(`Anular ${x.number}`, [r], 'Anular gasto', async () => { const t = r.querySelector('input').value.trim(); if (t.length < 3) { r.setError('Indicá el motivo'); throw bad(); } await financeApi.voidExpense(x.id, t); toast('Gasto anulado'); }, true);
  }
  function manageCats() {
    const list = h('div', {}); const name = input({ placeholder: 'Nueva categoría (ej. Alquiler)', maxlength: 80, 'aria-label': 'Nombre de categoría' });
    const draw = () => { setChildren(list, categories.length ? h('ul', { class: 'list' }, categories.map((x) => h('li', {}, h('span', {}, x.name, !x.active && h('span', { class: 'muted' }, ' (inactiva)')),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await financeApi.updateCategory(x.id, { active: !x.active }); x.active = !x.active; fillCats(); draw(); } catch (e) { toast(e.message, 'err'); } } }, x.active ? 'Desactivar' : 'Activar')))) : emptyState('Sin categorías', 'Creá las categorías que uses (alquiler, sueldos, servicios…).')); };
    const add = h('button', { class: 'btn primary', type: 'button', onclick: async () => { const v = name.value.trim(); if (v.length < 2) return; try { await financeApi.createCategory(v); categories = (await financeApi.categories()).data; name.value = ''; fillCats(); draw(); } catch (e) { toast(e.message, 'err'); } } }, 'Agregar');
    draw(); openModal({ title: 'Categorías de gastos', content: h('div', {}, list, h('div', { class: 'toolbar', style: 'border:0' }, name, add)), footer: [] });
  }
  await load();
}
