# Serafina — Arquitectura y modelo de dominio (Fase 2)

Estado: **propuesta para aprobación**. No hay código de backend todavía.
Decisiones ya cerradas: Node.js + Fastify + PostgreSQL, API REST, migraciones versionadas, Render, panel en HTML/CSS/JS modular bajo `/admin/`, moneda PYG entera, sin IA, sin integración fiscal simulada.

---

## 1. Arquitectura propuesta

Un único backend (monolito modular) es la única fuente de verdad. Sitio público y panel son clientes de la misma API.

```
Navegador cliente ──► Sitio público (Netlify, estático) ──┐
                                                          ├──► API REST /api/v1 (Fastify, Render)
Navegador funcionario ──► Panel /admin/ (estático) ───────┘            │
                                                                       ▼
                                                    PostgreSQL (Render) ◄── migraciones
                                                                       │
                          Jobs internos (alertas, vencimientos) ───────┘
                          Integraciones (Google, Meta, WhatsApp) — solo desde el servidor
```

Decisiones de diseño:

- **Monolito modular**, no microservicios. Cada módulo (`catalog`, `inventory`, `sales`…) tiene sus rutas, esquemas de validación, servicio y repositorio. Los módulos se hablan por funciones de servicio, nunca consultando tablas ajenas directamente. Así se puede extraer un módulo después sin rehacer nada.
- **SQL explícito con consultas parametrizadas** (driver `pg` + `node-pg-migrate` o equivalente). Sin ORM pesado: el dominio es muy transaccional y conviene ver el SQL. Esto evita SQL injection por construcción.
- **Un servicio de dominio por operación crítica** (confirmar venta, recibir compra, producir) que abre **una transacción** y llama a los servicios de inventario/caja/pagos con ese cliente de transacción.
- **El panel se sirve desde el mismo servicio Fastify** (`@fastify/static`, ruta `/admin/`). Esto permite cookies de sesión same-site, sin CORS ni CSRF cross-site para el panel. El sitio público en Netlify solo usa endpoints públicos (`/api/v1/public/*`), sin cookies.
- **Dinero:** `BIGINT` en guaraníes. Nunca `float`. IVA incluido en precios de venta (a confirmar con contador); se calcula y guarda el desglose por línea.
- **Historial inmutable:** movimientos de stock, movimientos de caja, pagos, documentos fiscales y auditoría son *append-only*. Las correcciones son movimientos de signo contrario.

## 2. Estructura de carpetas

Se conservan `HTML/`, `CSS/`, `JAVA/`, `IMAGENES/` sin cambios. Se agrega:

```
server/
  package.json
  src/
    app.js                 # construye la instancia Fastify (plugins, hooks)
    server.js              # arranque
    config/                # env.js (valida variables con esquema), constantes
    db/
      pool.js  tx.js       # pool y helper withTransaction()
      migrations/          # 0001_*.sql ... (versionadas, con up/down)
      seeds/               # roles, permisos, config inicial (idempotentes)
    plugins/               # auth, rbac, csrf, rate-limit, audit, errors, uploads
    modules/
      auth/  users/  rbac/
      catalog/             # productos, variantes, categorías, recetas
      inventory/           # stock, lotes, movimientos, merma, reservas
      purchasing/          # proveedores, órdenes, recepciones, cuentas por pagar
      sales/               # ventas, POS, devoluciones
      orders/              # pedidos, cotizaciones, eventos
      production/  delivery/
      cash/  finance/      # caja, gastos, pagos, cuentas por cobrar
      billing/             # documentos fiscales (adaptadores)
      cms/                 # contenido, banners, promos, galería, FAQ, media
      integrations/        # google/, meta/, whatsapp/
      reports/  dashboard/  notifications/  audit/  settings/
      public/              # API pública (catálogo, pedido web)
    lib/                   # money.js, dates.js, errors.js, pagination.js
  test/                    # unit + integración (PostgreSQL real)
admin/
  index.html  login.html  app.html   # shell único + login
  assets/
    css/        # tokens, layout, components, responsive
    js/core/        # router, store, bootstrap, módulos registrados
    js/api/         # cliente fetch, un archivo por recurso
    js/auth/        # sesión, guardas de ruta, permisos
    js/components/  # table, form, modal, toast, confirm, pagination, empty/skeleton, command palette
    js/modules/     # dashboard/, sales/, inventory/ ... (vista + controlador por módulo)
    js/utils/       # money (PYG), fechas, validación, dom
docs/
  ARQUITECTURA.md
render.yaml
```

El panel es una **SPA mínima con router por hash/History API** (`/admin/#/ventas`), un único `app.html` y módulos ES que se cargan bajo demanda (`import()`), no un HTML por pantalla.

## 3. Diagrama lógico del dominio (flujo de datos entre módulos)

```
Proveedor ──► Compra (OC → recepción) ──► LOTE ──► MOVIMIENTO ─┐
                  │                                             │  (stock físico =
                  └──► Cuenta por pagar ──► Pago (egreso) ──┐   │   suma de movimientos)
                                                            │   ▼
Categoría ─► Producto ─► Variante ─► Receta(componentes) ─► INVENTARIO (ítem)
                              │                               ▲  ▲
                              │ precio vigente (historial)     │  │ reserva / consumo
Cliente ─► Pedido ─────────────┼─► línea de pedido ─────────────┘  │
 │ Destinatario/Dirección      │        │                          │
 │                             │        ├─► Orden de producción ───┘ (consume componentes)
 │                             │        └─► Entrega (ruta, repartidor)
 └────────► Venta ─► línea de venta (snapshot precio y COSTO) ─► Pago ─► Mov. de caja
              │                                                   └─► Cuenta por cobrar (saldo)
              └─► Documento fiscal (separado de la venta) ─► adaptador SIFEN (futuro)

Todo ─► audit_logs ;  Todo ─► reportes (consultas sobre estas tablas, sin tablas duplicadas)
```

**Respuesta a la regla "una venta no es solo $X"**: una línea de venta apunta a `variant_id`; el servicio resuelve la receta, bloquea los ítems componentes (`SELECT … FOR UPDATE`), valida disponible, escribe movimientos `venta/consumo`, guarda en la línea `unit_price`, `unit_cost` (costo de los componentes en ese instante, método costo promedio ponderado) y por tanto el margen queda congelado históricamente. Pago → movimiento de caja si es efectivo de caja abierta; saldo → cuenta por cobrar; si hay pedido asociado, se vincula `order_id` y se crean producción/entrega según el tipo; todo lo lee Reportes por `sale_id`.

## 4. Modelo de datos

Convenciones: `id` UUID v7/`bigint identity` (usar `bigint identity` por simplicidad e índices), `created_at/updated_at timestamptz`, `created_by`, borrado lógico (`archived_at`) en maestros, importes `BIGINT` PYG, cantidades `NUMERIC(14,3)` (tallos, metros de cinta), `CHECK` en todos los montos y estados.

### Identidad y permisos
`users` (email único, `password_hash` argon2id, `role_id`, `active`, `failed_attempts`, `locked_until`), `roles` (`code`, `name`, `is_system`), `permissions` (`code` único, ej. `ventas.create`), `role_permissions`, `user_permissions` (`allow` boolean: permite añadir/denegar sobre el rol), `sessions` (`id` hash, `user_id`, `expires_at`, `ip`, `ua`, `revoked_at`).

### Catálogo
`product_categories` (jerarquía opcional, `slug`, `sort_order`, `active`), `products` (`kind`: `finished|raw_flower|foliage|supply|accessory|packaging`, `sku`, `name`, `slug`, `description`, `category_id`, `is_sellable`, `is_stockable`, `is_composite`, `active`, `legacy_id` — p.ej. `rom-01`), `product_variants` (`product_id`, `sku`, `label` “M/G/6 rosas”, `price_pyg`, `cost_override_pyg`, `vat_rate`, `active`, `sort_order`), `variant_price_history` (`variant_id`, `price_pyg`, `valid_from`, `changed_by`), `product_media` (`product_id`, `media_id`, `sort_order`), `recipe_components` (`variant_id` del producto compuesto, `component_product_id`, `quantity`, `unit`, `UNIQUE(variant_id, component_product_id)`), `other_costs` (`variant_id`, `concept`, `amount_pyg`: mano de obra, etc.).

Decisión de modelo: **un solo concepto "producto"** con `kind` (no tablas separadas para flores e insumos). Un *ítem de inventario* es un `product` con `is_stockable`. Un ramo vendible es `products(kind=finished, is_composite=true)` con variantes que tienen su receta. Así receta→inventario→venta usan los mismos ids.

### Inventario
`stock_locations` (ubicaciones), `inventory_levels` (`product_id`, `location_id`, `on_hand`, `reserved`, `min_stock`, `max_stock`; **`available = on_hand − reserved`** calculado; `CHECK on_hand >= 0` y `reserved >= 0` y `reserved <= on_hand`), `inventory_lots` (`product_id`, `supplier_id`, `purchase_item_id`, `received_at`, `purchased_at`, `qty_initial`, `qty_remaining`, `unit_cost_pyg`, `expires_at`), `inventory_movements` (append-only: `product_id`, `lot_id?`, `type` enum [compra, venta, produccion, consumo, devolucion, merma, ajuste_pos, ajuste_neg, transferencia, uso_interno, evento], `qty` con signo, `unit_cost_pyg`, `reason`, `reference_type/reference_id`, `user_id`, `note`, `occurred_at`), `stock_reservations` (`order_item_id`/`event_id`, `product_id`, `qty`, `status`: active|consumed|released), `waste_reasons` (configurable) y `waste_records` (`movement_id`, `reason_id`, `cost_pyg`, `note`).

Regla: `inventory_levels.on_hand` es una cache transaccional **solo modificable por la función de inventario que inserta el movimiento en la misma transacción**; un test de integridad verifica `on_hand = SUM(movements)`. Costeo: **costo promedio ponderado** por producto (actualizado en recepción); lotes sirven para vencimiento/FEFO y trazabilidad (se consumen primero los que vencen antes).

### Compras
`suppliers` (nombre, RUC, contacto, condiciones, `payment_terms_days`, `archived_at`), `supplier_products` (`supplier_id`, `product_id`, `supplier_sku`, `last_price`), `supplier_price_history`, `purchase_orders` (`number`, `supplier_id`, estado: borrador|enviada|parcial|recibida|cancelada, `expected_at`), `purchase_order_items`, `purchase_receipts` (`po_id`, `received_by`, `supplier_invoice_no`, `received_at`), `purchase_receipt_items` (`po_item_id`, `qty`, `unit_cost`, `lot` datos), `payables` (cuenta por pagar: `supplier_id`, `receipt_id`, `invoice_no`, `total`, `due_date`, estado), `payable_payments`.
Devoluciones a proveedor: `purchase_returns` + movimiento negativo.

### Clientes y pedidos
`customers` (nombre, RUC/CI, teléfonos, email, `type`: persona|empresa|mayorista, preferencias, `archived_at`), `customer_addresses`, `customer_important_dates`, `recipients` (destinatario **independiente**: nombre, teléfono, `customer_id` opcional para reutilizar), `orders` (`number`, `customer_id`, `recipient_id`, `delivery_address` snapshot + `address_id`, `channel` [web|whatsapp|instagram|telefono|mostrador|evento|mayorista], `utm_source/medium/campaign`, `requested_date`, `time_slot`, `card_message`, `status`, `total`, `paid_total`, `delivery_fee`, `event_id?`, `quotation_id?`), `order_items` (`variant_id`, `qty`, `unit_price`, `unit_cost`, `notes`), `order_status_history`.
`quotations` + `quotation_items` (estados borrador|enviada|aceptada|rechazada|vencida; `valid_until`; conversión → `orders`), `events` (tipo, fecha, lugar, invitados, presupuesto, `quotation_id`, anticipo/saldo vía `payments`, `event_materials` con reservas, `event_staff`).

### Ventas, pagos, caja y finanzas
`sales` (`number`, `customer_id?`, `order_id?`, `cash_session_id?`, `channel`, `status`: borrador|confirmada|pagada|anulada|devuelta, `subtotal`, `discount`, `delivery_fee`, `vat_total`, `total`, `confirmed_at`, `voided_at/by/reason`), `sale_items` (`variant_id`, `qty`, `unit_price`, `discount`, `vat_rate`, **`unit_cost` congelado**), `sale_returns` + items (reversa de stock según `restock` boolean), `payment_methods` (configurable: efectivo, transferencia, tarjeta, QR…; `affects_cash` boolean), `payments` (`sale_id|order_id|event_id`, `method_id`, `amount`, `received_at`, `reference`, `status`; **no se borran, se anulan con contra-asiento**), `receivables` (por venta a crédito: `due_date`, `balance`, estado calculado), `cash_registers`, `cash_sessions` (apertura/cierre, `opening_amount`, `expected_cash`, `counted_cash`, `difference`), `cash_movements` (append-only: tipo [apertura, venta, ingreso, egreso, retiro, devolucion, gasto, cobro, pago_proveedor], `amount` con signo, `payment_id?`, `expense_id?`), `expense_categories` (configurables), `expenses` (`category_id`, `amount`, `supplier_id?`, `paid_via_cash`, `cash_movement_id?`).

### Producción y entrega
`production_orders` (`order_item_id`, `variant_id`, `qty`, estado pendiente|en_preparacion|control_calidad|listo|cancelado, `assigned_to`, `checklist` en `production_checklist_items` — plantilla configurable), consumo de componentes vía `inventory_movements(type=produccion)` al pasar a *en preparación*/*listo* (regla definida en §5).
`delivery_zones` (tarifa), `courier_profiles` (user repartidor), `delivery_routes` (fecha, `courier_id`), `deliveries` (`order_id`, `route_id?`, `route_position`, destinatario/dirección snapshot, `time_slot`, estado pendiente|asignado|listo|en_camino|entregado|no_entregado|reprogramado, `left_at`, `arrived_at`, `proof_media_id`, `notes`).

### Facturación (separada de la venta)
`tax_settings` (RUC, razón social, domicilio fiscal, actividad económica), `tax_establishments` (código de establecimiento), `tax_expedition_points` (punto de expedición), `tax_stampings` (**timbrado**: número, vigencia desde/hasta, tipo de documento, rango de numeración, último número usado), `fiscal_documents` (`sale_id`, `doc_type`: factura|nota_credito|nota_debito|autofactura…, `number`, `stamping_id`, `customer_tax_id`, `condition`: contado|crédito, importes por tasa de IVA, `status`: borrador|emitido|anulado|rechazado, `provider`, `provider_payload` jsonb, `cdc`/`xml` nullable). Un **adaptador** `billing/adapters/` define la interfaz (`emit`, `cancel`, `status`); hoy solo existe el adaptador **`manual`** que numera internamente y marca los documentos como *“Comprobante interno — no es documento fiscal”*; el adaptador SIFEN se implementa en una fase posterior contra la documentación oficial de la DNIT.

### CMS e integraciones
`site_content` (clave→valor JSON por sección: hero, textos, contacto, redes), `banners`, `promotions` + `promotion_products`, `gallery_items`, `faq_items`, `seo_pages`, `media` (`storage_key`, `mime`, `size`, `sha256`, `alt_text`, `width`, `height`, usado por producto/CMS), `integration_accounts` (`provider`, estado, `token` **cifrado**, `scopes`, `expires_at`), `analytics_snapshots` (métricas ya traídas de APIs oficiales, por día/fuente — para no consultar la API en vivo), `social_snapshots`, `attribution_events` (`order_id`, `source`, `medium`, `campaign`, `first_touch`).

### Sistema
`audit_logs` (append-only: `user_id`, `action`, `entity`, `entity_id`, `before` jsonb, `after` jsonb, `ip`, `at`), `notifications` (+ `notification_reads`, filtradas por permiso), `settings` (clave/valor tipado), `number_sequences` (numeración interna con bloqueo).

### Estados y transiciones (resumen)
- Pedido: consulta→cotización→pendiente→confirmado→pendiente_de_pago→pagado→en_preparación→listo→en_reparto→entregado; ramas: cancelado, reprogramado, no_entregado. Tabla `order_status_transitions` en código (no se salta de estado arbitrariamente).
- Reserva de stock: **al confirmar** el pedido; se libera al cancelar/modificar; se consume cuando producción pasa a *en_preparación* (o al vender de mostrador).
- Venta: borrador→confirmada→(pagada)→anulada|devuelta. Nunca `DELETE`.

### Índices y restricciones clave
FKs con `ON DELETE RESTRICT` en todo lo financiero/stock. Únicos: `products.sku`, `product_variants.sku`, `users.email` (citext), `(series, number)` documentos. Índices: `inventory_movements(product_id, occurred_at)`, `(reference_type, reference_id)`; `sales(status, confirmed_at)`, `sales(customer_id)`; `orders(status, requested_date)`; `payments(sale_id)`; `deliveries(route_id, route_position)`, `(status, scheduled)`; `audit_logs(entity, entity_id, at)`; parcial `WHERE archived_at IS NULL` en maestros. `CHECK`: montos ≥ 0, `qty ≠ 0` en movimientos, `paid_total ≤ total`, transiciones válidas verificadas en la capa de servicio y por `CHECK` de enum.

### Operaciones que exigen transacción (`SERIALIZABLE`/`READ COMMITTED + FOR UPDATE`)
Confirmar venta; anular/devolver venta; confirmar pedido (reserva); producir/consumir; recibir compra; ajustar stock/merma; registrar pago (+caja +receivable); abrir/cerrar caja; emitir documento fiscal (numeración); convertir cotización en pedido; aplicar una promoción de precio. Bloqueo de filas de inventario en **orden de `product_id` ascendente** para evitar deadlocks.

## 5. Reglas de negocio entre módulos (los 5 flujos)

1. **Pedido web:** `POST /public/orders` (valida, precios recalculados en servidor, nunca se confía en el cliente) → `orders` en *pendiente* con `channel=web`, UTM guardado → notificación → funcionario confirma (reserva stock) → registra pago → crea `production_order` → QC → listo → crea/asigna `delivery` → entregado → se genera la **venta** (o la venta ya existe si se cobró antes) y se consume el stock restante → caja y reportes leen de ahí.
2. **Compra:** alerta de stock bajo → OC → recepción (parcial o total) crea lote + movimiento `compra`, actualiza costo promedio y `payable`.
3. **Compuesto:** receta se resuelve en el momento de la reserva/consumo; si falta cualquier componente, la operación falla completa (rollback) con detalle de qué falta.
4. **Evento:** consulta→cotización→aceptada (conversión)→anticipo (`payment` ligado al evento)→reserva de materiales→producción→entrega→saldo→cierre.
5. **CMS:** `PUT /admin/products/:id` en una transacción con auditoría → la API pública lee de la misma tabla; cabeceras `ETag` + caché corta (60 s) en la API pública.

## 6. Endpoints principales (`/api/v1`)

Convenciones: JSON, paginación `?page&limit&sort&q`, errores `{error:{code,message,details}}`, idempotency-key en POST críticos (venta, pago, pedido público).

| Área | Endpoints (permiso) |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (devuelve permisos), `POST /auth/change-password`, `GET /auth/csrf` |
| Usuarios/RBAC | `GET/POST/PATCH /users` (`users.*`), `GET /roles`, `PUT /roles/:id/permissions` (`roles.edit`), `PUT /users/:id/permissions` |
| Catálogo | `GET/POST/PATCH /products`, `…/variants`, `PUT /variants/:id/recipe`, `POST /variants/:id/recipe/duplicate`, `GET /variants/:id/cost` (`products.*`) |
| Inventario | `GET /inventory`, `GET /inventory/movements`, `POST /inventory/adjustments`, `POST /inventory/waste`, `GET /inventory/alerts` (`inventario.*`) |
| Compras | `GET/POST /suppliers`, `/purchase-orders`, `POST /purchase-orders/:id/receive`, `GET /payables`, `POST /payables/:id/payments` (`compras.*`) |
| Ventas | `POST /sales` (confirma), `GET /sales`, `POST /sales/:id/void`, `POST /sales/:id/returns`, `POST /sales/:id/payments` (`ventas.*`) |
| Pedidos | `GET/POST/PATCH /orders`, `POST /orders/:id/transition`, `GET/POST /quotations`, `POST /quotations/:id/convert`, `GET/POST /events` (`pedidos.*`) |
| Producción/Delivery | `GET /production-orders`, `POST …/:id/transition`, `GET/POST /deliveries`, `/routes` (repartidor: solo las propias) |
| Caja/Finanzas | `POST /cash/sessions/open`, `…/close`, `POST /cash/movements`, `GET/POST /expenses`, `GET /receivables` (`caja.*`) |
| Facturación | `GET /fiscal/settings`, `POST /fiscal/documents` (usa adaptador) (`facturacion.*`) |
| CMS | `GET/PUT /cms/*`, `POST /media` (multipart) (`web.*`) |
| Analytics/Marketing | `GET /analytics/*`, `GET /marketing/*` (leen *snapshots*), `GET /integrations`, `GET /integrations/:p/connect` (OAuth) |
| Reportes | `GET /reports/{sales,inventory,purchases,profitability,delivery,customers,marketing}?from&to&format=json|csv|xlsx|pdf` |
| Sistema | `GET /dashboard`, `GET /search?q=` (Ctrl+K), `GET /notifications`, `GET /audit-logs`, `GET/PUT /settings` |
| Público (sin sesión) | `GET /public/catalog`, `/public/products/:slug`, `/public/content`, `/public/banners`, `POST /public/orders`, `POST /public/events/track` |

## 7. Autenticación

- Contraseñas con **argon2id**; política mínima (≥ 12 caracteres, lista de comunes), bloqueo progresivo tras fallos y rate limit por IP+email.
- **Sesión por cookie de servidor** (no JWT en localStorage): ID aleatorio de 256 bits, se guarda su hash en `sessions`; cookie `__Host-sid` `HttpOnly; Secure; SameSite=Lax`; expiración absoluta 12 h + inactividad 2 h; rotación al login; revocación al cambiar contraseña o desactivar usuario.
- **CSRF:** token doble envío (`X-CSRF-Token`) para métodos no seguros del panel, más verificación de `Origin`. La API pública es sin cookies, por lo que no es susceptible.
- 2FA TOTP para Administrador y Contabilidad: previsto en el modelo, recomendado antes de producción real (decidir en Fase 8).
- Primer administrador creado por comando de CLI (`npm run create-admin`), nunca con credenciales por defecto.

## 8. RBAC

- Permisos con forma `modulo.accion` (ej. `ventas.create`, `inventario.merma`). La lista del pedido original en inglés (`sales.view`) se normaliza a español para coherencia con la UI; se define **una sola tabla `permissions` sembrada por migración**.
- Efectivos del usuario = permisos del rol ∪ `user_permissions.allow` − `user_permissions` denegados. El rol **Personalizado** parte vacío y el Administrador marca permisos. `Administrador` tiene todos (verificado por rol, no por lista).
- **Backend:** `fastify.addHook` + `{ preHandler: requirePermission('ventas.create') }` en *cada* ruta; una prueba automática recorre el árbol de rutas y falla si alguna ruta `/api/v1/**` (salvo `/public` y `/auth/login`) no declara permiso. Respuesta 401 sin sesión, 403 sin permiso.
- **Datos acotados:** el repartidor solo ve entregas donde `courier_id = su perfil` (filtro en la consulta, no en el front).
- **Frontend:** `/auth/me` entrega los permisos; el router bloquea rutas, el sidebar, botones y Ctrl+K filtran por permiso. Es comodidad de UX; la seguridad real es la del backend.
- Roles iniciales sembrados: Administrador, Ventas, Florista/Producción, Repartidor, Marketing, Contabilidad, Personalizado. Los conjuntos exactos de permisos de cada rol se entregarán en la migración de semillas para revisión tuya.

## 9. Estrategia de migración de los 65 productos actuales

Dato corregido: la auditoría dijo 69; el recuento real de `catalogo-datos.js` es **65 productos en 5 colecciones** (Románticos 16, Pequeños Detalles 12, Graduados 16, Nacimientos 12, Condolencias 9). El “69” contaba comentarios y secciones.

1. Script `server/scripts/import-legacy-catalog.js`, **idempotente** (upsert por `legacy_id`), que lee `JAVA/catalogo-datos.js` tal cual (sin modificarlo) y produce:
   - 5 `product_categories` (slug = id actual).
   - 65 `products` (`kind=finished`, `is_composite=false` hasta cargar recetas, `legacy_id`).
   - Variantes parseando el texto de precio. Formatos existentes: `"N Gs."` (59 → 1 variante “Único”), `"M: N Gs. / G: N Gs."` (3), `"P / M / G"` (1), `"N rosas: … / N rosas: …"` (1), `"N Gs. Version mini: N Gs."` (1).
   - Imágenes copiadas a `media` referenciando los archivos existentes de `IMAGENES/`.
2. **No se infiere ni inventa nada**: el parser solo acepta los 5 patrones conocidos; cualquier línea ambigua se escribe en un informe `legacy-import-report.json` para revisión manual y el script falla si el total de variantes no coincide con la verificación.
3. **Reconciliación** automática: imprime un cuadro producto-por-producto (precio original en texto vs variantes numéricas) que tú firmas antes de aplicarlo en producción.
4. Costos y recetas: arrancan vacíos (hoy no existen datos). Los márgenes no se muestran hasta que haya receta/costo — nada se inventa.
5. Stock inicial: carga por **ajuste de inventario inicial** (movimiento auditado) hecha por el funcionario, no por script.

## 10. Estrategia para llevar el catálogo hardcodeado a PostgreSQL

Estrategia *strangler*, sin corte brusco:

1. **Fase A:** API pública `GET /public/catalog` devuelve exactamente la forma actual `{secciones, productos}` (con `precio` formateado como texto a partir de variantes), para que `catalogo.js` funcione sin tocar su lógica de render.
2. **Fase B:** `catalogo.js` intenta `fetch(API)` y, **si falla o no responde, cae a `catalogo-datos.js`** (el archivo se conserva como respaldo y semilla). Se agrega un flag `?source=legacy` para comparar.
3. **Fase C:** paridad verificada con una prueba que compara los 65 productos de la API contra el archivo (nombre, descripción, imágenes, precios numéricos vs texto).
4. **Fase D:** cuando el panel CMS es el que edita, `catalogo-datos.js` queda congelado como archivo histórico; el sitio solo usa la API. Se mantiene un snapshot JSON versionado en el repo para recuperación.
5. Idéntico patrón para la home (colecciones/banners), FAQ y contacto: primero lectura con respaldo, luego CMS.
6. El formulario de pedido y “Mayorista” siguen enviando a WhatsApp; se **añade** el `POST /public/orders` (el pedido queda registrado y luego abre WhatsApp con el número de pedido). Si la API falla, el comportamiento actual de WhatsApp se mantiene.

## 11. Estrategia de despliegue

- **Render:** servicio Web (Node) + PostgreSQL gestionado (plan con backups diarios y *point-in-time recovery* — no usar el plan gratuito en producción) definidos en `render.yaml`. Entornos `staging` y `production` separados.
- `preDeployCommand: npm run migrate` aplica migraciones antes de enrutar tráfico; migraciones solo hacia adelante en producción, con `down` para desarrollo.
- Uploads: Render no persiste disco sin disco de pago → storage de objetos compatible S3 (Render Disk como alternativa inicial). Se abstrae en `media/storage` para cambiarlo sin tocar el dominio.
- Netlify sigue sirviendo el sitio público y, opcionalmente, redirige `/api/*` al backend para evitar CORS; si no, CORS con lista blanca estricta de orígenes.
- Dominio: `api.` para el backend y panel en `…/admin/`; HTTPS obligatorio, HSTS.
- CI (GitHub Actions): lint + pruebas con PostgreSQL de servicio + verificación de migraciones desde cero + auditoría de dependencias.
- Backups: dump diario automático de Render + prueba de restauración documentada.

## 12. Variables de entorno

`NODE_ENV`, `PORT`, `DATABASE_URL`, `SESSION_SECRET`, `COOKIE_DOMAIN`, `PUBLIC_ORIGINS` (lista blanca CORS), `ADMIN_ORIGIN`, `ENCRYPTION_KEY` (cifrado de tokens de integraciones), `RATE_LIMIT_*`, `UPLOAD_MAX_BYTES`, `STORAGE_DRIVER`, `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY`, `LOG_LEVEL`, `SENTRY_DSN` (opcional), `GOOGLE_CLIENT_ID/SECRET`, `GA4_PROPERTY_ID`, `GSC_SITE_URL`, `GBP_ACCOUNT_ID`, `META_APP_ID/SECRET`, `META_PAGE_ID`, `IG_BUSINESS_ID`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `SIFEN_*` (futuro). Se valida todo con esquema al arrancar y el proceso **no inicia** si falta una obligatoria. Se entrega `.env.example` sin valores reales; los secretos viven solo en Render.

## 13. Integraciones externas previstas

| Integración | API oficial | Qué se puede traer | Notas |
|---|---|---|---|
| Google Analytics 4 | GA4 Data API (OAuth/cuenta de servicio) | usuarios, sesiones, vistas, fuentes, dispositivos, eventos | Eventos web `view_product`, `begin_order`, `click_whatsapp`, `submit_order` vía gtag con consentimiento de cookies existente; `purchase` vía Measurement Protocol desde el servidor |
| Search Console | Search Console API | consultas, clics, impresiones, posición | solo propiedades verificadas |
| Business Profile | Business Profile APIs | rendimiento, llamadas, direcciones | **requiere solicitud/aprobación de acceso a Google**; plazo no controlable |
| Instagram/Facebook | Meta Graph API | seguidores, alcance, impresiones, interacciones, publicaciones | requiere cuenta Business/Creator vinculada a Página y revisión de la app para permisos |
| WhatsApp | WhatsApp Business Cloud API | enviar/recibir mensajes plantilla | requiere cuenta Business verificada y plantillas aprobadas |
| Mapas | por definir (Google Maps / OSM) | geocodificación y rutas | fase de delivery |
| SIFEN (DNIT) | e-Kuatia / SIFEN | facturación electrónica | **requiere habilitación como facturador electrónico, certificado de firma digital y timbrado electrónico**; se implementa con la documentación técnica vigente de la DNIT, no de memoria |

Atribución: se guarda `utm_*`/`referrer` y canal declarado al crear el pedido. El reporte “¿qué canal vende más?” se calcula con esos datos reales y solo es tan bueno como la captura (los pedidos por WhatsApp directo se atribuyen con el canal que el funcionario seleccione).

## 14. Riesgos técnicos

1. **Reglas fiscales paraguayas** (IVA, timbrado, SIFEN): no codificar tasas ni numeración como constantes; configurables y a validar con contador/DNIT.
2. **Concurrencia de stock** (dos ventas simultáneas): mitigado con `FOR UPDATE` ordenado y pruebas de carrera.
3. **Costeo con recetas incompletas:** margen engañoso si faltan componentes → la UI marca “costo incompleto”.
4. **Perecederos:** flores con vida corta distorsionan el stock; la merma y los lotes con vencimiento son parte del modelo y no un extra.
5. **Aprobaciones de Meta/Google** pueden tardar semanas o ser denegadas; esas integraciones no bloquean el resto.
6. **Plan gratuito de Render** duerme el servicio y la BD gratuita expira → no apto para producción.
7. **Panel en JS sin framework** crece mal si no se respeta la modularidad → componentes comunes y reglas de lint desde el día 1.
8. **Alcance enorme:** riesgo de módulos superficiales. Mitigación: entregar por fases con criterio de terminado estricto y pruebas de integración reales contra PostgreSQL.
9. **Migración del catálogo:** textos de precio irregulares → parser estricto + informe, nunca suposiciones.
10. **Imágenes pesadas** (43 MB): generar derivados optimizados (WebP) al subirlas.

## 15. Orden de implementación

| Fase | Contenido | Criterio de terminado |
|---|---|---|
| 3a | Cimientos: Fastify, config validada, pool/transacciones, migraciones, auditoría, errores, rate limit, tests con PostgreSQL, CI | `npm test` verde; arranque y migración desde cero |
| 3b | Auth + usuarios + RBAC + shell del panel (login, router, sidebar con permisos) | 401/403 probados por ruta; sesión segura |
| 3c | Catálogo (categorías, productos, variantes, precios, historial) + importación de los 65 + API pública con respaldo | paridad 65/65 comprobada |
| 3d | Inventario (niveles, movimientos, lotes, reservas, alertas, merma) + proveedores + compras/recepción + cuentas por pagar | `on_hand = Σ movimientos` en pruebas |
| 3e | Clientes/destinatarios, pedidos (público + panel), POS/ventas, pagos, caja | flujo 1 de punta a punta |
| 4 | Recetas completas, producción, delivery/rutas, eventos, cotizaciones | flujos 3 y 4 |
| 5 | Gastos, CxC, CxP, facturación (adaptador manual), reportes financieros | |
| 6 | CMS y biblioteca multimedia | flujo 5 |
| 7 | Analytics y marketing (según credenciales) | |
| 8 | Auditoría de seguridad | |
| 9 | QA completo y responsive | |

Cada fase se entrega con pruebas ejecutadas y un informe de verificación (crear/leer/editar/desactivar, validaciones, permisos, persistencia, relaciones), no solo “implementado”.

## 16. Qué necesito de ti (cuentas y datos externos)

**Ya, para empezar:**
- Cuenta de **Render** (o invitarme a un proyecto) con PostgreSQL de pago o plan que no expire.
- **Dominio** definitivo (¿`serafinafloreria.com`?) y quién controla el DNS.
- Confirmar: IVA incluido en el precio al público; qué productos son exentos/5 %/10 %.
- Lista inicial de **usuarios y roles** (correos) y quién es el administrador.
- Aprobar el conjunto de permisos por rol (te lo envío en la migración de semillas).

**Más adelante:**
- Google: acceso (Editor) a la propiedad **GA4**, Search Console y Business Profile del negocio.
- Meta: Página de Facebook + cuenta de Instagram Business, y una cuenta Meta for Developers; verificación del negocio.
- WhatsApp Business: número, cuenta Business verificada.
- Fiscal: **RUC, razón social, establecimiento, punto de expedición, timbrado vigente**, y definir con tu contador si pasan a **facturación electrónica SIFEN** (requiere habilitación y firma digital).
- Cuenta de almacenamiento de objetos (S3 compatible) para imágenes.
- Si quieres mapas: cuenta de Google Maps Platform (facturación activa) u OSM.

> Nota de honestidad: ningún dato de esta lista se simula. Hasta que existan credenciales, los módulos de integración muestran el estado “no conectado”, no datos de ejemplo.
