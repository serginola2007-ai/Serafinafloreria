'use strict';
/** Venta de un ramo con receta, de punta a punta en Chromium real: POS, caja, stock, costo/margen, crédito, anulación, clientes y permisos. */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { chromium } = require('playwright');
const { makeApp, createUser, login: apiLogin, PASSWORD } = require('../test/helpers');
const { setupFlowers } = require('../test/fixtures');
const inv = require('../src/modules/inventory/service');

const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (m) => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const app = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4328', API_URL: 'http://127.0.0.1:4328', ADMIN_URL: 'http://127.0.0.1:4328/admin' });
  await app.listen({ port: 4328, host: '127.0.0.1' });
  await createUser(app, { email: 'admin@serafina.test', role: 'administrador', fullName: 'Admin Serafina' });
  await createUser(app, { email: 'vendedor@serafina.test', role: 'ventas', fullName: 'Vera Vendedora' });
  await createUser(app, { email: 'florista@serafina.test', role: 'florista', fullName: 'Flora Florista' });
  const F = await setupFlowers(app, await apiLogin(app, 'admin@serafina.test'));
  const stockOf = async (pid) => Number((await app.pool.query('SELECT COALESCE(sum(on_hand),0) AS q FROM inventory_levels WHERE product_id=$1', [pid])).rows[0].q);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|net::|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const shot = (x) => page.screenshot({ path: path.join(SHOTS, `s-${x}.png`) });
  const login = async (email) => { await page.goto('http://127.0.0.1:4328/admin/'); await page.waitForSelector('#login-email'); await page.fill('#login-email', email); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar'); };
  const go = async (label, h1) => { await page.click(`a.nav-link:has-text("${label}")`); await page.waitForSelector(`h1:has-text("${h1}")`); await page.waitForTimeout(250); };
  const toast = (t) => page.waitForSelector(`.toast:has-text("${t}")`);
  const noGarbage = async () => assert.doesNotMatch(await page.textContent('#view'), /\bfalse\b|undefined|\[object|NaN/);
  const addBouquet = async (times = 1) => { for (let i = 0; i < times; i++) await page.click('button.pos-card:has-text("Bouquet Romántico")'); };
  const pickCustomer = async (name) => { await page.fill('input[aria-label="Buscar cliente"]', name); await page.waitForSelector(`.menu-item:has-text("${name}"), .menu-item:has-text("Crear cliente nuevo")`); };

  try {
    await login('admin@serafina.test');
    const nav = await page.locator('.sidebar .nav-link').allTextContents();
    for (const x of ['Nueva venta', 'Historial de ventas', 'Cuentas por cobrar', 'Caja', 'Clientes']) assert.ok(nav.includes(x), x);

    // ── 1. caja cerrada ──
    await go('Nueva venta', 'Nueva venta'); await page.waitForSelector('button.pos-card');
    assert.match(await page.textContent('button.pos-card'), /Se pueden armar: 8/);
    await addBouquet(); await page.click('button:has-text("+ Efectivo")'); await page.click('#pos-confirm');
    await page.waitForSelector('.alert.err:has-text("La caja está cerrada")');
    assert.equal(await stockOf(F.rosa), 100, 'no se descontó nada');
    ok('sin caja abierta, cobrar en efectivo se rechaza y no descuenta stock');

    // ── 2. abrir caja ──
    await go('Caja', 'Caja'); await page.waitForSelector('#o-amt'); await page.fill('#o-amt', '100.000'); await page.click('button:has-text("Abrir caja")'); await toast('Caja abierta');
    await page.waitForSelector('.stat:has-text("100.000 Gs.")');
    ok('abre la caja con 100.000 Gs.');

    // ── 3. venta de 2 ramos con cliente nuevo, efectivo y vuelto ──
    await go('Nueva venta', 'Nueva venta'); await page.waitForSelector('button.pos-card');
    await addBouquet(2); assert.match(await page.textContent('.cart'), /500\.000 Gs\./);
    await pickCustomer('Juan'); await page.click('.menu-item:has-text("Crear cliente nuevo")'); await page.fill('#c-name', 'Juan Pérez'); await page.fill('#c-phone', '0981 111 222'); await page.click('.modal-foot button.primary'); await toast('Cliente creado');
    await page.waitForSelector('.cart .alert:has-text("Juan Pérez")');
    await page.click('button:has-text("+ Efectivo")'); await page.fill('#pos-rc', '600000'); await page.waitForSelector('#pos-change:has-text("Vuelto: 100.000 Gs.")');
    await shot('1-pos');
    await page.click('#pos-confirm'); await toast('confirmada'); await page.waitForSelector('.receipt');
    const rc = await page.textContent('.receipt'); assert.match(rc, /COMPROBANTE INTERNO/); assert.match(rc, /No es un documento fiscal/); assert.match(rc, /2 × Bouquet Romántico/); assert.match(rc, /500\.000 Gs\./); assert.match(rc, /V-000001/);
    await shot('2-comprobante'); await page.click('.modal-foot button:has-text("Cerrar")');
    assert.equal(await stockOf(F.rosa), 76); assert.equal(await stockOf(F.euc), 24);
    ok('vende 2 ramos: vuelto calculado, comprobante interno (aclara que NO es fiscal) y stock descontado por receta (rosas 100→76)');

    // ── 4. caja y detalle con costo/margen ──
    await go('Caja', 'Caja'); await page.waitForSelector('.stat:has-text("600.000 Gs.")');
    assert.match(await page.textContent('#view'), /Venta/); await shot('3-caja');
    await go('Historial de ventas', 'Ventas'); await page.waitForSelector('td:has-text("V-000001")'); await page.click('a:has-text("V-000001")'); await page.waitForSelector('h1:has-text("V-000001")');
    const det = await page.textContent('#view'); assert.match(det, /58\.400 Gs\./); assert.match(det, /441\.600 Gs\./); assert.match(det, /Juan Pérez/);
    await shot('4-detalle'); await noGarbage();
    ok('caja = 600.000 Gs. y el detalle muestra costo real (58.400) y margen (441.600) congelados');

    // ── 5. venta a crédito + cobro ──
    await go('Nueva venta', 'Nueva venta'); await page.waitForSelector('button.pos-card'); await addBouquet();
    await pickCustomer('Juan'); await page.click('.menu-item:has-text("Juan Pérez")');
    await page.click('button:has-text("+ Efectivo")'); await page.fill('input[aria-label="Monto cobrado"]', '50000');
    await page.waitForSelector('.alert.warn:has-text("Saldo a crédito: 200.000 Gs.")'); await page.fill('#pos-due', '2026-12-31');
    await page.click('#pos-confirm'); await toast('V-000002'); await page.waitForSelector('.receipt:has-text("Saldo pendiente")'); await page.click('.modal-foot button:has-text("Cerrar")');
    await go('Cuentas por cobrar', 'Cuentas por cobrar'); await page.waitForSelector('td:has-text("V-000002")');
    assert.match(await page.textContent('.stat'), /200\.000 Gs\./);
    await page.click('button:has-text("Cobrar")'); await page.selectOption('#cb-m', 'transferencia'); await page.click('.modal-foot button.primary'); await toast('Cobro registrado');
    await page.waitForSelector('text=Sin cuentas por cobrar');
    ok('venta a crédito (50.000 pagados) genera cuenta por cobrar de 200.000 y se cobra por transferencia');

    // ── 6. anular la venta 1 ──
    await go('Historial de ventas', 'Ventas'); await page.click('a:has-text("V-000001")'); await page.waitForSelector('h1:has-text("V-000001")');
    await page.click('button:has-text("Anular venta")'); await page.fill('#v-reason', 'Error de carga'); await page.click('.modal-foot button.danger'); await toast('Venta anulada'); await page.waitForSelector('.alert.err:has-text("Venta anulada")');
    assert.equal(await stockOf(F.rosa), 76 + 24 - 12, 'repuso 24 de la venta 1 (quedan descontadas las 12 de la venta 2)');
    await go('Caja', 'Caja'); await page.waitForSelector('.stat:has-text("150.000 Gs.")');
    ok('anular: repone el stock y el efectivo sale de la caja (600.000 + 50.000 − 500.000 = 150.000)');

    // ── 7. stock insuficiente ──
    await go('Nueva venta', 'Nueva venta'); await page.waitForSelector('button.pos-card'); await addBouquet();
    for (let i = 0; i < 9; i++) await page.click('button[aria-label="Más"]');
    await page.click('button:has-text("+ Transferencia")'); await page.click('#pos-confirm'); await page.waitForSelector('.alert.err:has-text("No alcanza el stock")');
    assert.match(await page.textContent('.alert.err'), /Eucalipto/);
    ok('pedir más ramos de los que se pueden armar muestra qué componentes faltan');

    // ── 8. receta desde el producto ──
    await go('Productos', 'Productos'); await page.waitForSelector('td:has-text("Bouquet Romántico")'); await page.click('tr:has-text("Bouquet Romántico") a:has-text("Editar")'); await page.waitForSelector('#p-name');
    await page.click('button:has-text("Receta · margen")'); await page.waitForSelector('.modal:has-text("Costo (aprox.)")');
    const rm = await page.textContent('.modal'); assert.match(rm, /29\.200 Gs\./); assert.match(rm, /88\.3%/); assert.match(rm, /Rosa roja/);
    await shot('5-receta');
    await page.fill('input[aria-label="Cantidad de Rosa roja"]', '10'); await page.waitForSelector('.modal .stat:has-text("27.200 Gs.")'); await page.click('.modal-foot button.primary'); await toast('Receta guardada');
    assert.equal((await app.pool.query(`SELECT qty FROM recipe_components WHERE component_product_id = $1`, [F.rosa])).rows[0].qty, 10);
    ok('la receta muestra costo 29.200 y margen 88,3 %; al cambiar 12→10 rosas el costo se recalcula (27.200) y se guarda');

    // ── 9. clientes ──
    await go('Clientes', 'Clientes'); await page.waitForSelector('td:has-text("Juan Pérez")');
    assert.equal(await page.textContent('tr:has-text("Juan Pérez") td[data-label="Compras"]'), '1', 'la venta anulada no cuenta');
    assert.match(await page.textContent('tr:has-text("Juan Pérez") td[data-label="Total comprado"]'), /^250\.000 Gs\.$/);
    await page.click('a:has-text("Juan Pérez")'); await page.waitForSelector('h1:has-text("Juan Pérez")');
    await page.click('section:has(h2:has-text("Direcciones")) button:has-text("Agregar")'); await page.fill('#a-addr', 'Av. España 100'); await page.fill('#a-zone', 'Centro'); await page.click('.modal-foot button.primary'); await toast('Dirección guardada');
    await page.click('section:has(h2:has-text("Destinatarios habituales")) button:has-text("Agregar")'); await page.fill('#r-name', 'María González'); await page.fill('#r-addr', 'Villa Morra'); await page.click('.modal-foot button.primary'); await toast('Destinatario guardado');
    await page.waitForSelector('li:has-text("María González")'); await page.waitForSelector('li:has-text("Av. España 100")');
    assert.match(await page.textContent('h1'), /Juan Pérez/);
    await shot('6-cliente'); await noGarbage();
    ok('ficha de cliente: totales reales; destinatario (María González) guardado aparte del cliente (Juan Pérez)');

    // ── 10. dashboard ──
    await go('Dashboard', 'Hola'); await page.waitForSelector('.stat'); const dash = await page.textContent('#view'); assert.match(dash, /Ventas de hoy/); assert.match(dash, /Caja/); assert.match(dash, /Ventas del mes/); await noGarbage();
    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
    ok('dashboard con ventas y caja reales; integridad de inventario intacta');

    // ── 11. permisos: florista y vendedor ──
    await page.click('.user-btn'); await page.click('button:has-text("Cerrar sesión")'); await page.waitForSelector('#login-email');
    await page.fill('#login-email', 'florista@serafina.test'); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar');
    const fNav = await page.locator('.sidebar .nav-link').allTextContents(); for (const x of ['Nueva venta', 'Historial de ventas', 'Caja', 'Clientes', 'Cuentas por cobrar']) assert.ok(!fNav.includes(x), `florista no debería ver ${x}`);
    for (const h of ['#/caja', '#/clientes', '#/ventas', '#/ventas/nueva']) { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForSelector('text=Sin acceso'); }
    assert.equal(await page.evaluate(async () => (await fetch('/api/v1/sales', { credentials: 'same-origin' })).status), 403);
    await page.click('.user-btn'); await page.click('button:has-text("Cerrar sesión")'); await page.waitForSelector('#login-email');
    await page.fill('#login-email', 'vendedor@serafina.test'); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar');
    await go('Caja', 'Caja'); await page.waitForSelector('.stat'); assert.equal(await page.locator('button:has-text("Cerrar caja")').count(), 0); assert.equal(await page.locator('button:has-text("Retiro")').count(), 0);
    await go('Historial de ventas', 'Ventas'); await page.click('a:has-text("V-000002")'); await page.waitForSelector('h1:has-text("V-000002")');
    assert.doesNotMatch(await page.textContent('#view'), /Margen/); assert.equal(await page.locator('th:has-text("Costo")').count(), 0);
    ok('florista no accede a ventas/caja/clientes (UI, URL y API); vendedor ve la caja sin operarla y NO ve costos ni márgenes');

    // ── 12. móvil ──
    await page.setViewportSize({ width: 390, height: 850 }); await go2('Nueva venta', 'Nueva venta'); await page.waitForSelector('button.pos-card'); await page.click('button.pos-card'); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'POS sin scroll horizontal'); await shot('7-movil-pos');
    ok('móvil: el POS no tiene scroll horizontal');
    async function go2(label, h1) { await page.click('.menu-btn'); await page.click(`a.nav-link:has-text("${label}")`); await page.waitForSelector(`h1:has-text("${h1}")`); }

    assert.deepEqual(problems, [], problems.join(' | ')); ok('sin errores de consola ni CSP');
    console.log('\nSALES E2E OK');
  } catch (e) { await page.screenshot({ path: path.join(SHOTS, 's-FALLO.png') }).catch(() => {}); console.error('\nSALES E2E FALLÓ en el paso', n + 1, '\n', e.message, '\nconsola:', problems); process.exitCode = 1; }
  finally { await browser.close(); await app.close_all(); }
})();
