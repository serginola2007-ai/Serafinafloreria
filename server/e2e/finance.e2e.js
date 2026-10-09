'use strict';
/** Finanzas en Chromium real: categorías, gasto en efectivo (caja), resumen con costo congelado, anulación y permisos. */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { chromium } = require('playwright');
const { makeApp, createUser, login: apiLogin, call, PASSWORD } = require('../test/helpers');
const { setupFlowers } = require('../test/fixtures');

const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (m) => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const app = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4330', API_URL: 'http://127.0.0.1:4330', ADMIN_URL: 'http://127.0.0.1:4330/admin' });
  await app.listen({ port: 4330, host: '127.0.0.1' });
  await createUser(app, { email: 'admin@serafina.test', role: 'administrador', fullName: 'Admin Serafina' });
  await createUser(app, { email: 'vendedor@serafina.test', role: 'ventas', fullName: 'Vera Vendedora' });
  const admin = await apiLogin(app, 'admin@serafina.test'); const F = await setupFlowers(app, admin);
  await call(app, admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 100000 });
  await call(app, admin, 'POST', '/api/v1/sales', { items: [{ variantId: F.variantId, qty: 2 }], payments: [{ methodCode: 'transferencia', amountPyg: 500000 }] });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|net::|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const toast = (t) => page.waitForSelector(`.toast:has-text("${t}")`);
  try {
    await page.goto('http://127.0.0.1:4330/admin/'); await page.fill('#login-email', 'admin@serafina.test'); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar');
    await page.click('a.nav-link:has-text("Finanzas")'); await page.waitForSelector('h1:has-text("Finanzas")'); await page.waitForSelector('.stat:has-text("Ventas")');
    assert.match(await page.textContent('#view'), /441\.600 Gs\./); assert.doesNotMatch(await page.textContent('#view'), /\bfalse\b|undefined|NaN|\[object/);
    ok('el resumen muestra ventas 500.000, costo 58.400 y margen 441.600 (datos reales)');

    await page.click('button:has-text("Registrar gasto")'); await toast('Primero creá una categoría'); await page.waitForSelector('input[aria-label="Nombre de categoría"]');
    await page.fill('input[aria-label="Nombre de categoría"]', 'Servicios'); await page.click('.modal button:has-text("Agregar")'); await page.waitForSelector('.modal li:has-text("Servicios")'); await page.keyboard.press('Escape');
    ok('sin categorías pide crear una; crea "Servicios"');

    await page.click('button:has-text("Registrar gasto")'); await page.fill('#ex-con', 'Factura de luz'); await page.fill('#ex-a', '40.000'); await page.selectOption('#ex-m', 'efectivo'); await page.click('.modal-foot button.primary'); await toast('Gasto registrado');
    await page.waitForSelector('tr:has-text("Factura de luz"), .card:has-text("Factura de luz")');
    assert.match(await page.textContent('#view'), /Resultado operativo/); assert.match(await page.textContent('#view'), /401\.600 Gs\./);
    const cm = (await app.pool.query(`SELECT amount_pyg FROM cash_movements WHERE type='gasto'`)).rows; assert.deepEqual(cm.map((r) => Number(r.amount_pyg)), [-40000]);
    ok('gasto en efectivo: sale de la caja (−40.000) y el resultado pasa a 401.600');

    await page.click('button:has-text("Anular")'); await page.fill('#xv-r', 'Duplicado'); await page.click('.modal-foot button.danger'); await toast('Gasto anulado');
    await page.waitForSelector('.badge:has-text("Anulado")'); assert.match(await page.textContent('#view'), /441\.600 Gs\./);
    assert.equal(Number((await app.pool.query(`SELECT COALESCE(sum(amount_pyg),0) AS s FROM cash_movements`)).rows[0].s), 100000);
    ok('anular devuelve el efectivo a la caja y el resultado vuelve a 441.600');

    await page.click('.user-btn'); await page.click('button:has-text("Cerrar sesión")'); await page.waitForSelector('#login-email');
    await page.fill('#login-email', 'vendedor@serafina.test'); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar');
    assert.ok(!(await page.locator('.sidebar .nav-link').allTextContents()).includes('Finanzas'));
    await page.evaluate(() => { location.hash = '#/finanzas'; }); await page.waitForSelector('text=Sin acceso');
    assert.equal(await page.evaluate(async () => (await fetch('/api/v1/finance/summary', { credentials: 'same-origin' })).status), 403);
    ok('ventas no ve Finanzas (menú, URL ni API)');
    assert.deepEqual(problems, [], problems.join(' | ')); ok('sin errores de consola ni CSP');
    console.log('\nFINANCE E2E OK');
  } catch (e) { await page.screenshot({ path: path.join(SHOTS, 'f-FALLO.png') }).catch(() => {}); console.error('\nFINANCE E2E FALLÓ en el paso', n + 1, '\n', e.message, '\nconsola:', problems); process.exitCode = 1; }
  finally { await browser.close(); await app.close_all(); }
})();
