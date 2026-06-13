/* ════════════════════════════════════════════
   SERAFINA FLORERÍA — pedido.js
   JavaScript específico para pedido.html
   ════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   SERAFINA FLORERÍA — serafina.js
   Script global · v2.0 · 2026

   Módulos:
     1. Tema claro/oscuro   — todas las páginas
     2. Cursor personalizado — desktop, todas las páginas
     3. Loader              — index.html
     4. Nav scroll          — todas las páginas
     5. Hamburger / menú    — todas las páginas
     6. Reveal on scroll    — todas las páginas
     7. Filtro catálogo     — catalogo.html
     8. Pedido especial     — pedido.html (chips, colores, resumen, WhatsApp)
     9. Cookies             — configuracion-de-cookies.html
   ══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────
   UTILIDADES
   ───────────────────────────────────────────────────────────────────────── */

/** Selecciona un elemento del DOM, retorna null si no existe */
const $ = (sel, ctx = document) => ctx.querySelector(sel);

/** Selecciona múltiples elementos, retorna array vacío si no hay */
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/** Ejecuta fn solo cuando el elemento existe en el DOM */
const ifEl = (sel, fn) => { const el = $(sel); if (el) fn(el); };
/* ─────────────────────────────────────────────────────────────────────────
   1. TEMA CLARO / OSCURO
   Persiste en localStorage bajo la clave 'serafina-theme'.
   Soporta botón de escritorio (#themeBtn), botón móvil (#mobileThemeBtn)
   y label de modo (#mobileThemeLabel).
   ───────────────────────────────────────────────────────────────────────── */

const Theme = (() => {
  const KEY = 'serafina-theme';
  const html = document.documentElement;

  function get()  { return html.getAttribute('data-theme'); }
  function set(v) {
    html.setAttribute('data-theme', v);
    localStorage.setItem(KEY, v);
    _updateLabel();
  }
  function toggle() { set(get() === 'dark' ? 'light' : 'dark'); }

  function _updateLabel() {
    ifEl('#mobileThemeLabel', el => {
      el.textContent = get() === 'dark' ? 'Modo Claro' : 'Modo Oscuro';
    });
  }

  function init() {
    const saved = localStorage.getItem(KEY) || 'dark';
    html.setAttribute('data-theme', saved);
    _updateLabel();
    $$('#themeBtn, #mobileThemeBtn').forEach(btn =>
      btn.addEventListener('click', toggle)
    );
  }

  return { init, toggle, get, set };
})();
/* ─────────────────────────────────────────────────────────────────────────
   2. CURSOR PERSONALIZADO (solo desktop con hover fino)
   Dot central sigue el mouse directamente.
   Ring sigue con inercia (lerp 10%).
   Crece/desaparece al hacer hover sobre links y botones.
   ───────────────────────────────────────────────────────────────────────── */

const Cursor = (() => {
  function init() {
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;

    const dot  = $('#cur');
    const ring = $('#cur-r');
    if (!dot || !ring) return;

    let mx = 0, my = 0, rx = 0, ry = 0;

    document.addEventListener('mousemove', e => {
      mx = e.clientX;
      my = e.clientY;
    });

    (function loop() {
      rx += (mx - rx) * 0.1;
      ry += (my - ry) * 0.1;
      dot.style.left  = mx + 'px';
      dot.style.top   = my + 'px';
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      requestAnimationFrame(loop);
    })();
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   4. NAV — SCROLL BEHAVIOR
   Añade clase .scrolled al nav cuando el scroll supera el umbral.
   El umbral es 70px en páginas con hero transparente (index, historia)
   y 40px en páginas con nav siempre sólido.
   ───────────────────────────────────────────────────────────────────────── */

const Nav = (() => {
  function init() {
    const nav = $('#nav');
    if (!nav) return;

    // Si el nav tiene clase .solid ya es sólido siempre — umbral bajo
    const threshold = nav.classList.contains('solid') ? 40 : 70;

    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > threshold);
    }, { passive: true });
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   5. HAMBURGER / MENÚ MÓVIL
   Controla apertura/cierre del menú móvil (#mobileMenu).
   Bloquea scroll del body mientras está abierto.
   Cierra con Escape.
   Links dentro del menú cierran automáticamente (onclick="closeMob()").
   ───────────────────────────────────────────────────────────────────────── */

const MobileMenu = (() => {
  let ham, mob;

  function close() {
    if (!ham || !mob) return;
    ham.classList.remove('open');
    mob.classList.remove('open');
    ham.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function init() {
    ham = $('#hamburger');
    mob = $('#mobileMenu');
    if (!ham || !mob) return;

    ham.addEventListener('click', () => {
      const isOpen = mob.classList.toggle('open');
      ham.classList.toggle('open', isOpen);
      ham.setAttribute('aria-expanded', String(isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
  }

  // Expuesto globalmente para los onclick="closeMob()" en los links del menú
  return { init, close };
})();

// Alias global para los onclick inline en los HTML
window.closeMob = () => MobileMenu.close();
/* ─────────────────────────────────────────────────────────────────────────
   6. REVEAL ON SCROLL (IntersectionObserver)
   Observa todos los elementos con clase .reveal.
   Al entrar en viewport añade .visible (transición en CSS).
   ───────────────────────────────────────────────────────────────────────── */

const Reveal = (() => {
  function init() {
    const els = $$('.reveal');
    if (!els.length) return;

    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) e.target.classList.add('visible');
      });
    }, { threshold: 0.08 });

    els.forEach(el => obs.observe(el));
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   8. PEDIDO ESPECIAL (solo pedido.html)
   - Chips de ocasión, tamaño y entrega (data-group / data-val)
   - Selector de paleta de colores (.color-opt)
   - Campos de fecha (#fecha) y nombre (#nombre)
   - Resumen en tiempo real (#sum-*)
   - Validación de campos obligatorios antes de enviar
   - Feedback visual: filas en error se marcan, shake en el botón
   - Envío a WhatsApp con mensaje pre-armado
   ───────────────────────────────────────────────────────────────────────── */

const PedidoForm = (() => {
  const state = { cat: '', color: '', size: '', entrega: '' };
  const PH = '<span class="sb-placeholder">Sin elegir</span>';

  // Campos obligatorios: [key de state, id del sb-item, label legible]
  const REQUIRED = [
    { key: 'cat',     sumId: 'sum-cat',     label: 'la ocasión'  },
    { key: 'size',    sumId: 'sum-size',    label: 'el tamaño'   },
    { key: 'entrega', sumId: 'sum-entrega', label: 'la entrega'  },
  ];

  function _setSum(id, val) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = val || PH;
  }

  /* Marca o desmarca una fila del summary como error */
  function _setRowError(sumId, hasError) {
    const el = document.getElementById(sumId);
    if (!el) return;
    const row = el.closest('.sb-item');
    if (!row) return;
    row.classList.toggle('sb-error', hasError);

    // Inyecta/remueve el mensaje de error inline bajo el placeholder
    const existing = row.querySelector('.sb-error-msg');
    if (hasError && !existing) {
      const msg = document.createElement('span');
      msg.className = 'sb-error-msg';
      msg.textContent = 'Requerido';
      el.after(msg);
    } else if (!hasError && existing) {
      existing.remove();
    }
  }

  /* Limpia todos los errores de validación */
  function _clearErrors() {
    REQUIRED.forEach(({ sumId }) => _setRowError(sumId, false));
    const btn = $('#.sb-send-btn') || document.querySelector('.sb-send-btn');
    btn?.classList.remove('sb-shake');
  }

  /* Valida campos obligatorios. Retorna array de campos inválidos. */
  function _validate() {
    return REQUIRED.filter(({ key }) => !state[key]);
  }

  function updateSummary() {
    _setSum('sum-cat',     state.cat);
    _setSum('sum-color',   state.color);
    _setSum('sum-size',    state.size);
    _setSum('sum-entrega', state.entrega);

    const fechaEl = document.getElementById('fecha');
    if (fechaEl) {
      const val = fechaEl.value;
      _setSum('sum-fecha', val
        ? new Date(val + 'T12:00').toLocaleDateString('es-PY', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
          })
        : ''
      );
    }

    // Si ya había errores visibles, actualizar en tiempo real al elegir
    REQUIRED.forEach(({ key, sumId }) => {
      const row = document.getElementById(sumId)?.closest('.sb-item');
      if (row?.classList.contains('sb-error') && state[key]) {
        _setRowError(sumId, false);
      }
    });
  }

  function sendToWhatsApp() {
    // ── Validación ──────────────────────────────────────────────────────
    const invalids = _validate();

    if (invalids.length > 0) {
      // Marcar cada campo inválido
      invalids.forEach(({ sumId }) => _setRowError(sumId, true));

      // Shake en el botón de envío
      const btn = document.querySelector('.sb-send-btn');
      if (btn) {
        btn.classList.remove('sb-shake');
        // Forzar reflow para reiniciar la animación si se aprieta dos veces
        void btn.offsetWidth;
        btn.classList.add('sb-shake');
        btn.addEventListener('animationend', () => btn.classList.remove('sb-shake'), { once: true });
      }

      // Scroll al summary box para que el usuario vea los errores
      const box = document.querySelector('.summary-box');
      if (box) {
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      return; // Cortar aquí — no abrir WhatsApp
    }

    // ── Sin errores: limpiar y enviar ───────────────────────────────────
    _clearErrors();

    const nombre = (document.getElementById('nombre')?.value  || '').trim();
    const fecha  =  document.getElementById('fecha')?.value   || '';
    const msg    = (document.getElementById('mensaje')?.value || '').trim();

    let text = '*Hola Serafina! Quiero hacer un pedido personalizado* 🌸\n\n';
    if (nombre)        text += `*Nombre:* ${nombre}\n`;
    if (state.cat)     text += `*Ocasión:* ${state.cat}\n`;
    if (state.color)   text += `*Colores:* ${state.color}\n`;
    if (state.size)    text += `*Tamaño:* ${state.size}\n`;
    if (state.entrega) text += `*Entrega:* ${state.entrega}\n`;
    if (fecha)         text += `*Fecha deseada:* ${
      new Date(fecha + 'T12:00').toLocaleDateString('es-PY', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })
    }\n`;
    if (msg)           text += `\n*Detalles adicionales:*\n${msg}`;

    window.open(
      'https://wa.me/595985654607?text=' + encodeURIComponent(text),
      '_blank'
    );
  }

  function init() {
    const fechaEl = document.getElementById('fecha');
    if (!fechaEl) return; // No estamos en pedido.html

    fechaEl.min = new Date().toISOString().split('T')[0];

    // Chips
    $$('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const group = chip.dataset.group;
        const val   = chip.dataset.val;
        $$(`.chip[data-group="${group}"]`).forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        state[group] = val;
        updateSummary();
      });
    });

    // Colores
    $$('.color-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        $$('.color-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        state.color = opt.dataset.val;
        updateSummary();
      });
    });

    // Campos de texto
    fechaEl.addEventListener('change', updateSummary);
    document.getElementById('nombre')?.addEventListener('input', updateSummary);
  }

  return { init, sendToWhatsApp };
})();

window.sendToWhatsApp = () => PedidoForm.sendToWhatsApp();
/* ─────────────────────────────────────────────────────────────────────────
   11. COOKIE CONSENT BANNER
   Muestra un banner en la parte inferior la primera vez que el usuario
   visita el sitio. Se guarda la decisión en localStorage bajo 'sf_consent'.
   "Aceptar" guarda {accepted: true, ts: Date}.
   "Configurar" lleva a configuracion-de-cookies.html.
   "Rechazar" guarda {accepted: false} y cierra el banner.
   ───────────────────────────────────────────────────────────────────────── */

const CookieBanner = (() => {
  const KEY = 'sf_consent';
  let banner;

  function _hasConsent() {
    try {
      return !!JSON.parse(localStorage.getItem(KEY));
    } catch { return false; }
  }

  function _save(accepted) {
    localStorage.setItem(KEY, JSON.stringify({ accepted, ts: Date.now() }));
  }

  function _dismiss() {
    if (!banner) return;
    banner.classList.remove('cb-show');
    banner.addEventListener('transitionend', () => banner.remove(), { once: true });
  }

  function accept() {
    _save(true);
    _dismiss();
  }

  function reject() {
    _save(false);
    _dismiss();
  }

  function init() {
    // No mostrar si ya hay decisión guardada
    if (_hasConsent()) return;
    // No mostrar en la propia página de cookies
    if (window.location.pathname.includes('configuracion-de-cookies')) return;

    banner = document.createElement('div');
    banner.id = 'sf-cookie-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Consentimiento de cookies');
    banner.innerHTML = `
      <div class="cb-inner">
        <div class="cb-text">
          <span class="cb-title">Usamos cookies</span>
          <span class="cb-desc">Utilizamos cookies para mejorar tu experiencia de navegación y analizar el uso del sitio. Podés aceptarlas todas o configurar tus preferencias.</span>
        </div>
        <div class="cb-actions">
          <a href="configuracion-de-cookies.html" class="cb-btn cb-btn-config">Configurar</a>
          <button class="cb-btn cb-btn-reject" onclick="CookieBannerReject()">Rechazar</button>
          <button class="cb-btn cb-btn-accept" onclick="CookieBannerAccept()">Aceptar todas</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    // Pequeño delay para que el CSS de transición funcione
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('cb-show')));
  }

  return { init, accept, reject };
})();

window.CookieBannerAccept = () => CookieBanner.accept();
window.CookieBannerReject = () => CookieBanner.reject();
/* ─────────────────────────────────────────────────────────────────────────
   12. SCROLL PROGRESS BAR
   Barra fina en la parte superior que muestra el progreso de lectura.
   Solo activa en páginas largas (catalogo, historia).
   ───────────────────────────────────────────────────────────────────────── */

const ScrollProgress = (() => {
  function init() {
    // Activar en todas las páginas con suficiente contenido
    const bar = document.createElement('div');
    bar.id = 'sf-scroll-progress';
    document.body.prepend(bar);

    window.addEventListener('scroll', () => {
      const scrollTop  = window.scrollY;
      const docHeight  = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      bar.style.width = `${Math.min(pct, 100)}%`;
    }, { passive: true });
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   13. ANCHOR SCROLL CON OFFSET DE NAV
   Intercepta clicks en links href="#seccion" y aplica
   el offset del nav fijo para que el destino no quede tapado.
   ───────────────────────────────────────────────────────────────────────── */

const AnchorScroll = (() => {
  function init() {
    document.addEventListener('click', e => {
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;

      const hash = link.getAttribute('href');
      if (hash === '#') return;

      const target = document.querySelector(hash);
      if (!target) return;

      e.preventDefault();

      const nav    = document.getElementById('nav');
      const offset = nav ? nav.getBoundingClientRect().height + 12 : 80;
      const top    = target.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

      // Cerrar menú móvil si estaba abierto
      MobileMenu.close();
    });
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   21. VALIDACIÓN DE FECHA EN PEDIDO
   - Bloquea fechas pasadas poniendo min = hoy
   - Avisa si quedan menos de 24hs (pedido urgente)
   - Muestra cuántos días faltan cuando la fecha es válida
   ───────────────────────────────────────────────────────────────────────── */
const FechaValidacion = (() => {
  function _formatDate(date) {
    return date.toLocaleDateString('es-PY', { weekday:'long', day:'numeric', month:'long' });
  }

  function init() {
    const input = document.getElementById('fecha');
    const hint  = document.getElementById('dateHint');
    if (!input) return;

    // Establecer fecha mínima = hoy
    const hoy = new Date();
    const pad = n => String(n).padStart(2, '0');
    const minVal = hoy.getFullYear() + '-' + pad(hoy.getMonth() + 1) + '-' + pad(hoy.getDate());
    input.setAttribute('min', minVal);

    input.addEventListener('change', () => {
      if (!hint) return;
      const val = input.value;
      if (!val) { hint.textContent = ''; hint.className = 'date-hint'; return; }

      const sel  = new Date(val + 'T12:00:00');
      const diff = (sel - hoy) / 86400000;

      if (diff < 0) {
        hint.textContent = 'Esa fecha ya pasó. Elegí una fecha futura.';
        hint.className = 'date-hint date-hint--error';
        input.value = '';
        return;
      }

      if (diff < 1) {
        hint.textContent = '⚡ Pedido urgente — coordinamos disponibilidad por WhatsApp.';
        hint.className = 'date-hint date-hint--warn';
      } else if (diff < 2) {
        hint.textContent = '✓ Mañana · ' + _formatDate(sel) + ' — confirmamos disponibilidad.';
        hint.className = 'date-hint date-hint--ok';
      } else {
        const dias = Math.round(diff);
        hint.textContent = '✓ ' + _formatDate(sel) + ' · faltan ' + dias + ' día' + (dias === 1 ? '' : 's') + '.';
        hint.className = 'date-hint date-hint--ok';
      }
    });
  }
  return { init };
})();

/* ─────────────────────────────────────────────────────────────────────────
   INIT — arranca todos los módulos
   Cada uno verifica internamente si los elementos necesarios existen,
   por lo que es seguro correrlos en todas las páginas.
   ───────────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  // Solo se inicializan los módulos presentes en esta página.
  Theme.init();
  Cursor.init();
  Nav.init();
  MobileMenu.init();
  AnchorScroll.init();
  Reveal.init();
  FechaValidacion.init();
  PedidoForm.init();
  CookieBanner.init();
  ScrollProgress.init();
});
