import { h, clear } from '../components/dom.js';
import { skeletonRows, errorState } from '../components/states.js';
import { breadcrumbs, pageHead } from '../components/page.js';
import { ROUTES, findRoute } from './nav.js';
import { session } from '../auth/session.js';

/** Router por hash (#/ruta?x=1). Aplica permisos ANTES de cargar el módulo y limpia el módulo anterior. */
export function createRouter({ view, onNavigate }) {
  let cleanup = null; let token = 0;

  function parse() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, search = ''] = raw.split('?');
    return { path: path.replace(/(.)\/$/, '$1'), query: Object.fromEntries(new URLSearchParams(search)) };
  }
  const navigate = (to, replace = false) => {
    if (replace) history.replaceState(null, '', `#${to}`); else location.hash = to;
    if (replace) render();
  };

  async function render() {
    const my = ++token;
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* noop */ } }
    cleanup = null;
    const { path, query } = parse();
    const found = findRoute(path); const route = found?.route; const params = found?.params || {};
    clear(view);
    if (!route) { onNavigate?.(null); view.append(notFound()); document.title = 'No encontrado · Serafina'; return; }
    onNavigate?.(route);
    document.title = `${route.label} · Serafina`;
    if (!session.canAny(route.anyOf)) { view.append(forbidden(route)); return; }
    const holder = h('div', {}, skeletonRows(6)); view.append(holder);
    try {
      const mod = await route.load();
      if (my !== token) return;
      clear(holder);
      const result = await mod.default({ view: holder, query, params, navigate, route, session });
      if (my === token) cleanup = result; else if (typeof result === 'function') result();
      view.focus({ preventScroll: true });
    } catch (e) {
      if (my !== token) return;
      clear(holder); holder.append(errorState(e.message || 'Error inesperado', () => render()));
    }
  }
  window.addEventListener('hashchange', render);
  return { start: render, navigate, refresh: render };
}

const notFound = () => h('div', {}, breadcrumbs([{ label: 'Inicio', href: '#/' }, { label: 'No encontrado' }]),
  pageHead({ title: 'Página no encontrada' }), h('p', {}, 'La dirección no existe. ', h('a', { href: '#/' }, 'Volver al inicio')));
const forbidden = (route) => h('div', {}, breadcrumbs([{ label: 'Inicio', href: '#/' }, { label: route.label }]),
  pageHead({ title: 'Sin acceso' }), h('div', { class: 'alert err', role: 'alert' }, 'Tu usuario no tiene permiso para ver esta sección. Si lo necesitás, pedíselo a un Administrador.'),
  h('a', { class: 'btn', href: '#/' }, 'Volver al inicio'));
export { ROUTES };
