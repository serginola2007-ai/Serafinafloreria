'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeApp, userWithRole, call, multipart, PNG_1PX } = require('./helpers');
const { importLegacyCatalog, loadLegacyCatalog } = require('../src/modules/catalog/import-legacy');
const { withTransaction } = require('../src/db/pool');

const REPO = path.resolve(__dirname, '..', '..');

async function upload(app, s, content, name = 'a.png') {
  const m = multipart({ filename: name, content });
  const r = await app.inject({ method: 'POST', url: '/api/v1/media', payload: m.payload, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': m.contentType } });
  assert.equal(r.statusCode, 201, r.body); return r.json().id;
}

describe('catálogo editable (categorías, productos, variantes, precios)', () => {
  let app, admin, vend, mk, catId, img1, img2;
  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'admin@test.local');
    vend = await userWithRole(app, 'ventas', 'v@test.local');
    mk = await userWithRole(app, 'marketing', 'm@test.local');
    img1 = await upload(app, admin, PNG_1PX, 'uno.png');
    img2 = await upload(app, admin, Buffer.concat([PNG_1PX, Buffer.from('2')]), 'dos.png');
  });
  after(async () => { await app.close_all(); });

  test('permisos: ver sí, crear/editar/archivar solo con permiso (backend 403)', async () => {
    assert.equal((await call(app, vend, 'GET', '/api/v1/products')).statusCode, 200);
    assert.equal((await call(app, mk, 'GET', '/api/v1/categories')).statusCode, 200);
    for (const [m, u, b] of [['POST', '/api/v1/categories', { name: 'X' }], ['POST', '/api/v1/products', { name: 'X', categoryId: 1, variants: [{ label: 'U', pricePyg: 1 }] }],
      ['PATCH', '/api/v1/products/1', { name: 'Y' }], ['DELETE', '/api/v1/products/1'], ['PATCH', '/api/v1/variants/1', { pricePyg: 5 }], ['PUT', '/api/v1/products/1/media', { mediaIds: [] }], ['DELETE', '/api/v1/categories/1']]) {
      assert.equal((await call(app, vend, m, u, b)).statusCode, 403, `${m} ${u}`);
    }
    assert.equal((await app.inject('/api/v1/products')).statusCode, 401);
  });

  test('categorías: alta (slug automático y único), edición, archivar bloqueado si tiene productos', async () => {
    const c1 = (await call(app, admin, 'POST', '/api/v1/categories', { name: 'Día de la Madre' })).json();
    assert.equal(c1.slug, 'dia-de-la-madre'); catId = c1.id;
    const c2 = (await call(app, admin, 'POST', '/api/v1/categories', { name: 'Día de la madre' })).json();
    assert.equal(c2.slug, 'dia-de-la-madre-2');
    assert.equal((await call(app, admin, 'PATCH', `/api/v1/categories/${c2.id}`, { description: 'Flores', sortOrder: 5 })).statusCode, 200);
    assert.equal((await call(app, admin, 'POST', '/api/v1/categories', { name: 'X', coverMediaId: 99999 })).json().error.code, 'UNKNOWN_MEDIA');
    assert.equal((await call(app, admin, 'DELETE', `/api/v1/categories/${c2.id}`)).statusCode, 200);
    const list = (await call(app, admin, 'GET', '/api/v1/categories')).json().data;
    assert.equal(list.find((c) => c.id === c2.id).archived, true);
  });

  test('crear producto: precios SOLO enteros PYG ≥ 0; rechaza texto, decimales, negativos y excesos', async () => {
    const base = { name: 'Ramo Test', categoryId: catId };
    for (const bad of [-1, 1.5, 'abc', 1e13, null]) {
      const r = await call(app, admin, 'POST', '/api/v1/products', { ...base, variants: [{ label: 'M', pricePyg: bad }] });
      assert.equal(r.statusCode, 400, `precio ${bad}`);
    }
    assert.equal((await call(app, admin, 'POST', '/api/v1/products', { ...base, variants: [] })).statusCode, 400);
    assert.equal((await call(app, admin, 'POST', '/api/v1/products', { ...base, variants: [{ label: 'M', pricePyg: '180.000 Gs.' }] })).statusCode, 400, 'texto de precio no se acepta');
    assert.equal((await call(app, admin, 'POST', '/api/v1/products', { ...base, variants: [{ label: 'M', pricePyg: 1 }, { label: 'm', pricePyg: 2 }] })).json().error.code, 'DUPLICATE_VARIANT');
    assert.equal((await call(app, admin, 'POST', '/api/v1/products', { ...base, categoryId: 99999, variants: [{ label: 'M', pricePyg: 1 }] })).json().error.code, 'UNKNOWN_CATEGORY');
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n, 0, 'nada quedó a medias');
  });

  let pid, vM, vG;
  test('crear producto con variantes e historial inicial; nace como borrador', async () => {
    const r = await call(app, admin, 'POST', '/api/v1/products', { name: 'Ramo Romántico Test', description: 'Rosas rojas', categoryId: catId,
      variants: [{ label: 'M', pricePyg: 180000 }, { label: 'G', pricePyg: 290000 }], mediaIds: [img1] });
    assert.equal(r.statusCode, 201, r.body);
    const p = r.json(); pid = p.id; [vM, vG] = p.variants.map((v) => v.id);
    assert.equal(p.status, 'inactive'); assert.equal(p.slug, 'ramo-romantico-test'); assert.equal(p.images.length, 1);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM variant_price_history')).rows[0].n, 2);
    assert.equal((await call(app, admin, 'GET', '/api/v1/products?status=published')).json().data.length, 0);
    assert.equal((await app.inject('/api/v1/public/catalog')).json().productos.length, 0, 'un borrador no se ve en la web');
  });

  test('publicar exige producto completo (categoría, variante activa, imagen) y recién ahí aparece en la web', async () => {
    const draft = (await call(app, admin, 'POST', '/api/v1/products', { name: 'Sin imagen', categoryId: catId, variants: [{ label: 'U', pricePyg: 100000 }] })).json();
    const r = await call(app, admin, 'PATCH', `/api/v1/products/${draft.id}`, { active: true });
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'PRODUCT_INCOMPLETE'); assert.deepEqual(r.json().error.details.missing, ['al menos una imagen']);
    assert.equal((await call(app, admin, 'POST', '/api/v1/products', { name: 'Directo', categoryId: catId, variants: [{ label: 'U', pricePyg: 1 }], publish: true })).statusCode, 409);
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM products WHERE name='Directo'`)).rows[0].n, 0, 'si falla publicar, no se crea nada');

    const pub = await call(app, admin, 'PATCH', `/api/v1/products/${pid}`, { active: true });
    assert.equal(pub.json().status, 'published');
    const web = (await app.inject('/api/v1/public/catalog')).json();
    const w = web.productos.find((p) => p.nombre === 'Ramo Romántico Test');
    assert.ok(w); assert.equal(w.precio, 'M: 180.000 Gs. / G: 290.000 Gs.'); assert.equal(w.seccion, 'dia-de-la-madre');
    assert.ok(w.fotos[0].startsWith('https://cdn.test/uploads/'));
  });

  test('cambio de precio: se refleja en la web, guarda historial y auditoría antes/después', async () => {
    const r = await call(app, admin, 'PATCH', `/api/v1/variants/${vM}`, { pricePyg: 200000, reason: 'ajuste de costos' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().variants.find((v) => v.id === vM).pricePyg, 200000);
    const web = (await app.inject('/api/v1/public/catalog')).json().productos.find((p) => p.nombre === 'Ramo Romántico Test');
    assert.equal(web.precio, 'M: 200.000 Gs. / G: 290.000 Gs.');
    const h = (await call(app, admin, 'GET', `/api/v1/variants/${vM}/price-history`)).json().data;
    assert.deepEqual(h.map((x) => x.pricePyg), [200000, 180000]); assert.equal(h[0].reason, 'ajuste de costos'); assert.equal(h[0].changedBy, 'Usuario Prueba');
    const a = (await app.pool.query(`SELECT before, after, user_id FROM audit_logs WHERE action='variant.price_changed'`)).rows;
    assert.equal(a.length, 1); assert.equal(a[0].before.pricePyg, 180000); assert.equal(a[0].after.pricePyg, 200000);
    // mismo precio → no genera historial
    await call(app, admin, 'PATCH', `/api/v1/variants/${vM}`, { pricePyg: 200000 });
    assert.equal((await call(app, admin, 'GET', `/api/v1/variants/${vM}/price-history`)).json().data.length, 2);
    assert.equal((await call(app, admin, 'PATCH', `/api/v1/variants/${vM}`, { pricePyg: 9.99 })).statusCode, 400);
  });

  test('variantes: agregar, nombre duplicado → 409, desactivar; la última activa de un producto publicado no se puede quitar', async () => {
    assert.equal((await call(app, admin, 'POST', `/api/v1/products/${pid}/variants`, { label: 'G', pricePyg: 1 })).statusCode, 409);
    const added = await call(app, admin, 'POST', `/api/v1/products/${pid}/variants`, { label: 'XL', pricePyg: 400000 });
    assert.equal(added.statusCode, 201); assert.equal(added.json().variants.length, 3);
    assert.equal((await call(app, admin, 'PATCH', `/api/v1/variants/${vG}`, { active: false })).statusCode, 200);
    const web = (await app.inject('/api/v1/public/catalog')).json().productos.find((p) => p.nombre === 'Ramo Romántico Test');
    assert.deepEqual(web.variantes.map((v) => v.label), ['M', 'XL']);
    const xl = added.json().variants.find((v) => v.label === 'XL').id;
    await call(app, admin, 'PATCH', `/api/v1/variants/${xl}`, { active: false });
    const last = await call(app, admin, 'PATCH', `/api/v1/variants/${vM}`, { active: false });
    assert.equal(last.statusCode, 409); assert.equal(last.json().error.code, 'LAST_VARIANT');
    await call(app, admin, 'PATCH', `/api/v1/variants/${xl}`, { active: true });
  });

  test('imágenes: orden, reemplazo, privadas/inexistentes rechazadas, un publicado no puede quedar sin imagen', async () => {
    const set = await call(app, admin, 'PUT', `/api/v1/products/${pid}/media`, { mediaIds: [img2, img1] });
    assert.deepEqual(set.json().images.map((i) => i.mediaId), [img2, img1]);
    assert.equal((await call(app, admin, 'PUT', `/api/v1/products/${pid}/media`, { mediaIds: [999999] })).json().error.code, 'UNKNOWN_MEDIA');
    const m = multipart({ filename: 'p.pdf', mime: 'application/pdf', content: Buffer.from('%PDF-1.4 x'), fields: { isPublic: 'false' } });
    const pdf = (await app.inject({ method: 'POST', url: '/api/v1/media', payload: m.payload, headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': m.contentType } })).json().id;
    assert.equal((await call(app, admin, 'PUT', `/api/v1/products/${pid}/media`, { mediaIds: [pdf] })).json().error.code, 'UNKNOWN_MEDIA');
    assert.equal((await call(app, admin, 'PUT', `/api/v1/products/${pid}/media`, { mediaIds: [] })).json().error.code, 'PRODUCT_INCOMPLETE');
    assert.equal((await call(app, admin, 'DELETE', `/api/v1/media/${img1}`)).json().error.code, 'MEDIA_IN_USE', 'la imagen en uso no se puede borrar');
  });

  test('editar datos, despublicar, listar con filtros/orden/búsqueda y paginación', async () => {
    const e = await call(app, admin, 'PATCH', `/api/v1/products/${pid}`, { name: 'Ramo Romántico Premium', description: 'Nueva descripción', sortOrder: 3 });
    assert.equal(e.json().name, 'Ramo Romántico Premium'); assert.equal(e.json().slug, 'ramo-romantico-test', 'el slug no cambia al renombrar');
    const web = (await app.inject('/api/v1/public/catalog')).json().productos.find((p) => p.id === String(pid));
    assert.equal(web.nombre, 'Ramo Romántico Premium');
    const l = (await call(app, admin, 'GET', '/api/v1/products?q=premium&status=published')).json();
    assert.equal(l.data.length, 1); assert.equal(l.data[0].priceFrom, 200000); assert.equal(l.data[0].priceTo, 400000); assert.equal(l.data[0].variants, 2); assert.ok(l.data[0].thumbUrl);
    assert.equal((await call(app, admin, 'GET', "/api/v1/products?q=%25_'--")).statusCode, 200, 'comodines y comillas en la búsqueda');
    assert.equal((await call(app, admin, 'GET', '/api/v1/products?sort=password')).statusCode, 400);
    const unp = await call(app, admin, 'PATCH', `/api/v1/products/${pid}`, { active: false });
    assert.equal(unp.json().status, 'inactive');
    assert.equal((await app.inject('/api/v1/public/catalog')).json().productos.length, 0);
    await call(app, admin, 'PATCH', `/api/v1/products/${pid}`, { active: true });
  });

  test('archivar (no se borra) y restaurar como borrador; categoría con productos no se archiva', async () => {
    assert.equal((await call(app, admin, 'DELETE', `/api/v1/categories/${catId}`)).json().error.code, 'CATEGORY_NOT_EMPTY');
    assert.equal((await call(app, admin, 'DELETE', `/api/v1/products/${pid}`)).statusCode, 200);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM products WHERE id=$1', [pid])).rows[0].n, 1, 'la fila se conserva');
    assert.equal((await call(app, admin, 'GET', '/api/v1/products?status=archived')).json().data.length, 1);
    assert.equal((await call(app, admin, 'GET', '/api/v1/products')).json().data.find((p) => p.id === pid), undefined);
    assert.equal((await app.inject('/api/v1/public/catalog')).json().productos.find((p) => p.id === String(pid)), undefined);
    assert.equal((await call(app, admin, 'PATCH', `/api/v1/products/${pid}`, { name: 'x' })).json().error.code, 'ARCHIVED');
    assert.equal((await call(app, admin, 'PATCH', `/api/v1/variants/${vM}`, { pricePyg: 5 })).json().error.code, 'ARCHIVED');
    const r = await call(app, admin, 'POST', `/api/v1/products/${pid}/restore`);
    assert.equal(r.json().status, 'inactive');
    assert.equal((await call(app, admin, 'POST', `/api/v1/products/${pid}/restore`)).json().error.code, 'NOT_ARCHIVED');
  });

  test('auditoría de todo el ciclo (crear, publicar, precio, imágenes, archivar)', async () => {
    const acts = new Set((await app.pool.query(`SELECT action FROM audit_logs`)).rows.map((r) => r.action));
    for (const a of ['category.created', 'category.updated', 'category.archived', 'product.created', 'product.published', 'product.unpublished', 'product.updated', 'product.archived', 'product.restored', 'product.media_set', 'variant.created', 'variant.price_changed', 'variant.updated']) assert.ok(acts.has(a), a);
  });
});

describe('productos pendientes de revisión (importación) → flujo de resolución', () => {
  let app, admin;
  before(async () => {
    app = await makeApp(); admin = await userWithRole(app, 'administrador', 'admin@test.local');
    const fake = { secciones: [{ id: 'sec', titulo: 'Sec', descripcion: '', foto: '../IMAGENES/logo.jpeg' }],
      productos: [{ id: 'r-1', seccion: 'sec', nombre: 'Precio raro', precio: 'Consultar', descripcion: 'd', fotos: ['../IMAGENES/logo.jpeg'] }] };
    await withTransaction(app.pool, (tx) => importLegacyCatalog(tx, fake, { repoRoot: REPO }));
  });
  after(async () => { await app.close_all(); });
  test('queda en "review"; no se puede activar hasta cargar precio y resolver; luego se publica', async () => {
    const list = (await call(app, admin, 'GET', '/api/v1/products?status=review')).json().data;
    assert.equal(list.length, 1); const pid = list[0].id;
    assert.match((await call(app, admin, 'GET', `/api/v1/products/${pid}`)).json().reviewNote, /precio no convertible/);
    const early = await call(app, admin, 'PATCH', `/api/v1/products/${pid}`, { active: true });
    assert.equal(early.statusCode, 409); assert.ok(early.json().error.details.missing.includes('resolver la revisión pendiente'));
    await call(app, admin, 'POST', `/api/v1/products/${pid}/variants`, { label: 'Único', pricePyg: 150000 });
    const done = await call(app, admin, 'PATCH', `/api/v1/products/${pid}`, { resolveReview: true, active: true });
    assert.equal(done.statusCode, 200, done.body); assert.equal(done.json().status, 'published');
    assert.equal((await app.inject('/api/v1/public/catalog')).json().productos[0].precio, '150.000 Gs.');
  });
});
