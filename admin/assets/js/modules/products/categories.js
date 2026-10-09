import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable } from '../../components/table.js';
import { field, input, checkbox, applyServerErrors, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { openMediaPicker } from '../../components/media-picker.js';
import { confirmDialog } from '../../components/confirm.js';
import { toast } from '../../components/toast.js';
import { icon } from '../../components/icons.js';
import { categoriesApi } from '../../api/resources.js';

export default async function mount({ view, session }) {
  const holder = h('div', { class: 'card' });
  const newBtn = session.can('productos.create') ? h('button', { class: 'btn primary', type: 'button', onclick: () => openForm() }, icon('plus'), 'Nueva categoría') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Catálogo' }, { label: 'Categorías' }]),
    pageHead({ title: 'Categorías', subtitle: 'Las colecciones en las que se agrupan los productos del sitio.', actions: newBtn }), holder);

  async function load() {
    setChildren(holder, skeletonRows(5));
    try {
      const { data } = await categoriesApi.list();
      const rows = data.filter((c) => !c.archived);
      setChildren(holder, rows.length ? dataTable({ rows, columns: [
        { key: 'name', label: 'Categoría', render: (c) => h('div', { class: 'cell-product' }, c.coverUrl ? h('img', { class: 'thumb', src: c.coverUrl, alt: '' }) : h('div', { class: 'thumb ph' }, icon('box')), h('span', {}, h('strong', {}, c.name), h('br'), h('span', { class: 'muted small' }, c.slug))) },
        { key: 'products', label: 'Productos', render: (c) => String(c.products) },
        { key: 'sortOrder', label: 'Orden', render: (c) => String(c.sortOrder) },
        { key: 'active', label: 'Estado', render: (c) => (c.active ? badge('Visible', 'ok') : badge('Oculta', '')) },
      ], actions: (c) => [
        session.can('productos.edit') && h('button', { class: 'btn sm', type: 'button', onclick: () => openForm(c) }, 'Editar'),
        session.can('productos.delete') && h('button', { class: 'btn sm danger', type: 'button', onclick: () => archive(c) }, 'Archivar'),
      ].filter(Boolean) }) : emptyState('No hay categorías', 'Creá la primera con “Nueva categoría”.'));
    } catch (e) { setChildren(holder, errorState(e.message, load)); }
  }
  function openForm(c) {
    let cover = c?.coverMediaId ?? null; let coverUrl = c?.coverUrl ?? null;
    const f = {
      name: field({ id: 'c-name', label: 'Nombre', required: true, control: input({ maxlength: 80, value: c?.name ?? '' }) }),
      description: field({ id: 'c-desc', label: 'Descripción', control: h('textarea', { class: 'textarea', rows: 3, maxlength: 500 }, c?.description ?? '') }),
      sortOrder: field({ id: 'c-order', label: 'Orden', help: 'Menor número aparece primero.', control: input({ type: 'number', min: 0, max: 100000, step: 1, value: String(c?.sortOrder ?? 0) }) }),
    };
    const active = c ? checkbox('Visible en el sitio', { checked: c.active }) : null;
    const preview = h('div', {}); const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const drawCover = () => setChildren(preview, coverUrl ? h('img', { class: 'thumb', src: coverUrl, alt: 'Portada', style: 'width:96px;height:96px' }) : h('p', { class: 'muted small' }, 'Sin portada'));
    drawCover();
    const save = h('button', { class: 'btn primary', type: 'button' }, c ? 'Guardar' : 'Crear categoría');
    const m = openModal({ title: c ? 'Editar categoría' : 'Nueva categoría', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, f.name, f.description, f.sortOrder,
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Imagen de portada'), preview, session.can('media.view') && h('button', { class: 'btn sm', type: 'button', style: 'align-self:flex-start', onclick: () => openMediaPicker({ selected: cover ? [cover] : [], max: 1, onPick: (ids, map) => { cover = ids[0] ?? null; coverUrl = cover ? map.get(cover) : null; drawCover(); } }) }, 'Elegir imagen')), active),
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
    save.addEventListener('click', async () => {
      err.hidden = true; Object.values(f).forEach((x) => x.setError(''));
      const v = (k) => f[k].querySelector('input,textarea').value;
      if (!v('name').trim()) { f.name.setError('El nombre es obligatorio'); return; }
      const body = { name: v('name').trim(), description: v('description').trim() || null, sortOrder: Number(v('sortOrder') || 0), coverMediaId: cover };
      if (c && active) body.active = active.querySelector('input').checked;
      try { await withBusy(save, () => (c ? categoriesApi.update(c.id, body) : categoriesApi.create(body))); toast(c ? 'Categoría actualizada' : 'Categoría creada'); m.close(); load(); }
      catch (e) { applyServerErrors(e, f, err); }
    });
  }
  async function archive(c) {
    if (!(await confirmDialog({ title: 'Archivar categoría', message: `“${c.name}” dejará de existir en el sitio. Solo se puede si no tiene productos.`, confirmLabel: 'Archivar', danger: true }))) return;
    try { await categoriesApi.archive(c.id); toast('Categoría archivada'); load(); } catch (e) { toast(e.message, 'err'); }
  }
  await load();
}
