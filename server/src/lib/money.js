'use strict';
/** Guaraníes: siempre enteros, sin decimales. */
const isPYG = (n) => Number.isSafeInteger(n) && n >= 0;
function assertPYG(n, label = 'importe') {
  if (!isPYG(n)) throw new TypeError(`${label} debe ser un entero de Guaraníes >= 0 (recibido: ${n})`);
  return n;
}
const formatGs = (n) => String(assertPYG(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Texto de precio para la web actual a partir de variantes numéricas: "180.000 Gs." o "M: 180.000 Gs. / G: 290.000 Gs." */
function priceText(variants) {
  if (!variants.length) return '';
  if (variants.length === 1) return `${formatGs(variants[0].pricePyg)} Gs.`;
  return variants.map((v, i) => (i === 0 && v.label === 'Estándar' ? `${formatGs(v.pricePyg)} Gs.` : `${v.label}: ${formatGs(v.pricePyg)} Gs.`)).join(' / ');
}
module.exports = { isPYG, assertPYG, formatGs, priceText };
