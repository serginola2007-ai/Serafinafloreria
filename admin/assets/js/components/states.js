import { h } from './dom.js';
import { icon } from './icons.js';

export const skeletonRows = (n = 5) => h('div', { class: 'skeleton-rows', 'aria-busy': 'true', 'aria-label': 'Cargando' },
  Array.from({ length: n }, (_, i) => h('div', { class: 'skeleton', style: `width:${90 - (i % 3) * 14}%` })));
export const emptyState = (title, text, action) => h('div', { class: 'empty' }, icon('inbox'), h('h3', {}, title), text && h('p', {}, text), action);
export const errorState = (message, onRetry) => h('div', { class: 'empty' }, h('h3', {}, 'No se pudo cargar'), h('p', {}, message),
  onRetry && h('button', { class: 'btn', type: 'button', onclick: onRetry }, 'Reintentar'));
export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
export const spinner = () => h('span', { class: 'spinner', 'aria-hidden': 'true' });
