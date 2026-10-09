import { h } from './dom.js';
let host;
export function toast(message, kind = 'ok', ms = 4200) {
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? ms + 2500 : ms);
}
