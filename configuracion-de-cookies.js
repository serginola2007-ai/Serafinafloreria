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
   Soporta botón de escritorio (#boton-tema), botón móvil (#boton-tema-movil)
   y label de modo (#etiqueta-tema-movil).
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
    ifEl('#etiqueta-tema-movil', el => {
      el.textContent = get() === 'dark' ? 'Modo Claro' : 'Modo Oscuro';
    });
  }

  function init() {
    const saved = localStorage.getItem(KEY) || 'dark';
    html.setAttribute('data-theme', saved);
    _updateLabel();
    $$('#boton-tema, #boton-tema-movil').forEach(btn =>
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

    const dot  = $('#cursor');
    const ring = $('#cursor-anillo');
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
   3. LOADER (solo index.html — elemento #cargador)
   Espera el evento 'load' y añade clase .saliente tras 1100ms.
   ───────────────────────────────────────────────────────────────────────── */

const Loader = (() => {
  function init() {
    const loader = $('#cargador');
    if (!loader) return;
    window.addEventListener('load', () => {
      setTimeout(() => loader.classList.add('saliente'), 1100);
    });
  }

  return { init };
})();

/* ─────────────────────────────────────────────────────────────────────────
   4. NAV — SCROLL BEHAVIOR
   Añade clase .con-scroll al nav cuando el scroll supera el umbral.
   El umbral es 70px en páginas con hero transparente (index, historia)
   y 40px en páginas con nav siempre sólido.
   ───────────────────────────────────────────────────────────────────────── */

const Nav = (() => {
  function init() {
    const nav = $('#barra-nav');
    if (!nav) return;

    // Si el nav tiene clase .solid ya es sólido siempre — umbral bajo
    const threshold = nav.classList.contains('solido') ? 40 : 70;

    window.addEventListener('scroll', () => {
      nav.classList.toggle('con-scroll', window.scrollY > threshold);
    }, { passive: true });
  }

  return { init };
})();

/* ─────────────────────────────────────────────────────────────────────────
   5. HAMBURGER / MENÚ MÓVIL
   Controla apertura/cierre del menú móvil (#menu-movil).
   Bloquea scroll del body mientras está abierto.
   Cierra con Escape.
   Links dentro del menú cierran automáticamente (onclick="closeMob()").
   ───────────────────────────────────────────────────────────────────────── */

const MobileMenu = (() => {
  let ham, mob;

  function close() {
    if (!ham || !mob) return;
    ham.classList.remove('abierto');
    mob.classList.remove('abierto');
    ham.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function init() {
    ham = $('#hamburguesa');
    mob = $('#menu-movil');
    if (!ham || !mob) return;

    ham.addEventListener('click', () => {
      const isOpen = mob.classList.toggle('abierto');
      ham.classList.toggle('abierto', isOpen);
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

      const nav    = document.getElementById('barra-nav');
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
   6. REVEAL ON SCROLL (IntersectionObserver)
   Observa todos los elementos con clase .revelar.
   Al entrar en viewport añade .visible (transición en CSS).
   ───────────────────────────────────────────────────────────────────────── */

const Reveal = (() => {
  function init() {
    const els = $$('.revelar');
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
   9. COOKIES (solo configuracion-de-cookies.html)
   - Carga preferencias guardadas en localStorage ('sf_cookies')
   - toggleCookie(name, el) — cambia estado de una cookie
   - savePreferences()      — guarda en localStorage
   - acceptAll()            — activa todas y guarda
   ───────────────────────────────────────────────────────────────────────── */

const Cookies = (() => {
  const KEY = 'sf_cookies';

  function updateCard(name, active) {
    const card = document.getElementById('card-' + name);
    const lbl  = document.getElementById('label-' + name);
    if (!card || !lbl) return;
    if (active) {
      card.classList.add('activo');
      lbl.textContent = 'Activadas';
      lbl.classList.add('activado');
    } else {
      card.classList.remove('activo');
      lbl.textContent = 'Desactivadas';
      lbl.classList.remove('activado');
    }
  }

  function toggleCookie(name, el) {
    updateCard(name, el.checked);
  }

  function savePreferences() {
    const prefs = {
      analiticas: document.getElementById('toggle-analiticas')?.checked ?? false,
      marketing:  document.getElementById('toggle-marketing')?.checked  ?? false,
    };
    localStorage.setItem(KEY, JSON.stringify(prefs));
    const msg = document.getElementById('mensaje-guardado');
    if (msg) {
      msg.classList.add('mostrar');
      setTimeout(() => msg.classList.remove('mostrar'), 3000);
    }
  }

  function acceptAll() {
    ['analiticas', 'marketing'].forEach(k => {
      const cb = document.getElementById('toggle-' + k);
      if (cb) { cb.checked = true; updateCard(k, true); }
    });
    savePreferences();
  }

  function init() {
    if (!document.getElementById('toggle-analiticas')) return; // no estamos en cookies page

    // Cargar preferencias guardadas
    const prefs = JSON.parse(localStorage.getItem(KEY) || '{}');
    ['analiticas', 'marketing'].forEach(k => {
      if (prefs[k]) {
        const cb = document.getElementById('toggle-' + k);
        if (cb) { cb.checked = true; updateCard(k, true); }
      }
    });
  }

  // Expuesto globalmente (llamados desde onclick en el HTML)
  return { init, toggleCookie, savePreferences, acceptAll };
})();

window.toggleCookie    = (n, el) => Cookies.toggleCookie(n, el);
window.savePreferences = ()      => Cookies.savePreferences();
window.acceptAll       = ()      => Cookies.acceptAll();

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
    banner.classList.remove('aviso-cookies-visible');
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
      <div class="aviso-cookies-interior">
        <div class="aviso-cookies-texto">
          <span class="aviso-cookies-titulo">Usamos cookies</span>
          <span class="aviso-cookies-descripcion">Utilizamos cookies para mejorar tu experiencia de navegación y analizar el uso del sitio. Podés aceptarlas todas o configurar tus preferencias.</span>
        </div>
        <div class="aviso-cookies-actions">
          <a href="configuracion-de-cookies.html" class="aviso-cookies-boton aviso-cookies-boton-config">Configurar</a>
          <button class="aviso-cookies-boton aviso-cookies-boton-reject" onclick="CookieBannerReject()">Rechazar</button>
          <button class="aviso-cookies-boton aviso-cookies-boton-accept" onclick="CookieBannerAccept()">Aceptar todas</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    // Pequeño delay para que el CSS de transición funcione
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('aviso-cookies-visible')));
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
    bar.id = 'barra-progreso';
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
   INIT — arranca todos los módulos
   Cada uno verifica internamente si los elementos necesarios existen,
   por lo que es seguro correrlos en todas las páginas.
   ───────────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  Cursor.init();
  Loader.init();
  Nav.init();
  MobileMenu.init();
  AnchorScroll.init();
  Reveal.init();
  Cookies.init();
  CookieBanner.init();
  ScrollProgress.init();
});
