import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { field, input, select, withBusy } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { cashApi } from '../../api/resources.js';
import { formatGs, formatDateTime, parseGs } from '../../utils/format.js';

const TYPES = { apertura: 'Apertura', venta: 'Venta', cobro: 'Cobro', ingreso: 'Ingreso', egreso: 'Egreso', retiro: 'Retiro', devolucion: 'Devolución', pago_proveedor: 'Pago a proveedor', gasto: 'Gasto' };

export default async function mount({ view, session }) {
  const holder = h('div', {}); const hist = h('div', { class: 'card', style: 'margin-top:16px' }); let page = 1;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Caja' }]), pageHead({ title: 'Caja', subtitle: 'Efectivo del turno: apertura, movimientos, arqueo y cierre.' }), holder, hist);

  async function load() {
    setChildren(holder, skeletonRows(5));
    try {
      const c = await cashApi.current();
      if (!c.open) {
        const amount = field({ id: 'o-amt', label: 'Monto inicial en efectivo (Gs.)', help: 'Lo que hay en el cajón al empezar (puede ser 0).', control: input({ inputmode: 'numeric', value: '0' }) });
        const btn = h('button', { class: 'btn primary', type: 'button' }, 'Abrir caja');
        btn.addEventListener('click', async () => { amount.setError(''); const n = parseGs(amount.querySelector('input').value); if (Number.isNaN(n)) { amount.setError('Monto entero en guaraníes'); return; }
          try { await withBusy(btn, () => cashApi.open(n)); toast('Caja abierta'); load(); } catch (e) { toast(e.message, 'err'); } });
        setChildren(holder, h('section', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:6px' }, 'La caja está cerrada'), h('p', { class: 'muted' }, 'Mientras esté cerrada no se pueden registrar cobros en efectivo ni pagos en efectivo a proveedores.'),
          session.can('caja.open') ? h('div', { style: 'max-width:340px' }, amount, btn) : h('p', { class: 'small muted' }, 'Tu rol no puede abrir la caja.')));
      } else {
        const s = c.session; const d = await cashApi.session(s.id);
        const act = [session.can('caja.adjust') && ['ingreso', 'Ingreso'], session.can('caja.adjust') && ['egreso', 'Egreso'], session.can('caja.adjust') && ['retiro', 'Retiro']].filter(Boolean).map(([t, l]) => h('button', { class: 'btn', type: 'button', onclick: () => movement(t, l) }, l));
        if (session.can('caja.close')) act.push(h('button', { class: 'btn primary', type: 'button', onclick: () => closeCash(s.expectedCashPyg) }, 'Cerrar caja'));
        setChildren(holder, h('div', { class: 'actions', style: 'margin-bottom:14px' }, act),
          h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Efectivo esperado en caja'), h('div', { class: 'value', style: 'font-size:28px' }, formatGs(s.expectedCashPyg))),
            h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Apertura'), h('div', { class: 'value', style: 'font-size:28px' }, formatGs(s.openingAmountPyg)), h('div', { class: 'hint' }, `${formatDateTime(s.openedAt)} · ${s.openedBy}`))),
          h('div', { class: 'grid cols-2' },
            h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Cobros del turno por método')), c.salesByMethod.length ? h('ul', { class: 'list' }, c.salesByMethod.map((m) => h('li', {}, h('span', {}, m.name, !m.affectsCash && h('span', { class: 'muted small' }, ' (no entra al cajón)')), h('strong', {}, formatGs(m.totalPyg))))) : emptyState('Sin cobros todavía')),
            h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Movimientos de efectivo')), movementsTable(d.movements))));
      }
    } catch (e) { setChildren(holder, errorState(e.message, load)); }
    await loadHistory();
  }
  const movementsTable = (rows) => (rows.length ? dataTable({ rows, columns: [{ key: 'at', label: 'Hora', render: (m) => h('span', { class: 'small nowrap' }, formatDateTime(m.at)) }, { key: 'type', label: 'Tipo', render: (m) => badge(TYPES[m.type] ?? m.type, m.amountPyg > 0 ? 'ok' : 'warn') },
    { key: 'amount', label: 'Monto', render: (m) => h('strong', {}, `${m.amountPyg > 0 ? '+' : ''}${formatGs(m.amountPyg)}`) }, { key: 'concept', label: 'Concepto', render: (m) => m.concept || '—' }, { key: 'user', label: 'Usuario', render: (m) => m.user || '—' }] }) : emptyState('Sin movimientos'));

  function movement(type, label) {
    const amount = field({ id: 'm-amt', label: 'Monto (Gs.)', required: true, control: input({ inputmode: 'numeric' }) }); const concept = field({ id: 'm-con', label: 'Concepto', required: true, help: 'Qué es y por qué (queda auditado).', control: input({ maxlength: 200 }) });
    const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, `Registrar ${label.toLowerCase()}`);
    const m = openModal({ title: label, content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, amount, concept), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
    save.addEventListener('click', async () => { err.hidden = true; amount.setError(''); concept.setError(''); const n = parseGs(amount.querySelector('input').value); const t = concept.querySelector('input').value.trim();
      if (Number.isNaN(n) || n <= 0) { amount.setError('Monto entero mayor que 0'); return; } if (t.length < 3) { concept.setError('Indicá el concepto (mínimo 3 caracteres)'); return; }
      try { await withBusy(save, () => cashApi.move({ type, amountPyg: n, concept: t })); toast(`${label} registrado`); m.close(); load(); } catch (e) { err.hidden = false; err.textContent = e.message; } });
  }
  function closeCash(expected) {
    const counted = field({ id: 'cc-cnt', label: 'Efectivo contado (Gs.)', required: true, control: input({ inputmode: 'numeric', value: String(expected) }) }); const note = field({ id: 'cc-note', label: 'Observación', control: input({ maxlength: 500 }) });
    const diff = h('p', { style: 'font-weight:600' }); const err = h('div', { class: 'form-error', role: 'alert', hidden: true }); const save = h('button', { class: 'btn primary', type: 'button' }, 'Cerrar caja');
    const upd = () => { const n = parseGs(counted.querySelector('input').value); if (Number.isNaN(n)) { diff.textContent = ''; return; } const d = n - expected; diff.textContent = d === 0 ? 'Sin diferencia ✔' : `Diferencia: ${d > 0 ? '+' : ''}${formatGs(d)} (${d > 0 ? 'sobrante' : 'faltante'})`; diff.style.color = d === 0 ? 'var(--ok)' : 'var(--err)'; };
    counted.querySelector('input').addEventListener('input', upd);
    const m = openModal({ title: 'Arqueo y cierre de caja', content: h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, h('p', {}, 'Efectivo esperado: ', h('strong', {}, formatGs(expected))), counted, diff, note), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] }); upd();
    save.addEventListener('click', async () => { err.hidden = true; const n = parseGs(counted.querySelector('input').value); if (Number.isNaN(n)) { counted.setError('Monto entero en guaraníes'); return; }
      try { const r = await withBusy(save, () => cashApi.close({ countedCashPyg: n, note: note.querySelector('input').value.trim() || null })); toast(r.differencePyg === 0 ? 'Caja cerrada sin diferencias' : `Caja cerrada · diferencia ${formatGs(r.differencePyg)}`); m.close(); load(); } catch (e) { err.hidden = false; err.textContent = e.message; } });
  }
  async function loadHistory() {
    setChildren(hist, h('div', { class: 'card-head' }, h('h2', {}, 'Historial de cajas')), skeletonRows(3));
    try {
      const r = await cashApi.sessions({ page, limit: 8 });
      setChildren(hist, h('div', { class: 'card-head' }, h('h2', {}, 'Historial de cajas')), r.data.length ? dataTable({ rows: r.data, columns: [
        { key: 'open', label: 'Apertura', render: (s) => h('span', { class: 'small' }, formatDateTime(s.openedAt)) }, { key: 'by', label: 'Abrió', render: (s) => s.openedBy },
        { key: 'exp', label: 'Esperado', render: (s) => (s.closedAt ? formatGs(s.expectedCashPyg) : 'En curso') }, { key: 'cnt', label: 'Contado', render: (s) => (s.closedAt ? formatGs(s.countedCashPyg) : '—') },
        { key: 'diff', label: 'Diferencia', render: (s) => (s.closedAt ? badge(formatGs(s.differencePyg), s.differencePyg === 0 ? 'ok' : 'err') : '—') }],
        actions: (s) => [h('button', { class: 'btn sm', type: 'button', onclick: () => detail(s.id) }, 'Detalle')] }) : emptyState('Todavía no hay cajas'), pager({ meta: r.meta, onPage: (p) => { page = p; loadHistory(); } }));
    } catch (e) { setChildren(hist, errorState(e.message, loadHistory)); }
  }
  async function detail(id) {
    const body = h('div', {}, skeletonRows(4)); const m = openModal({ title: `Caja #${id}`, wide: true, content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar')] });
    try { const d = await cashApi.session(id);
      setChildren(body, h('p', {}, `Esperado ${formatGs(d.expectedCashPyg)}`, d.closedAt && ` · contado ${formatGs(d.countedCashPyg)} · diferencia ${formatGs(d.differencePyg)}`, d.note && ` · “${d.note}”`), movementsTable(d.movements));
    } catch (e) { setChildren(body, errorState(e.message)); }
  }
  void select;
  await load();
}
