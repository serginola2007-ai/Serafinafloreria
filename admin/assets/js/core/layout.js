import { h, clear } from '../components/dom.js';
import { icon } from '../components/icons.js';
import { visibleRoutes } from './nav.js';
import { initials } from '../utils/format.js';
import { toggleTheme } from './theme.js';
import { openPalette } from '../components/command-palette.js';

/** Estructura del panel: barra superior con menús desplegables por grupo (según permisos), búsqueda y menú de usuario; en pantallas chicas la navegación pasa a un panel lateral. */
export function buildShell({ session, navigate }) {
  const app = h('div', { class: 'app' });
  const nav = h('nav', { class: 'app-nav', 'aria-label': 'Principal' });
  const view = h('main', { class: 'content', id: 'view', tabindex: '-1' });

  const closeGroups = () => nav.querySelectorAll('.nav-group.open').forEach((g) => { g.classList.remove('open'); g.querySelector('.nav-group-btn').setAttribute('aria-expanded', 'false'); });
  function openGroup(g, focusFirst = false) {
    closeGroups(); g.classList.add('open'); g.querySelector('.nav-group-btn').setAttribute('aria-expanded', 'true');
    if (focusFirst) g.querySelector('.nav-link')?.focus();
  }
  const isDesktop = () => !window.matchMedia('(max-width: 1040px)').matches;
  function renderNav(current) {
    clear(nav);
    const groups = new Map();
    for (const r of visibleRoutes(session)) (groups.get(r.group) || groups.set(r.group, []).get(r.group)).push(r);
    const activeId = current?.navId || current?.id;
    const done = () => { closeGroups(); app.classList.remove('nav-open'); };
    for (const [g, routes] of groups) {
      if (g === 'General') { // enlaces sueltos (Dashboard)
        nav.append(...routes.map((r) => h('a', { class: 'nav-top', href: `#${r.path}`, 'aria-current': activeId === r.id ? 'page' : null, onclick: done }, r.label)));
        continue;
      }
      const btn = h('button', { class: 'nav-group-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-active': String(routes.some((r) => r.id === activeId)) }, g, h('span', { class: 'nav-caret', 'aria-hidden': 'true' }));
      const menu = h('div', { class: 'nav-menu', role: 'menu', 'aria-label': g },
        routes.map((r) => h('a', { class: 'nav-link', role: 'menuitem', href: `#${r.path}`, 'aria-current': activeId === r.id ? 'page' : null, onclick: done }, icon(r.icon), r.label)));
      const group = h('div', { class: 'nav-group' }, btn, menu);
      btn.addEventListener('click', () => (group.classList.contains('open') ? closeGroups() : openGroup(group)));
      // con un menú abierto, pasar el mouse por otro grupo lo abre (como en una barra de menús de escritorio)
      btn.addEventListener('mouseenter', () => { if (isDesktop() && nav.querySelector('.nav-group.open') && !group.classList.contains('open')) openGroup(group); });
      btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openGroup(group, true); } });
      menu.addEventListener('keydown', (e) => {
        const links = [...menu.querySelectorAll('.nav-link')]; const i = links.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); links[(i + 1) % links.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); links[(i - 1 + links.length) % links.length].focus(); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { // grupo vecino
          const all = [...nav.querySelectorAll('.nav-group')]; const n = all[(all.indexOf(group) + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]; e.preventDefault(); openGroup(n, true);
        } else if (e.key === 'Escape') { e.stopPropagation(); closeGroups(); btn.focus(); }
      });
      nav.append(group);
    }
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.nav-group')) closeGroups(); });
  window.addEventListener('resize', closeGroups);

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
    else if (e.key === 'Escape') { if (!menu.hidden) toggleMenu(false); closeGroups(); }
  });

  app.append(
    h('div', { class: 'scrim', onclick: () => app.classList.remove('nav-open') }),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn ghost icon menu-btn', type: 'button', 'aria-label': 'Abrir menú', onclick: () => app.classList.toggle('nav-open') }, icon('menu')),
        h('a', { class: 'brand', href: '#/' }, h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'S'), h('div', {}, h('div', { class: 'brand-name' }, 'Serafina'), h('div', { class: 'brand-sub' }, 'Florería'))),
        nav,
        h('div', { class: 'spacer' }),
        h('button', { class: 'search-trigger', type: 'button', onclick: openSearch, 'aria-label': 'Búsqueda rápida' }, icon('search'), h('span', {}, 'Buscar…'), h('kbd', {}, 'Ctrl K')),
        h('div', { class: 'user-menu' }, userBtn, menu)),
      view));
  return { app, view, renderNav };
}
