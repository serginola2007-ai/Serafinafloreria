import { h, setChildren } from './dom.js';
import { openModal } from './modal.js';
import { mediaApi } from '../api/resources.js';
import { skeletonRows, errorState, emptyState } from './states.js';
import { pager } from './table.js';
import { toast } from './toast.js';
import { session } from '../auth/session.js';

/** Selector de imágenes de la biblioteca multimedia (reutilizable: productos, categorías, CMS). Permite subir nuevas. */
export function openMediaPicker({ selected = [], max = 12, onPick }) {
  const chosen = new Map(selected.map((id) => [id, null]));
  const grid = h('div', {});
  const upload = session.can('media.upload');
  const fileInput = upload ? h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': 'Subir imagen' }) : null;
  const count = h('span', { class: 'muted small' });
  const done = h('button', { class: 'btn primary', type: 'button' }, 'Usar selección');
  const m = openModal({ title: 'Biblioteca de imágenes', wide: true,
    content: h('div', {}, upload && h('div', { class: 'actions', style: 'margin-bottom:12px' }, h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Subir imagen nueva'), fileInput,
      h('span', { class: 'small muted' }, 'JPG, PNG o WebP. Máximo 8 MB.')), grid),
    footer: [count, h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), done] });
  const urls = new Map();
  let page = 1;
  const refreshCount = () => { count.textContent = `${chosen.size} seleccionada(s)`; };
  async function load() {
    setChildren(grid, skeletonRows(4));
    try {
      const r = await mediaApi.list({ page, limit: 24 });
      const items = r.data.filter((x) => x.isPublic && x.mime.startsWith('image/'));
      items.forEach((x) => urls.set(x.id, x.url));
      setChildren(grid, items.length ? h('div', { class: 'picker-grid' }, items.map((x) => {
        const b = h('button', { class: 'picker-item', type: 'button', 'aria-pressed': String(chosen.has(x.id)), title: x.altText || x.originalName || '' },
          h('img', { src: x.url, alt: x.altText || x.originalName || 'Imagen', loading: 'lazy' }), h('span', {}, x.originalName || `#${x.id}`));
        b.addEventListener('click', () => {
          if (chosen.has(x.id)) chosen.delete(x.id); else { if (chosen.size >= max) { toast(`Máximo ${max} imágenes`, 'err'); return; } chosen.set(x.id, x.url); }
          b.setAttribute('aria-pressed', String(chosen.has(x.id))); refreshCount();
        });
        return b;
      })) : emptyState('No hay imágenes', upload ? 'Subí la primera con el botón de arriba.' : 'Pedile a alguien con permiso que suba imágenes.'), pager({ meta: r.meta, onPage: (p) => { page = p; load(); } }));
    } catch (e) { setChildren(grid, errorState(e.message, load)); }
  }
  fileInput?.addEventListener('change', async () => {
    const f = fileInput.files[0]; if (!f) return;
    try { const r = await mediaApi.upload(f); chosen.set(r.id, r.url); toast(r.reused ? 'Esa imagen ya estaba en la biblioteca' : 'Imagen subida'); page = 1; refreshCount(); await load(); }
    catch (e) { toast(e.message, 'err'); } finally { fileInput.value = ''; }
  });
  done.addEventListener('click', () => { const ids = [...chosen.keys()]; const map = new Map(ids.map((id) => [id, chosen.get(id) ?? urls.get(id) ?? null])); m.close(); onPick(ids, map); });
  refreshCount(); load();
}
