'use strict';
/** Inventario + proveedores + compras en Chromium real: el flujo "stock bajo → orden → recepción → costo → cuenta por pagar". */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { chromium } = require('playwright');
const { makeApp, createUser, PASSWORD } = require('../test/helpers');
const inv = require('../src/modules/inventory/service');

const { clickNav } = require('./nav');
const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (m) => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const app = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4327', API_URL: 'http://127.0.0.1:4327', ADMIN_URL: 'http://127.0.0.1:4327/admin' });
  await app.listen({ port: 4327, host: '127.0.0.1' });
  await createUser(app, { email: 'admin@serafina.test', role: 'administrador', fullName: 'Admin Serafina' });
  await createUser(app, { email: 'florista@serafina.test', role: 'florista', fullName: 'Flora Florista' });
  await app.pool.query(`INSERT INTO product_categories(slug, name) VALUES ('flores', 'Flores')`);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|net::|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const shot = (x) => page.screenshot({ path: path.join(SHOTS, `i-${x}.png`) });
  const login = async (email) => { await page.goto('http://127.0.0.1:4327/admin/'); await page.waitForSelector('#login-email'); await page.fill('#login-email', email); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.app-nav'); };
  const go = async (label, h1) => { await clickNav(page, label); await page.waitForSelector(`h1:has-text("${h1}")`); await page.waitForTimeout(200); };
  const noGarbage = async () => assert.doesNotMatch(await page.textContent('#view'), /\bfalse\b|undefined|\[object|NaN/);
  const toast = (t) => page.waitForSelector(`.toast:has-text("${t}")`);
  const pickProduct = async (text) => { await page.fill('input[aria-label="Buscar producto"]', text.split(' ')[0]); await page.waitForSelector(`select[aria-label="Producto"] option:has-text("${text}")`, { state: 'attached' }); await page.selectOption('select[aria-label="Producto"]', { label: text }); };

  try {
    await login('admin@serafina.test');
    const nav = await page.locator('.app-nav .nav-link').allTextContents();
    for (const x of ['Stock', 'Movimientos', 'Merma', 'Órdenes de compra', 'Proveedores', 'Cuentas por pagar']) assert.ok(nav.includes(x), x);

    // ── 1. insumo nuevo desde Stock ──
    await go('Stock', 'Stock');
    await page.click('button:has-text("Nuevo insumo")'); await page.fill('#n-name', 'Rosa roja'); await page.fill('#n-unit', 'tallo'); await page.fill('#n-min', '30');
    await page.click('.modal-foot button.primary'); await toast('Insumo creado');
    await page.waitForSelector('td:has-text("Rosa roja")'); await page.waitForSelector('.badge:has-text("Agotado")');
    ok('crea un insumo desde Inventario (queda agotado, con mínimo 30)');

    // ── 2. proveedor ──
    await go('Proveedores', 'Proveedores');
    await page.click('button:has-text("Nuevo proveedor")'); await page.fill('#s-name', 'Flores del Sol'); await page.fill('#s-ruc', '80012345-6'); await page.fill('#s-terms', '15');
    await page.click('.modal-foot button.primary'); await toast('Proveedor creado'); await page.waitForSelector('td:has-text("Flores del Sol")');
    ok('crea proveedor con RUC y plazo de pago');

    // ── 3. orden de compra ──
    await go('Órdenes de compra', 'Órdenes de compra');
    await page.click('a:has-text("Nueva orden")'); await page.waitForSelector('#o-sup');
    await page.selectOption('#o-sup', { label: 'Flores del Sol' });
    await pickProduct('Rosa roja (tallo)');
    await page.fill('input[aria-label="Cantidad"]', '100'); await page.fill('input[aria-label="Costo unitario"]', '1.000');
    await page.waitForSelector('text=Subtotal 100.000 Gs.');
    await page.click('button:has-text("Crear orden")'); await toast('creada'); await page.waitForSelector('h1:has-text("OC-000001")');
    assert.match(await page.textContent('#view'), /Total: 100\.000 Gs\./);
    await shot('1-orden');
    ok('crea una orden de compra (borrador) con subtotales en guaraníes');

    await page.click('button:has-text("Marcar como enviada")'); await toast('enviada'); await page.waitForSelector('.badge:has-text("Enviada")');

    // ── 4. recepción parcial ──
    await page.click('button:has-text("Recibir mercadería")'); await page.waitForSelector('.modal');
    await page.fill('input[aria-label="Cantidad recibida de Rosa roja"]', '60'); await page.fill('input[aria-label="Costo real de Rosa roja"]', '1.100');
    await page.fill('#r-inv', '001-001-0000123');
    await page.click('.modal-foot button.primary'); await toast('Recepción RC-000001');
    await page.waitForSelector('.badge:has-text("Recibida parcial")');
    assert.match(await page.textContent('#view'), /66\.000 Gs\./);
    ok('recepción parcial: estado "Recibida parcial", total de la factura 66.000 Gs.');

    await go('Stock', 'Stock'); await page.waitForSelector('td:has-text("Rosa roja")');
    const row = await page.textContent('tr:has-text("Rosa roja")');
    assert.match(row, /60 tallo/); assert.match(row, /1\.100 Gs\./); assert.match(row, /66\.000 Gs\./);
    await shot('2-stock');
    ok('Stock refleja 60 tallos, costo promedio 1.100 Gs. y valor 66.000 Gs.');

    // ── 5. cuentas por pagar ──
    await go('Cuentas por pagar', 'Cuentas por pagar'); await page.waitForSelector('td:has-text("Flores del Sol")');
    assert.match(await page.textContent('#view'), /66\.000 Gs\./);
    await page.click('button:has-text("Registrar pago")'); await page.fill('#p-amt', '30.000'); await page.selectOption('#p-method', 'transferencia'); await page.fill('#p-ref', 'TRF 123');
    await page.click('.modal-foot button.primary'); await toast('Pago registrado');
    await page.waitForSelector('td:has-text("36.000 Gs.")');
    await page.click('button:has-text("Registrar pago")'); await page.fill('#p-amt', '99.999'); await page.click('.modal-foot button.primary');
    await page.waitForSelector('#p-amt-err:not([hidden])');
    ok('pago parcial descuenta el saldo (36.000 Gs.); un sobrepago se rechaza'); await page.click('.modal-head button');

    // ── 6. ajuste y merma → alertas ──
    await go('Stock', 'Stock'); await page.waitForSelector('td:has-text("Rosa roja")');
    await page.click('tr:has-text("Rosa roja") button:has-text("Ajustar")'); await page.selectOption('#a-dir', 'out'); await page.fill('#a-qty', '5'); await page.fill('#a-reason', 'Conteo físico');
    await page.click('.modal-foot button.primary'); await toast('Ajuste registrado');
    await page.click('tr:has-text("Rosa roja") button:has-text("Merma")'); await page.fill('#w-qty', '30'); await page.selectOption('#w-reason', 'flor_marchita'); await page.fill('#w-note', 'Calor');
    await page.click('.modal-foot button.primary'); await toast('Merma registrada');
    await page.waitForSelector('.badge:has-text("Stock bajo")'); await page.waitForSelector('button:has-text("Bajo mínimo: 1")');
    assert.match(await page.textContent('tr:has-text("Rosa roja")'), /25 tallo/);
    await shot('3-alerta');
    ok('ajuste (−5) y merma (−30) dejan 25 tallos → alerta "Stock bajo" visible');

    await page.click('tr:has-text("Rosa roja") button:has-text("Ajustar")'); await page.selectOption('#a-dir', 'out'); await page.fill('#a-qty', '999'); await page.fill('#a-reason', 'Prueba exceso');
    await page.click('.modal-foot button.primary'); await page.waitForSelector('#a-qty-err:not([hidden])');
    assert.match(await page.textContent('#a-qty-err'), /Stock insuficiente/); await page.click('.modal-head button');
    ok('no deja sacar más stock del disponible');

    await go('Merma', 'Merma'); await page.waitForSelector('td:has-text("Flor marchita")');
    assert.match(await page.textContent('#view'), /33\.000 Gs\./);
    await shot('4-merma');
    ok('reporte de merma: 30 × 1.100 = 33.000 Gs. por motivo, producto y usuario');

    await go('Movimientos', 'Movimientos de inventario'); await page.waitForSelector('td:has-text("Compra")');
    const mv = await page.textContent('tbody'); assert.match(mv, /Compra/); assert.match(mv, /Merma/); assert.match(mv, /Ajuste \(−\)/);
    ok('historial de movimientos con compra, merma y ajuste');

    await go('Dashboard', 'Hola'); await page.waitForSelector('.stat');
    const dash = await page.textContent('#view'); assert.match(dash, /Stock bajo mínimo/); assert.match(dash, /Por pagar a proveedores/); assert.match(dash, /36\.000 Gs\./);
    await noGarbage(); ok('el dashboard muestra stock bajo y deuda con proveedores (datos reales)');

    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
    ok('integridad: stock físico = Σ lotes = Σ movimientos');

    // ── 7. rol Florista ──
    await page.click('.user-btn'); await page.click('button:has-text("Cerrar sesión")'); await page.waitForSelector('#login-email');
    await page.fill('#login-email', 'florista@serafina.test'); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.app-nav');
    const fNav = await page.locator('.app-nav .nav-link').allTextContents();
    assert.ok(fNav.includes('Stock') && fNav.includes('Merma') && !fNav.includes('Órdenes de compra') && !fNav.includes('Proveedores') && !fNav.includes('Cuentas por pagar'), fNav.join(','));
    await page.evaluate(() => { location.hash = '#/compras'; }); await page.waitForSelector('text=Sin acceso');
    await go('Stock', 'Stock'); await page.waitForSelector('td:has-text("Rosa roja")');
    assert.equal(await page.locator('button:has-text("Ajustar")').count(), 0); assert.ok(await page.locator('button:has-text("Merma")').count() > 0);
    const st403 = await page.evaluate(async () => (await fetch('/api/v1/purchase-orders', { credentials: 'same-origin' })).status); assert.equal(st403, 403);
    ok('rol Florista: ve stock y puede mermar, sin ajustar ni acceder a compras (URL directa y API → denegado)');

    // ── 8. móvil ──
    await page.setViewportSize({ width: 390, height: 800 }); await page.reload(); await page.waitForSelector('td:has-text("Rosa roja")'); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'scroll horizontal en Stock');
    await shot('5-movil-stock');
    ok('móvil: Stock sin scroll horizontal');

    assert.deepEqual(problems, [], problems.join(' | ')); ok('sin errores de consola ni CSP');
    console.log('\nINVENTORY E2E OK');
  } catch (e) { await page.screenshot({ path: path.join(SHOTS, 'i-FALLO.png') }).catch(() => {}); console.error('\nINVENTORY E2E FALLÓ en el paso', n + 1, '\n', e.message, '\nconsola:', problems); process.exitCode = 1; }
  finally { await browser.close(); await app.close_all(); }
})();
