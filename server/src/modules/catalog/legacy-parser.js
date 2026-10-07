'use strict';
/**
 * Convierte los textos de precio del catálogo actual a variantes numéricas.
 * Solo acepta los 5 formatos conocidos. Cualquier otra cosa devuelve null → revisión manual (no se adivina nada).
 *   "180.000 Gs."                                  → [Único]
 *   "M: 180.000 Gs. / G: 290.000 Gs."              → [M, G]   (también "P / M / G" y "6 rosas / 8 rosas")
 *   "180.000 Gs. Version mini: 130.000 Gs."        → [Estándar, "Version mini"]
 */
const AMOUNT = '(\\d{1,3}(?:\\.\\d{3})*|\\d+)';
const toInt = (s) => Number(s.replace(/\./g, ''));

function parsePrice(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/\s+/g, ' ');
  let m = new RegExp(`^${AMOUNT} Gs\\.$`).exec(t);
  if (m) return [{ label: 'Único', pricePyg: toInt(m[1]) }];

  m = new RegExp(`^${AMOUNT} Gs\\. ([^:/]+?): ${AMOUNT} Gs\\.$`).exec(t);
  if (m) return finish([{ label: 'Estándar', pricePyg: toInt(m[1]) }, { label: m[2].trim(), pricePyg: toInt(m[3]) }]);

  const parts = t.split(' / ');
  if (parts.length >= 2) {
    const out = [];
    for (const p of parts) {
      const pm = new RegExp(`^([^:/]+?): ${AMOUNT} Gs\\.$`).exec(p);
      if (!pm) return null;
      out.push({ label: pm[1].trim(), pricePyg: toInt(pm[2]) });
    }
    return finish(out);
  }
  return null;
}

function finish(variants) {
  const labels = new Set(variants.map((v) => v.label));
  if (labels.size !== variants.length) return null;
  if (variants.some((v) => !(v.pricePyg > 0))) return null;
  return variants;
}
module.exports = { parsePrice };
