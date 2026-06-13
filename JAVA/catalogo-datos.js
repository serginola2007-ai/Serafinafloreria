/* ═══════════════════════════════════════════════════════════════
   SERAFINA FLORERÍA — catalogo-datos.js
   Ubicación: JAVA/catalogo-datos.js
   ┌─────────────────────────────────────────────────────────┐
   │  CÓMO AGREGAR UN PRODUCTO                               │
   │                                                         │
   │  1. Buscá la sección donde querés agregar               │
   │     (ej: ROMÁNTICOS)                                   │
   │  2. Copiá un bloque { ... } existente                   │
   │  3. Pegalo al final de la lista de esa sección          │
   │  4. Cambiá: id, nombre, precio, descripcion, fotos      │
   │  5. Guardá el archivo                                   │
   │                                                         │
   │  REGLAS DE RUTAS:                                       │
   │  Las fotos van relativas desde la carpeta HTML/         │
   │  Ej: "../IMAGENES/Romanticos/nombre-foto.jpg"           │
   └─────────────────────────────────────────────────────────┘
   ═══════════════════════════════════════════════════════════════ */

window.SERAFINA_CATALOGO = {

  /* ══════════════════════════════
     SECCIONES
     id          → identificador único (sin espacios)
     titulo      → nombre visible
     descripcion → frase corta debajo del título
     foto        → portada (ruta desde HTML/)
  ══════════════════════════════ */
  secciones: [
    {
      id:          'romanticos',
      titulo:      'Románticos',
      descripcion: 'Ramos y arreglos diseñados para expresar amor. Flores frescas seleccionadas, cada pieza única.',
      foto:        '../IMAGENES/Romanticos/arreglo_romanticos_1_ramo_cherry.jpg'
    },
    {
      id:          'pequenosdetalles',
      titulo:      'Pequeños Detalles',
      descripcion: 'Pequeños gestos que dicen mucho. Arreglos perfectos para sorprender en cualquier momento.',
      foto:        '../IMAGENES/coleccion_pequeñosdetalles_logo.png'
    },
    {
      id:          'graduados',
      titulo:      'Graduados',
      descripcion: 'Celebrá el logro con flores. Arreglos especiales para acompañar el gran día.',
      foto:        '../IMAGENES/coleccion_graduados_logo.jpeg'
    },
    {
      id:          'nacimientos',
      titulo:      'Nacimientos',
      descripcion: 'Bienvenida al mundo con flores. Arreglos tiernos para recibir una nueva vida.',
      foto:        '../IMAGENES/coleccion_nacimientos_logo.jpeg'
    },
    {
      id:          'condolencias',
      titulo:      'Condolencias',
      descripcion: 'Acompañamos con respeto y delicadeza en los momentos difíciles.',
      foto:        '../IMAGENES/coleccion_condolencias_logo.jpeg'
    }
  ],

  /* ══════════════════════════════
     PRODUCTOS
     id          → único, sin espacios
     seccion     → debe coincidir con el id de la sección
     nombre      → nombre del arreglo
     precio      → texto libre ("Gs. 250.000", "Desde Gs. 180.000")
     descripcion → descripción corta
     fotos       → array de rutas desde HTML/
                   Ej: ["../IMAGENES/Romanticos/foto.jpg"]
  ══════════════════════════════ */
  productos: [

    /* ─────────────────────────────
       ROMÁNTICOS
    ───────────────────────────── */
    {
      id:          'rom-01',
      seccion:     'romanticos',
      nombre:      'Ramo Cherry',
      precio:      '',
      descripcion: 'Ramo con flores cherry, diseño fresco y romántico.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_1_ramo_cherry.jpg']
    },
    {
      id:          'rom-02',
      seccion:     'romanticos',
      nombre:      'Ramo Amor',
      precio:      '',
      descripcion: 'Ramo con rosas rojas y detalles en tonos pastel, ideal para expresar amor y cariño.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_2_ramo_amor.jpg']
    },
    {
      id:          'rom-03',
      seccion:     'romanticos',
      nombre:      'Ramo Fuscia',
      precio:      '',
      descripcion: 'Ramo con flores en tonos fuscia, diseño vibrante y lleno de vida, perfecto para sorprender a esa persona especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_3_ramo_fuscia.jpg']
    },
    {
      id:          'rom-04',
      seccion:     'romanticos',
      nombre:      'Ramo de Lirios',
      precio:      '',
      descripcion: 'Ramo con lirios blancos, diseño elegante y sofisticado, ideal para expresar sentimientos profundos y duraderos.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_4_ramo_de_lirios.jpg']
    },
    {
      id:          'rom-05',
      seccion:     'romanticos',
      nombre:      'Ramo Pink',
      precio:      '',
      descripcion: 'Ramo con flores en tonos pink, diseño delicado y romántico, perfecto para expresar amor y ternura en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_5_ramo_pink.jpg']
    },
    {
      id:          'rom-06',
      seccion:     'romanticos',
      nombre:      'Ramo Sweet',
      precio:      '',
      descripcion: 'Ramo con flores en tonos suaves y dulces, diseño encantador y romántico, ideal para expresar amor y cariño de una manera tierna y delicada.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_6_ramo_sweet.jpg']
    },
    {
      id:          'rom-07',
      seccion:     'romanticos',
      nombre:      'Ramo Luz de Amor',
      precio:      '',
      descripcion: 'Ramo con flores en tonos claros y luminosos, diseño radiante y romántico, perfecto para expresar amor y esperanza en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_7_ramo_luz_de_amor.jpg']
    },
    {
      id:          'rom-08',
      seccion:     'romanticos',
      nombre:      'Ramo Pasión',
      precio:      '',
      descripcion: 'Ramo con flores en tonos intensos y apasionados, diseño vibrante y romántico, ideal para expresar amor y deseo de una manera intensa y apasionada.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_8_ramo_pasion.jpg']
    },
    {
      id:          'rom-09',
      seccion:     'romanticos',
      nombre:      'Ramo Pink G',
      precio:      '',
      descripcion: 'Ramo con flores en tonos pink, diseño grande y romántico, perfecto para expresar amor y ternura de una manera impactante y memorable en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_9_ramo_pink_g.jpg']
    },
    {
      id:          'rom-10',
      seccion:     'romanticos',
      nombre:      'Ramo Violeta',
      precio:      '',
      descripcion: 'Ramo con flores en tonos violeta, diseño elegante y romántico, ideal para expresar amor y misterio de una manera sofisticada y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_10_ramo_violeta.jpg']
    },
    {
      id:          'rom-11',
      seccion:     'romanticos',
      nombre:      'Ramo Bloom',
      precio:      '',
      descripcion: 'Ramo con flores en tonos variados, diseño fresco y romántico, perfecto para expresar amor y alegría de una manera vibrante y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_11_ramo_bloom.jpg']
    },
    {
      id:          'rom-12',
      seccion:     'romanticos',
      nombre:      'Ramo Love',
      precio:      '',
      descripcion: 'Ramo con flores en tonos rojos y rosas, diseño clásico y romántico, ideal para expresar amor y pasión de una manera tradicional y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_12_ramo_love.jpg']
    },
    {
      id:          'rom-13',
      seccion:     'romanticos',
      nombre:      'Jarron Pink',
      precio:      '',
      descripcion: 'Jarrón con flores en tonos pink, diseño delicado y romántico, perfecto para expresar amor y ternura de una manera elegante y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_17_jarron_pink.jpg']
    },
    {
      id:          'rom-14',
      seccion:     'romanticos',
      nombre:      'Box Sweet',
      precio:      '',
      descripcion: 'Box con flores en tonos suaves y dulces, diseño encantador y romántico, ideal para expresar amor y cariño de una manera tierna y delicada, perfecto para sorprender a esa persona especial en cualquier ocasión.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_18_box_sweet.jpg']
    },
    {
      id:          'rom-15',
      seccion:     'romanticos',
      nombre:      'Box Bloom',
      precio:      '',
      descripcion: 'Box con flores en tonos variados, diseño fresco y romántico, perfecto para expresar amor y alegría de una manera vibrante y encantadora, ideal para sorprender a esa persona especial en cualquier ocasión.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_19_box_bloom.jpg']
    },
    {
      id:          'rom-16',
      seccion:     'romanticos',
      nombre:      'Box Valentin',
      precio:      '',
      descripcion: 'Box con flores en tonos rojos y rosas, diseño clásico y romántico, ideal para expresar amor y pasión de una manera tradicional y encantadora, perfecto para sorprender a esa persona especial en cualquier ocasión.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_20_box_valentin.jpg']
    },

    /* ─────────────────────────────
       PEQUEÑOS DETALLES
       Agregá productos acá ↓
       Ejemplo:
    // {
    //   id:          'det-01',
    //   seccion:     'pequenosdetalles',
    //   nombre:      'Nombre del arreglo',
    //   precio:      'Gs. 150.000',
    //   descripcion: 'Descripción del arreglo.',
    //   fotos:       ['../IMAGENES/PequenosDetalles/nombre-foto.jpg']
    // },
    ───────────────────────────── */

    {
      id:          'det-01',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de 3 Gerberas',
      precio:      '',
      descripcion: 'Ramo pequeño con 3 gerberas, diseño alegre y colorido, ideal para expresar cariño y alegría de una manera sencilla y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/PequenosDetalles/Arr1_Ramo_de_3_Gerberas.png']
    },

    /* ─────────────────────────────
       GRADUADOS
       Agregá productos acá ↓
       Ejemplo:
    // {
    //   id:          'grad-01',
    //   seccion:     'graduados',
    //   nombre:      'Nombre del arreglo',
    //   precio:      'Gs. 200.000',
    //   descripcion: 'Descripción del arreglo.',
    //   fotos:       ['../IMAGENES/Graduados/nombre-foto.jpg']
    // },
    ───────────────────────────── */

    /* ─────────────────────────────
       NACIMIENTOS
       Agregá productos acá ↓
       Ejemplo:
    // {
    //   id:          'nac-01',
    //   seccion:     'nacimientos',
    //   nombre:      'Nombre del arreglo',
    //   precio:      'Gs. 180.000',
    //   descripcion: 'Descripción del arreglo.',
    //   fotos:       ['../IMAGENES/Nacimientos/nombre-foto.jpg']
    // },
    ───────────────────────────── */

    /* ─────────────────────────────
       CONDOLENCIAS
       Agregá productos acá ↓
       Ejemplo:
    // {
    //   id:          'con-01',
    //   seccion:     'condolencias',
    //   nombre:      'Nombre del arreglo',
    //   precio:      'Gs. 220.000',
    //   descripcion: 'Descripción del arreglo.',
    //   fotos:       ['../IMAGENES/Condolencias/nombre-foto.jpg']
    // }
    ───────────────────────────── */

  ] /* fin productos */

}; /* fin window.SERAFINA_CATALOGO */
