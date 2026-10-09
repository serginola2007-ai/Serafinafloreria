'use strict';
/** Evento → cotización con ítems de catálogo y libres → envío → aceptación → conversión a pedido, en Chromium real. */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { chromium } = require('playwright');
const { makeApp, createUser, login: apiLogin, call, PASSWORD } = require('../test/helpers');
const { setupFlowers } = require('../test/fixtures');

const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (m) => console.log(`  ✔ ${++n}. ${m}`);
const fut = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

(async () => {
  const app = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4331', API_URL: 'http://127.0.0.1:4331', ADMIN_URL: 'http://127.0.0.1:4331/admin' });
  await app.listen({ port: 4331, host: '127.0.0.1' });
  await createUser(app, { email: 'admin@serafina.test', role: 'administrador', fullName: 'Admin Serafina' });
  const admin = await apiLogin(app, 'admin@serafina.test'); await setupFlowers(app, admin);
  await call(app, admin, 'POST', '/api/v1/customers', { name: 'Empresa Eventos SA', phone: '021 555 000' });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|net::|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const toast = (t) => page.waitForSelector(`.toast:has-text("${t}")`);
  const pick = async () => { await page.fill('input[aria-label="Buscar cliente"]', 'Empresa'); await page.click('.menu-item:has-text("Empresa Eventos SA")'); };
  try {
    await page.goto('http://127.0.0.1:4331/admin/'); await page.fill('#login-email', 'admin@serafina.test'); await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar');
    await page.click('a.nav-link:has-text("Eventos")'); await page.waitForSelector('h1:has-text("Eventos y cotizaciones")');
    await page.click('button:has-text("Nuevo evento")'); await pick(); await page.fill('#ev-n', 'Boda Gómez'); await page.selectOption('#ev-t', 'casamiento'); await page.fill('#ev-v', 'Quinta Los Pinos'); await page.click('.modal-foot button.primary'); await toast('Evento creado');
    await page.waitForSelector('tr:has-text("Boda Gómez"), .card:has-text("Boda Gómez")'); ok('crea el evento Boda Gómez');

    await page.click('a:has-text("Nueva cotización")'); await page.waitForSelector('h1:has-text("Nueva cotización")'); await pick();
    await page.waitForSelector('#qf-ev option:nth-child(2)', { state: 'attached' }); await page.selectOption('#qf-ev', { index: 1 });
    await page.fill('input[aria-label="Buscar producto"]', 'Bouquet'); await page.click('.menu-item:has-text("Bouquet Romántico")');
    await page.fill('input[aria-label="Descripción del ítem libre"]', 'Montaje'); await page.fill('input[aria-label="Precio del ítem libre"]', '300.000'); await page.click('button:has-text("Agregar ítem libre")');
    await page.fill('#qf-v', fut(7)); assert.match(await page.textContent('#view'), /Total 550\.000 Gs\./);
    await page.click('button:has-text("Crear cotización")'); await page.waitForSelector('h1:has-text("C-000001")'); ok('cotización C-000001 con ítem de catálogo y libre (550.000 Gs.)');

    await page.click('button:has-text("Marcar como enviada")'); await toast('Hecho'); await page.waitForSelector('.badge:has-text("Enviada")');
    await page.click('button:has-text("Cliente aceptó")'); await toast('Hecho'); await page.waitForSelector('.badge:has-text("Aceptada")');
    await page.click('button:has-text("Convertir en pedido")'); await page.fill('#qc-d', fut(10)); await page.click('.modal-foot button.primary');
    await page.waitForSelector('.modal .form-error:has-text("ítems libres")'); ok('con ítems libres no permite convertir (no inventa stock ni receta)');
    await page.keyboard.press('Escape');

    // segunda cotización solo catálogo → conversión
    await page.click('a.nav-link:has-text("Eventos")'); await page.click('a:has-text("Nueva cotización")'); await pick();
    await page.fill('input[aria-label="Buscar producto"]', 'Bouquet'); await page.click('.menu-item:has-text("Bouquet Romántico")'); await page.fill('#qf-v', fut(7)); await page.click('button:has-text("Crear cotización")'); await page.waitForSelector('h1:has-text("C-000002")');
    await page.click('button:has-text("Marcar como enviada")'); await page.waitForSelector('.badge:has-text("Enviada")'); await page.click('button:has-text("Cliente aceptó")'); await page.waitForSelector('.badge:has-text("Aceptada")');
    await page.click('button:has-text("Convertir en pedido")'); await page.fill('#qc-d', fut(10)); await page.click('.modal-foot button.primary'); await toast('Pedido P-000001 creado');
    await page.waitForSelector('a:has-text("P-000001")'); const o = (await app.pool.query(`SELECT channel, status, total_pyg FROM orders WHERE number='P-000001'`)).rows[0];
    assert.deepEqual([o.channel, o.status, Number(o.total_pyg)], ['evento', 'pendiente', 250000]); ok('la cotización de catálogo se convierte en el pedido P-000001 (canal evento)');
    assert.deepEqual(problems, [], problems.join(' | ')); ok('sin errores de consola ni CSP');
    console.log('\nEVENTS E2E OK');
  } catch (e) { await page.screenshot({ path: path.join(SHOTS, 'e-FALLO.png') }).catch(() => {}); console.error('\nEVENTS E2E FALLÓ en el paso', n + 1, '\n', e.message, '\nconsola:', problems); process.exitCode = 1; }
  finally { await browser.close(); await app.close_all(); }
})();
