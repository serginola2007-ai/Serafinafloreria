'use strict';
/** Catálogo en el panel (Chromium real): lista de los 65 importados, edición de precio con historial, alta con imagen, publicación, archivado y permisos. */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { chromium } = require('playwright');
const { makeApp, createUser, PASSWORD, PNG_1PX } = require('../test/helpers');
const { importLegacyCatalog, loadLegacyCatalog } = require('../src/modules/catalog/import-legacy');
const { withTransaction } = require('../src/db/pool');

const REPO = path.resolve(__dirname, '..', '..'); const { clickNav } = require('./nav');
const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
let n = 0; const ok = (m) => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const site = http.createServer((req, res) => { // sirve IMAGENES/ como lo haría el sitio público (PUBLIC_URL)
    const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(4326, '127.0.0.1');
  const app = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4326', API_URL: 'http://127.0.0.1:4325', ADMIN_URL: 'http://127.0.0.1:4325/admin' });
  await app.listen({ port: 4325, host: '127.0.0.1' });
  await withTransaction(app.pool, (tx) => importLegacyCatalog(tx, loadLegacyCatalog(path.join(REPO, 'JAVA', 'catalogo-datos.js')), { repoRoot: REPO }));
  await createUser(app, { email: 'admin@serafina.test', role: 'administrador', fullName: 'Admin Serafina' });
  await createUser(app, { email: 'vendedor@serafina.test', role: 'ventas', fullName: 'Vendedor Uno' });
  const png = path.join(os.tmpdir(), 'nuevo-ramo.png'); fs.writeFileSync(png, PNG_1PX);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|net::|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const shot = (x) => page.screenshot({ path: path.join(SHOTS, `c-${x}.png`) });
  const login = async (email) => { await page.goto('http://127.0.0.1:4325/admin/'); await page.waitForSelector('#login-email'); await page.fill('#login-email', email); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.app-nav'); };
  const publicCat = async () => (await app.inject('/api/v1/public/catalog')).json();

  try {
    await login('admin@serafina.test');
    const nav = await page.locator('.app-nav .nav-link').allTextContents();
    assert.ok(nav.includes('Productos') && nav.includes('Categorías'));
    await clickNav(page, 'Productos'); await page.waitForSelector('h1:has-text("Productos")'); await page.waitForSelector('table.table tbody tr');
    assert.match(await page.textContent('.pager'), /1–15 de 65/);
    await page.waitForFunction(() => [...document.querySelectorAll('.thumb')].some((i) => i.tagName === 'IMG' && i.complete && i.naturalWidth > 0));
    await shot('1-lista');
    ok('lista los 65 productos importados, con miniaturas y paginación');

    await page.fill('input[type=search]', 'cherry'); await page.waitForFunction(() => document.querySelectorAll('table.table tbody tr').length === 1);
    assert.match(await page.textContent('table.table tbody tr'), /180\.000 Gs\. – 290\.000 Gs\./);
    ok('búsqueda desde el servidor y rango de precios real');

    await page.click('a:has-text("Editar")'); await page.waitForSelector('#p-name');
    assert.equal(await page.inputValue('#p-name'), 'Ramo Cherry');
    assert.doesNotMatch(await page.textContent('#view'), /false|undefined|\[object|NaN/, 'texto basura en el editor');
    await shot('2-editor');
    const rows = page.locator('.var-row'); assert.equal(await rows.count() >= 3, true);
    const priceM = rows.nth(1).locator('input.price-input');
    await page.fill('input[aria-label="Motivo del cambio de precio"]', 'ajuste de flores');
    await priceM.fill('185.000'); await rows.nth(0).locator('input.price-input').fill('185.000');
    await rows.nth(0).locator('button:has-text("Guardar")').click();
    await page.waitForSelector('.toast:has-text("Variante actualizada")');
    assert.equal((await publicCat()).productos.find((p) => p.id === 'rom-01').precio, 'M: 185.000 Gs. / G: 290.000 Gs.');
    ok('cambia el precio de una variante → persiste y se refleja en la API pública');

    await page.locator('.var-row').nth(0).locator('button:has-text("Historial")').click();
    await page.waitForSelector('.modal li');
    const hist = await page.locator('.modal li').allTextContents();
    assert.equal(hist.length, 2); assert.match(hist[0], /185\.000 Gs\./); assert.match(hist[0], /ajuste de flores/); assert.match(hist[1], /180\.000 Gs\./);
    await shot('3-historial'); await page.click('.modal-foot button');
    ok('historial de precios con motivo y autor');

    await page.locator('.var-row').nth(0).locator('input.price-input').fill('12,5');
    await page.waitForSelector('text=Ingresá solo números');
    ok('precio con decimales/texto se rechaza en el formulario');

    // ── categoría + producto nuevo con imagen subida ──
    await clickNav(page, 'Categorías'); await page.waitForSelector('h1:has-text("Categorías")'); await page.waitForSelector('table.table tbody tr');
    await page.click('button:has-text("Nueva categoría")'); await page.fill('#c-name', 'Cumpleaños'); await page.click('.modal-foot button.primary');
    await page.waitForSelector('.toast:has-text("Categoría creada")'); await page.waitForSelector('td:has-text("Cumpleaños")');
    ok('crea categoría desde el panel');

    await clickNav(page, 'Productos'); await page.waitForSelector('h1:has-text("Productos")');
    await page.click('a:has-text("Nuevo producto")'); await page.waitForSelector('#p-name');
    await page.click('button:has-text("Crear y publicar")'); await page.waitForSelector('#p-name-err:not([hidden])');
    ok('validación de formulario: nombre obligatorio');
    await page.fill('#p-name', 'Ramo Alegría E2E'); await page.selectOption('#p-cat', { label: 'Cumpleaños' });
    await page.fill('.var-row input[aria-label="Nombre de la variante"]', 'Único'); await page.fill('.var-row input.price-input', '250000');
    await page.click('button:has-text("Crear y publicar")');
    await page.waitForSelector('.toast:has-text("No se puede publicar. Falta: al menos una imagen")');
    assert.equal((await publicCat()).productos.find((p) => p.nombre === 'Ramo Alegría E2E'), undefined);
    ok('no deja publicar sin imagen (regla del backend) y explica qué falta');

    await page.click('button:has-text("Elegir de la biblioteca")'); await page.waitForSelector('.modal');
    await page.setInputFiles('input[type=file]', png);
    await page.waitForSelector('.toast:has-text("Imagen subida")'); await page.waitForSelector('.picker-item[aria-pressed="true"]');
    await page.click('.modal-foot button.primary'); await page.waitForSelector('.img-tile');
    await page.click('button:has-text("Crear y publicar")');
    await page.waitForSelector('.toast:has-text("Producto publicado")'); await page.waitForFunction(() => /#\/productos\/\d+/.test(location.hash));
    const web = (await publicCat()).productos.find((p) => p.nombre === 'Ramo Alegría E2E');
    assert.ok(web && web.precio === '250.000 Gs.' && web.seccion === 'cumpleanos' && web.fotos.length === 1);
    await shot('4-publicado');
    ok('sube imagen (storage), crea y publica → aparece en la web pública con precio e imagen');

    await page.click('button:has-text("Despublicar")'); await page.waitForSelector('.toast:has-text("despublicado")');
    assert.equal((await publicCat()).productos.find((p) => p.nombre === 'Ramo Alegría E2E'), undefined);
    await page.click('button:has-text("Publicar en el sitio")'); await page.waitForSelector('.toast:has-text("publicado")');
    await page.click('button:has-text("Archivar")'); await page.click('.modal-foot button.danger');
    await page.waitForFunction(() => location.hash === '#/productos');
    assert.equal((await publicCat()).productos.find((p) => p.nombre === 'Ramo Alegría E2E'), undefined);
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM products WHERE name='Ramo Alegría E2E'`)).rows[0].n, 1);
    ok('despublicar / republicar / archivar (no se borra) con confirmación');

    const acts = (await app.pool.query(`SELECT DISTINCT action FROM audit_logs WHERE action LIKE 'product.%' OR action LIKE 'variant.%' OR action LIKE 'category.%'`)).rows.map((r) => r.action);
    for (const a of ['product.created', 'product.published', 'product.unpublished', 'product.archived', 'variant.price_changed', 'category.created']) assert.ok(acts.includes(a), a);
    ok('todas las acciones quedaron en la auditoría');

    // ── rol Ventas: solo lectura ──
    await page.click('.user-btn'); await page.click('button:has-text("Cerrar sesión")'); await page.waitForSelector('#login-email');
    await login('vendedor@serafina.test');
    await clickNav(page, 'Productos'); await page.waitForSelector('table.table tbody tr');
    assert.equal(await page.locator('a:has-text("Nuevo producto")').count(), 0);
    assert.equal(await page.locator('button:has-text("Archivar")').count(), 0);
    await page.click('a:has-text("Ver") >> nth=0'); await page.waitForSelector('#p-name');
    assert.equal(await page.locator('#p-name').isDisabled(), true); assert.equal(await page.locator('button:has-text("Guardar datos")').count(), 0);
    await page.evaluate(() => { location.hash = '#/productos/nuevo'; }); await page.waitForSelector('text=Sin acceso');
    const st = await page.evaluate(async () => (await fetch('/api/v1/products/1', { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{"name":"hack"}' })).status);
    assert.equal(st, 403);
    ok('rol Ventas: ve el catálogo sin botones de edición; /productos/nuevo → sin acceso; el backend rechaza con 403');

    // ── móvil ──
    await page.setViewportSize({ width: 390, height: 800 });
    await page.evaluate(() => { location.hash = '#/productos'; }); await page.waitForSelector('table.table tbody tr'); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sin scroll horizontal');
    await shot('5-movil-lista');
    await page.locator('a:has-text("Ver") >> nth=0').click(); await page.waitForSelector('#p-name'); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'editor sin scroll horizontal');
    await shot('6-movil-editor');
    ok('móvil: lista como tarjetas y editor sin scroll horizontal');

    assert.deepEqual(problems, [], problems.join(' | '));
    ok('sin errores de consola ni CSP');
    console.log('\nCATALOG E2E OK');
  } catch (e) { await page.screenshot({ path: path.join(SHOTS, 'c-FALLO.png') }).catch(() => {}); console.error('\nCATALOG E2E FALLÓ en el paso', n + 1, '\n', e.message, '\nconsola:', problems); process.exitCode = 1; }
  finally { await browser.close(); site.close(); await app.close_all(); }
})();
