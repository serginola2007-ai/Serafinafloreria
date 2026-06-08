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
   10. LIGHTBOX (index.html — galería, y cualquier .foto-galeria img)
   Abre una imagen a pantalla completa con overlay oscuro.
   Navegación ← → con teclado y botones.
   Cierre con Escape, clic en overlay o botón ×.
   Las imágenes se obtienen del mismo .galeria-grilla donde se hizo clic.
   ───────────────────────────────────────────────────────────────────────── */

const Lightbox = (() => {
  let images = [];  // Array de { src, alt }
  let current = 0;
  let overlay, imgEl, counter, prevBtn, nextBtn;

  function _build() {
    if ($('#visor')) return;  // Ya existe

    overlay = document.createElement('div');
    overlay.id = 'visor';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Imagen ampliada');
    overlay.innerHTML = `
      <button class="visor-cerrar" aria-label="Cerrar">&times;</button>
      <button class="visor-nav visor-anterior" aria-label="Anterior">&#8592;</button>
      <div class="visor-imagen-contenedor">
        <img class="visor-imagen" src="" alt="" decoding="async">
      </div>
      <button class="visor-nav visor-siguiente" aria-label="Siguiente">&#8594;</button>
      <div class="visor-contador"></div>
    `;
    document.body.appendChild(overlay);

    imgEl   = overlay.querySelector('.visor-imagen');
    counter = overlay.querySelector('.visor-contador');
    prevBtn = overlay.querySelector('.visor-anterior');
    nextBtn = overlay.querySelector('.visor-siguiente');

    overlay.querySelector('.visor-cerrar').addEventListener('click', close);
    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);

    // Clic en el overlay (fuera de la imagen) cierra
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.classList.contains('visor-imagen-contenedor')) close();
    });
  }

  function _show() {
    const item = images[current];
    imgEl.src = item.src;
    imgEl.alt = item.alt;
    counter.textContent = `${current + 1} / ${images.length}`;
    prevBtn.style.visibility = images.length > 1 ? 'visible' : 'hidden';
    nextBtn.style.visibility = images.length > 1 ? 'visible' : 'hidden';
    overlay.classList.add('visor-abierto');
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
    overlay.classList.remove('visor-abierto');
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
    const grid = $('.galeria-grilla');
    if (!grid) return;

    const gps = $$('.foto-galeria', grid);
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
      if (!overlay?.classList.contains('visor-abierto')) return;
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
   14. BANNER DE OFERTAS
   Strip sobre el hero. Quitar clase oferta-strip--visible para desactivar.
   ───────────────────────────────────────────────────────────────────────── */
const OfertaStrip = (() => {
  const SK = 'sf-oferta-closed';
  function init() {
    const strip = $('#tira-oferta');
    if (!strip) return;
    if (sessionStorage.getItem(SK) === '1') { strip.classList.remove('tira-oferta-visible'); return; }
    const btn = $('#tira-oferta-cerrar');
    if (btn) btn.addEventListener('click', () => {
      strip.classList.remove('tira-oferta-visible');
      sessionStorage.setItem(SK, '1');
    });
  }
  function show() { const s = $('#tira-oferta'); if (s) { sessionStorage.removeItem(SK); s.classList.add('tira-oferta-visible'); } }
  function hide() { const s = $('#tira-oferta'); if (s) s.classList.remove('tira-oferta-visible'); }
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
      'Dia de la madre 12.jpg','Dia de la madre 13.jpg','Dia de la madre 14.jpg',
      'Dia de la madre 18.jpg','Dia de la madre 8.jpg','Dia de la madre 7.jpg','Dia de la madre 36.jpg',
    ],
  };
  function _buildGrid(container, items) {
    container.innerHTML = '';
    items.slice(0, CFG.count).forEach((item, i) => {
      const a = document.createElement('a');
      a.href = item.url || CFG.profileUrl;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'instagram-item revelar' + (i > 0 ? ' d' + Math.min(i, 4) : '');
      a.setAttribute('aria-label', 'Ver en Instagram');
      const img = document.createElement('img');
      img.src = item.src; img.alt = item.alt || 'Serafina Florería · @serafinaflorespy';
      img.loading = 'lazy'; img.decoding = 'async';
      const ov = document.createElement('div');
      ov.className = 'instagram-capa';
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
      d.className = 'instagram-item instagram-esqueleto';
      container.appendChild(d);
    }
  }
  async function init() {
    const container = $('#grilla-instagram');
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
    $$('.pregunta-item').forEach(item => {
      const btn = item.querySelector('.pregunta-q');
      if (!btn) return;
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        const isOpen = item.classList.contains('abierto');
        // Cerrar todos
        $$('.pregunta-item.abierto').forEach(o => {
          o.classList.remove('abierto');
          o.querySelector('.pregunta-q').setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          item.classList.add('abierto');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
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
    const result  = $('.calculadora-result');
    const titleEl = $('.calculadora-result-titulo');
    const descEl  = $('.calculadora-result-descripcion');
    const detEl   = $('.calculadora-result-detail');
    const waBtn   = $('.boton-whatsapp-calculadora');
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
    $$('.calculadora-chip[data-ocasion]').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.calculadora-chip[data-ocasion]').forEach(c => c.classList.remove('seleccionado'));
        chip.classList.add('seleccionado');
        selOcasion = chip.dataset.ocasion;
        _update();
      });
    });
    $$('.calculadora-chip[data-tamano]').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.calculadora-chip[data-tamano]').forEach(c => c.classList.remove('seleccionado'));
        chip.classList.add('seleccionado');
        selTamaño = chip.dataset.tamano;
        _update();
      });
    });
  }

  return { init };
})();

/* ─────────────────────────────────────────────────────────────────────────
   20. LIGHTBOX EN GALERÍA DEL HOME
   Conecta las imágenes del mosaico .galeria-grilla al lightbox existente.
   ───────────────────────────────────────────────────────────────────────── */
const GaleriaLightbox = (() => {
  function init() {
    const grid = document.querySelector('.galeria-grilla');
    if (!grid) return;
    const imgs = [...grid.querySelectorAll('.foto-galeria img')];
    if (!imgs.length) return;

    const srcs = imgs.map(img => img.src);

    imgs.forEach((img, i) => {
      const gp = img.closest('.foto-galeria');
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
   22. PARALLAX EN HERO
   Mueve el fondo del hero a 40% de la velocidad del scroll.
   Solo en desktop con mouse fino. Respeta prefers-reduced-motion.
   Usa rAF + flag ticking para mantener 60fps sin layout thrashing.
   ───────────────────────────────────────────────────────────────────────── */
const Parallax = (() => {
  function init() {
    const bg = document.querySelector('.portada-fondo');
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
  Theme.init();
  Cursor.init();
  Loader.init();
  Nav.init();
  MobileMenu.init();
  AnchorScroll.init();
  Reveal.init();
  Lightbox.init();
  CookieBanner.init();
  ScrollProgress.init();
  OfertaStrip.init();
  InstagramFeed.init();
  FAQ.init();
  Calculadora.init();
  GaleriaLightbox.init();
  Parallax.init();
});
