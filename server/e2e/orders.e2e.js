'use strict';
/** Pedido de punta a punta en Chromium real: crear, reservar, producir, asignar, entregar como repartidor (móvil) y verificar la venta. */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { chromium } = require('playwright');
const { makeApp, createUser, login: apiLogin, call, PASSWORD } = require('../test/helpers');
const { setupFlowers } = require('../test/fixtures');

const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (m) => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const app = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4329', API_URL: 'http://127.0.0.1:4329', ADMIN_URL: 'http://127.0.0.1:4329/admin' });
  await app.listen({ port: 4329, host: '127.0.0.1' });
  await createUser(app, { email: 'admin@serafina.test', role: 'administrador', fullName: 'Admin Serafina' });
  await createUser(app, { email: 'repartidor@serafina.test', role: 'repartidor', fullName: 'Rafa Repartidor' });
  const admin = await apiLogin(app, 'admin@serafina.test');
  const F = await setupFlowers(app, admin);
  await call(app, admin, 'POST', '/api/v1/customers', { name: 'Ana Gómez', phone: '0981 555 666' });
  await call(app, admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 0 });
  const rosas = async () => Number((await app.pool.query('SELECT on_hand, reserved FROM inventory_levels WHERE product_id=$1', [F.rosa])).rows[0].on_hand);
  const reserved = async () => Number((await app.pool.query('SELECT reserved FROM inventory_levels WHERE product_id=$1', [F.rosa])).rows[0].reserved);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|net::|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const shot = (x) => page.screenshot({ path: path.join(SHOTS, `o-${x}.png`) });
  const login = async (email) => { await page.goto('http://127.0.0.1:4329/admin/'); await page.waitForSelector('#login-email'); await page.fill('#login-email', email); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar'); };
  const go = async (label, h1) => { await page.click(`a.nav-link:has-text("${label}")`); await page.waitForSelector(`h1:has-text("${h1}")`); await page.waitForTimeout(250); };
  const toast = (t) => page.waitForSelector(`.toast:has-text("${t}")`);
  const noGarbage = async () => assert.doesNotMatch(await page.textContent('#view'), /\bfalse\b|undefined|\[object|NaN/);
  const future = '2099-06-01';

  try {
    await login('admin@serafina.test');
    const nav = await page.locator('.sidebar .nav-link').allTextContents(); for (const x of ['Pedidos', 'Producción', 'Entregas']) assert.ok(nav.includes(x), x);

    // 1. zona de delivery
    await go('Entregas', 'Entregas'); await page.click('button:has-text("Zonas y tarifas")');
    await page.fill('input[aria-label="Nombre de zona"]', 'Centro'); await page.fill('input[aria-label="Tarifa"]', '20.000'); await page.click('.modal button:has-text("Agregar")');
    await page.waitForSelector('.modal li:has-text("Centro")'); await page.keyboard.press('Escape'); ok('crea la zona Centro con tarifa 20.000');

    // 2. nuevo pedido
    await go('Pedidos', 'Pedidos'); await page.click('a:has-text("Nuevo pedido")'); await page.waitForSelector('h1:has-text("Nuevo pedido")');
    await page.fill('input[aria-label="Buscar cliente"]', 'Ana'); await page.click('.menu-item:has-text("Ana Gómez")');
    await page.fill('input[aria-label="Buscar producto"]', 'Bouquet'); await page.click('.menu-item:has-text("Bouquet Romántico")');
    await page.fill('#o-date', future); await page.fill('#o-rn', 'María'); await page.fill('#o-rp', '0982 000 111'); await page.fill('#o-addr', 'Av. Mcal. López 123');
    await page.selectOption('#o-zone', { label: 'Centro · 20.000 Gs.' }); await page.fill('#o-card', 'Feliz cumple');
    await shot('1-form'); await page.click('button:has-text("Crear pedido")'); await page.waitForSelector('h1:has-text("P-000001")'); await noGarbage();
    assert.match(await page.textContent('#view'), /Total 270\.000 Gs\./); assert.equal(await reserved(), 0);
    ok('crea el pedido P-000001 (270.000 Gs.) sin reservar todavía');

    // 3. confirmar → reserva
    await page.click('button:has-text("Confirmar y reservar stock")'); await toast('Hecho'); await page.waitForSelector('.badge:has-text("Confirmado")');
    assert.equal(await reserved(), 12); assert.equal(await rosas(), 100); assert.match(await page.textContent('#view'), /Rosa roja/);
    ok('al confirmar reserva 12 rosas (físico intacto)');

    // 4. cobro parcial
    await page.click('button:has-text("Registrar cobro")'); await page.fill('#op-a', '100.000'); await page.click('.modal-foot button.primary'); await toast('Cobro registrado');
    await page.waitForSelector('text=Saldo 170.000 Gs.'); ok('registra un cobro anticipado de 100.000 Gs.');

    // 5. producción
    await go('Producción', 'Producción'); await page.click('button.card:has-text("Bouquet Romántico")');
    await page.click('.modal button:has-text("Iniciar")'); await page.waitForSelector('.modal', { state: 'detached' }); await page.waitForTimeout(400);
    assert.equal(await rosas(), 88); assert.equal(await reserved(), 0);
    await page.click('button.card:has-text("Bouquet Romántico")');
    await page.waitForSelector('.modal input[type=checkbox]:not([disabled])');
    for (const c of await page.locator('.modal input[type=checkbox]:not([disabled])').all()) { const r = page.waitForResponse((x) => x.url().includes('/checklist/')); await c.check(); const rs = await r; assert.equal(rs.status(), 200); }
    await page.waitForTimeout(300); await page.click('.modal button:has-text("Pasar a control de calidad")'); await page.waitForSelector('.modal', { state: 'detached' }); await page.waitForTimeout(400); await page.click('button.card:has-text("Bouquet Romántico")'); await page.click('.modal button:has-text("Aprobar")');
    await page.waitForFunction(() => document.querySelector('#view')?.textContent.includes('Listo')); await shot('2-produccion');
    ok('producción: inicia (consume 12 rosas y libera la reserva), checklist, calidad y aprobación');

    // 6. asignar repartidor
    await go('Entregas', 'Entregas'); await page.click('button:has-text("Asignar")'); await page.selectOption('#as-c', { label: 'Rafa Repartidor' }); await page.click('.modal-foot button.primary');
    await page.waitForSelector('text=Repartidor: Rafa Repartidor'); ok('asigna al repartidor');

    // 7. repartidor en móvil
    await page.click('.user-btn'); await page.click('button:has-text("Cerrar sesión")'); await page.waitForSelector('#login-email');
    await page.setViewportSize({ width: 390, height: 850 });
    await page.fill('#login-email', 'repartidor@serafina.test'); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar, .menu-btn');
    const rn = await page.evaluate(async () => (await fetch('/api/v1/orders', { credentials: 'same-origin' })).status); assert.equal(rn, 403);
    await page.click('.menu-btn'); await page.click('a.nav-link:has-text("Entregas")'); await page.waitForSelector('h1:has-text("Mis entregas")');
    assert.match(await page.textContent('#view'), /Cobrar al entregar: 170\.000 Gs\./); assert.ok(await page.locator('a:has-text("Abrir mapa")').count());
    await page.click('button:has-text("Salir a entregar")'); await toast('Salió a entregar'); await shot('3-movil');
    await page.click('button:has-text("Entregado")'); await page.click('.modal-foot button.primary');
    await page.waitForSelector('.modal :text("Cobrá el saldo")'); ok('repartidor (móvil) sale a entregar; no puede cerrar con saldo sin cobrar ni vencimiento');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sin scroll horizontal');
    await page.keyboard.press('Escape');

    // 8. cobrar el saldo como admin y entregar
    await call(app, admin, 'POST', `/api/v1/orders/1/payments`, { methodCode: 'efectivo', amountPyg: 170000 });
    await page.reload(); await page.waitForSelector('h1:has-text("Mis entregas")'); await page.click('button:has-text("Entregado")'); await page.click('.modal-foot button.primary'); await toast('Entrega registrada');
    const sale = (await app.pool.query('SELECT s.number, s.total_pyg, s.paid_pyg FROM sales s WHERE s.order_id = 1')).rows[0];
    assert.equal(sale.total_pyg, 270000); assert.equal(Number(sale.paid_pyg), 270000);
    const cost = (await app.pool.query('SELECT cost_total_pyg, cost_known FROM sale_items WHERE sale_id = (SELECT id FROM sales WHERE order_id = 1)')).rows[0];
    assert.equal(Number(cost.cost_total_pyg), 29200); assert.equal(cost.cost_known, true); assert.equal(await rosas(), 88, 'no vuelve a descontar al entregar');
    ok(`la entrega genera la venta ${sale.number} con costo congelado de 29.200 Gs. y sin doble descuento de stock`);

    assert.deepEqual(problems, [], problems.join(' | ')); ok('sin errores de consola ni CSP');
    console.log('\nORDERS E2E OK');
  } catch (e) { console.error('TOASTS', await page.locator('.toast').allTextContents().catch(() => [])); await page.screenshot({ path: path.join(SHOTS, 'o-FALLO.png') }).catch(() => {}); console.error('\nORDERS E2E FALLÓ en el paso', n + 1, '\n', e.message, '\nconsola:', problems); process.exitCode = 1; }
  finally { await browser.close(); await app.close_all(); }
})();
