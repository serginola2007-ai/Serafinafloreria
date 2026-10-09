'use strict';
/**
 * Prueba de punta a punta del panel en Chromium real (servidor + PostgreSQL de pruebas).
 *   NODE_PATH=<ruta global de node_modules con playwright> node e2e/panel.e2e.js
 * Guarda capturas en e2e/screens/ (ignoradas por git).
 */
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { makeApp, createUser, PASSWORD } = require('../test/helpers');

const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
let step = 0; const ok = (m) => console.log(`  ✔ ${++step}. ${m}`);

(async () => {
  const real = await makeApp({ PUBLIC_URL: 'http://127.0.0.1:4321', API_URL: 'http://127.0.0.1:4321', ADMIN_URL: 'http://127.0.0.1:4321/admin' });
  await real.listen({ port: 4321, host: '127.0.0.1' });

  await createUser(real, { email: 'dueno@serafina.test', fullName: 'Dueña Serafina', role: 'administrador', mustChange: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g(oogleapis|static)|ERR_(NAME|INTERNET|CONNECTION|TUNNEL)|net::|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: false });
  const goto = (h) => page.goto(`http://127.0.0.1:4321/admin/${h || ''}`, { waitUntil: 'domcontentloaded' });

  try {
    await goto();
    await page.waitForSelector('#login-email');
    await shot('01-login');
    ok('muestra el login sin sesión');

    await page.fill('#login-email', 'dueno@serafina.test'); await page.fill('#login-pass', 'incorrecta-incorrecta'); await page.click('button[type=submit]');
    await page.waitForSelector('.form-error:not([hidden])');
    assert.match(await page.textContent('.form-error'), /Credenciales inválidas/);
    ok('credenciales erróneas → mensaje de error, sin entrar');

    await page.fill('#login-pass', PASSWORD); await page.click('button[type=submit]');
    await page.waitForSelector('#pw-cur');
    ok('primer ingreso → cambio de contraseña obligatorio (no se ve el panel)');
    assert.equal(await page.locator('.sidebar').count(), 0);
    await page.fill('#pw-cur', PASSWORD); await page.fill('#pw-new', 'corta'); await page.fill('#pw-rep', 'corta'); await page.click('button[type=submit]');
    await page.waitForSelector('#pw-new-err:not([hidden])');
    ok('contraseña débil rechazada por el servidor, con mensaje en el campo');
    await page.fill('#pw-new', 'Nueva-Clave-Muy-Segura-9'); await page.fill('#pw-rep', 'Nueva-Clave-Muy-Segura-9'); await page.click('button[type=submit]');
    await page.waitForSelector('.sidebar');
    ok('cambia la contraseña y entra al panel');

    const navText = await page.locator('.sidebar .nav-link').allTextContents();
    assert.deepEqual(navText, ['Dashboard', 'Productos', 'Categorías', 'Nueva venta', 'Historial de ventas', 'Cuentas por cobrar', 'Caja', 'Clientes', 'Pedidos', 'Producción', 'Entregas', 'Stock', 'Movimientos', 'Merma', 'Órdenes de compra', 'Proveedores', 'Cuentas por pagar', 'Finanzas', 'Usuarios', 'Roles y permisos', 'Auditoría', 'Integraciones']);
    await page.waitForSelector('.stat');
    assert.doesNotMatch(await page.textContent('#view'), /false|undefined|\[object|NaN/, 'texto basura en el dashboard');
    await shot('02-dashboard');
    ok('administrador ve todos los módulos y el dashboard con datos reales');
    assert.match(await page.textContent('.value >> nth=0'), /^\d+$/);

    // ── Usuarios: crear ──
    await page.click('a.nav-link:has-text("Usuarios")');
    await page.waitForSelector('h1:has-text("Usuarios")'); await page.waitForSelector('table.table');
    await page.click('button:has-text("Nuevo usuario")');
    await page.fill('#u-name', 'Vera Ventas'); await page.fill('#u-email', 'vera@serafina.test'); await page.selectOption('#u-role', 'ventas');
    await page.fill('#u-pass', 'corta'); await page.click('.modal-foot button.primary');
    await page.waitForSelector('#u-pass-err:not([hidden])');
    ok('alta de usuario: validación del servidor sobre el campo contraseña');
    await page.fill('#u-pass', 'Inicial-Segura-Rosa-1'); await page.click('.modal-foot button.primary');
    await page.waitForSelector('.toast:has-text("Usuario creado")');
    await page.waitForSelector('td:has-text("vera@serafina.test")');
    ok('crea usuario (persistido y visible en la lista)');

    await page.click('button:has-text("Nuevo usuario")');
    await page.fill('#u-name', 'Pedro Personalizado'); await page.fill('#u-email', 'pedro@serafina.test'); await page.selectOption('#u-role', 'personalizado');
    await page.fill('#u-pass', 'Inicial-Segura-Lirio-2'); await page.click('.modal-foot button.primary');
    await page.waitForSelector('td:has-text("pedro@serafina.test")');
    await shot('03-usuarios');

    // ── búsqueda ──
    await page.fill('input[type=search]', 'pedro');
    await page.waitForFunction(() => document.querySelectorAll('table.table tbody tr').length === 1);
    ok('búsqueda filtra desde el servidor');
    await page.fill('input[type=search]', ''); await page.waitForFunction(() => document.querySelectorAll('table.table tbody tr').length === 3);

    // ── permisos individuales ──
    await page.locator('tr', { hasText: 'pedro@serafina.test' }).locator('button:has-text("Permisos")').click();
    await page.waitForSelector('.perm-module');
    await page.selectOption('select[aria-label="integraciones.view"], select[aria-label="marketing.view"]', 'allow');
    await shot('04-permisos');
    await page.click('.modal-foot button.primary');
    await page.waitForSelector('.toast:has-text("Permisos actualizados")');
    ok('asigna permiso individual al rol Personalizado');

    // ── auditoría ──
    await page.click('a.nav-link:has-text("Auditoría")');
    await page.waitForSelector('h1:has-text("Auditoría")'); await page.waitForSelector('th:has-text("Acción")');
    const auditText = await page.locator('table.table').textContent();
    assert.match(auditText, /Creó un usuario/); assert.match(auditText, /Cambió permisos de un usuario/);
    await shot('05-auditoria');
    ok('la auditoría muestra las acciones realizadas');

    // ── roles ──
    await page.click('a.nav-link:has-text("Roles y permisos")');
    await page.waitForSelector('.perm-module');
    await shot('06-roles');
    ok('pantalla de roles carga la matriz de permisos');

    // ── paleta ──
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette input');
    const palItems = await page.locator('.palette li button').allTextContents();
    assert.ok(palItems.some((t) => /Usuarios/.test(t)) && palItems.some((t) => /Cerrar sesión/.test(t)));
    await page.keyboard.type('audit'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/auditoria');
    ok('Ctrl+K abre la paleta y navega');

    // ── logout → login con usuario de ventas ──
    await page.click('.user-btn'); await page.click('button:has-text("Cerrar sesión")');
    await page.waitForSelector('#login-email');
    await page.fill('#login-email', 'vera@serafina.test'); await page.fill('#login-pass', 'Inicial-Segura-Rosa-1'); await page.click('button[type=submit]');
    await page.waitForSelector('#pw-cur');
    await page.fill('#pw-cur', 'Inicial-Segura-Rosa-1'); await page.fill('#pw-new', 'Girasol-Seguro-Dorado-22'); await page.fill('#pw-rep', 'Girasol-Seguro-Dorado-22'); await page.click('button[type=submit]');
    await page.waitForSelector('.sidebar');
    const vNav = await page.locator('.sidebar .nav-link').allTextContents();
    assert.deepEqual(vNav, ['Dashboard', 'Productos', 'Categorías', 'Nueva venta', 'Historial de ventas', 'Cuentas por cobrar', 'Caja', 'Clientes', 'Pedidos', 'Stock', 'Movimientos', 'Merma']);
    ok('rol Ventas: el menú solo muestra lo permitido');

    await page.evaluate(() => { location.hash = '#/usuarios'; });
    await page.waitForSelector('text=Sin acceso');
    ok('URL directa a un módulo sin permiso → "Sin acceso"');
    const apiStatus = await page.evaluate(async () => (await fetch('/api/v1/users', { credentials: 'same-origin' })).status);
    assert.equal(apiStatus, 403);
    const postStatus = await page.evaluate(async () => (await fetch('/api/v1/users', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
    assert.equal(postStatus, 403);
    ok('y el backend responde 403 (GET y POST) aunque se esquive el frontend');
    await page.keyboard.press('Control+k'); await page.waitForSelector('.palette input');
    const vPal = (await page.locator('.palette li button').allTextContents()).join('|');
    assert.ok(!/Usuarios|Auditoría|Roles/.test(vPal));
    await page.keyboard.press('Escape');
    ok('la paleta de comandos tampoco ofrece lo no permitido');
    await shot('07-ventas-sin-acceso');

    // ── sesión expirada ──
    await real.pool.query(`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL`);
    await page.evaluate(() => { location.hash = '#/cuenta'; });
    await page.click('text=Mi cuenta').catch(() => {});
    await page.evaluate(() => fetch('/api/v1/auth/me').then(() => document.querySelector('.sidebar a[href="#/"]').click()));
    await page.waitForSelector('#login-email', { timeout: 8000 }).catch(async () => { await page.reload(); await page.waitForSelector('#login-email'); });
    ok('sesión revocada en el servidor → vuelve al login');

    // ── responsive móvil ──
    await page.setViewportSize({ width: 390, height: 800 });
    await page.fill('#login-email', 'dueno@serafina.test'); await page.fill('#login-pass', 'Nueva-Clave-Muy-Segura-9'); await page.click('button[type=submit]');
    await page.waitForSelector('.menu-btn');
    assert.equal(await page.locator('.sidebar').evaluate((e) => getComputedStyle(e).transform !== 'none'), true, 'sidebar fuera de pantalla');
    await page.click('.menu-btn');
    await page.waitForFunction(() => document.querySelector('.app').classList.contains('nav-open'));
    await shot('08-movil-menu');
    await page.click('a.nav-link:has-text("Usuarios")');
    await page.waitForSelector('table.table');
    const theadHidden = await page.locator('thead').evaluate((e) => getComputedStyle(e).display === 'none');
    assert.ok(theadHidden);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.ok(noOverflow, 'sin scroll horizontal en móvil');
    await page.waitForTimeout(400); await shot('09-movil-usuarios');
    ok('móvil: menú lateral, tablas como tarjetas y sin scroll horizontal');

    assert.deepEqual(problems, [], 'errores de consola / CSP: ' + problems.join(' | '));
    ok('sin errores de consola ni violaciones de CSP');
    console.log('\nE2E OK');
  } catch (e) {
    await page.screenshot({ path: path.join(SHOTS, 'FALLO.png') }).catch(() => {});
    console.error('\nE2E FALLÓ en el paso', step + 1, '\n', e.message, '\nconsola:', problems);
    process.exitCode = 1;
  } finally { await browser.close(); await real.close_all(); }
})();
