/* ═══════════════════════════════════════════════════════════════
   SERAFINA FLORERÍA — catalogo-datos.js
   Ubicación: JAVA/catalogo-datos.js

   ┌─────────────────────────────────────────────────────────┐
   │  CÓMO AGREGAR UN PRODUCTO                               │
   │                                                         │
   │  1. Buscá la sección donde querés agregar               │
   │     (ej: /* ── ROMÁNTICOS */)                           │
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
      nombre:      'Arreglo Romántico 2',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_2.jpg']
    },
    {
      id:          'rom-03',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 3',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_3.jpg']
    },
    {
      id:          'rom-04',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 4',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_4.jpg']
    },
    {
      id:          'rom-05',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 5',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_5.jpg']
    },
    {
      id:          'rom-06',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 6',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_6.jpg']
    },
    {
      id:          'rom-07',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 7',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_7.jpg']
    },
    {
      id:          'rom-08',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 8',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_8.jpg']
    },
    {
      id:          'rom-09',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 9',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_9.jpg']
    },
    {
      id:          'rom-10',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 10',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_10.jpg']
    },
    {
      id:          'rom-11',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 11',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_11.jpg']
    },
    {
      id:          'rom-12',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 12',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_12.jpg']
    },
    {
      id:          'rom-13',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 13',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_13.jpg']
    },
    {
      id:          'rom-14',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 14',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_14.jpg']
    },
    {
      id:          'rom-15',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 15',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_15.jpg']
    },
    {
      id:          'rom-16',
      seccion:     'romanticos',
      nombre:      'Arreglo Romántico 16',
      precio:      '',
      descripcion: '',
      fotos:       ['../IMAGENES/Romanticos/arreglo_romanticos_16.jpg']
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
