import { h, clear } from '../components/dom.js';
import { icon } from '../components/icons.js';
import { visibleRoutes } from './nav.js';
import { initials } from '../utils/format.js';
import { toggleTheme } from './theme.js';
import { openPalette } from '../components/command-palette.js';

/** Estructura del panel: sidebar (según permisos), topbar con búsqueda y menú de usuario, y el contenedor de vistas. */
export function buildShell({ session, navigate }) {
  const app = h('div', { class: 'app' });
  const nav = h('nav', { 'aria-label': 'Principal' });
  const view = h('main', { class: 'content', id: 'view', tabindex: '-1' });

  function renderNav(current) {
    clear(nav);
    const groups = new Map();
    for (const r of visibleRoutes(session)) (groups.get(r.group) || groups.set(r.group, []).get(r.group)).push(r);
    for (const [g, routes] of groups) {
      nav.append(h('div', { class: 'nav-group' }, g !== 'General' && h('div', { class: 'nav-group-title' }, g),
        routes.map((r) => h('a', { class: 'nav-link', href: `#${r.path}`, 'aria-current': current?.id === r.id ? 'page' : null, onclick: () => app.classList.remove('nav-open') }, icon(r.icon), r.label))));
    }
  }

  const items = () => [
    ...visibleRoutes(session).map((r) => ({ label: r.label, icon: r.icon, hint: 'Ir a', run: () => navigate(r.path) })),
    { label: 'Cambiar contraseña', icon: 'key', hint: 'Cuenta', run: () => navigate('/cuenta') },
    { label: 'Cambiar tema claro/oscuro', icon: 'moon', run: toggleTheme },
    { label: 'Cerrar sesión', icon: 'logout', run: () => session.logout() },
  ];
  const openSearch = () => openPalette(items);

  const menu = h('div', { class: 'menu-pop', hidden: true, role: 'menu' });
  const userBtn = h('button', { class: 'user-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => toggleMenu() },
    h('span', { class: 'avatar' }, initials(session.user.fullName)), h('span', { class: 'who-txt small' }, session.user.fullName));
  function toggleMenu(force) {
    const open = force ?? menu.hidden; menu.hidden = !open; userBtn.setAttribute('aria-expanded', String(open));
  }
  menu.append(h('div', { class: 'who' }, h('div', {}, session.user.fullName), h('div', { class: 'small muted' }, session.user.email), h('div', { class: 'small muted' }, session.user.role.name)),
    h('a', { class: 'menu-item', role: 'menuitem', href: '#/cuenta', onclick: () => toggleMenu(false) }, icon('key'), 'Mi cuenta'),
    h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => { toggleMenu(false); toggleTheme(); } }, icon('moon'), 'Tema claro / oscuro'),
    h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => session.logout() }, icon('logout'), 'Cerrar sesión'));
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.user-menu')) toggleMenu(false); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!document.querySelector('.modal-scrim')) openSearch(); }
    else if (e.key === 'Escape' && !menu.hidden) toggleMenu(false);
  });

  app.append(
    h('aside', { class: 'sidebar' },
      h('a', { class: 'brand', href: '#/' }, h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'S'), h('div', {}, h('div', { class: 'brand-name' }, 'Serafina'), h('div', { class: 'brand-sub' }, 'Florería'))),
      nav, h('div', { class: 'sidebar-foot' }, session.user.role.name)),
    h('div', { class: 'scrim', onclick: () => app.classList.remove('nav-open') }),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn ghost icon menu-btn', type: 'button', 'aria-label': 'Abrir menú', onclick: () => app.classList.toggle('nav-open') }, icon('menu')),
        h('button', { class: 'search-trigger', type: 'button', onclick: openSearch, 'aria-label': 'Búsqueda rápida' }, icon('search'), h('span', {}, 'Buscar…'), h('kbd', {}, 'Ctrl K')),
        h('div', { class: 'spacer' }), h('div', { class: 'user-menu' }, userBtn, menu)),
      view));
  return { app, view, renderNav };
}
