'use strict';
/** Validación de archivos subidos: extensión permitida + MIME declarado + firma real del contenido (magic bytes). */
const TYPES = {
  'image/jpeg': { ext: 'jpg', exts: ['jpg', 'jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', exts: ['png'], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', exts: ['webp'], test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  'application/pdf': { ext: 'pdf', exts: ['pdf'], privateOnly: true, test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
};

function inspectUpload({ filename, mimetype, buffer, isPublic }) {
  const t = TYPES[mimetype];
  if (!t) return { error: 'Tipo de archivo no permitido (se aceptan JPG, PNG, WebP y PDF privado)' };
  const ext = (String(filename).split('.').pop() || '').toLowerCase();
  if (!t.exts.includes(ext)) return { error: 'La extensión no coincide con el tipo de archivo' };
  if (!buffer.length || !t.test(buffer)) return { error: 'El contenido del archivo no coincide con su tipo declarado' };
  if (t.privateOnly && isPublic) return { error: 'Los PDF solo pueden subirse como archivos privados' };
  return { mime: mimetype, ext: t.ext };
}

/** Nombre original saneado: solo para mostrar. El nombre en storage siempre es generado por el servidor. */
function safeOriginalName(name) {
  const base = String(name || 'archivo').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim();
  return (base || 'archivo').slice(0, 100);
}
module.exports = { inspectUpload, safeOriginalName, TYPES };
