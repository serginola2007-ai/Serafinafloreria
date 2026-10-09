import { h, setChildren, append } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { field, input, select, applyServerErrors, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { openMediaPicker } from '../../components/media-picker.js';
import { confirmDialog } from '../../components/confirm.js';
import { toast } from '../../components/toast.js';
import { productsApi, categoriesApi, recipesApi } from '../../api/resources.js';
import { openRecipe } from './recipe.js';
import { formatGs, formatDateTime, parseGs } from '../../utils/format.js';
import { statusBadge } from './index.js';

/** Como Element.append pero ignora false/null (evita que "&& nodo" imprima "false"). */
const addTo = (el, ...c) => append(el, c);
const KINDS = [['finished', 'Producto terminado (arreglo)'], ['raw_flower', 'Flor'], ['foliage', 'Follaje'], ['supply', 'Insumo'], ['accessory', 'Accesorio'], ['packaging', 'Packaging']];

export default async function mount({ view, session, params, navigate }) {
  const isNew = !params.id;
  const can = (c) => session.can(c);
  const root = h('div', {}, skeletonRows(8)); view.append(root);
  let product = null; let categories = []; let costing = [];
  const draft = { variants: [{ label: 'Único', price: '' }], mediaIds: [], urls: new Map(), data: { name: '', categoryId: '', kind: 'finished', sku: '', description: '' } }; // solo para "nuevo": sobrevive a los re-dibujados

  try {
    categories = (await categoriesApi.list()).data.filter((c) => !c.archived);
    if (!isNew) { product = await productsApi.get(params.id); costing = (await recipesApi.costing(params.id).catch(() => ({ data: [] }))).data; }
  } catch (e) { setChildren(root, errorState(e.message, () => location.reload())); return; }

  const failMsg = (e) => (e.code === 'PRODUCT_INCOMPLETE' && e.details?.missing ? `No se puede publicar. Falta: ${e.details.missing.join(', ')}` : e.message);
  async function refresh(p) { product = p ?? await productsApi.get(product.id); costing = (await recipesApi.costing(product.id).catch(() => ({ data: [] }))).data; render(); }

  function render() {
    const editable = isNew ? can('productos.create') : can('productos.edit') && product.status !== 'archived';
    const title = isNew ? 'Nuevo producto' : product.name;
    const f = {
      name: field({ id: 'p-name', label: 'Nombre', required: true, control: input({ maxlength: 120, value: product?.name ?? draft.data.name, disabled: !editable }) }),
      categoryId: field({ id: 'p-cat', label: 'Categoría', required: true, control: select([{ value: '', label: 'Elegí una categoría' }, ...categories.map((c) => ({ value: c.id, label: c.name }))], product?.category?.id ?? draft.data.categoryId, { disabled: !editable }) }),
      kind: field({ id: 'p-kind', label: 'Tipo', control: select(KINDS.map(([value, label]) => ({ value, label })), product?.kind ?? draft.data.kind, { disabled: !editable }) }),
      sku: field({ id: 'p-sku', label: 'Código interno (SKU)', help: 'Opcional.', control: input({ maxlength: 60, value: product?.sku ?? draft.data.sku, disabled: !editable }) }),
      description: field({ id: 'p-desc', label: 'Descripción', help: 'Se muestra en el sitio.', control: h('textarea', { class: 'textarea', rows: 4, maxlength: 2000, disabled: !editable }, product?.description ?? draft.data.description) }),
    };
    const val = (k) => f[k].querySelector('input,select,textarea').value;
    if (isNew) for (const k of Object.keys(f)) { const c = f[k].querySelector('input,select,textarea'); const keep = () => { draft.data[k] = c.value; }; c.addEventListener('input', keep); c.addEventListener('change', keep); }
    const formErr = h('div', { class: 'form-error', role: 'alert', hidden: true });

    /* ── Datos ── */
    const saveData = h('button', { class: 'btn primary', type: 'button' }, 'Guardar datos');
    saveData.addEventListener('click', async () => {
      formErr.hidden = true; Object.values(f).forEach((x) => x.setError(''));
      if (!val('name').trim()) { f.name.setError('El nombre es obligatorio'); return; }
      if (!val('categoryId')) { f.categoryId.setError('Elegí una categoría'); return; }
      const body = { name: val('name').trim(), description: val('description').trim() || null, categoryId: Number(val('categoryId')), kind: val('kind'), sku: val('sku').trim() || null };
      try { const p = await withBusy(saveData, () => productsApi.update(product.id, body)); toast('Datos guardados'); await refresh(p); }
      catch (e) { applyServerErrors(e, f, formErr); }
    });
    const dataCard = h('section', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:14px' }, 'Datos'), formErr, f.name,
      h('div', { class: 'grid cols-2' }, f.categoryId, f.kind), f.description, f.sku, !isNew && editable && saveData);

    /* ── Variantes ── */
    const reason = input({ placeholder: 'Motivo del cambio de precio (opcional)', maxlength: 200, 'aria-label': 'Motivo del cambio de precio' });
    const varCard = h('section', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:4px' }, 'Variantes y precios'),
      h('p', { class: 'muted small', style: 'margin-bottom:10px' }, 'Precios en guaraníes (números enteros). Una variante puede ser un tamaño: M, G, “6 rosas”, etc.'));
    const addRow = (parent, { label = '', price = '', onChange, onRemove, extra } = {}) => {
      const l = input({ value: label, maxlength: 60, placeholder: 'Nombre (ej. M)', 'aria-label': 'Nombre de la variante', disabled: !editable });
      const pr = input({ class: 'input price-input', value: price, inputmode: 'numeric', placeholder: 'Precio en Gs.', 'aria-label': 'Precio en guaraníes', disabled: !editable });
      const hint = h('div', { class: 'small muted' });
      const upd = (init) => { const n = parseGs(pr.value); hint.textContent = pr.value === '' ? '' : Number.isNaN(n) ? 'Ingresá solo números' : formatGs(n); hint.style.color = Number.isNaN(n) && pr.value !== '' ? 'var(--err)' : ''; if (init !== true) onChange?.(); };
      pr.addEventListener('input', upd); l.addEventListener('input', () => onChange?.());
      const row = h('div', { class: 'var-row' }, l, h('div', {}, pr, hint), h('div', { class: 'row-actions' }, extra, onRemove && h('button', { class: 'btn sm danger', type: 'button', onclick: onRemove }, 'Quitar')));
      parent.append(row); upd(true);
      return { row, l, pr };
    };

    if (isNew) {
      const list = h('div', {});
      const redraw = () => { list.replaceChildren(); draft.variants.forEach((v, i) => {
        const r = addRow(list, { label: v.label, price: v.price, onChange: () => { v.label = r.l.value; v.price = r.pr.value; }, onRemove: draft.variants.length > 1 ? () => { draft.variants.splice(i, 1); redraw(); } : null });
      }); };
      redraw();
      addTo(varCard, list, h('button', { class: 'btn sm', type: 'button', style: 'margin-top:10px', onclick: () => { draft.variants.push({ label: '', price: '' }); redraw(); } }, 'Agregar variante'));
    } else {
      const list = h('div', {});
      for (const v of product.variants) {
        let dirty = false;
        const save = h('button', { class: 'btn sm primary', type: 'button', disabled: true }, 'Guardar');
        const r = addRow(list, { label: v.label, price: String(v.pricePyg), onChange: () => { dirty = r.l.value.trim() !== v.label || parseGs(r.pr.value) !== v.pricePyg; save.disabled = !dirty; },
          extra: [
            editable && save,
            h('button', { class: 'btn sm', type: 'button', onclick: () => priceHistory(v) }, 'Historial'),
            product.kind === 'finished' && h('button', { class: 'btn sm', type: 'button', onclick: () => openRecipe({ variant: v, product, canEdit: can('productos.edit'), onChanged: () => refresh() }) }, (() => { const c = costing.find((x) => x.variantId === v.id); return c?.hasRecipe ? `Receta · margen ${c.marginPct ?? '—'}%` : 'Receta'; })()),
            editable && h('button', { class: 'btn sm', type: 'button', onclick: () => toggleVariant(v) }, v.active ? 'Desactivar' : 'Activar'),
          ].filter(Boolean) });
        r.row.classList.toggle('inactive', !v.active); if (!v.active) r.l.after(h('span', { class: 'sr-only' }, ' (inactiva)'));
        save.addEventListener('click', async () => {
          const price = parseGs(r.pr.value); if (Number.isNaN(price)) { toast('El precio debe ser un número entero de guaraníes', 'err'); return; }
          const body = { label: r.l.value.trim() }; if (price !== v.pricePyg) { body.pricePyg = price; if (reason.value.trim()) body.reason = reason.value.trim(); }
          try { const p = await withBusy(save, () => productsApi.updateVariant(v.id, body)); toast('Variante actualizada'); await refresh(p); } catch (e) { toast(failMsg(e), 'err'); }
        });
      }
      addTo(varCard, editable && reason, list);
      if (editable) {
        const nl = input({ maxlength: 60, placeholder: 'Nueva variante (ej. G)', 'aria-label': 'Nueva variante' });
        const np = input({ class: 'input price-input', inputmode: 'numeric', placeholder: 'Precio en Gs.', 'aria-label': 'Precio de la nueva variante' });
        const add = h('button', { class: 'btn sm', type: 'button' }, 'Agregar variante');
        add.addEventListener('click', async () => {
          const price = parseGs(np.value); if (!nl.value.trim() || Number.isNaN(price)) { toast('Completá el nombre y un precio entero válido', 'err'); return; }
          try { const p = await withBusy(add, () => productsApi.addVariant(product.id, { label: nl.value.trim(), pricePyg: price })); toast('Variante agregada'); await refresh(p); } catch (e) { toast(failMsg(e), 'err'); }
        });
        addTo(varCard, h('div', { class: 'var-row' }, nl, np, add));
      }
    }

    /* ── Imágenes ── */
    const ids = isNew ? draft.mediaIds : product.images.map((i) => i.mediaId);
    const urlOf = (id) => (isNew ? draft.urls.get(id) : product.images.find((i) => i.mediaId === id)?.url);
    const setIds = async (next, urls) => {
      if (isNew) { draft.mediaIds = next; urls?.forEach((u, id) => draft.urls.set(id, u)); render(); return; }
      try { await refresh(await productsApi.setMedia(product.id, next)); toast('Imágenes actualizadas'); } catch (e) { toast(failMsg(e), 'err'); }
    };
    const move = (i, d) => { const n = [...ids]; [n[i], n[i + d]] = [n[i + d], n[i]]; setIds(n); };
    const imgCard = h('section', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:4px' }, 'Imágenes'), h('p', { class: 'muted small', style: 'margin-bottom:10px' }, 'La primera es la imagen principal.'),
      ids.length ? h('div', { class: 'img-grid' }, ids.map((id, i) => h('div', { class: 'img-tile' }, i === 0 && h('span', { class: 'main-tag' }, badge('Principal', 'ok')),
        h('img', { src: urlOf(id) || '', alt: `Imagen ${i + 1}` }),
        editable && h('div', { class: 'tools' }, h('button', { class: 'btn sm icon', type: 'button', disabled: i === 0, 'aria-label': 'Mover antes', onclick: () => move(i, -1) }, '←'),
          h('button', { class: 'btn sm icon danger', type: 'button', 'aria-label': 'Quitar imagen', onclick: () => setIds(ids.filter((x) => x !== id)) }, '✕'),
          h('button', { class: 'btn sm icon', type: 'button', disabled: i === ids.length - 1, 'aria-label': 'Mover después', onclick: () => move(i, 1) }, '→'))))) : h('p', { class: 'muted' }, 'Todavía no hay imágenes.'),
      editable && can('media.view') && h('button', { class: 'btn', type: 'button', style: 'margin-top:12px', onclick: () => openMediaPicker({ selected: ids, onPick: (picked, map) => setIds(picked, map) }) }, 'Elegir de la biblioteca / subir'),
      editable && !can('media.view') && h('p', { class: 'small muted' }, 'Tu rol no puede ver la biblioteca de imágenes.'));

    /* ── Estado / acciones ── */
    const side = h('aside', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:12px' }, 'Estado'));
    if (isNew) {
      const create = (publish) => async (ev) => {
        const variants = draft.variants.map((v) => ({ label: v.label.trim(), pricePyg: parseGs(v.price) }));
        formErr.hidden = true; Object.values(f).forEach((x) => x.setError(''));
        if (!val('name').trim()) { f.name.setError('El nombre es obligatorio'); return; }
        if (!val('categoryId')) { f.categoryId.setError('Elegí una categoría'); return; }
        if (variants.some((v) => !v.label || Number.isNaN(v.pricePyg))) { toast('Cada variante necesita nombre y un precio entero válido', 'err'); return; }
        const body = { name: val('name').trim(), description: val('description').trim() || null, categoryId: Number(val('categoryId')), kind: val('kind'), sku: val('sku').trim() || null, variants, mediaIds: draft.mediaIds, publish };
        try { const p = await withBusy(ev.currentTarget, () => productsApi.create(body)); toast(publish ? 'Producto publicado' : 'Borrador creado'); navigate(`/productos/${p.id}`); }
        catch (e) { if (e.code === 'PRODUCT_INCOMPLETE') toast(failMsg(e), 'err'); else applyServerErrors(e, f, formErr); }
      };
      addTo(side, h('p', { class: 'muted small' }, 'Se crea como borrador. Para publicarlo necesita categoría, una variante con precio y una imagen.'),
        editable && h('button', { class: 'btn block', type: 'button', style: 'margin-bottom:8px', onclick: create(false) }, 'Crear borrador'),
        editable && h('button', { class: 'btn primary block', type: 'button', onclick: create(true) }, 'Crear y publicar'));
    } else {
      const missing = [];
      if (!product.category) missing.push('categoría'); if (!product.variants.some((v) => v.active)) missing.push('variante activa'); if (!product.images.length) missing.push('imagen'); if (product.needsReview) missing.push('revisión pendiente');
      addTo(side, h('p', {}, statusBadge(product.status)), h('p', { class: 'small muted' }, `Actualizado ${formatDateTime(product.updatedAt)}`),
        product.needsReview && h('div', { class: 'alert warn' }, h('div', {}, h('strong', {}, 'Requiere revisión: '), product.reviewNote)),
        product.status !== 'published' && product.status !== 'archived' && missing.length > 0 && h('p', { class: 'small muted' }, 'Para publicar falta: ', missing.join(', '), '.'));
      const act = (label, cls, fn) => h('button', { class: `btn ${cls} block`, type: 'button', style: 'margin-bottom:8px', onclick: async (ev) => { try { await withBusy(ev.currentTarget, fn); } catch (e) { toast(failMsg(e), 'err'); } } }, label);
      if (can('productos.edit')) {
        if (product.needsReview) addTo(side, act('Marcar como revisado', '', async () => { await refresh(await productsApi.update(product.id, { resolveReview: true })); toast('Revisión resuelta'); }));
        if (product.status === 'inactive') addTo(side, act('Publicar en el sitio', 'primary', async () => { await refresh(await productsApi.update(product.id, { active: true })); toast('Producto publicado'); }));
        if (product.status === 'published') addTo(side, act('Despublicar', '', async () => { await refresh(await productsApi.update(product.id, { active: false })); toast('Producto despublicado'); }));
        if (product.status === 'archived') addTo(side, act('Restaurar como borrador', '', async () => { await refresh(await productsApi.restore(product.id)); toast('Producto restaurado'); }));
      }
      if (can('productos.delete') && product.status !== 'archived') addTo(side, h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: 'Archivar producto', message: 'Dejará de verse en el sitio. Se conserva el historial y podés restaurarlo.', confirmLabel: 'Archivar', danger: true }))) return;
        try { await productsApi.archive(product.id); toast('Producto archivado'); navigate('/productos'); } catch (e) { toast(e.message, 'err'); }
      } }, 'Archivar'));
      if (!can('productos.edit')) addTo(side, h('p', { class: 'small muted' }, 'Tenés permiso de solo lectura.'));
    }

    setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Catálogo' }, { label: 'Productos', href: '#/productos' }, { label: title }]),
      pageHead({ title, subtitle: isNew ? null : `Código web: ${product.slug}` }),
      h('div', { class: 'editor-grid' }, h('div', { class: 'grid' }, dataCard, varCard, imgCard), side));
  }

  async function toggleVariant(v) {
    try { await refresh(await productsApi.updateVariant(v.id, { active: !v.active })); toast(v.active ? 'Variante desactivada' : 'Variante activada'); } catch (e) { toast(failMsg(e), 'err'); }
  }
  async function priceHistory(v) {
    const body = h('div', {}, skeletonRows(3));
    const m = openModal({ title: `Historial de precios · ${v.label}`, content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar')] });
    try {
      const { data } = await productsApi.priceHistory(v.id);
      setChildren(body, h('ul', { class: 'list' }, data.map((x) => h('li', {}, h('span', {}, h('strong', {}, formatGs(x.pricePyg)), x.reason && h('span', { class: 'muted small' }, ` · ${x.reason}`)),
        h('span', { class: 'muted small nowrap' }, `${formatDateTime(x.validFrom)}${x.changedBy ? ' · ' + x.changedBy : ''}`)))));
    } catch (e) { setChildren(body, errorState(e.message)); }
  }
  render();
}
