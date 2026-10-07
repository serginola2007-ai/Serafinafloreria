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
