import { h, append } from './dom.js';
import { icon } from './icons.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Abre un modal accesible (role=dialog, foco atrapado, Esc cierra). Devuelve {el, body, close, setFooter}.
 * `content`: Node | Node[]; `footer`: Node[]
 */
export function openModal({ title, content, footer = [], wide = false, onClose, dismissible = true, labelledBy = 'modal-title' }) {
  const prev = document.activeElement;
  const body = h('div', { class: 'modal-body' });
  append(body, [content]);
  const foot = h('div', { class: 'modal-foot' }, footer);
  const closeBtn = dismissible ? h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('x')) : null;
  const dlg = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy },
    h('div', { class: 'modal-head' }, h('h2', { id: labelledBy }, title), closeBtn), body, foot);
  const scrim = h('div', { class: 'modal-scrim', onmousedown: (e) => { if (e.target === scrim && dismissible) close(); } }, dlg);
  document.body.append(scrim);
  document.body.style.overflow = 'hidden';

  function onKey(e) {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    if (!document.querySelector('.modal-scrim')) document.body.style.overflow = '';
    prev?.focus?.();
    onClose?.(result);
  }
  (dlg.querySelector('[autofocus]') || dlg.querySelector('input,select,textarea') || dlg.querySelector('.modal-foot button') || dlg).focus?.();
  return { el: dlg, body, close, setFooter: (nodes) => { foot.replaceChildren(...nodes); } };
}
