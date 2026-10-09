import { h } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { passwordForm } from '../../auth/auth-views.js';
import { badge } from '../../components/states.js';

export default async function mount({ view, session }) {
  const u = session.user;
  const form = passwordForm({ onDone: () => form.reset() });
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Mi cuenta' }]), pageHead({ title: 'Mi cuenta' }),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:12px' }, 'Datos'),
        h('p', {}, h('strong', {}, u.fullName)), h('p', { class: 'muted' }, u.email), h('p', {}, 'Rol: ', badge(u.role.name, 'info'))),
      h('section', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:12px' }, 'Cambiar contraseña'), form)));
}
