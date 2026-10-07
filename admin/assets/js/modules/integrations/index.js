import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { integrationsApi } from '../../api/resources.js';
import { skeletonRows, errorState, badge } from '../../components/states.js';

export default async function mount({ view }) {
  const body = h('div', {}, skeletonRows(4));
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Integraciones' }]),
    pageHead({ title: 'Integraciones', subtitle: 'Google, Meta y WhatsApp se conectan con credenciales oficiales configuradas en el servidor. Hasta entonces no se muestran métricas.' }), body);
  async function load() {
    setChildren(body, skeletonRows(4));
    try {
      const { data } = await integrationsApi.list();
      setChildren(body, h('div', { class: 'grid cols-2' }, data.map((i) => h('section', { class: 'card card-pad' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center' }, h('h2', {}, i.label),
          i.status === 'not_configured' ? badge('No configurada', 'warn') : badge('Credenciales presentes', 'info')),
        i.status === 'not_configured'
          ? h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Faltan variables de entorno en el servidor: ', h('span', { class: 'mono' }, i.missingEnv.join(', ')))
          : h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Las credenciales están cargadas. La conexión y lectura de métricas se activa al implementarse el adaptador oficial.'),
        h('p', { class: 'small', style: 'margin-top:6px' }, i.implemented ? badge('Adaptador activo', 'ok') : badge('Adaptador pendiente', ''))))));
    } catch (e) { setChildren(body, errorState(e.message, load)); }
  }
  await load();
}
