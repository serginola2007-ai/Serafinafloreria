# Serafina — servidor (Fastify + PostgreSQL)

Fuente única de verdad del sistema. El sitio público (`../HTML`, `../CSS`, `../JAVA`) y el panel (`/admin/`, fase 3b) consumen esta API.
Diseño completo: [`../docs/ARQUITECTURA.md`](../docs/ARQUITECTURA.md).

## Puesta en marcha local
```bash
cd server && npm ci
cp .env.example .env            # y completar DATABASE_URL (PostgreSQL 14+)
export $(grep -v '^#' .env | xargs)
npm run migrate                 # esquema (versionado, con rollback: npm run migrate:down -- 1)
npm run seed                    # roles y permisos (idempotente)
npm run create-admin -- --email tu@correo --name "Tu Nombre"   # pide contraseña sin eco; sin credenciales por defecto
npm run import-legacy-catalog -- --dry-run                      # informe; sin --dry-run aplica (idempotente)
npm start
npm test                        # requiere TEST_DATABASE_URL (default: postgres://serafina:serafina_dev@localhost/serafina_test)
```

## Garantías ya implementadas (Fase 3a)
- Configuración validada al arrancar: producción exige `PUBLIC_URL`, `API_URL`, `ADMIN_URL` (https) y falla si faltan.
- Migraciones `NNNN_nombre.up.sql/.down.sql`, checksum, transacción por migración, lock, `/ready` verifica esquema al día.
- Sesiones por cookie (`__Host-sid` en producción: HttpOnly, Secure, SameSite=Lax), token guardado solo como SHA-256, expiración absoluta + inactividad, CSRF por token + verificación de Origin.
- argon2id, política de contraseñas, bloqueo por intentos, rate limit, cambio obligatorio de contraseña inicial.
- RBAC: `modulo.accion`; toda ruta `/api/` debe declarar su acceso o el servidor no arranca; anti-escalada de privilegios.
- Auditoría append-only (trigger en la base), transaccional con el cambio, sin secretos.
- Archivos: validación de extensión + MIME + firma real, límite de tamaño, nombres generados, S3 compatible, privados con URL firmada.
- Integraciones (Google/Meta/WhatsApp): solo adaptadores; sin credenciales aparecen "no configuradas"; nunca datos de ejemplo.

## Sin definir (requisitos para producción)
Ver sección 16 de `docs/ARQUITECTURA.md` y `../render.yaml`. IVA/datos fiscales: **no hay tasas hardcodeadas**; `tax_categories` está vacía hasta que el contador confirme.

## Panel `/admin/` y catálogo (Fases 3b y 3c)
- `/admin/` lo sirve este mismo backend (HTML+CSS+JS modular en `../admin/`, sin framework, sin `innerHTML`, CSP estricta).
  Módulos registrados en `admin/assets/js/core/nav.js`; solo existen los que funcionan de punta a punta.
- Catálogo editable: categorías, productos, variantes con precio entero en PYG, historial de precios, imágenes (S3), publicar/despublicar/archivar.
  Un producto solo se publica si tiene categoría, variante activa con precio e imagen. Nada se borra: se archiva.
- Sitio público: `JAVA/api-config.js` → `window.SERAFINA_API_URL`. Vacío = comportamiento original. Con URL, el catálogo sale de la base y,
  si la API falla o tarda más de 4 s, se usa `catalogo-datos.js` como respaldo.
- Las imágenes originales viven en el sitio público (`PUBLIC_URL/IMAGENES/...`); las subidas desde el panel van al object storage.

## Pruebas
```bash
npm test        # 117 pruebas de integración contra PostgreSQL real
npm run e2e     # 3 recorridos en Chromium real (panel, sitio público ↔ API, catálogo). Requiere Playwright (PLAYWRIGHT_NODE_PATH)
```

## Inventario, proveedores y compras (Fase 3d)
- **Stock por lotes**: todo ingreso crea un lote (con vencimiento opcional); toda salida descuenta FEFO (primero lo que vence antes) y registra un movimiento por lote con su costo real.
- **Costo promedio ponderado** por producto (guaraníes enteros por unidad). Cantidades con hasta 3 decimales.
- **Físico / reservado / disponible**: la base impide reservar más de lo que hay (`CHECK reserved <= on_hand`) y las salidas validan contra lo disponible, con bloqueos `FOR UPDATE` (probado con salidas concurrentes).
- **Movimientos y pagos son append-only** (trigger en la base). Las correcciones son movimientos de signo contrario.
- **Recepción de compra** (una sola transacción): recibo + lotes + movimientos + costo promedio + último precio/historial del proveedor + cuenta por pagar. Si algo falla, no se guarda nada.
- **Integridad**: `verifyIntegrity()` comprueba `stock físico = Σ lotes = Σ movimientos` (corre en las pruebas).
- Pendiente de otros módulos: reservas por pedidos, producción/recetas (consumen con `consumeStock`), devoluciones a proveedor, vínculo de pagos en efectivo con la caja.

## Clientes, recetas, caja y ventas (Fase 3e)
- **Clientes y destinatarios** son entidades distintas (el destinatario puede o no estar ligado a un cliente). Direcciones, fechas importantes (con próximas fechas), estadísticas reales (total comprado, ticket promedio, saldo) y exportación CSV protegida contra inyección de fórmulas.
- **Recetas** (`recipe_components` + costos extra por variante): costo = componentes al costo promedio + extras; margen y % calculados; "cuántos se pueden armar" con el stock disponible; copiar con factor; activar/desactivar.
- **Venta** (`POST /sales`, una transacción): precios siempre desde la base; valida TODO el stock antes de tocar nada (informa cada faltante); descuenta componentes FEFO; **congela el costo real** (lotes consumidos + extras) línea por línea; registra pagos; el efectivo mueve la caja; el saldo queda como cuenta por cobrar (exige cliente y vencimiento). Descuentos solo con `ventas.discount`.
- **Anulación**: repone el stock al costo original, devuelve el dinero con contra-asientos (`sale_refunds`) y el efectivo sale de la caja abierta. Nada se borra.
- **Caja**: una sola abierta a la vez (índice único); movimientos append-only; arqueo (esperado vs contado) al cerrar; nunca queda en negativo. Los pagos a proveedores en efectivo también salen de la caja.
- **Costos y márgenes**: solo se muestran con `finanzas.view`/`reportes.view`. Una línea sin receta ni stock propio se marca `cost_known = false` y NO se inventa margen.
- **Comprobante interno**: imprimible, rotulado "No es un documento fiscal". No hay IVA calculado ni facturación: la configuración fiscal sigue pendiente de confirmación con el contador (ver `tax_categories`).
- Nota de costeo: el *costo promedio* (referencia para recetas y márgenes proyectados) cambia solo con ingresos; el costo *real* de cada venta sale de los lotes que efectivamente se consumieron.

## Pedidos, producción y delivery (Fase 3f)

- **Pedidos** (`/api/v1/orders`): estados consulta → cotización → pendiente → confirmado/pagado → en preparación → listo → en reparto → entregado (o cancelado/reprogramado/no entregado). Los precios los calcula siempre el servidor.
- **Stock**: confirmar un pedido **reserva** insumos (`inventory_levels.reserved`, tabla `stock_reservations`); el stock físico no cambia hasta producir. La reserva impide vender ese stock en el mostrador. `GET /orders/demand` avisa cuando los pedidos pendientes piden más de lo disponible.
- **Producción** (`/api/v1/production`): iniciar consume la reserva (FEFO, costo real congelado); checklist → control de calidad → aprobación. Rechazar devuelve el trabajo a preparación.
- **Delivery** (`/api/v1/deliveries`, `/delivery-routes`, `/delivery-zones`): asignar repartidor, salir, entregar, fallar, reprogramar. Un usuario con solo `delivery.own` ve y opera únicamente sus entregas (403 en el resto).
- **Cierre**: al entregar (o retirar) se genera la **venta** con el costo congelado de producción; los cobros anticipados pasan a esa venta. Con saldo pendiente se exige cliente y vencimiento (cuentas por cobrar).
- **Cancelación**: reembolsa lo cobrado (efectivo requiere caja abierta); si ya se produjo, hay que indicar si los materiales vuelven al stock o van a merma.
- **Pedido web** `POST /api/v1/public/orders`: sin sesión, con límite por IP y campo trampa; devuelve solo número y total. Aún no está conectado al formulario del sitio público.
- **Comprobante**: el repartidor asignado sube una foto privada (`POST /deliveries/:id/proof`); solo `delivery.edit` obtiene la URL firmada temporal.
- Pendiente: geocodificación/mapas reales, eventos y cotizaciones.
