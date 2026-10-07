import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { confirmDialog } from '../../components/confirm.js';
import { toast } from '../../components/toast.js';
import { icon } from '../../components/icons.js';
import { productsApi, categoriesApi } from '../../api/resources.js';
import { formatGs, debounce } from '../../utils/format.js';

export const STATUS = { published: ['Publicado', 'ok'], inactive: ['Borrador', ''], review: ['A revisar', 'warn'], archived: ['Archivado', 'err'] };
export const statusBadge = (s) => badge(...(STATUS[s] || [s, '']));
export const priceRange = (p) => (p.priceFrom == null ? '—' : p.priceFrom === p.priceTo ? formatGs(p.priceFrom) : `${formatGs(p.priceFrom)} – ${formatGs(p.priceTo)}`);

export default async function mount({ view, session, query }) {
  const st = { page: 1, q: '', categoryId: '', status: query.status || 'all', sort: { key: 'order', dir: 'asc' } };
  const holder = h('div', { class: 'card' });
  const search = input({ type: 'search', class: 'input grow', placeholder: 'Buscar por nombre o código…', 'aria-label': 'Buscar productos' });
  const cat = select([{ value: '', label: 'Todas las categorías' }], '', { 'aria-label': 'Categoría' });
  const status = select([{ value: 'all', label: 'Todos (sin archivados)' }, { value: 'published', label: 'Publicados' }, { value: 'inactive', label: 'Borradores' }, { value: 'review', label: 'A revisar' }, { value: 'archived', label: 'Archivados' }], st.status, { 'aria-label': 'Estado' });
  const newBtn = session.can('productos.create') ? h('a', { class: 'btn primary', href: '#/productos/nuevo' }, icon('plus'), 'Nuevo producto') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Catálogo' }, { label: 'Productos' }]),
    pageHead({ title: 'Productos', subtitle: 'Lo que publicás acá se ve en el sitio web.', actions: newBtn }), holder);

  const reload = () => { st.page = 1; load(); };
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); reload(); }, 300));
  cat.addEventListener('change', () => { st.categoryId = cat.value; reload(); });
  status.addEventListener('change', () => { st.status = status.value; reload(); });
  const toolbar = () => h('div', { class: 'toolbar' }, search, cat, status);

  async function load() {
    setChildren(holder, toolbar(), skeletonRows(7));
    try {
      const r = await productsApi.list({ page: st.page, limit: 15, q: st.q, categoryId: st.categoryId, status: st.status, sort: st.sort.key, dir: st.sort.dir });
      const actions = (p) => [
        h('a', { class: 'btn sm', href: `#/productos/${p.id}` }, session.can('productos.edit') ? 'Editar' : 'Ver'),
        p.status === 'archived' ? session.can('productos.edit') && h('button', { class: 'btn sm', type: 'button', onclick: () => restore(p) }, 'Restaurar')
          : session.can('productos.delete') && h('button', { class: 'btn sm danger', type: 'button', onclick: () => archive(p) }, 'Archivar'),
      ].filter(Boolean);
      setChildren(holder, toolbar(), r.data.length ? dataTable({ rows: r.data, actions, sort: st.sort, onSort: (key, dir) => { st.sort = { key, dir }; load(); }, columns: [
        { key: 'name', sortKey: 'name', label: 'Producto', render: (p) => h('div', { class: 'cell-product' }, p.thumbUrl ? h('img', { class: 'thumb', src: p.thumbUrl, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb ph' }, icon('box')),
          h('span', {}, h('strong', {}, p.name), p.legacyId && h('span', { class: 'muted small' }, ` · ${p.legacyId}`))) },
        { key: 'category', label: 'Categoría', render: (p) => p.category?.name || '—' },
        { key: 'price', label: 'Precio', render: (p) => h('span', { class: 'nowrap' }, priceRange(p)) },
        { key: 'variants', label: 'Variantes', render: (p) => String(p.variants) },
        { key: 'status', label: 'Estado', render: (p) => statusBadge(p.status) },
      ] }) : emptyState('No hay productos', st.q || st.categoryId || st.status !== 'all' ? 'Probá con otros filtros.' : 'Creá el primero con “Nuevo producto”.'),
      pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  async function archive(p) {
    if (!(await confirmDialog({ title: 'Archivar producto', message: `“${p.name}” dejará de verse en el sitio. Se conserva su historial y podés restaurarlo.`, confirmLabel: 'Archivar', danger: true }))) return;
    try { await productsApi.archive(p.id); toast('Producto archivado'); load(); } catch (e) { toast(e.message, 'err'); }
  }
  async function restore(p) { try { await productsApi.restore(p.id); toast('Producto restaurado como borrador'); load(); } catch (e) { toast(e.message, 'err'); } }

  try { (await categoriesApi.list()).data.filter((c) => !c.archived).forEach((c) => cat.append(h('option', { value: c.id }, c.name))); } catch { /* el filtro queda sin categorías */ }
  await load();
}
