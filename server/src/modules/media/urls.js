'use strict';
/** URL pública de un registro media. legacy → archivo del sitio estático; object → storage. */
function mediaUrl(app, m) {
  if (m.storage === 'legacy') return `${app.config.publicUrl}/${m.storage_key}`;
  return app.storage.publicUrl(m.storage_key);
}
/** Forma que espera el catálogo actual (rutas relativas desde HTML/) para los archivos del sitio. */
function legacyPath(app, m) {
  return m.storage === 'legacy' ? `../${m.storage_key}` : mediaUrl(app, m);
}
module.exports = { mediaUrl, legacyPath };
