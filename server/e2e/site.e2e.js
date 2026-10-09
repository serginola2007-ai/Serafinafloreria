'use strict';
/** Sitio público ↔ API: sin API (igual que hoy), con API (datos de la base), cambios del panel reflejados y respaldo si la API cae. */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const { chromium } = require('playwright');
const { makeApp } = require('../test/helpers');
const { importLegacyCatalog, loadLegacyCatalog } = require('../src/modules/catalog/import-legacy');
const { withTransaction } = require('../src/db/pool');

const REPO = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
let n = 0; const ok = (m) => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const site = http.createServer((req, res) => {
    const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(4324, '127.0.0.1');
  const app = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4324', API_URL: 'http://127.0.0.1:4323', ADMIN_URL: 'http://127.0.0.1:4323/admin' });
  await app.listen({ port: 4323, host: '127.0.0.1' });
  await withTransaction(app.pool, async (tx) => importLegacyCatalog(tx, loadLegacyCatalog(path.join(REPO, 'JAVA', 'catalogo-datos.js')), { repoRoot: REPO }));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const PAGE = 'http://127.0.0.1:4324/HTML/catalogo.html';
  const open = async (apiUrl) => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const errs = []; const apiCalls = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('request', (r) => { if (r.url().includes('/api/v1/public/catalog')) apiCalls.push(r.url()); });
    if (apiUrl !== undefined) await page.addInitScript((u) => { window.SERAFINA_API_URL = u; }, apiUrl);
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.producto-card');
    return { page, ctx, errs, apiCalls };
  };
  const cards = (p) => p.locator('.producto-card').count();
  const price = (p, nombre) => p.locator('.producto-card', { hasText: nombre }).locator('.producto-precio').first().textContent();
  try {
    let s = await open();
    assert.equal(await cards(s.page), 65); assert.equal(s.apiCalls.length, 0);
    assert.equal(await price(s.page, 'Ramo Cherry'), 'M: 180.000 Gs. / G: 290.000 Gs.');
    ok('sin API configurada: el catálogo es el de siempre (65 productos, sin llamadas al backend)'); await s.ctx.close();

    s = await open('http://127.0.0.1:4323');
    assert.equal(s.apiCalls.length, 1); assert.equal(await cards(s.page), 65);
    assert.equal(await price(s.page, 'Ramo Cherry'), 'M: 180.000 Gs. / G: 290.000 Gs.');
    const imgOk = await s.page.evaluate(() => [...document.querySelectorAll('.producto-card img')].filter((i) => i.complete && i.naturalWidth === 0).length);
    assert.equal(imgOk, 0, 'todas las imágenes cargan');
    assert.deepEqual(s.errs, []);
    ok('con API: los 65 productos salen de PostgreSQL, con precios e imágenes idénticos'); await s.ctx.close();

    await app.pool.query(`UPDATE product_variants SET price_pyg = 185000 WHERE product_id = (SELECT id FROM products WHERE legacy_id='rom-01') AND label='M'`);
    await app.pool.query(`UPDATE products SET active = false WHERE legacy_id = 'rom-02'`);
    s = await open('http://127.0.0.1:4323');
    assert.equal(await cards(s.page), 64); assert.equal(await price(s.page, 'Ramo Cherry'), 'M: 185.000 Gs. / G: 290.000 Gs.');
    assert.equal(await s.page.locator('.producto-card', { hasText: 'Ramo Amor' }).count(), 0);
    await s.page.locator('.producto-card', { hasText: 'Ramo Cherry' }).first().click();
    await s.page.waitForSelector('#producto-modal.open');
    ok('cambios hechos en la base (precio, despublicar) se ven en la web pública, y el modal de detalle funciona'); await s.ctx.close();

    const t0 = Date.now();
    s = await open('http://127.0.0.1:4399'); // backend caído
    assert.equal(await cards(s.page), 65); assert.ok(Date.now() - t0 < 8000);
    assert.equal(await price(s.page, 'Ramo Cherry'), 'M: 180.000 Gs. / G: 290.000 Gs.', 'respaldo = datos originales');
    ok('backend caído → el sitio usa catalogo-datos.js y sigue funcionando'); await s.ctx.close();

    console.log('\nSITE E2E OK');
  } catch (e) { console.error('\nSITE E2E FALLÓ en el paso', n + 1, '\n', e.message); process.exitCode = 1; }
  finally { await browser.close(); site.close(); await app.close_all(); }
})();
