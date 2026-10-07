'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { makeApp, userWithRole, call } = require('./helpers');
const { parsePrice } = require('../src/modules/catalog/legacy-parser');
const { importLegacyCatalog, loadLegacyCatalog } = require('../src/modules/catalog/import-legacy');
const { priceText, formatGs, assertPYG } = require('../src/lib/money');
const { withTransaction } = require('../src/db/pool');

const REPO = path.resolve(__dirname, '..', '..');
const LEGACY_FILE = path.join(REPO, 'JAVA', 'catalogo-datos.js');

describe('dinero (PYG entero)', () => {
  test('formato y validación', () => {
    assert.equal(formatGs(180000), '180.000'); assert.equal(formatGs(0), '0'); assert.equal(formatGs(1234567), '1.234.567');
    for (const bad of [-1, 1.5, '100', NaN, Infinity, 2 ** 60]) assert.throws(() => assertPYG(bad), TypeError);
  });
});

describe('parser de precios del catálogo original', () => {
  const ok = [
    ['180.000 Gs.', [{ label: 'Único', pricePyg: 180000 }]],
    ['M: 180.000 Gs. / G: 290.000 Gs.', [{ label: 'M', pricePyg: 180000 }, { label: 'G', pricePyg: 290000 }]],
    ['6 rosas: 170.000 Gs. / 8 rosas: 225.000 Gs.', [{ label: '6 rosas', pricePyg: 170000 }, { label: '8 rosas', pricePyg: 225000 }]],
    ['P: 100.000 Gs. / M: 150.000 Gs. / G: 200.000 Gs.', [{ label: 'P', pricePyg: 100000 }, { label: 'M', pricePyg: 150000 }, { label: 'G', pricePyg: 200000 }]],
    ['180.000 Gs. Version mini: 130.000 Gs.', [{ label: 'Estándar', pricePyg: 180000 }, { label: 'Version mini', pricePyg: 130000 }]],
  ];
  for (const [txt, exp] of ok) test(`convierte "${txt}"`, () => assert.deepEqual(parsePrice(txt), exp));
  for (const bad of ['', 'Consultar', 'Desde 180.000 Gs.', '180.000', '180.000 Gs. / 200.000 Gs.', 'M: 0 Gs. / G: 5 Gs.', 'M: 1 Gs. / M: 2 Gs.', '12,5 Gs.', null, 42]) {
    test(`NO adivina: ${JSON.stringify(bad)} → revisión manual`, () => assert.equal(parsePrice(bad), null));
  }
  test('ida y vuelta: priceText reproduce el formato original', () => {
    for (const [txt] of ok.slice(0, 4)) assert.equal(priceText(parsePrice(txt)), txt);
  });
});

describe('importación del catálogo + paridad con el catálogo actual', () => {
  let app, legacy, report;
  before(async () => {
    app = await makeApp();
    legacy = loadLegacyCatalog(LEGACY_FILE);
    report = await withTransaction(app.pool, (tx) => importLegacyCatalog(tx, legacy, { repoRoot: REPO }));
  });
  after(async () => { await app.close_all(); });

  test('el origen tiene los 65 productos reales y 5 secciones', () => {
    assert.equal(legacy.productos.length, 65); assert.equal(legacy.secciones.length, 5);
    assert.equal(new Set(legacy.productos.map((p) => p.id)).size, 65, 'ids únicos');
  });

  test('se importan 65/65 sin ítems pendientes de revisión', () => {
    assert.deepEqual(report.products, { created: 65, existing: 0 });
    assert.deepEqual(report.categories, { created: 5, existing: 0 });
    assert.deepEqual(report.review, []);
    assert.equal(report.variants, 72);
  });

  test('es idempotente: una segunda corrida no duplica nada', async () => {
    const r2 = await withTransaction(app.pool, (tx) => importLegacyCatalog(tx, legacy, { repoRoot: REPO }));
    assert.deepEqual(r2.products, { created: 0, existing: 65 }); assert.equal(r2.variants, 0);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n, 65);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM product_variants')).rows[0].n, 72);
  });

  test('no pisa ediciones hechas luego en la base (precio cambiado se conserva)', async () => {
    await app.pool.query(`UPDATE product_variants SET price_pyg = 999999 WHERE product_id = (SELECT id FROM products WHERE legacy_id='rom-05')`);
    await withTransaction(app.pool, (tx) => importLegacyCatalog(tx, legacy, { repoRoot: REPO }));
    const { rows } = await app.pool.query(`SELECT price_pyg FROM product_variants WHERE product_id = (SELECT id FROM products WHERE legacy_id='rom-05')`);
    assert.equal(rows[0].price_pyg, 999999);
    // restaurar para los tests de paridad
    const orig = parsePrice(legacy.productos.find((p) => p.id === 'rom-05').precio)[0].pricePyg;
    await app.pool.query(`UPDATE product_variants SET price_pyg = $1 WHERE product_id = (SELECT id FROM products WHERE legacy_id='rom-05')`, [orig]);
  });

  test('todo precio quedó como entero PYG y con historial inicial', async () => {
    const { rows } = await app.pool.query(`SELECT v.price_pyg, (SELECT count(*) FROM variant_price_history h WHERE h.variant_id=v.id)::int AS h FROM product_variants v`);
    assert.equal(rows.length, 72);
    for (const r of rows) { assert.ok(Number.isSafeInteger(r.price_pyg) && r.price_pyg > 0); assert.equal(r.h, 1); }
  });

  test('PARIDAD: GET /public/catalog devuelve exactamente lo que hoy muestra el sitio', async () => {
    const res = await app.inject('/api/v1/public/catalog');
    assert.equal(res.statusCode, 200);
    const api = res.json();

    // secciones: mismo orden y mismos datos
    assert.equal(api.secciones.length, legacy.secciones.length);
    legacy.secciones.forEach((s, i) => {
      assert.deepEqual({ id: api.secciones[i].id, titulo: api.secciones[i].titulo, descripcion: api.secciones[i].descripcion, foto: api.secciones[i].foto },
        { id: s.id, titulo: s.titulo, descripcion: s.descripcion, foto: s.foto }, 'sección ' + s.id);
    });

    // productos: mismo orden, ids, sección, nombre, descripción y fotos
    assert.equal(api.productos.length, 65);
    const textDiffs = [];
    legacy.productos.forEach((p, i) => {
      const a = api.productos[i];
      assert.equal(a.id, p.id, `orden/id en posición ${i}`);
      assert.equal(a.seccion, p.seccion, p.id); assert.equal(a.nombre, p.nombre, p.id); assert.equal(a.descripcion, p.descripcion, p.id);
      assert.deepEqual(a.fotos, p.fotos, 'fotos ' + p.id);
      // precios: los mismos números, en el mismo orden (comparación independiente del parser)
      const nums = [...p.precio.matchAll(/(\d[\d.]*) Gs\./g)].map((m) => Number(m[1].replace(/\./g, '')));
      assert.deepEqual(a.variantes.map((v) => v.pricePyg), nums, 'precios ' + p.id);
      if (a.precio !== p.precio) textDiffs.push(p.id);
    });
    // Única diferencia textual tolerada: formato del producto con "versión mini" (mismos números y etiquetas)
    assert.deepEqual(textDiffs, legacy.productos.filter((p) => /Gs\. [^:/]+: /.test(p.precio) && !p.precio.includes(' / ')).map((p) => p.id));
    assert.ok(textDiffs.length <= 1, 'diferencias de texto inesperadas: ' + textDiffs);
  });

  test('todas las imágenes referenciadas por la API existen en disco', async () => {
    const api = (await app.inject('/api/v1/public/catalog')).json();
    const refs = [...api.secciones.map((s) => s.foto), ...api.productos.flatMap((p) => p.fotos)];
    assert.ok(refs.length >= 70);
    for (const r of refs) assert.ok(fs.existsSync(path.join(REPO, 'HTML', r)), 'falta ' + r);
  });

  test('la API expone variantes numéricas y caché con ETag/304', async () => {
    const r = await app.inject('/api/v1/public/catalog');
    assert.ok(r.headers.etag); assert.match(r.headers['cache-control'], /max-age=60/);
    const m = r.json().productos.find((p) => p.id === 'rom-01');
    assert.deepEqual(m.variantes.map(({ label, pricePyg }) => ({ label, pricePyg })), [{ label: 'M', pricePyg: 180000 }, { label: 'G', pricePyg: 290000 }]);
    const r304 = await app.inject({ url: '/api/v1/public/catalog', headers: { 'if-none-match': r.headers.etag } });
    assert.equal(r304.statusCode, 304);
  });

  test('cambios en la base se reflejan en la web: archivar producto o cambiar precio → API actualizada', async () => {
    await app.pool.query(`UPDATE products SET active=false WHERE legacy_id='rom-02'`);
    await app.pool.query(`UPDATE product_variants SET price_pyg=185000 WHERE product_id=(SELECT id FROM products WHERE legacy_id='rom-01') AND label='M'`);
    const api = (await app.inject('/api/v1/public/catalog')).json();
    assert.equal(api.productos.length, 64);
    assert.ok(!api.productos.find((p) => p.id === 'rom-02'));
    assert.equal(api.productos.find((p) => p.id === 'rom-01').precio, 'M: 185.000 Gs. / G: 290.000 Gs.');
  });

  test('la API pública no requiere sesión y no filtra campos internos', async () => {
    const r = await app.inject('/api/v1/public/catalog');
    assert.ok(!/needs_review|review_note|cost|sha256|storage_key|password/i.test(r.body));
  });
});

describe('importación: lo no convertible queda para revisión manual (nunca se inventa)', () => {
  let app;
  before(async () => { app = await makeApp(); });
  after(async () => { await app.close_all(); });
  test('precio raro, imagen inexistente y sección inválida → producto inactivo con nota; sin variantes inventadas', async () => {
    const fake = { secciones: [{ id: 'sec', titulo: 'Sec', descripcion: '', foto: '../IMAGENES/no-existe.jpg' }], productos: [
      { id: 'x-1', seccion: 'sec', nombre: 'Producto raro', precio: 'Consultar', descripcion: 'd', fotos: ['../IMAGENES/logo.jpeg'] },
      { id: 'x-2', seccion: 'sec', nombre: 'Sin foto', precio: '100.000 Gs.', descripcion: 'd', fotos: ['../IMAGENES/fantasma.png'] },
      { id: 'x-3', seccion: 'otra', nombre: 'Sin sección', precio: '100.000 Gs.', descripcion: 'd', fotos: ['../IMAGENES/logo.jpeg'] },
      { id: 'x-4', seccion: 'sec', nombre: 'Traversal', precio: '100.000 Gs.', descripcion: 'd', fotos: ['../../server/package.json'] },
    ] };
    const rep = await withTransaction(app.pool, (tx) => importLegacyCatalog(tx, fake, { repoRoot: REPO }));
    assert.equal(rep.review.filter((r) => r.type === 'product').length, 4);
    const { rows } = await app.pool.query('SELECT legacy_id, active, needs_review, review_note FROM products ORDER BY legacy_id');
    assert.ok(rows.every((r) => r.active === false && r.needs_review && r.review_note));
    assert.match(rows[0].review_note, /precio no convertible/);
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM product_variants WHERE product_id=(SELECT id FROM products WHERE legacy_id='x-1')`)).rows[0].n, 0);
    assert.equal((await app.inject('/api/v1/public/catalog')).json().productos.length, 0, 'lo pendiente de revisión no se publica');
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM media WHERE storage_key NOT LIKE 'IMAGENES/%'`)).rows[0].n, 0, 'no se registran rutas fuera de IMAGENES/');
  });
});
