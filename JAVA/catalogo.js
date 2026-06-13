/* ════════════════════════════════════════════
   SERAFINA FLORERÍA — catalogo.js
   Ubicación: JAVA/catalogo.js
   Lee datos de JAVA/catalogo-datos.js
   ════════════════════════════════════════════ */
'use strict';

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ─── TEMA CLARO / OSCURO ───────────────────── */
const Tema = (() => {
  const CLAVE = 'serafina-tema';
  const html  = document.documentElement;

  function obtener()    { return html.getAttribute('data-theme'); }
  function aplicar(v)   { html.setAttribute('data-theme', v); localStorage.setItem(CLAVE, v); actualizarLabel(); }
  function alternar()   { aplicar(obtener() === 'dark' ? 'light' : 'dark'); }
  function actualizarLabel() {
    const label = $('#mobileThemeLabel');
    if (label) label.textContent = obtener() === 'dark' ? 'Modo Claro' : 'Modo Oscuro';
  }
  function init() {
    html.setAttribute('data-theme', localStorage.getItem(CLAVE) || 'dark');
    actualizarLabel();
    $$('#themeBtn, #mobileThemeBtn').forEach(b => b.addEventListener('click', alternar));
  }
  return { init };
})();

/* ─── CURSOR ANIMADO ────────────────────────── */
const Cursor = (() => {
  function init() {
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    const punto = $('#cur'), anillo = $('#cur-r');
    if (!punto || !anillo) return;
    let mx = 0, my = 0, rx = 0, ry = 0;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    (function loop() {
      rx += (mx - rx) * 0.1; ry += (my - ry) * 0.1;
      punto.style.left  = mx + 'px'; punto.style.top  = my + 'px';
      anillo.style.left = rx + 'px'; anillo.style.top = ry + 'px';
      requestAnimationFrame(loop);
    })();
  }
  return { init };
})();

/* ─── BARRA DE NAVEGACIÓN ───────────────────── */
const Nav = (() => {
  function init() {
    const nav = $('#nav'); if (!nav) return;
    const umbral = nav.classList.contains('solid') ? 40 : 70;
    window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > umbral), { passive: true });
  }
  return { init };
})();

/* ─── MENÚ MÓVIL ────────────────────────────── */
const MenuMovil = (() => {
  let hamburger, menu;
  function cerrar() {
    if (!hamburger || !menu) return;
    hamburger.classList.remove('open');
    menu.classList.remove('open');
    document.body.style.overflow = '';
  }
  function init() {
    hamburger = $('#hamburger'); menu = $('#mobileMenu');
    if (!hamburger || !menu) return;
    hamburger.addEventListener('click', () => {
      const abierto = menu.classList.toggle('open');
      hamburger.classList.toggle('open', abierto);
      document.body.style.overflow = abierto ? 'hidden' : '';
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  }
  return { init, cerrar };
})();
window.closeMob = () => MenuMovil.cerrar();

/* ─── REVELAR AL SCROLL ─────────────────────── */
const Reveal = (() => {
  function init() {
    const elementos = $$('.reveal'); if (!elementos.length) return;
    const obs = new IntersectionObserver(
      entradas => entradas.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.08 }
    );
    elementos.forEach(el => obs.observe(el));
  }
  return { init };
})();

/* ════════════════════════════════════════════════════════
   CATÁLOGO
   Lee los datos de window.SERAFINA_CATALOGO
   (definido en JAVA/catalogo-datos.js)
   ════════════════════════════════════════════════════════ */
const Catalogo = (() => {
  const WA_NUMERO = '595985654607';
  let datos = null;

  /* Escapa HTML para evitar inyección */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  function linkWhatsApp(nombre) {
    const msg = encodeURIComponent('¡Hola! Quiero consultar por el arreglo "' + nombre + '" de Serafina Florería 🌸');
    return 'https://wa.me/' + WA_NUMERO + '?text=' + msg;
  }

  /* ── Botones de filtro por sección ── */
  function renderFiltros() {
    const contenedor = $('#filter-wrap');
    if (!contenedor || !datos.secciones.length) {
      if (contenedor) contenedor.style.display = 'none';
      return;
    }
    let html = '<button class="filter-btn active" data-filter="all">Todos</button>';
    datos.secciones.forEach(s => {
      html += `<button class="filter-btn" data-filter="${esc(s.id)}">${esc(s.titulo)}</button>`;
    });
    contenedor.innerHTML = html;

    $$('.filter-btn', contenedor).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.filter-btn', contenedor).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filtro = btn.dataset.filter;
        $$('[data-section]').forEach(sec => {
          sec.style.display = (filtro === 'all' || sec.dataset.section === filtro) ? '' : 'none';
        });
      });
    });
  }

  /* ── Secciones y grilla de productos ── */
  function renderSecciones() {
    const contenedor = $('#catalogo-cats');
    if (!contenedor) return;

    if (!datos.secciones.length) {
      contenedor.innerHTML = '<div class="catalogo-vacio"><h2>Catálogo en preparación</h2><p>Pronto vas a poder ver nuestros arreglos acá.</p></div>';
      return;
    }

    let html = '';
    datos.secciones.forEach(sec => {
      const productos = datos.productos.filter(p => p.seccion === sec.id);

      html += `<div data-section="${esc(sec.id)}">
        <div class="cat-section-header reveal">
          <div class="cat-section-header-inner">
            <div>
              <p class="cat-sec-tag">Colección · ${esc(sec.titulo)}</p>
              <h2 class="cat-sec-h2">${esc(sec.titulo)}</h2>
            </div>
            <div><p class="cat-sec-sub">${esc(sec.descripcion)}</p></div>
          </div>
        </div>`;

      if (!productos.length) {
        html += `<div class="seccion-vacia">Próximamente nuevos arreglos en esta colección.</div>`;
      } else {
        html += '<div class="productos-grid">';
        productos.forEach(p => {
          const foto   = (p.fotos && p.fotos[0]) ? esc(p.fotos[0]) : esc(sec.foto || '');
          const nFotos = (p.fotos || []).length;
          const badgeMultifoto = nFotos > 1
            ? `<div class="producto-fotos-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>${nFotos}
               </div>`
            : '';
          html += `<div class="producto-card" data-id="${esc(p.id)}">
            ${badgeMultifoto}
            <img src="${foto}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
            <div class="producto-info">
              <h3 class="producto-nombre">${esc(p.nombre)}</h3>
              ${p.precio      ? `<p class="producto-precio">${esc(p.precio)}</p>` : ''}
              ${p.descripcion ? `<p class="producto-mini">${esc(p.descripcion)}</p>` : ''}
              <span class="producto-ver">Ver detalle →</span>
            </div>
          </div>`;
        });
        html += '</div>';
      }
      html += '</div>';
    });

    contenedor.innerHTML = html;

    $$('.producto-card').forEach(card => {
      card.addEventListener('click', () => abrirModal(card.dataset.id));
    });

    Reveal.init();
  }

  /* ── Modal de detalle ── */
  function abrirModal(id) {
    const p = datos.productos.find(x => x.id === id);
    if (!p) return;
    const sec   = datos.secciones.find(s => s.id === p.seccion);
    const fotos = (p.fotos && p.fotos.length) ? p.fotos : [sec?.foto].filter(Boolean);

    $('#modal-section').textContent   = sec ? 'Colección · ' + sec.titulo : '';
    $('#modal-badge').textContent     = sec ? sec.titulo : '';
    $('#modal-name').textContent      = p.nombre;
    $('#modal-price').textContent     = p.precio || '';
    $('#modal-desc').textContent      = p.descripcion || '';
    $('#modal-wa').href               = linkWhatsApp(p.nombre);

    const imgPrincipal = $('#modal-img-main');
    imgPrincipal.src = fotos[0] || '';
    imgPrincipal.alt = p.nombre;

    const miniaturas = $('#modal-thumbs');
    if (fotos.length > 1) {
      miniaturas.innerHTML = fotos.map((f, i) =>
        `<img src="${esc(f)}" alt="${esc(p.nombre)} ${i+1}" class="${i === 0 ? 'active' : ''}" data-src="${esc(f)}">`
      ).join('');
      $$('img', miniaturas).forEach(mini => {
        mini.addEventListener('click', () => {
          imgPrincipal.src = mini.dataset.src;
          $$('img', miniaturas).forEach(x => x.classList.remove('active'));
          mini.classList.add('active');
        });
      });
    } else {
      miniaturas.innerHTML = '';
    }

    const overlay = $('#producto-modal');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function cerrarModal() {
    $('#producto-modal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function initModal() {
    const btnCerrar = $('#modal-close');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrarModal);

    const overlay = $('#producto-modal');
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) cerrarModal(); });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });
  }

  function init() {
    datos = window.SERAFINA_CATALOGO;
    if (!datos || !Array.isArray(datos.secciones)) {
      const contenedor = $('#catalogo-cats');
      if (contenedor) contenedor.innerHTML = '<div class="catalogo-vacio"><h2>No se pudieron cargar los datos</h2><p>Verificá que el archivo JAVA/catalogo-datos.js esté presente.</p></div>';
      return;
    }
    renderFiltros();
    renderSecciones();
    initModal();
  }

  return { init };
})();

/* ─── INICIO ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  Tema.init();
  Cursor.init();
  Nav.init();
  MenuMovil.init();
  Catalogo.init();
});
