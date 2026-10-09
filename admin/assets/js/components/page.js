import { h } from './dom.js';

export function breadcrumbs(items) {
  return h('nav', { class: 'breadcrumbs', 'aria-label': 'Ubicación' }, items.map((it, i) => [
    i > 0 && h('span', { 'aria-hidden': 'true' }, '/'),
    it.href && i < items.length - 1 ? h('a', { href: it.href }, it.label) : h('span', i === items.length - 1 ? { 'aria-current': 'page' } : {}, it.label),
  ]));
}
export const pageHead = ({ title, subtitle, actions }) => h('div', { class: 'page-head' },
  h('div', {}, h('h1', {}, title), subtitle && h('p', { class: 'sub' }, subtitle)), actions && h('div', { class: 'actions' }, actions));
