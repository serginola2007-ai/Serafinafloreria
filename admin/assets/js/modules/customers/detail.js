import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, checkbox, select, withBusy, applyServerErrors } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { confirmDialog } from '../../components/confirm.js';
import { toast } from '../../components/toast.js';
import { customersApi, recipientsApi } from '../../api/resources.js';
import { formatGs, formatDate } from '../../utils/format.js';
import { openCustomerForm, KINDS } from './customer-form.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export default async function mount({ view, session, params, navigate }) {
  const root = h('div', {}, skeletonRows(8)); view.append(root); const canEdit = session.can('clientes.edit');
  async function load() {
    let c; try { c = await customersApi.get(params.id); } catch (e) { setChildren(root, errorState(e.message, load)); return; }
    const stat = (l, v) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value', style: 'font-size:26px' }, v));
    const actions = [canEdit && h('button', { class: 'btn', type: 'button', onclick: () => openCustomerForm({ customer: c, onSaved: load }) }, 'Editar'),
      session.can('ventas.create') && h('a', { class: 'btn primary', href: `#/ventas/nueva?customerId=${c.id}` }, 'Nueva venta'),
      session.can('clientes.delete') && h('button', { class: 'btn danger', type: 'button', onclick: archive }, 'Archivar')].filter(Boolean);
    setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Clientes', href: '#/clientes' }, { label: c.name }]),
      pageHead({ title: c.name, subtitle: [KINDS[c.kind], c.phone, c.email, c.taxId && `RUC/CI ${c.taxId}`].filter(Boolean).join(' · '), actions }),
      h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, stat('Total comprado', formatGs(c.totalSpentPyg)), stat('Compras', String(c.purchases)), stat('Ticket promedio', c.purchases ? formatGs(c.averageTicketPyg) : '—'), stat('Saldo pendiente', formatGs(c.balancePyg))),
      (c.preferences || c.notes) && h('section', { class: 'card card-pad', style: 'margin-bottom:16px' }, c.preferences && h('p', {}, h('strong', {}, 'Preferencias: '), c.preferences), c.notes && h('p', { style: 'margin:0' }, h('strong', {}, 'Notas: '), c.notes)),
      h('div', { class: 'grid cols-2' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Direcciones'), canEdit && h('button', { class: 'btn sm', type: 'button', onclick: () => addressForm() }, 'Agregar')),
          c.addresses.length ? h('ul', { class: 'list' }, c.addresses.map((a) => h('li', {}, h('span', {}, h('strong', {}, a.label || 'Dirección'), a.isDefault && ' ', a.isDefault && badge('Principal', 'ok'), h('br'), a.address, a.zone && ` · ${a.zone}`, a.reference && h('span', { class: 'muted small' }, ` (${a.reference})`)),
            canEdit && h('span', { class: 'nowrap' }, h('button', { class: 'btn sm', type: 'button', onclick: () => addressForm(a) }, 'Editar'), h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Quitar dirección', onclick: async () => { try { await customersApi.removeAddress(a.id); load(); } catch (e) { toast(e.message, 'err'); } } }, '✕'))))) : emptyState('Sin direcciones')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Destinatarios habituales'), session.can('clientes.create') && h('button', { class: 'btn sm', type: 'button', onclick: () => recipientForm() }, 'Agregar')),
          c.recipients.length ? h('ul', { class: 'list' }, c.recipients.map((r) => h('li', {}, h('span', {}, h('strong', {}, r.name), r.phone && ` · ${r.phone}`, h('br'), h('span', { class: 'muted small' }, [r.address, r.zone].filter(Boolean).join(' · ') || 'Sin dirección')),
            canEdit && h('span', { class: 'nowrap' }, h('button', { class: 'btn sm', type: 'button', onclick: () => recipientForm(r) }, 'Editar'), h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Quitar destinatario', onclick: async () => { try { await recipientsApi.archive(r.id); load(); } catch (e) { toast(e.message, 'err'); } } }, '✕'))))) : emptyState('Sin destinatarios', 'El destinatario puede ser otra persona distinta del cliente.')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Fechas importantes'), canEdit && h('button', { class: 'btn sm', type: 'button', onclick: dateForm }, 'Agregar')),
          c.dates.length ? h('ul', { class: 'list' }, c.dates.map((d) => h('li', {}, h('span', {}, h('strong', {}, d.label), ` · ${d.day} de ${MONTHS[d.month - 1]}`), canEdit && h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Quitar fecha', onclick: async () => { try { await customersApi.removeDate(d.id); load(); } catch (e) { toast(e.message, 'err'); } } }, '✕')))) : emptyState('Sin fechas', 'Cumpleaños, aniversarios… para recordarlos.')),
        c.recentSales && h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Compras recientes'), session.can('ventas.view') && h('a', { href: `#/ventas?customerId=${c.id}` }, 'Ver todas')),
          c.recentSales.length ? h('ul', { class: 'list' }, c.recentSales.map((s) => h('li', {}, h('span', {}, h('a', { href: `#/ventas/${s.id}` }, h('strong', {}, s.number)), ' ', s.status === 'anulada' ? badge('Anulada', 'err') : s.paidPyg >= s.totalPyg ? badge('Pagada', 'ok') : badge('Con saldo', 'warn')), h('span', { class: 'muted small nowrap' }, `${formatGs(s.totalPyg)} · ${formatDate(s.createdAt)}`)))) : emptyState('Todavía no compró'))));
    async function archive() {
      if (!(await confirmDialog({ title: 'Archivar cliente', message: 'Dejará de aparecer en las búsquedas. Su historial de compras se conserva.', confirmLabel: 'Archivar', danger: true }))) return;
      try { await customersApi.archive(c.id); toast('Cliente archivado'); navigate('/clientes'); } catch (e) { toast(e.message, 'err'); }
    }
    function addressForm(a) {
      const f = { label: field({ id: 'a-label', label: 'Etiqueta', control: input({ maxlength: 60, value: a?.label ?? '', placeholder: 'Casa, Oficina…' }) }), address: field({ id: 'a-addr', label: 'Dirección', required: true, control: input({ maxlength: 300, value: a?.address ?? '' }) }),
        zone: field({ id: 'a-zone', label: 'Barrio / zona', control: input({ maxlength: 80, value: a?.zone ?? '' }) }), reference: field({ id: 'a-ref', label: 'Referencia', control: input({ maxlength: 300, value: a?.reference ?? '' }) }) };
      const def = checkbox('Dirección principal', { checked: !!a?.isDefault }); const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Guardar');
      const m = openModal({ title: a ? 'Editar dirección' : 'Nueva dirección', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, ...Object.values(f), def), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
      save.addEventListener('click', async () => { const v = (k) => f[k].querySelector('input').value.trim(); if (!v('address')) { f.address.setError('La dirección es obligatoria'); return; }
        const body = { label: v('label') || null, address: v('address'), zone: v('zone') || null, reference: v('reference') || null, isDefault: def.querySelector('input').checked };
        try { await withBusy(save, () => (a ? customersApi.updateAddress(a.id, body) : customersApi.addAddress(c.id, body))); toast('Dirección guardada'); m.close(); load(); } catch (e) { applyServerErrors(e, f, err); } });
    }
    function recipientForm(r) {
      const f = { name: field({ id: 'r-name', label: 'Nombre del destinatario', required: true, control: input({ maxlength: 120, value: r?.name ?? '' }) }), phone: field({ id: 'r-phone', label: 'Teléfono', control: input({ maxlength: 40, value: r?.phone ?? '' }) }),
        address: field({ id: 'r-addr', label: 'Dirección de entrega', control: input({ maxlength: 300, value: r?.address ?? '' }) }), zone: field({ id: 'r-zone', label: 'Barrio / zona', control: input({ maxlength: 80, value: r?.zone ?? '' }) }) };
      const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Guardar');
      const m = openModal({ title: r ? 'Editar destinatario' : 'Nuevo destinatario', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, ...Object.values(f)), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
      save.addEventListener('click', async () => { const v = (k) => f[k].querySelector('input').value.trim(); if (!v('name')) { f.name.setError('El nombre es obligatorio'); return; }
        const body = { name: v('name'), phone: v('phone') || null, address: v('address') || null, zone: v('zone') || null }; if (!r) body.customerId = c.id;
        try { await withBusy(save, () => (r ? recipientsApi.update(r.id, body) : recipientsApi.create(body))); toast('Destinatario guardado'); m.close(); load(); } catch (e) { applyServerErrors(e, f, err); } });
    }
    function dateForm() {
      const label = field({ id: 'd-label', label: 'Qué se recuerda', required: true, control: input({ maxlength: 80, placeholder: 'Cumpleaños de su esposa' }) });
      const day = field({ id: 'd-day', label: 'Día', required: true, control: input({ type: 'number', min: 1, max: 31, step: 1 }) }); const month = field({ id: 'd-month', label: 'Mes', control: select(MONTHS.map((m, i) => ({ value: i + 1, label: m })), 1) });
      const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Guardar');
      const m = openModal({ title: 'Nueva fecha importante', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, label, h('div', { class: 'grid cols-2' }, day, month)), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
      save.addEventListener('click', async () => { err.hidden = true; const lb = label.querySelector('input').value.trim(); const d = Number(day.querySelector('input').value); if (!lb || !(d >= 1 && d <= 31)) { err.hidden = false; err.textContent = 'Completá el motivo y un día entre 1 y 31.'; return; }
        try { await withBusy(save, () => customersApi.addDate(c.id, { label: lb, day: d, month: Number(month.querySelector('select').value) })); toast('Fecha guardada'); m.close(); load(); } catch (e) { err.hidden = false; err.textContent = e.message; } });
    }
  }
  await load();
}
