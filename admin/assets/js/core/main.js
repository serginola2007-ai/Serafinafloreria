import { h, clear } from '../components/dom.js';
import { session } from '../auth/session.js';
import { loginView, forcedPasswordView } from '../auth/auth-views.js';
import { buildShell } from './layout.js';
import { createRouter } from './router.js';
import { initTheme } from './theme.js';
import { toast } from '../components/toast.js';

initTheme();
const root = document.getElementById('app');
let router = null;

function show(node) { clear(root); root.append(node); }

function boot() {
  if (!session.user) { router = null; return show(loginView({ notice: session.expired ? 'Tu sesión expiró. Ingresá de nuevo.' : null, onDone: boot })); }
  if (session.user.mustChangePassword) return show(forcedPasswordView({ onDone: boot }));
  const shell = buildShell({ session, navigate: (to) => router.navigate(to) });
  show(shell.app);
  router = createRouter({ view: shell.view, onNavigate: (route) => shell.renderNav(route) });
  router.start();
}

// cierre de sesión (manual o por expiración) → volver al login
session.subscribe((s) => { if (!s.user) boot(); });

(async () => {
  root.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'spinner', 'aria-label': 'Cargando' })));
  await session.restore();
  boot();
})().catch((e) => { clear(root); root.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h2', {}, 'No se pudo iniciar el panel'), h('p', {}, e.message)))); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.name !== 'AbortError') toast(e.reason?.message || 'Error inesperado', 'err'); });
