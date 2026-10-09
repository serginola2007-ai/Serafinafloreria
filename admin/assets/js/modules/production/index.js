import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { productionApi } from '../../api/resources.js';
import { formatDate, formatQty } from '../../utils/format.js';

const COLS = [['pendiente', 'Pendiente'], ['en_preparacion', 'En preparación'], ['control_calidad', 'Control de calidad'], ['listo', 'Listo']];

export default async function mount({ view, session }) {
  const holder = h('div', {}); const st = { date: '' }; const canEdit = session.can('produccion.edit');
  const date = input({ type: 'date', 'aria-label': 'Fecha de entrega' }); date.addEventListener('input', () => { st.date = date.value; load(); });
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Producción' }]), pageHead({ title: 'Producción', subtitle: 'Armado de pedidos: checklist, control de calidad y consumo de materiales.' }), h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, h('label', { class: 'small muted' }, 'Entrega ', date))), holder);
  async function load() {
    setChildren(holder, skeletonRows(6));
    try {
      const r = await productionApi.list({ status: 'all', limit: 100, date: st.date || undefined });
      const rows = r.data.filter((p) => p.status !== 'cancelado' && (p.status !== 'listo' || ['listo', 'en_preparacion'].includes(p.orderStatus)));
      setChildren(holder, rows.length ? h('div', { class: 'grid cols-4' }, COLS.map(([code, label]) => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, label), badge(String(rows.filter((p) => p.status === code).length))),
        h('div', { style: 'display:grid;gap:8px;padding:8px' }, rows.filter((p) => p.status === code).map((p) => h('button', { class: 'card', type: 'button', style: 'text-align:left;padding:10px;cursor:pointer', onclick: () => openCard(p.id) },
          h('strong', {}, p.description), h('div', { class: 'small muted' }, `${p.orderNumber} · ${formatDate(p.requestedDate)}${p.timeSlot ? ` ${p.timeSlot}` : ''}`), h('div', { class: 'small' }, `Checklist ${p.checklistDone}/${p.checklistTotal}`), p.assignedTo && h('div', { class: 'small muted' }, p.assignedTo.name))))))) : emptyState('Sin producción pendiente', 'Los pedidos confirmados aparecen acá.'));
    } catch (e) { setChildren(holder, errorState(e.message, load)); }
  }
  async function openCard(id) {
    let p; try { p = await productionApi.get(id); } catch (e) { toast(e.message, 'err'); return; }
    const done = (fn) => async (ev) => { try { await withBusy(ev.currentTarget, fn); m.close(); load(); } catch (e) { toast(e.message, 'err'); } };
    const checks = h('ul', { class: 'list' }, p.checklist.map((c) => h('li', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.done, disabled: !canEdit || p.status !== 'en_preparacion' || ['calidad', 'listo'].includes(c.code),
      onchange: async (e) => { try { await productionApi.checklist(p.id, c.code, e.target.checked); } catch (er) { e.target.checked = !e.target.checked; toast(er.message, 'err'); } } }), c.step))));
    const foot = [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar')];
    if (canEdit) {
      if (p.status === 'pendiente') foot.push(h('button', { class: 'btn primary', type: 'button', onclick: done(() => productionApi.start(p.id)) }, 'Iniciar (consume materiales)'));
      if (p.status === 'en_preparacion') foot.push(h('button', { class: 'btn primary', type: 'button', onclick: done(() => productionApi.quality(p.id)) }, 'Pasar a control de calidad'));
      if (p.status === 'control_calidad') foot.push(h('button', { class: 'btn danger', type: 'button', onclick: () => reject(p, m) }, 'Rechazar'), h('button', { class: 'btn primary', type: 'button', onclick: done(() => productionApi.approve(p.id)) }, 'Aprobar'));
    }
    const m = openModal({ title: `${p.description} · ${p.orderNumber}`, wide: true, content: h('div', {}, p.cardMessage && h('div', { class: 'alert info' }, `Tarjeta: “${p.cardMessage}”`), p.notes && h('p', { class: 'muted' }, p.notes),
      h('h3', {}, 'Materiales'), p.materials.length ? h('ul', { class: 'list' }, p.materials.map((x) => h('li', {}, h('span', {}, x.name), h('span', {}, `${formatQty(x.qty)} ${x.unit}`)))) : emptyState('Sin receta', 'Este producto no descuenta materiales.'),
      p.costPyg != null && h('p', { class: 'muted small' }, p.costKnown ? `Costo: ${p.costPyg.toLocaleString('es-PY')} Gs.` : 'Costo desconocido'), h('h3', {}, 'Checklist'), checks), footer: foot });
  }
  function reject(p, parent) {
    const note = field({ id: 'pr-n', label: 'Qué hay que corregir', required: true, control: input({ maxlength: 300 }) }); const save = h('button', { class: 'btn danger solid', type: 'button' }, 'Rechazar');
    const m = openModal({ title: 'Rechazar armado', content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, note), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Volver'), save] });
    save.addEventListener('click', async () => { const t = note.querySelector('input').value.trim(); if (t.length < 3) { note.setError('Indicá el motivo'); return; } try { await withBusy(save, () => productionApi.reject(p.id, t)); m.close(); parent.close(); load(); } catch (e) { toast(e.message, 'err'); } });
  }
  void select;
  await load();
}
