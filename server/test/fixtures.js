'use strict';
const { call, multipart, PNG_1PX } = require('./helpers');

/** Arma el escenario del enunciado: insumos con stock y costo + "Bouquet Romántico" con su receta, publicado. */
async function setupFlowers(app, admin) {
  const api = (m, u, b) => call(app, admin, m, u, b);
  const ok = (r, code = [200, 201]) => { if (!code.includes(r.statusCode)) throw new Error(`${r.statusCode} ${r.body}`); return r.json(); };
  const cat = ok(await api('POST', '/api/v1/categories', { name: 'Románticos' })).id;
  const supplies = ok(await api('POST', '/api/v1/categories', { name: 'Insumos' })).id;
  const mkSupply = async (name, unit, qty, cost, kind = 'raw_flower') => {
    const p = ok(await api('POST', '/api/v1/products', { name, categoryId: supplies, kind }));
    ok(await api('POST', '/api/v1/inventory/items', { productId: p.id, unit, minStock: 1 }));
    ok(await api('POST', '/api/v1/inventory/adjustments', { productId: p.id, direction: 'in', qty, unitCostPyg: cost, reason: 'Carga inicial' }));
    return p.id;
  };
  const ids = {
    rosa: await mkSupply('Rosa roja', 'tallo', 100, 1000), euc: await mkSupply('Eucalipto', 'tallo', 30, 400, 'foliage'),
    papel: await mkSupply('Papel', 'unidad', 10, 500, 'packaging'), cinta: await mkSupply('Cinta', 'unidad', 10, 300, 'packaging'), tarjeta: await mkSupply('Tarjeta', 'unidad', 10, 200, 'packaging'),
  };
  const m = multipart({ filename: 'b.png', content: PNG_1PX });
  const img = (await app.inject({ method: 'POST', url: '/api/v1/media', payload: m.payload, headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': m.contentType } })).json().id;
  const prod = ok(await api('POST', '/api/v1/products', { name: 'Bouquet Romántico', categoryId: cat, variants: [{ label: 'M', pricePyg: 250000 }], mediaIds: [img] }));
  const variantId = prod.variants[0].id;
  ok(await api('PUT', `/api/v1/variants/${variantId}/recipe`, { components: [{ productId: ids.rosa, qty: 12 }, { productId: ids.euc, qty: 3 }, { productId: ids.papel, qty: 1 }, { productId: ids.cinta, qty: 1 }, { productId: ids.tarjeta, qty: 1 }],
    extras: [{ concept: 'Mano de obra', amountPyg: 15000 }] }));
  ok(await api('PATCH', `/api/v1/products/${prod.id}`, { active: true }));
  return { ...ids, productId: prod.id, variantId, cat, supplies, img };
}
module.exports = { setupFlowers };
