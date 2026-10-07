import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * Tabla reutilizable. En pantallas chicas se muestra como tarjetas (data-label en cada celda).
 * columns: [{ key, label, render(row)->Node|string, sortKey?, align? }]; actions(row) -> Node[] opcional.
 */
export function dataTable({ columns, rows, rowKey = (r) => r.id, actions, sort, onSort }) {
  const head = h('tr', {}, columns.map((c) => {
    const th = h('th', { scope: 'col', 'aria-sort': sort && c.sortKey === sort.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null });
    if (c.sortKey && onSort) {
      const arrow = sort && sort.key === c.sortKey ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      th.append(h('button', { type: 'button', onclick: () => onSort(c.sortKey, sort && sort.key === c.sortKey && sort.dir === 'asc' ? 'desc' : 'asc') }, c.label + arrow));
    } else th.append(c.label);
    return th;
  }), actions && h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Acciones')));
  const body = rows.map((r) => h('tr', { dataset: { id: rowKey(r) } },
    columns.map((c) => h('td', { 'data-label': c.label }, c.render ? c.render(r) : r[c.key] ?? '—')),
    actions && h('td', { class: 'actions-cell' }, h('div', { class: 'row-actions' }, actions(r)))));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table responsive' }, h('thead', {}, head), h('tbody', {}, body)));
}

export function pager({ meta, onPage }) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return h('div', { class: 'pager' }, h('span', {}, `${from}–${to} de ${meta.total}`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', type: 'button', disabled: meta.page <= 1, onclick: () => onPage(meta.page - 1) }, 'Anterior'),
      h('span', {}, `Página ${meta.page} de ${meta.pages}`),
      h('button', { class: 'btn sm', type: 'button', disabled: meta.page >= meta.pages, onclick: () => onPage(meta.page + 1) }, 'Siguiente', icon('chevron'))));
}
