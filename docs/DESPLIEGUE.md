# Despliegue en Render (paso a paso)

Nada está desplegado todavía: crear el servicio requiere **tu cuenta de Render** (datos de pago incluidos), que no puedo usar desde la sesión. El repositorio ya trae el blueprint (`render.yaml`).

## 1. Crear el servicio
1. En Render: **New → Blueprint** → conectá el repositorio `serginola2007-ai/Serafinafloreria` y elegí la rama que quieras desplegar (`claude/wizardly-mccarthy-ypzkyj`, o `main` tras fusionarla).
2. Render crea la base `serafina-db` (PostgreSQL 16) y el servicio `serafina-api`. Confirmá los planes vigentes: el PostgreSQL gratuito expira y no es apto para producción, y un servicio gratuito se "duerme".
3. Te pedirá `PUBLIC_URL`, `API_URL` y `ADMIN_URL` (el servidor **no arranca** sin ellas). Si todavía no conocés la URL, poné un valor provisorio y corregilas luego.

## 2. Variables de entorno
Una vez creado el servicio Render te muestra su URL, por ejemplo `https://serafina-api-xxxx.onrender.com`. Cargá (Environment):
| Variable | Valor |
|---|---|
| `API_URL` | la URL del servicio |
| `ADMIN_URL` | la URL del servicio + `/admin` |
| `PUBLIC_URL` | la URL del sitio público (mientras no esté conectado, la misma URL del servicio) |

Guardá y esperá el redeploy. El panel queda en `<API_URL>/admin/`. La verificación de salud es `<API_URL>/ready`.

## 3. Crear el primer administrador (sin contraseña por defecto)
En el servicio → **Shell**:
```
npm run create-admin
```
El comando te pide correo y contraseña; el sistema te obliga a cambiarla al entrar la primera vez. No hay credenciales en el código.

## 4. Imágenes (opcional)
Para subir imágenes necesitás un almacenamiento compatible con S3 (Cloudflare R2, Backblaze B2, AWS S3). Cambiá `STORAGE_DRIVER` a `s3` y cargá `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_BASE_URL`. Sin eso el panel funciona, pero no se pueden subir imágenes ni comprobantes de entrega.

## 5. Antes de usarlo con datos reales
- Revisá los permisos por rol (`server/src/modules/rbac/catalog.js`) y ajustalos desde **Roles y permisos**.
- Configurá backups de la base (plan pago) y una política de respaldo propia.
- IVA y datos fiscales: pendientes del contador; el sistema no emite documentos fiscales.
- La migración del catálogo (65 productos) se ejecuta con `npm run import-legacy-catalog`; revisá los productos marcados "a revisar".
