/* ═══════════════════════════════════════════════════════════════
   SERAFINA FLORERÍA — api-config.js
   Configuración de la conexión con el backend (API).

   window.SERAFINA_API_URL
     ''  (vacío)  → el sitio usa SOLO JAVA/catalogo-datos.js (comportamiento original).
     'https://…'   → el catálogo se lee de la API (base de datos). Si la API no responde
                     en 4 segundos o devuelve datos inválidos, se usa catalogo-datos.js
                     como respaldo automáticamente.

   Completar cuando el backend esté desplegado (sin barra final).
   ═══════════════════════════════════════════════════════════════ */
window.SERAFINA_API_URL = window.SERAFINA_API_URL || '';
