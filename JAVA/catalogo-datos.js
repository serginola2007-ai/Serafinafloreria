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
      precio:      'M: 180.000 Gs. / G: 290.000 Gs.',
      descripcion: 'Ramo con flores cherry, diseño fresco y romántico.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_1_ramo_cherry.png']
    },
    {
      id:          'rom-02',
      seccion:     'romanticos',
      nombre:      'Ramo Amor',
      precio:      'M: 170.000 Gs. / G: 290.000 Gs.',
      descripcion: 'Ramo con rosas rojas y detalles en tonos pastel, ideal para expresar amor y cariño.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_2_ramo_amor.png']
    },
    {
      id:          'rom-03',
      seccion:     'romanticos',
      nombre:      'Ramo Fuscia',
      precio:      '6 rosas: 170.000 Gs. / 8 rosas: 225.000 Gs.',
      descripcion: 'Ramo con flores en tonos fuscia, diseño vibrante y lleno de vida, perfecto para sorprender a esa persona especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_3_ramo_fuscia.png']
    },
    {
      id:          'rom-04',
      seccion:     'romanticos',
      nombre:      'Ramo de Lirios',
      precio:      'P: 120.000 Gs. / M: 180.000 Gs. / G: 330.000 Gs.',
      descripcion: 'Ramo con lirios blancos, diseño elegante y sofisticado, ideal para expresar sentimientos profundos y duraderos.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_4_ramo_de_lirios.png']
    },
    {
      id:          'rom-05',
      seccion:     'romanticos',
      nombre:      'Ramo Pink',
      precio:      '190.000 Gs.',
      descripcion: 'Ramo con flores en tonos pink, diseño delicado y romántico, perfecto para expresar amor y ternura en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_5_ramo_pink.png']
    },
    {
      id:          'rom-06',
      seccion:     'romanticos',
      nombre:      'Ramo Sweet',
      precio:      '250.000 Gs.',
      descripcion: 'Ramo con flores en tonos suaves y dulces, diseño encantador y romántico, ideal para expresar amor y cariño de una manera tierna y delicada.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_6_ramo_sweet.png']
    },
    {
      id:          'rom-07',
      seccion:     'romanticos',
      nombre:      'Ramo Luz de Amor',
      precio:      '180.000 Gs.',
      descripcion: 'Ramo con flores en tonos claros y luminosos, diseño radiante y romántico, perfecto para expresar amor y esperanza en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_7_ramo_luz_de_amor.png']
    },
    {
      id:          'rom-08',
      seccion:     'romanticos',
      nombre:      'Ramo Pasión',
      precio:      '220.000 Gs.',
      descripcion: 'Ramo con flores en tonos intensos y apasionados, diseño vibrante y romántico, ideal para expresar amor y deseo de una manera intensa y apasionada.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_8_ramo_pasion.png']
    },
    {
      id:          'rom-09',
      seccion:     'romanticos',
      nombre:      'Ramo Pink G',
      precio:      '340.000 Gs.',
      descripcion: 'Ramo con flores en tonos pink, diseño grande y romántico, perfecto para expresar amor y ternura de una manera impactante y memorable en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_9_ramo_pink_g.png']
    },
    {
      id:          'rom-10',
      seccion:     'romanticos',
      nombre:      'Ramo Violeta',
      precio:      '180.000 Gs.',
      descripcion: 'Ramo con flores en tonos violeta, diseño elegante y romántico, ideal para expresar amor y misterio de una manera sofisticada y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_10_ramo_violeta.png']
    },
    {
      id:          'rom-11',
      seccion:     'romanticos',
      nombre:      'Ramo Bloom',
      precio:      '550.000 Gs.',
      descripcion: 'Ramo con flores en tonos variados, diseño fresco y romántico, perfecto para expresar amor y alegría de una manera vibrante y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_11_ramo_bloom.png']
    },
    {
      id:          'rom-12',
      seccion:     'romanticos',
      nombre:      'Ramo Love',
      precio:      '480.000 Gs.',
      descripcion: 'Ramo con flores en tonos rojos y rosas, diseño clásico y romántico, ideal para expresar amor y pasión de una manera tradicional y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_12_ramo_love.png']
    },
    {
      id:          'rom-13',
      seccion:     'romanticos',
      nombre:      'Jarron Pink',
      precio:      '360.000 Gs.',
      descripcion: 'Jarrón con flores en tonos pink, diseño delicado y romántico, perfecto para expresar amor y ternura de una manera elegante y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_17_jarron_pink.png']
    },
    {
      id:          'rom-14',
      seccion:     'romanticos',
      nombre:      'Box Sweet',
      precio:      '350.000 Gs. Version mini: 160.000 Gs.',
      descripcion: 'Box con flores en tonos suaves y dulces, diseño encantador y romántico, ideal para expresar amor y cariño de una manera tierna y delicada, perfecto para sorprender a esa persona especial en cualquier ocasión.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_18_box_sweet.png']
    },
    {
      id:          'rom-15',
      seccion:     'romanticos',
      nombre:      'Box Bloom',
      precio:      '550.000 Gs.',
      descripcion: 'Box con flores en tonos variados, diseño fresco y romántico, perfecto para expresar amor y alegría de una manera vibrante y encantadora, ideal para sorprender a esa persona especial en cualquier ocasión.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_19_box_bloom.png']
    },
    {
      id:          'rom-16',
      seccion:     'romanticos',
      nombre:      'Box Valentin',
      precio:      '900.000 Gs.',
      descripcion: 'Box con flores en tonos rojos y rosas, diseño clásico y romántico, ideal para expresar amor y pasión de una manera tradicional y encantadora, perfecto para sorprender a esa persona especial en cualquier ocasión.',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_20_box_valentin.png']
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
      precio:      '75.000 Gs.',
      descripcion: 'Ramo pequeño con 3 gerberas, diseño alegre y colorido, ideal para expresar cariño y alegría de una manera sencilla y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr1_Ramo_de_3_Gerberas.png']
    },
    {
      id:          'det-02',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de 3 Rosas',
      precio:      '90.000 Gs.',
      descripcion: 'Ramo pequeño con 3 rosas, diseño clásico y romántico, ideal para expresar amor y cariño de una manera sencilla y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr2_Ramo_de_3_Rosas.png']
    },
    {
      id:          'det-03',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de 3 Rosas Coreano',
      precio:      '95.000 Gs.',
      descripcion: 'Ramo pequeño con 3 rosas con estilo coreano, diseño elegante y sofisticado, ideal para expresar amor y cariño de una manera sencilla y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr3_Ramo_de_3_Rosas_Coreano.png']
    },
    {
      id:          'det-04',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de Claveles',
      precio:      '75.000 Gs.',
      descripcion: 'Ramo pequeño con claveles, diseño delicado y encantador, ideal para expresar cariño y alegría de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr4_Ramo_de_Claveles.png']
    },
    {
      id:          'det-05',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo Love',
      precio:      '95.000 Gs.',
      descripcion: 'Ramo pequeño con flores en tonos rojos y rosas, diseño clásico y romántico, ideal para expresar amor y pasión de una manera sencilla y encantadora en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr5_Ramo_Love.png']
    },
    {
      id:          'det-06',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de Lirio Petit',
      precio:      '80.000 Gs.',
      descripcion: 'Ramo pequeño con lirios petit, diseño elegante y sofisticado, ideal para expresar admiración y respeto de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr6_Ramo_de_Lirio_Petit.png']
    },
    {
      id:          'det-07',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de Girasol y Margaritas',
      precio:      '80.000 Gs.',
      descripcion: 'Ramo pequeño con un girasol y margaritas, diseño fresco y alegre, ideal para expresar alegría y buena voluntad de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr7_Ramo_de_Girasol_y_Margaritas.png']
    },
    {
      id:          'det-08',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de Rosa y Girasol',
      precio:      '70.000 Gs.',
      descripcion: 'Ramo pequeño con una rosa y un girasol, diseño romántico y encantador, ideal para expresar amor y admiración de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr8_Ramo_de_Rosa_y_Girasol.png']
    },
    {
      id:          'det-09',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo Alegre',
      precio:      '120.000 Gs.',
      descripcion: 'Ramo pequeño con flores alegres y vibrantes, diseño fresco y animado, ideal para expresar alegría y buen humor de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr9_Ramo_Alegre.png']
    },
    {
      id:          'det-10',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de mini Margaritas',
      precio:      '75.000 Gs.',
      descripcion: 'Ramo pequeño con mini margaritas, diseño adorable y encantador, ideal para expresar cariño y afecto de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr10_Ramo_de_mini_Margaritas.png']
    },
    {
      id:          'det-11',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo de Girasoles',
      precio:      '100.000 Gs.',
      descripcion: 'Ramo pequeño con girasoles, diseño soleado y alegre, ideal para expresar alegría y buena voluntad de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr11_Ramo_de_Girasoles.png']
    },
    {
      id:          'det-12',
      seccion:     'pequenosdetalles',
      nombre:      'Ramo Love Lila',
      precio:      '95.000 Gs.',
      descripcion: 'Ramo pequeño con flores en tonos de lila, diseño elegante y sofisticado, ideal para expresar amor y admiración de una manera sencilla y hermosa en cualquier ocasión especial.',
      fotos:       ['../IMAGENES/Pequenos_detalles/Arr12_Ramo_Love_Lila.png']
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

{
      id:          'grad-01',
      seccion:     'graduados',
      nombre:      'Arreglo 1',
      precio:      '100.000 Gs.',
      descripcion: 'Ramo con girasol y margaritas, diseño alegre y vibrante, ideal para celebrar el logro de una graduación de una manera fresca y encantadora.',
      fotos:       ['../IMAGENES/Graduados/Arr1_Gradu_Ramo_Girasol_con_Margaritas.png']
},
{
      id:          'grad-02',
      seccion:     'graduados',
      nombre:      'Arreglo 2',
      precio:      '310.000 Gs.',
      descripcion: 'Ramo alegre y colorido, perfecto para celebrar una graduación con estilo y alegría.',
      fotos:       ['../IMAGENES/Graduados/Arr2_Gradu_Ramo_Alegre.png']
},
{
      id:          'grad-03',
      seccion:     'graduados',
      nombre:      'Arreglo 3',
      precio:      '210.000 Gs.',
      descripcion: 'Ramo con rosas elegantes, diseño sofisticado y romántico, ideal para celebrar una graduación con estilo y elegancia.',
      fotos:       ['../IMAGENES/Graduados/Arr3_Gradu_Ramo_Rosas_Elegantes.png']
},
{
      id:          'grad-04',
      seccion:     'graduados',
      nombre:      'Arreglo 4',
      precio:      '200.000 Gs.',
      descripcion: 'Ramo con flores variadas, diseño fresco y alegre, ideal para celebrar una graduación con estilo y originalidad.',
      fotos:       ['../IMAGENES/Graduados/Arr4_Gradu_Ramo_Rosas.png']
},
{
      id:          'grad-05',
      seccion:     'graduados',
      nombre:      'Arreglo 5',
      precio:      '180.000 Gs.',
      descripcion: 'Ramo con girasol y margaritas, diseño alegre y vibrante, ideal para celebrar el logro de una graduación de una manera fresca y encantadora.',
      fotos:       ['../IMAGENES/Graduados/Arr5_Gradu_Ramo_Girasol_y_Margaritas.png']
},
{
      id:          'grad-06',
      seccion:     'graduados',
      nombre:      'Arreglo 6',
      precio:      '240.000 Gs.',
      descripcion: 'Ramo con girasoles y rosas amarillas, diseño alegre y vibrante, ideal para celebrar el logro de una graduación de una manera fresca y encantadora.',
      fotos:       ['../IMAGENES/Graduados/Arr6_Gradu_Ramo_Girasoles_y_Rosas_Amarillas.png']
},
{
      id:          'grad-07',
      seccion:     'graduados',
      nombre:      'Arreglo 7',
      precio:      '200.000 Gs.',
      descripcion: 'Ramo con rosas pink, diseño elegante y romántico, ideal para celebrar una graduación con estilo y elegancia.',
      fotos:       ['../IMAGENES/Graduados/Arr7_Gradu_Ramo_Rosas_Pink.png']
},
{
      id:          'grad-08',
      seccion:     'graduados',
      nombre:      'Arreglo 8',
      precio:      '270.000 Gs.',
      descripcion: 'Ramo con flores alegres y vibrantes, diseño fresco y animado, ideal para celebrar una graduación con estilo y alegría.',
      fotos:       ['../IMAGENES/Graduados/Arr8_Gradu_Ramo_Alegre.png']
},
{
      id:          'grad-09',
      seccion:     'graduados',
      nombre:      'Arreglo 9',
      precio:      '185.000 Gs.',
      descripcion: 'Ramo con rosas en tonos lilas, diseño elegante y sofisticado, ideal para celebrar una graduación con estilo y elegancia.',
      fotos:       ['../IMAGENES/Graduados/Arr9_Gradu_Ramo_Rosas_Tonos_Lilas.png']
},
{
      id:          'grad-10',
      seccion:     'graduados',
      nombre:      'Arreglo 10',
      precio:      '360.000 Gs.',
      descripcion: 'Ramo con lirios rosados, diseño elegante y sofisticado, ideal para celebrar una graduación con estilo y elegancia.',
      fotos:       ['../IMAGENES/Graduados/Arr10_Gradu_Ramo_Lirios_Rosados.png']
},
{
      id:          'grad-11',
      seccion:     'graduados',
      nombre:      'Arreglo 11',
      precio:      '740.000 Gs.',
      descripcion: 'Ramo con rosas rosadas, diseño elegante y romántico, ideal para celebrar una graduación con estilo y elegancia.',
      fotos:       ['../IMAGENES/Graduados/Arr11_Gradu_Ramo_Grande_de_Rosas_Rosadas.png']
},
{
      id:          'grad-12',
      seccion:     'graduados',
      nombre:      'Arreglo 12',
      precio:      'M: 170.000 Gs. / G: 280.000 Gs.',
      descripcion: 'Ramo con girasoles y margaritas, diseño alegre y vibrante, ideal para celebrar el logro de una graduación de una manera fresca y encantadora.',
      fotos:       ['../IMAGENES/Graduados/Arr12_Gradu_Ramo_Grande_Girasoles_y_Margaritas.png']
},
{
      id:          'grad-13',
      seccion:     'graduados',
      nombre:      'Arreglo 13',
      precio:      '90.000 Gs.',
      descripcion: 'Ramo con girasol rosa y birrete, diseño alegre y festivo, ideal para celebrar una graduación con estilo y alegría.',
      fotos:       ['../IMAGENES/Graduados/Arr13_Gradu_Ramo_Girasol_Rosa_y_Birrete.png']
},
{
      id:          'grad-14',
      seccion:     'graduados',
      nombre:      'Arreglo 14',
      precio:      '120.000 Gs.',
      descripcion: 'Ramo con 3 girasoles, diseño fresco y alegre, ideal para celebrar el logro de una graduación de una manera original y encantadora.',
      fotos:       ['../IMAGENES/Graduados/Arr14_Gradu_Ramo_de_3_Girasoles.png']
},
{
      id:          'grad-15',
      seccion:     'graduados',
      nombre:      'Arreglo 15',
      precio:      '370.000 Gs.',
      descripcion: 'Box con flores mixtas en tonos pastel, diseño suave y elegante, ideal para celebrar una graduación con estilo y refinamiento.',
      fotos:       ['../IMAGENES/Graduados/Arr15_Gradu_Box_Flores_Mix_Pastel.png']
},
{
      id:          'grad-16',
      seccion:     'graduados',
      nombre:      'Arreglo 16',
      precio:      '310.000 Gs.',
      descripcion: 'Box con girasoles y flores mixtas, diseño alegre y vibrante, ideal para celebrar el logro de una graduación de una manera fresca y encantadora.',
      fotos:       ['../IMAGENES/Graduados/Arr16_Gradu_Box_Girasol_y_Flores_Mix.png']
},

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

{
      id:          'nac-01',
      seccion:     'nacimientos',
      nombre:      'Arreglo 1',
      precio:      '210.000 Gs.',
      descripcion: 'Ramo con hortensias azules y rosas blancas, diseño tierno y delicado, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora y llena de amor.',
      fotos:       ['../IMAGENES/Nacimientos/Arr1_Naci_Ramo_Hortensia_Azul_y_Rosas_blancas.png']
},
{
      id:          'nac-02',
      seccion:     'nacimientos',
      nombre:      'Arreglo 2',
      precio:      '210.000 Gs.',
      descripcion: 'Ramo con hortensias rosadas y rosas blancas, diseño tierno y delicado, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora y llena de amor.',
      fotos:       ['../IMAGENES/Nacimientos/Arr2_Naci_Ramo_Hortensia_Rosada_y_Rosas_Blancas.png']
},
{
      id:          'nac-03',
      seccion:     'nacimientos',
      nombre:      'Arreglo 3',
      precio:      '290.000 Gs.',
      descripcion: 'Box con rosas y globo personalizado, diseño adorable y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr3_Naci_Box_Rosas_y_Globo_Personalizado.png']
},
{
      id:          'nac-04',
      seccion:     'nacimientos',
      nombre:      'Arreglo 4',
      precio:      '395.000 Gs.',
      descripcion: 'Box con rosas azules, rosas rosadas, girasoles y globo personalizado, diseño alegre y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr4_Naci_Box_Rosas_Azules_Girasoles_y_Globo.png']
},
{
      id:          'nac-05',
      seccion:     'nacimientos',
      nombre:      'Arreglo 5',
      precio:      '365.000 Gs.',
      descripcion: 'Box con rosas celestes, rosas blancas, globo personalizado y detalles en tonos pastel, diseño tierno y delicado, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora y llena de amor.',
      fotos:       ['../IMAGENES/Nacimientos/Arr5_Naci_Box_Celeste_Rosas_Blancas_y_Globo.png']
},
{
      id:          'nac-06',
      seccion:     'nacimientos',
      nombre:      'Arreglo 6',
      precio:      '430.000 Gs.',
      descripcion: 'Cigueña con flores mixtas en tonos celestes, diseño encantador y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr6_Naci_Ciguena_Celeste_Flores_Mix.png']
},
{
      id:          'nac-07',
      seccion:     'nacimientos',
      nombre:      'Arreglo 7',
      precio:      '550.000 Gs.',
      descripcion: 'Jirafa con flores en tonos azules, girasoles y otras flores, diseño adorable y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr7_Naci_Jirafa_Azul_Girasoles_y_Flores.png']
},
{
      id:          'nac-08',
      seccion:     'nacimientos',
      nombre:      'Arreglo 8',
      precio:      '550.000 Gs.',
      descripcion: 'Jirafa con flores en tonos rosados, girasoles y otras flores, diseño tierno y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr8_Naci_Jirafa_Rosada_Flores_Mix_Pastel.png']
},
{
      id:          'nac-09',
      seccion:     'nacimientos',
      nombre:      'Arreglo 9',
      precio:      '550.000 Gs.',
      descripcion: 'Box con flores en tonos rosados, girasoles y otras flores, diseño tierno y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr9_Naci_Box_Grande_Flores_Mix_Rosadas.png']
},
{
      id:          'nac-10',
      seccion:     'nacimientos',
      nombre:      'Arreglo 10',
      precio:      '240.000 Gs.',
      descripcion: 'Biberón con flores en tonos rosados, lirios y gerberas, diseño adorable y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr10_Naci_Biberon_Rosado_con_Lirios_y_Gerberas.png']
},
{
      id:          'nac-11',
      seccion:     'nacimientos',
      nombre:      'Arreglo 11',
      precio:      '385.000 Gs.',
      descripcion: 'Silueta de carrito en tonos azules, girasoles y rosas, diseño alegre y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr11_Naci_Silueta_Carrito_Azul_Girasol_con_Rosas_y_Globo.png']
},
{
      id:          'nac-12',
      seccion:     'nacimientos',
      nombre:      'Arreglo 12',
      precio:      '190.000 Gs.',
      descripcion: 'Box con flores en tonos morados, girasoles y globo personalizado, diseño elegante y lleno de amor, ideal para dar la bienvenida a un nuevo bebé de una manera encantadora.',
      fotos:       ['../IMAGENES/Nacimientos/Arr12_Naci_Box_Morado_Girasoles_y_Globo_Hello_Kitty.png']
},


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

{
      id:          'con-01',
      seccion:     'condolencias',
      nombre:      'Corona Clásica',
      precio:      '550.000 Gs.',
      descripcion: 'Corona con flores blancas, diseño clásico y elegante, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr1_Cond_Corona_Crisantemos_Blancos.png']
},
{
      id:          'con-02',
      seccion:     'condolencias',
      nombre:      'Corona con Rosas',
      precio:      '690.000 Gs.',
      descripcion: 'Corona con flores blancas y rosas beige, diseño elegante y sobrio, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr2_Cond_Corona_Blancas_con_Cinta_Beige.png']
},
{
      id:          'con-03',
      seccion:     'condolencias',
      nombre:      'Corona con Rosas',
      precio:      '690.000 Gs.',
      descripcion: 'Corona con flores blancas y rosas rojas, diseño elengante, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr3_Cond_Corona_Crisantemos_Blancos_y_Rosas_Rojas.png']
},
{
      id:          'con-04',
      seccion:     'condolencias',
      nombre:      'Corona con Rosas y Lirios',
      precio:      '750.000 Gs.',
      descripcion: 'Corona con flores blancas y lirios rosados, diseño elegante y sofisticado, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr4_Cond_Corona_Blanca_con_Lirios_Rosados.png']
},
{
      id:          'con-05',
      seccion:     'condolencias',
      nombre:      'Corona de Girasoles',
      precio:      '700.000 Gs.',
      descripcion: 'Corona con flores blancas, girasoles y flores amarillas, diseño alegre y lleno de vida, ideal para expresar condolencias y respeto de una manera solemne pero con un toque de esperanza y luz en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr5_Cond_Corona_Girasoles_y_Flores_Amarillas.png']
},
{
      id:          'con-06',
      seccion:     'condolencias',
      nombre:      'Arreglo Clásico',
      precio:      '130.000 Gs.',
      descripcion: 'Arreglo con flores blancas, diseño clásico y elegante, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr6_Cond_Arreglo_Clasico_Flores_Blancas.png']
},
{
      id:          'con-07',
      seccion:     'condolencias',
      nombre:      'Cruz de Condolencias',
      precio:      '350.000 Gs.',
      descripcion: 'Cruz con flores blancas y rosas rosadas, diseño elegante y sobrio, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr7_Cond_Cruz_Flores_Blancas_y_Rosas_Rosadas.png']
},
{
      id:          'con-08',
      seccion:     'condolencias',
      nombre:      'Box blanca',
      precio:      '260.000 Gs.',
      descripcion: 'Box con flores blancas, diseño sencillo y elegante, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr8_Cond_Box_Madera_Rosas_Blancas.png']
},
{
      id:          'con-09',
      seccion:     'condolencias',
      nombre:      'Maceta blanca',
      precio:      '250.000 Gs.',
      descripcion: 'Maceta con flores blancas, diseño sencillo y elegante, ideal para expresar condolencias y respeto de una manera solemne y delicada en momentos difíciles.',
      fotos:       ['../IMAGENES/Condolencias/Arr9_Cond_Maceta_Blanca_de_Rosas_y_Follaje.png']
}

  ] /* fin productos */

}; /* fin window.SERAFINA_CATALOGO */
