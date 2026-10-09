import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { deliveryApi, ordersApi } from '../../api/resources.js';
import { formatGs, formatDate, parseGs } from '../../utils/format.js';

const STATUS = { pendiente: ['Pendiente', 'warn'], asignado: ['Asignado', 'info'], listo: ['Listo para salir', 'ok'], en_camino: ['En camino', 'info'], entregado: ['Entregado', 'ok'], no_entregado: ['No entregado', 'err'], reprogramado: ['Reprogramado', 'warn'], cancelado: ['Cancelado', 'err'] };

/** Vista única: el administrador/ventas ve todas las entregas; el repartidor (solo delivery.own) ve únicamente las suyas, en tarjetas pensadas para el celular. */
export default async function mount({ view, session }) {
  const manager = session.can('delivery.edit'); const holder = h('div', {}); const st = { date: '', status: 'active' };
  const date = input({ type: 'date', 'aria-label': 'Fecha' }); const status = select([{ value: 'active', label: 'Activas' }, { value: 'all', label: 'Todas' }, ...Object.entries(STATUS).map(([v, [l]]) => ({ value: v, label: l }))], 'active', { 'aria-label': 'Estado' });
  [date, status].forEach((e) => e.addEventListener('input', () => { st.date = date.value; st.status = status.value; load(); }));
  let couriers = []; if (manager) { try { couriers = (await deliveryApi.couriers()).data; } catch { /* sin repartidores */ } }
  const zonesBtn = manager ? h('button', { class: 'btn', type: 'button', onclick: openZones }, 'Zonas y tarifas') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Entregas' }]), pageHead({ title: manager ? 'Entregas' : 'Mis entregas', subtitle: manager ? 'Asignación, seguimiento y cierre de entregas.' : 'Entregas asignadas a vos.', actions: zonesBtn }),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, h('label', { class: 'small muted' }, 'Fecha ', date), status)), holder);
  const run = (fn, msg) => async (ev) => { try { await withBusy(ev.currentTarget, fn); toast(msg); load(); } catch (e) { toast(e.message, 'err'); } };
  function card(d) {
    const btns = [];
    if (manager && !['entregado', 'cancelado'].includes(d.status)) btns.push(h('button', { class: 'btn sm', type: 'button', onclick: () => assignDialog(d) }, d.courier ? 'Cambiar repartidor' : 'Asignar'));
    if (d.courier && ['listo', 'asignado', 'reprogramado', 'no_entregado'].includes(d.status) && ['listo', 'reprogramado', 'no_entregado'].includes(d.orderStatus)) btns.push(h('button', { class: 'btn sm primary', type: 'button', onclick: run(() => deliveryApi.start(d.id), 'Salió a entregar') }, 'Salir a entregar'));
    if (d.status === 'en_camino') btns.push(h('button', { class: 'btn sm primary', type: 'button', onclick: () => deliverDialog(d) }, 'Entregado'), h('button', { class: 'btn sm danger', type: 'button', onclick: () => failDialog(d) }, 'No se pudo entregar'));
    if (!['entregado', 'cancelado'].includes(d.status)) btns.push(h('button', { class: 'btn sm', type: 'button', onclick: () => rescheduleDialog(d) }, 'Reprogramar'));
    return h('article', { class: 'card', style: 'padding:12px;display:grid;gap:6px' }, h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('strong', {}, d.recipient ?? '—'), badge(...(STATUS[d.status] ?? [d.status, '']))),
      h('div', { class: 'small muted' }, `${d.orderNumber} · ${formatDate(d.scheduledDate)}${d.timeSlot ? ` · ${d.timeSlot}` : ''}`), d.address && h('div', {}, d.address, d.zone && ` (${d.zone})`), d.reference && h('div', { class: 'small muted' }, d.reference),
      d.phone && h('a', { href: `tel:${d.phone.replace(/[^\d+]/g, '')}` }, d.phone), d.cardMessage && h('div', { class: 'small' }, `Tarjeta: “${d.cardMessage}”`), d.balancePyg > 0 && h('div', { class: 'alert warn', style: 'margin:0' }, `Cobrar al entregar: ${formatGs(d.balancePyg)}`),
      d.failureReason && h('div', { class: 'small muted' }, `Motivo: ${d.failureReason}`), manager && h('div', { class: 'small muted' }, d.courier ? `Repartidor: ${d.courier.name}` : 'Sin repartidor'),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, d.mapsUrl && h('a', { class: 'btn sm', href: d.mapsUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir mapa'), h('a', { class: 'btn sm', href: `#/pedidos/${d.orderId}` }, 'Pedido'), ...btns));
  }
  async function load() {
    setChildren(holder, skeletonRows(5));
    try { const r = await deliveryApi.list({ status: st.status, date: st.date || undefined }); setChildren(holder, r.data.length ? h('div', { class: 'grid cols-3' }, r.data.map(card)) : emptyState('No hay entregas', 'Las entregas aparecen al confirmar pedidos con delivery.')); }
    catch (e) { setChildren(holder, errorState(e.message, load)); }
  }
  const dialog = (title, body, label, fn, danger) => {
    const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: danger ? 'btn danger solid' : 'btn primary', type: 'button' }, label);
    const m = openModal({ title, content: h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() }, err, ...body), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Volver'), save] });
    save.addEventListener('click', async () => { err.hidden = true; try { await withBusy(save, fn); m.close(); load(); } catch (e) { if (e.__shown) return; err.hidden = false; err.textContent = e.message; } });
  };
  const bad = () => Object.assign(new Error('x'), { __shown: true });
  function assignDialog(d) {
    const sel = field({ id: 'as-c', label: 'Repartidor', control: select([{ value: '', label: 'Sin asignar' }, ...couriers.map((c) => ({ value: String(c.id), label: c.name }))], d.courier ? String(d.courier.id) : '') });
    dialog(`Asignar ${d.orderNumber}`, [couriers.length ? sel : h('div', { class: 'alert warn' }, 'No hay usuarios con rol de repartidor. Crealos en Usuarios.'), couriers.length && sel].filter(Boolean).slice(-1), 'Guardar', () => deliveryApi.assign(d.id, sel.querySelector('select').value ? Number(sel.querySelector('select').value) : null));
  }
  function deliverDialog(d) {
    const due = field({ id: 'dl-d', label: 'Vencimiento del saldo', help: d.balancePyg > 0 ? `Saldo ${formatGs(d.balancePyg)}: si no se cobró, indicá hasta cuándo.` : 'Sin saldo.', control: input({ type: 'date' }) });
    dialog(`Entregar ${d.orderNumber}`, [due], 'Confirmar entrega', async () => { try { await deliveryApi.deliver(d.id, { creditDueDate: due.querySelector('input').value || undefined }); toast('Entrega registrada'); } catch (e) { if (e.code === 'BALANCE_PENDING') { due.setError('Cobrá el saldo desde el pedido o indicá el vencimiento'); throw bad(); } throw e; } });
  }
  function failDialog(d) { const r = field({ id: 'fl-r', label: 'Motivo', required: true, control: input({ maxlength: 300 }) }); dialog(`No entregado ${d.orderNumber}`, [r], 'Registrar', async () => { const t = r.querySelector('input').value.trim(); if (t.length < 3) { r.setError('Indicá el motivo'); throw bad(); } await deliveryApi.fail(d.id, t); }, true); }
  function rescheduleDialog(d) {
    const dt = field({ id: 'rs-d', label: 'Nueva fecha', required: true, control: input({ type: 'date' }) }); const sl = field({ id: 'rs-s', label: 'Horario', control: input({ maxlength: 60 }) }); const rs = field({ id: 'rs-r', label: 'Motivo', required: true, control: input({ maxlength: 300 }) });
    dialog(`Reprogramar ${d.orderNumber}`, [dt, sl, rs], 'Reprogramar', async () => { const v = dt.querySelector('input').value; const r = rs.querySelector('input').value.trim(); if (!v || r.length < 3) { rs.setError('Completá fecha y motivo'); throw bad(); }
      await deliveryApi.reschedule(d.id, { date: v, timeSlot: sl.querySelector('input').value.trim() || null, reason: r }); });
  }
  async function openZones() {
    const list = h('div', {}); const name = input({ placeholder: 'Nombre de la zona', maxlength: 80, 'aria-label': 'Nombre de zona' }); const fee = input({ inputmode: 'numeric', placeholder: 'Tarifa (Gs.)', 'aria-label': 'Tarifa' });
    const draw = async () => { try { const z = (await ordersApi.zones()).data; setChildren(list, z.length ? h('ul', { class: 'list' }, z.map((x) => h('li', {}, h('span', {}, x.name, !x.active && h('span', { class: 'muted' }, ' (inactiva)')), h('span', {}, formatGs(x.feePyg), ' ', h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await ordersApi.updateZone(x.id, { active: !x.active }); draw(); } catch (e) { toast(e.message, 'err'); } } }, x.active ? 'Desactivar' : 'Activar'))))) : emptyState('Sin zonas', 'Agregá zonas con su tarifa de delivery.')); } catch (e) { setChildren(list, errorState(e.message, draw)); } };
    const add = h('button', { class: 'btn primary', type: 'button', onclick: async () => { const n = parseGs(fee.value); if (!name.value.trim() || Number.isNaN(n)) { toast('Completá nombre y tarifa (entero)', 'err'); return; } try { await ordersApi.createZone({ name: name.value.trim(), feePyg: n }); name.value = ''; fee.value = ''; draw(); } catch (e) { toast(e.message, 'err'); } } }, 'Agregar');
    openModal({ title: 'Zonas y tarifas de delivery', content: h('div', {}, list, h('div', { class: 'toolbar', style: 'border:0' }, name, fee, add)), footer: [] }); await draw();
  }
  await load();
}
