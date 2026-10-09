import { h } from '../../components/dom.js';
import { field, input, applyServerErrors, withBusy } from '../../components/form.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { suppliersApi } from '../../api/resources.js';

export function openSupplierForm({ supplier, onSaved }) {
  const s = supplier; const editing = !!s;
  const f = {
    name: field({ id: 's-name', label: 'Nombre / razón social', required: true, control: input({ maxlength: 120, value: s?.name ?? '' }) }),
    taxId: field({ id: 's-ruc', label: 'RUC', help: 'Tal como figura en su factura.', control: input({ maxlength: 30, value: s?.taxId ?? '' }) }),
    contactName: field({ id: 's-contact', label: 'Contacto', control: input({ maxlength: 120, value: s?.contactName ?? '' }) }),
    phone: field({ id: 's-phone', label: 'Teléfono', control: input({ maxlength: 40, value: s?.phone ?? '' }) }),
    email: field({ id: 's-email', label: 'Correo', control: input({ type: 'email', maxlength: 254, value: s?.email ?? '' }) }),
    address: field({ id: 's-addr', label: 'Dirección', control: input({ maxlength: 300, value: s?.address ?? '' }) }),
    paymentTermsDays: field({ id: 's-terms', label: 'Plazo de pago (días)', help: '0 = contado.', control: input({ type: 'number', min: 0, max: 365, step: 1, value: String(s?.paymentTermsDays ?? 0) }) }),
    notes: field({ id: 's-notes', label: 'Notas / condiciones', control: h('textarea', { class: 'textarea', rows: 3, maxlength: 1000 }, s?.notes ?? '') }),
  };
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, editing ? 'Guardar' : 'Crear proveedor');
  const m = openModal({ title: editing ? 'Editar proveedor' : 'Nuevo proveedor', wide: true, content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err,
    h('div', { class: 'grid cols-2' }, f.name, f.taxId, f.contactName, f.phone, f.email, f.paymentTermsDays), f.address, f.notes),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  save.addEventListener('click', async () => {
    err.hidden = true; Object.values(f).forEach((x) => x.setError(''));
    const v = (k) => f[k].querySelector('input,textarea').value.trim();
    if (!v('name')) { f.name.setError('El nombre es obligatorio'); return; }
    const body = { name: v('name'), taxId: v('taxId') || null, contactName: v('contactName') || null, phone: v('phone') || null, email: v('email') || null, address: v('address') || null, notes: v('notes') || null, paymentTermsDays: Number(v('paymentTermsDays') || 0) };
    try { const r = await withBusy(save, () => (editing ? suppliersApi.update(s.id, body) : suppliersApi.create(body))); toast(editing ? 'Proveedor actualizado' : 'Proveedor creado'); m.close(); onSaved(r); }
    catch (e) { if (e.code === 'CONFLICT') f.taxId.setError('Ya existe un proveedor con ese RUC'); else applyServerErrors(e, f, err); }
  });
}
