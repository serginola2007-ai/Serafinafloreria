import { h } from '../../components/dom.js';
import { field, input, select, applyServerErrors, withBusy } from '../../components/form.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { customersApi } from '../../api/resources.js';

export const KINDS = { persona: 'Persona', empresa: 'Empresa', mayorista: 'Mayorista' };

export function openCustomerForm({ customer, onSaved, quick = false }) {
  const c = customer; const editing = !!c;
  const f = {
    name: field({ id: 'c-name', label: 'Nombre', required: true, control: input({ maxlength: 120, value: c?.name ?? '', autofocus: true }) }),
    kind: field({ id: 'c-kind', label: 'Tipo', control: select(Object.entries(KINDS).map(([value, label]) => ({ value, label })), c?.kind ?? 'persona') }),
    phone: field({ id: 'c-phone', label: 'Teléfono / WhatsApp', control: input({ maxlength: 40, value: c?.phone ?? '', inputmode: 'tel' }) }),
    email: field({ id: 'c-email', label: 'Correo', control: input({ type: 'email', maxlength: 254, value: c?.email ?? '' }) }),
    taxId: field({ id: 'c-tax', label: 'RUC / CI', help: 'Tal como lo informa el cliente.', control: input({ maxlength: 30, value: c?.taxId ?? '' }) }),
    preferences: field({ id: 'c-pref', label: 'Preferencias', help: 'Flores favoritas, colores, alergias…', control: h('textarea', { class: 'textarea', rows: 2, maxlength: 1000 }, c?.preferences ?? '') }),
    notes: field({ id: 'c-notes', label: 'Notas', control: h('textarea', { class: 'textarea', rows: 2, maxlength: 1000 }, c?.notes ?? '') }),
  };
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, editing ? 'Guardar' : 'Crear cliente');
  const layout = quick ? [f.name, f.phone] : [h('div', { class: 'grid cols-2' }, f.name, f.kind, f.phone, f.email, f.taxId), f.preferences, f.notes];
  const m = openModal({ title: editing ? 'Editar cliente' : 'Nuevo cliente', wide: !quick, content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, ...layout),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  save.addEventListener('click', async () => {
    err.hidden = true; Object.values(f).forEach((x) => x.setError(''));
    const v = (k) => f[k].querySelector('input,select,textarea')?.value.trim() ?? '';
    if (!v('name')) { f.name.setError('El nombre es obligatorio'); return; }
    const body = quick ? { name: v('name'), phone: v('phone') || null } : { name: v('name'), kind: v('kind'), phone: v('phone') || null, email: v('email') || null, taxId: v('taxId') || null, preferences: v('preferences') || null, notes: v('notes') || null };
    try { const r = await withBusy(save, () => (editing ? customersApi.update(c.id, body) : customersApi.create(body))); toast(editing ? 'Cliente actualizado' : 'Cliente creado'); m.close(); onSaved(r); }
    catch (e) { applyServerErrors(e, f, err); }
  });
}
