import { h } from './dom.js';
import { openModal } from './modal.js';

/** Confirmación explícita. Devuelve Promise<boolean>. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v) => { decided = true; m.close(); resolve(v); };
    const m = openModal({
      title, content: h('p', {}, message),
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, type: 'button', autofocus: true, onclick: () => done(true) }, confirmLabel)],
      onClose: () => { if (!decided) resolve(false); },
    });
  });
}
