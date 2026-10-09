# DOVA — navegación superior (documentación a partir de capturas)

**Alcance y fiabilidad.** No tengo acceso a `dova.onrender.com` (bloqueado por la política de red del entorno) ni a su código. Todo lo de abajo sale de **3 capturas** que aportó el usuario (Caja, Inicio con submenú *Facturación*, Inicio con submenú *Seguimiento*). Medidas en píxeles sobre una captura de ~1917 px de ancho: son aproximadas.
Etiquetas: **[OBS]** visto en la captura · **[INF]** inferido, sin confirmar · **[NO VERIFICADO]** no aparece en las capturas.

## 1. Barra superior (de izquierda a derecha) [OBS]

Franja de ~70 px de alto, fondo casi negro, línea gris inferior de 1 px, ancho completo. Contenido alineado con el área de página (margen izquierdo ~25 px).

| # | Elemento | Descripción |
|---|---|---|
| 1 | Marca | "**DOVA**" en sans-serif bold blanco (~20 px) y, pegado a la derecha, "DentCareRC" en tamaño pequeño (~13 px) [INF: nombre de la clínica/sede]. No se ve si es un enlace. |
| 2 | Búsqueda en línea | Campo de ~245 × 42 px (x 184–427), borde gris, fondo apenas más claro que la barra. Placeholder: "Buscar pacientes, citas, fact…" (truncado; [INF] "facturas"). |
| 3 | **Inicio** | Enlace directo, tipografía **monospace** ~14 px. Activo = caja naranja rellena (~#d9622b) con texto blanco. |
| 4 | **Movimientos ▾** | Desplegable. Activo (naranja) cuando la página actual pertenece a él (en la captura de Caja, Movimientos está naranja: el padre se marca activo). Caret ▾ cerrado, ▴ abierto. |
| 5 | **Reportes ▾** | Desplegable [contenido NO VERIFICADO]. |
| 6 | Separador vertical | Línea de 1 px entre Reportes y Administración. |
| 7 | **Administración ▾** | Desplegable [contenido NO VERIFICADO]. Otro separador vertical lo cierra. |
| 8 | Campana | Botón cuadrado ~44 px con borde, icono de campana y un **punto verde** abajo a la derecha [INF: indicador de conexión o de notificaciones; no se ve contador ni panel]. |
| 9 | **Buscar  Ctrl K** | Botón con borde: lupa + "Buscar" + chip de teclado "Ctrl K" [INF: abre una búsqueda global con atajo]. |
| 10 | **Salir** | Botón con borde, texto simple. |

Los elementos 8–10 están anclados a la derecha; 3–7 a la izquierda tras la búsqueda. [NO VERIFICADO: comportamiento al reducir el ancho.]

## 2. Desplegables [OBS]

**Panel principal (Movimientos abierto).** Columna de ~275 px de ancho bajo el activador, alineada a su borde izquierdo (x 547), fondo casi negro, borde gris fino, sin radio visible. Filas de ~46 px, texto monospace. Cada fila lleva un chevron "›" a la derecha. Orden exacto:
1. Agenda ›
2. Caja ›
3. Facturación ›
4. Seguimiento ›
5. Página web ›
6. Clínica ›

**Submenú lateral (flyout).** Se abre **a la derecha** del panel, pegado a su borde (x ≈ 817), con el mismo estilo. Al pasar el cursor, la fila activa se ve un poco más clara. Su borde superior queda ~27 px por encima del centro de la fila que lo abrió (es decir, alineado con el tope de esa fila), por lo que la posición vertical **depende de la fila**. Se dibuja **encima** del contenido de la página (se ve cortando las tarjetas).

- *Facturación* (5): Resumen · Facturas · Nueva factura · Reportes · Configuración.
- *Seguimiento* (12): Para contactar · Controles periódicos · Controles después de un tratamiento · Piezas en observación · Tratamientos sin turno · Presupuestos sin respuesta · Recordatorios de turnos · Pacientes que no volvieron · Cumpleaños · Tareas · Biopsias · Llamadas y mensajes.
- *Agenda, Caja, Página web, Clínica*: tienen chevron (por lo tanto submenú) pero **sus opciones no aparecen en las capturas** [NO VERIFICADO].

**Árbol observado**
- Inicio
- Movimientos
  - Agenda › [?]
  - Caja › [?]
  - Facturación › Resumen, Facturas, Nueva factura, Reportes, Configuración
  - Seguimiento › (12 opciones de arriba)
  - Página web › [?]
  - Clínica › [?]
- Reportes ▾ [?]
- Administración ▾ [?]

**No verificado** (no hay evidencia en las capturas): si abre por clic o por hover, animación, cierre con Escape/clic fuera, navegación con teclado, cómo se evita que el flyout se cierre al mover el cursor, comportamiento táctil, el panel de la campana, el overlay de "Buscar Ctrl K", si "Salir" pide confirmación, permisos por rol y el diseño móvil.

## 3. Página [OBS]

- Título de página en MAYÚSCULAS bold (~20 px): "CAJA", "INICIO"; subtítulos de sección también en mayúsculas ("SEGUIMIENTO DE PACIENTES").
- **Pestañas** bajo el título (Caja: "Caja del día" activa en negrita, "Cierres anteriores"), con línea inferior de 1 px.
- **Tarjetas de indicadores**: cuadrícula con borde fino y fondo marrón muy oscuro; número grande (0) y etiqueta debajo ("Controles periódicos atrasados", "Turnos hoy", "Insumos por acabarse", "Cuotas vencidas"…). Texto de estado debajo ("No hay una caja abierta hoy.").
- **Caja cerrada**: tarjeta con título "La caja está cerrada", texto guía, etiqueta "Efectivo inicial en el cajón (Gs.)", campo numérico (valor 0) y botón naranja "Abrir caja" (monospace).
- Contenedor de contenido con ancho máximo ~1575 px alineado a la izquierda (queda espacio libre a la derecha en pantallas anchas).
- Tema oscuro: barra ~#141010, fondo de página ~#2a2a2a, acento naranja ~#d9622b.
- Ruta por hash: `…/tecnico/#caja`.

## 4. Cómo reproducirlo en otro sistema (propuesta de implementación)

1. `<header>` con `display:flex`, alto fijo ~70 px; marca + búsqueda a la izquierda, `<nav>` con `<ul>` de primer nivel, y grupo de acciones a la derecha (`margin-left:auto`).
2. Primer nivel: `<a>` para enlaces directos y `<button aria-haspopup aria-expanded>` para desplegables; el padre se marca activo si la ruta actual está dentro de su rama.
3. Panel: `position:absolute` bajo el activador, `z-index` por encima del contenido; flyout `position:absolute; left:100%; top` alineado a la fila.
4. Accesibilidad que DOVA **no demuestra** en las capturas y que habría que agregar: `role="menu"`, flechas, Escape, foco visible, cierre al clic fuera, pequeña tolerancia al mover el cursor entre panel y flyout, y reemplazo por un panel móvil.
5. Fuente monospace en el menú, sans-serif en contenido; mayúsculas solo en títulos de página.

Pendiente para completar esta ficha: capturas (o acceso) de Reportes, Administración, la campana, el buscador Ctrl K, los submenús restantes, la vista móvil y las demás pantallas.
