/* ════════════════════════════════════════════
   SERAFINA FLORERÍA — index.js
   JavaScript específico para index.html
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
   3. LOADER (solo index.html — elemento #loader)
   Espera el evento 'load' y añade clase .out tras 1100ms.
   ───────────────────────────────────────────────────────────────────────── */

const Loader = (() => {
  function init() {
    const loader = $('#loader');
    if (!loader) return;
    window.addEventListener('load', () => {
      setTimeout(() => loader.classList.add('out'), 1100);
    });
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
   7. FILTRO DE CATÁLOGO (solo catalogo.html)
   Botones .filter-btn con data-filter="all|romanticos|cumpleanos|..."
   Muestra/oculta tarjetas .cat-card según data-cat.
   ───────────────────────────────────────────────────────────────────────── */

const CatalogoFilter = (() => {
  function init() {
    const btns  = $$('.filter-btn');
    const cards = $$('.cat-card');
    if (!btns.length || !cards.length) return;

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const filter = btn.dataset.filter;
        cards.forEach(card => {
          card.style.display =
            (filter === 'all' || card.dataset.cat === filter) ? '' : 'none';
        });
      });
    });
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   10. LIGHTBOX (index.html — galería, y cualquier .gp img)
   Abre una imagen a pantalla completa con overlay oscuro.
   Navegación ← → con teclado y botones.
   Cierre con Escape, clic en overlay o botón ×.
   Las imágenes se obtienen del mismo .gallery-grid donde se hizo clic.
   ───────────────────────────────────────────────────────────────────────── */

const Lightbox = (() => {
  let images = [];  // Array de { src, alt }
  let current = 0;
  let overlay, imgEl, counter, prevBtn, nextBtn;

  function _build() {
    if ($('#sf-lightbox')) return;  // Ya existe

    overlay = document.createElement('div');
    overlay.id = 'sf-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Imagen ampliada');
    overlay.innerHTML = `
      <button class="lb-close" aria-label="Cerrar">&times;</button>
      <button class="lb-nav lb-prev" aria-label="Anterior">&#8592;</button>
      <div class="lb-img-wrap">
        <img class="lb-img" src="" alt="" decoding="async">
      </div>
      <button class="lb-nav lb-next" aria-label="Siguiente">&#8594;</button>
      <div class="lb-counter"></div>
    `;
    document.body.appendChild(overlay);

    imgEl   = overlay.querySelector('.lb-img');
    counter = overlay.querySelector('.lb-counter');
    prevBtn = overlay.querySelector('.lb-prev');
    nextBtn = overlay.querySelector('.lb-next');

    overlay.querySelector('.lb-close').addEventListener('click', close);
    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);

    // Clic en el overlay (fuera de la imagen) cierra
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.classList.contains('lb-img-wrap')) close();
    });
  }

  function _show() {
    const item = images[current];
    imgEl.src = item.src;
    imgEl.alt = item.alt;
    counter.textContent = `${current + 1} / ${images.length}`;
    prevBtn.style.visibility = images.length > 1 ? 'visible' : 'hidden';
    nextBtn.style.visibility = images.length > 1 ? 'visible' : 'hidden';
    overlay.classList.add('lb-open');
    document.body.style.overflow = 'hidden';
  }

  function open(src, alt, allImages) {
    _build();
    images  = allImages;
    current = allImages.findIndex(i => i.src === src);
    if (current === -1) current = 0;
    _show();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('lb-open');
    document.body.style.overflow = '';
    // Reset src after fade-out to avoid flicker on reopen
    setTimeout(() => { if (imgEl) imgEl.src = ''; }, 350);
  }

  function prev() {
    current = (current - 1 + images.length) % images.length;
    _show();
  }

  function next() {
    current = (current + 1) % images.length;
    _show();
  }

  function init() {
    const grid = $('.gallery-grid');
    if (!grid) return;

    const gps = $$('.gp', grid);
    if (!gps.length) return;

    // Construir el array de imágenes del grid
    const allImages = gps
      .map(gp => gp.querySelector('img'))
      .filter(Boolean)
      .map(img => ({ src: img.src, alt: img.alt }));

    gps.forEach(gp => {
      const img = gp.querySelector('img');
      if (!img) return;
      gp.style.cursor = 'zoom-in';
      gp.addEventListener('click', () => open(img.src, img.alt, allImages));
    });

    // Navegación con teclado
    document.addEventListener('keydown', e => {
      if (!overlay?.classList.contains('lb-open')) return;
      if (e.key === 'Escape')     close();
      if (e.key === 'ArrowLeft')  prev();
      if (e.key === 'ArrowRight') next();
    });
  }

  function _open(srcs, index) {
    _build();
    images  = srcs.map(s => ({ src: s, alt: 'Galería · Serafina Florería' }));
    current = index || 0;
    _show();
  }

  return { init, open, close, _open };
})();
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
   14. BANNER DE OFERTAS
   Strip sobre el hero. Quitar clase oferta-strip--visible para desactivar.
   ───────────────────────────────────────────────────────────────────────── */
const OfertaStrip = (() => {
  const SK = 'sf-oferta-closed';
  function init() {
    const strip = $('#ofertaStrip');
    if (!strip) return;
    if (sessionStorage.getItem(SK) === '1') { strip.classList.remove('oferta-strip--visible'); return; }
    const btn = $('#ofertaStripClose');
    if (btn) btn.addEventListener('click', () => {
      strip.classList.remove('oferta-strip--visible');
      sessionStorage.setItem(SK, '1');
    });
  }
  function show() { const s = $('#ofertaStrip'); if (s) { sessionStorage.removeItem(SK); s.classList.add('oferta-strip--visible'); } }
  function hide() { const s = $('#ofertaStrip'); if (s) s.classList.remove('oferta-strip--visible'); }
  return { init, show, hide };
})();
/* ─────────────────────────────────────────────────────────────────────────
   15. FEED DE INSTAGRAM
   Usa imágenes propias del sitio como fallback mientras no haya API token.
   Para integración real: proveer endpoint /api/instagram-feed que retorne
   { items: [{ src, url, alt }] }
   ───────────────────────────────────────────────────────────────────────── */
const InstagramFeed = (() => {
  const CFG = {
    handle: 'serafinaflorespy',
    count: 7,
    profileUrl: 'https://www.instagram.com/serafinaflorespy/',
    fallback: [
      '../IMAGENES/dia-de-la-madre-12.jpg','../IMAGENES/dia-de-la-madre-13.jpg','../IMAGENES/dia-de-la-madre-14.jpg',
      '../IMAGENES/dia-de-la-madre-18.jpg','../IMAGENES/dia-de-la-madre-8.jpg','../IMAGENES/dia-de-la-madre-7.jpg','../IMAGENES/dia-de-la-madre-36.jpg',
    ],
  };
  function _buildGrid(container, items) {
    container.innerHTML = '';
    items.slice(0, CFG.count).forEach((item, i) => {
      const a = document.createElement('a');
      a.href = item.url || CFG.profileUrl;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'ig-feed-item reveal' + (i > 0 ? ' d' + Math.min(i, 4) : '');
      a.setAttribute('aria-label', 'Ver en Instagram');
      const img = document.createElement('img');
      img.src = item.src; img.alt = item.alt || 'Serafina Florería · @serafinaflorespy';
      img.loading = 'lazy'; img.decoding = 'async';
      const ov = document.createElement('div');
      ov.className = 'ig-feed-overlay';
      ov.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".5" fill="white" stroke="none"/></svg><span>Instagram</span>';
      a.appendChild(img); a.appendChild(ov);
      container.appendChild(a);
    });
    Reveal.init();
  }
  function _skeletons(container) {
    container.innerHTML = '';
    for (let i = 0; i < CFG.count; i++) {
      const d = document.createElement('div');
      d.className = 'ig-feed-item ig-feed-skeleton';
      container.appendChild(d);
    }
  }
  async function init() {
    const container = $('#igFeedGrid');
    if (!container) return;
    _skeletons(container);
    try {
      const r = await fetch('/api/instagram-feed');
      if (!r.ok) throw new Error();
      const data = await r.json();
      _buildGrid(container, data.items);
    } catch (_) {
      _buildGrid(container, CFG.fallback.map(src => ({ src, url: CFG.profileUrl, alt: 'Arreglo floral · Serafina Florería' })));
    }
  }
  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   16. FAQ — acordeón accesible
   ───────────────────────────────────────────────────────────────────────── */
const FAQ = (() => {
  function init() {
    $$('.faq-item').forEach(item => {
      const btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        // Cerrar todos
        $$('.faq-item.open').forEach(o => {
          o.classList.remove('open');
          o.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          item.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }
  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   17. CONTADOR REGRESIVO — configurable desde el HTML
   La fecha se lee del atributo data-target del elemento #countdownSection.
   Formato ISO: 'YYYY-MM-DDTHH:MM:SS'
   Ejemplo: <div id="countdownSection" data-target="2025-06-22T00:00:00" ...>

   Para cambiar la fecha y el título: editar solo el HTML, no el JS.
   Si no hay data-target o la fecha ya pasó, la sección se oculta sola.
   ───────────────────────────────────────────────────────────────────────── */
const Countdown = (() => {
  let timer = null;

  function _pad(n) { return String(Math.floor(n)).padStart(2, '0'); }

  function _tick(section, target, dEl, hEl, mEl, sEl) {
    const diff = target - new Date();
    if (diff <= 0) {
      clearInterval(timer);
      section.setAttribute('hidden', 'true');
      return;
    }
    const days  = diff / 86400000;
    const hours = (diff % 86400000) / 3600000;
    const mins  = (diff % 3600000)  / 60000;
    const secs  = (diff % 60000)    / 1000;

    [dEl, hEl, mEl, sEl].forEach((el, i) => {
      const vals = [_pad(days), _pad(hours), _pad(mins), _pad(secs)];
      if (el.textContent !== vals[i]) {
        el.classList.add('tick');
        el.textContent = vals[i];
        setTimeout(() => el.classList.remove('tick'), 150);
      }
    });
  }

  function init() {
    const section = $('#countdownSection');
    if (!section) return;

    // Leer fecha del atributo data-target del HTML
    const raw = section.dataset.target;
    if (!raw) { section.setAttribute('hidden', 'true'); return; }

    const target = new Date(raw);
    if (isNaN(target) || target <= new Date()) { section.setAttribute('hidden', 'true'); return; }

    const dEl = $('#cdDays'), hEl = $('#cdHours'), mEl = $('#cdMins'), sEl = $('#cdSecs');
    if (!dEl) return;

    _tick(section, target, dEl, hEl, mEl, sEl);
    timer = setInterval(() => _tick(section, target, dEl, hEl, mEl, sEl), 1000);
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   18. CALCULADORA DE PRESUPUESTO
   ───────────────────────────────────────────────────────────────────────── */
const Calculadora = (() => {
  // Descripciones por ocasión y tamaño — sin precios
  const INFO = {
    romanticos:  {
      desc: 'Ramos con rosas premium, liliums o flores mixtas. Ideal para sorprender en cualquier ocasión.',
      chico:   'Ramo pequeño — perfecto para un detalle romántico o como acompañamiento.',
      mediano: 'Ramo mediano — la opción más elegida, equilibrio entre presencia y practicidad.',
      grande:  'Ramo grande — gran impacto visual, ideal para ocasiones muy especiales.',
    },
    cumpleanos:  {
      desc: 'Composiciones vibrantes y alegres con flores de temporada frescas.',
      chico:   'Arreglo pequeño — lindo detalle de cumpleaños para sorprender.',
      mediano: 'Arreglo mediano — colores alegres, presencia garantizada.',
      grande:  'Arreglo grande — para que el cumpleaños sea verdaderamente memorable.',
    },
    nacimientos: {
      desc: 'Arreglos delicados en tonos pastel. Perfectos para dar la bienvenida.',
      chico:   'Arreglo pequeño — suave y delicado para la nueva llegada.',
      mediano: 'Arreglo mediano — tonos pastel con buena presencia para la habitación.',
      grande:  'Arreglo grande — decoración completa para recibir al nuevo integrante.',
    },
    condolencias:{
      desc: 'Composiciones sobrias y elegantes que transmiten respeto y acompañamiento.',
      chico:   'Corona o arreglo pequeño — acompañamiento discreto y sentido.',
      mediano: 'Arreglo mediano — presencia sobria y elegante.',
      grande:  'Arreglo grande — para expresar el mayor acompañamiento.',
    },
    eventos:     {
      desc: 'Decoración floral completa para bodas, quinceaños y eventos corporativos.',
      chico:   'Centro de mesa o arreglo puntual para un espacio específico.',
      mediano: 'Decoración para varios puntos del evento con coherencia visual.',
      grande:  'Decoración integral — arcos, centros, bouquet y ambientación completa.',
    },
  };

  let selOcasion = null, selTamaño = null;

  function _update() {
    const result  = $('.calc-result');
    const titleEl = $('.calc-result-title');
    const descEl  = $('.calc-result-desc');
    const detEl   = $('.calc-result-detail');
    const waBtn   = $('.calc-wa-btn');
    if (!result) return;

    if (!selOcasion || !selTamaño) { result.classList.remove('visible'); return; }

    const info = INFO[selOcasion];
    if (!info) return;

    if (titleEl) titleEl.textContent = selTamaño.charAt(0).toUpperCase() + selTamaño.slice(1) + ' · ' + selOcasion.charAt(0).toUpperCase() + selOcasion.slice(1);
    if (descEl)  descEl.textContent  = info.desc;
    if (detEl)   detEl.textContent   = info[selTamaño] || '';

    const ocasionLabel = { romanticos:'romántico', cumpleanos:'de cumpleaños', nacimientos:'de nacimiento', condolencias:'de condolencias', eventos:'para evento' };
    const msg = encodeURIComponent('Hola! Quiero consultar por un arreglo ' + (ocasionLabel[selOcasion] || selOcasion) + ' tamaño ' + selTamaño + '. ¿Cuál es el precio?');
    if (waBtn) waBtn.href = 'https://wa.me/595985654607?text=' + msg;
    result.classList.add('visible');
  }

  function init() {
    $$('.calc-chip[data-ocasion]').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.calc-chip[data-ocasion]').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selOcasion = chip.dataset.ocasion;
        _update();
      });
    });
    $$('.calc-chip[data-tamano]').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.calc-chip[data-tamano]').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selTamaño = chip.dataset.tamano;
        _update();
      });
    });
  }

  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   19. BOTÓN COMPARTIR ARREGLO
   Usa Web Share API en móvil (iOS/Android nativo).
   Fallback: copia al portapapeles en desktop.
   ───────────────────────────────────────────────────────────────────────── */
const ShareBtn = (() => {
  function init() {
    $$('.share-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const card   = btn.closest('.cat-card');
        const nombre = card?.querySelector('.cat-title2')?.textContent?.trim() || 'Arreglo floral';
        const url    = 'https://www.serafinafloreria.com/catalogo.html';
        const texto  = '¡Mirá este arreglo de ' + nombre + ' de Serafina Florería! 🌸';

        // Web Share API — funciona en iOS Safari, Android Chrome, etc.
        if (navigator.share) {
          try {
            await navigator.share({ title: nombre + ' · Serafina Florería', text: texto, url });
            return; // éxito — no hacer nada más
          } catch (err) {
            if (err.name === 'AbortError') return; // usuario canceló — no mostrar tooltip
          }
        }

        // Fallback clipboard
        try {
          await navigator.clipboard.writeText(texto + ' ' + url);
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 2200);
        } catch (_) {
          // clipboard no disponible (HTTP, contexto inseguro)
          const ta = document.createElement('textarea');
          ta.value = texto + ' ' + url;
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 2200);
        }
      });
    });
  }
  return { init };
})();
/* ─────────────────────────────────────────────────────────────────────────
   20. LIGHTBOX EN GALERÍA DEL HOME
   Conecta las imágenes del mosaico .gallery-grid al lightbox existente.
   ───────────────────────────────────────────────────────────────────────── */
const GaleriaLightbox = (() => {
  function init() {
    const grid = document.querySelector('.gallery-grid');
    if (!grid) return;
    const imgs = [...grid.querySelectorAll('.gp img')];
    if (!imgs.length) return;

    const srcs = imgs.map(img => img.src);

    imgs.forEach((img, i) => {
      const gp = img.closest('.gp');
      if (!gp) return;
      gp.style.cursor = 'zoom-in';
      gp.addEventListener('click', () => {
        if (Lightbox && Lightbox._open) {
          Lightbox._open(srcs, i);
        }
      });
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
   22. PARALLAX EN HERO
   Mueve el fondo del hero a 40% de la velocidad del scroll.
   Solo en desktop con mouse fino. Respeta prefers-reduced-motion.
   Usa rAF + flag ticking para mantener 60fps sin layout thrashing.
   ───────────────────────────────────────────────────────────────────────── */
const Parallax = (() => {
  function init() {
    const bg = document.querySelector('.hero-bg');
    if (!bg) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let ticking = false;

    function update() {
      bg.style.transform = 'translateY(' + (window.scrollY * 0.4) + 'px)';
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
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
  // Solo se inicializan los módulos presentes en esta página.
  Theme.init();
  Cursor.init();
  Loader.init();
  Nav.init();
  MobileMenu.init();
  AnchorScroll.init();
  Reveal.init();
  CatalogoFilter.init();
  Lightbox.init();
  GaleriaLightbox.init();
  ShareBtn.init();
  OfertaStrip.init();
  InstagramFeed.init();
  FAQ.init();
  Countdown.init();
  Calculadora.init();
  FechaValidacion.init();
  CookieBanner.init();
  ScrollProgress.init();
  Parallax.init();
});
