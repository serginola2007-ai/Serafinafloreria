import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { customerPicker } from '../../components/customer-picker.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { icon } from '../../components/icons.js';
import { toast } from '../../components/toast.js';
import { eventsApi } from '../../api/resources.js';
import { formatGs, formatDate } from '../../utils/format.js';

export const Q_STATUS = { borrador: ['Borrador', ''], enviada: ['Enviada', 'info'], aceptada: ['Aceptada', 'ok'], rechazada: ['Rechazada', 'err'], convertida: ['Convertida en pedido', 'ok'] };
export const qBadge = (q) => (q.expired ? badge('Vencida', 'err') : badge(...(Q_STATUS[q.status] ?? [q.status, ''])));
const EV_TYPES = { casamiento: 'Casamiento', cumpleanos: 'Cumpleaños', corporativo: 'Corporativo', funebre: 'Fúnebre', aniversario: 'Aniversario', otro: 'Otro' };
const EV_STATUS = { planificado: 'Planificado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado' };

export default async function mount({ view, session }) {
  const canCreate = session.can('eventos.create'); const canEdit = session.can('eventos.edit'); const st = { qp: 1, ep: 1 }; const qBox = h('div', {}); const eBox = h('div', {});
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Eventos' }]), pageHead({ title: 'Eventos y cotizaciones', subtitle: 'Presupuestos para eventos, con seguimiento hasta el pedido.',
    actions: canCreate ? [h('button', { class: 'btn', type: 'button', onclick: newEvent }, 'Nuevo evento'), h('a', { class: 'btn primary', href: '#/cotizaciones/nueva' }, icon('plus'), 'Nueva cotización')] : null }), qBox, eBox);

  async function loadQ() {
    setChildren(qBox, skeletonRows(4));
    try { const r = await eventsApi.quotations({ page: st.qp, limit: 10 });
      setChildren(qBox, h('section', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'card-head' }, h('h2', {}, 'Cotizaciones')), r.data.length ? dataTable({ rows: r.data, columns: [
        { key: 'n', label: 'Número', render: (q) => h('a', { href: `#/cotizaciones/${q.id}` }, h('strong', {}, q.number)) }, { key: 'c', label: 'Cliente', render: (q) => q.customer.name }, { key: 'e', label: 'Evento', render: (q) => q.event?.name ?? '—' },
        { key: 'v', label: 'Válida hasta', render: (q) => formatDate(q.validUntil) }, { key: 't', label: 'Total', render: (q) => h('strong', {}, formatGs(q.totalPyg)) }, { key: 's', label: 'Estado', render: qBadge }],
        actions: (q) => [h('a', { class: 'btn sm', href: `#/cotizaciones/${q.id}` }, 'Abrir')] }) : emptyState('Sin cotizaciones', 'Creá la primera cotización.'), pager({ meta: r.meta, onPage: (p) => { st.qp = p; loadQ(); } })));
    } catch (e) { setChildren(qBox, errorState(e.message, loadQ)); }
  }
  async function loadE() {
    setChildren(eBox, skeletonRows(4));
    try { const r = await eventsApi.events({ page: st.ep, limit: 10 });
      setChildren(eBox, h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Eventos')), r.data.length ? dataTable({ rows: r.data, columns: [
        { key: 'n', label: 'Número', render: (e) => h('strong', {}, e.number) }, { key: 'nm', label: 'Evento', render: (e) => e.name }, { key: 'c', label: 'Cliente', render: (e) => e.customer.name }, { key: 't', label: 'Tipo', render: (e) => EV_TYPES[e.type] },
        { key: 'd', label: 'Fecha', render: (e) => formatDate(e.eventDate) }, { key: 'v', label: 'Lugar', render: (e) => e.venue ?? '—' }, { key: 's', label: 'Estado', render: (e) => (canEdit ? statusSelect(e) : EV_STATUS[e.status]) }] })
        : emptyState('Sin eventos', 'Registrá un evento para asociarle cotizaciones.'), pager({ meta: r.meta, onPage: (p) => { st.ep = p; loadE(); } })));
    } catch (e) { setChildren(eBox, errorState(e.message, loadE)); }
  }
  const statusSelect = (e) => { const s = select(Object.entries(EV_STATUS).map(([value, label]) => ({ value, label })), e.status, { 'aria-label': `Estado de ${e.name}` });
    s.addEventListener('change', async () => { try { await eventsApi.updateEvent(e.id, { status: s.value }); toast('Estado actualizado'); } catch (er) { s.value = e.status; toast(er.message, 'err'); } }); return s; };
  function newEvent() {
    let cust = null; const picker = customerPicker({ onChange: (c) => { cust = c; } });
    const name = field({ id: 'ev-n', label: 'Nombre del evento', required: true, control: input({ maxlength: 160 }) }); const type = field({ id: 'ev-t', label: 'Tipo', control: select(Object.entries(EV_TYPES).map(([value, label]) => ({ value, label })), 'otro') });
    const date = field({ id: 'ev-d', label: 'Fecha', control: input({ type: 'date' }) }); const venue = field({ id: 'ev-v', label: 'Lugar', control: input({ maxlength: 200 }) }); const guests = field({ id: 'ev-g', label: 'Invitados', control: input({ type: 'number', min: '0' }) });
    const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Crear evento');
    const m = openModal({ title: 'Nuevo evento', content: h('form', { novalidate: true, onsubmit: (x) => x.preventDefault() }, err, h('label', { class: 'label' }, 'Cliente'), picker, name, type, date, venue, guests), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
    save.addEventListener('click', async () => { err.hidden = true; if (!cust) { err.hidden = false; err.textContent = 'Elegí el cliente'; return; } const nm = name.querySelector('input').value.trim(); if (nm.length < 2) { name.setError('Indicá el nombre'); return; }
      try { await withBusy(save, () => eventsApi.createEvent({ name: nm, customerId: cust.id, type: type.querySelector('select').value, eventDate: date.querySelector('input').value || null, venue: venue.querySelector('input').value.trim() || null, guests: guests.querySelector('input').value ? Number(guests.querySelector('input').value) : null }));
        toast('Evento creado'); m.close(); loadE(); } catch (e) { err.hidden = false; err.textContent = e.message; } });
  }
  await Promise.all([loadQ(), loadE()]);
}
