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
