'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call, multipart, PNG_1PX } = require('./helpers');

async function upload(app, s, opts) {
  const m = multipart(opts);
  return app.inject({ method: 'POST', url: '/api/v1/media', payload: m.payload, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': m.contentType } });
}

describe('archivos subidos (object storage)', () => {
  let app, mk, admin;
  before(async () => {
    app = await makeApp({ UPLOAD_MAX_BYTES: '4096' });
    mk = await userWithRole(app, 'marketing', 'mk@test.local');
    admin = await userWithRole(app, 'administrador', 'admin@test.local');
  });
  after(async () => { await app.close_all(); });

  test('subida válida: guarda en storage con nombre generado, registra en base y audita', async () => {
    const r = await upload(app, mk, { filename: '../../etc/pasword Mi Foto.PNG', content: PNG_1PX, fields: { altText: 'Ramo rojo' } });
    assert.equal(r.statusCode, 201, r.body);
    const j = r.json();
    assert.match(j.url, /^https:\/\/cdn\.test\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    assert.equal(j.mime, 'image/png'); assert.equal(j.altText, 'Ramo rojo'); assert.equal(j.reused, false);
    assert.ok(!j.originalName.includes('/') && !j.originalName.includes('..') || !j.originalName.includes('/'));
    assert.equal(app.storage.objects.size, 1);
    const a = await app.pool.query(`SELECT 1 FROM audit_logs WHERE action='media.uploaded'`);
    assert.equal(a.rowCount, 1);
  });
  test('misma imagen = se reutiliza (no se duplica)', async () => {
    const r = await upload(app, mk, { filename: 'otra.png', content: PNG_1PX });
    assert.equal(r.json().reused, true); assert.equal(app.storage.objects.size, 1);
  });
  test('rechaza: tipo no permitido, extensión que no coincide, contenido falso, SVG, ejecutable, PDF público', async () => {
    const cases = [
      { filename: 'x.exe', mime: 'application/x-msdownload', content: Buffer.from('MZ....') },
      { filename: 'x.svg', mime: 'image/svg+xml', content: Buffer.from('<svg onload=alert(1)/>') },
      { filename: 'x.png', mime: 'image/jpeg', content: PNG_1PX },
      { filename: 'x.png', mime: 'image/png', content: Buffer.from('esto no es un png') },
      { filename: 'x.html.png', mime: 'image/png', content: Buffer.from('<script>alert(1)</script>') },
      { filename: 'doc.pdf', mime: 'application/pdf', content: Buffer.from('%PDF-1.4 x'), fields: { isPublic: 'true' } },
    ];
    for (const c of cases) { const r = await upload(app, mk, c); assert.equal(r.statusCode, 400, c.filename + ' → ' + r.body); assert.equal(r.json().error.code, 'INVALID_FILE'); }
    assert.equal(app.storage.objects.size, 1);
  });
  test('límite de tamaño → 413 y nada se guarda', async () => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(10000)]);
    const r = await upload(app, mk, { filename: 'grande.png', content: big });
    assert.equal(r.statusCode, 413);
    assert.equal(app.storage.objects.size, 1);
  });
  test('permisos: sin sesión 401, sin media.upload 403, CSRF exigido', async () => {
    const m = multipart({ content: PNG_1PX });
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/media', payload: m.payload, headers: { 'content-type': m.contentType } })).statusCode, 401);
    const rep = await userWithRole(app, 'repartidor');
    assert.equal((await upload(app, rep, { content: PNG_1PX })).statusCode, 403);
    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/media', payload: m.payload, headers: { cookie: mk.cookie, 'content-type': m.contentType } });
    assert.equal(noCsrf.statusCode, 403);
  });
  test('archivo privado: sin URL pública; URL firmada temporal solo con media.view', async () => {
    const pdf = await upload(app, mk, { filename: 'contrato.pdf', mime: 'application/pdf', content: Buffer.from('%PDF-1.4 contenido'), fields: { isPublic: 'false' } });
    assert.equal(pdf.statusCode, 201); assert.equal(pdf.json().url, null);
    const rep = await userWithRole(app, 'repartidor', 'rep2@test.local');
    assert.equal((await call(app, rep, 'GET', `/api/v1/media/${pdf.json().id}/url`)).statusCode, 403);
    const u = (await call(app, mk, 'GET', `/api/v1/media/${pdf.json().id}/url`)).json();
    assert.match(u.url, /sig=/); assert.equal(u.expiresInSeconds, 300);
    const list = (await call(app, mk, 'GET', '/api/v1/media')).json();
    assert.ok(list.data.find((x) => x.id === pdf.json().id).url === null);
  });
  test('eliminación: requiere media.delete, bloquea si está en uso, archiva la fila y borra el objeto', async () => {
    const m = await upload(app, mk, { filename: 'b.png', content: Buffer.concat([PNG_1PX, Buffer.from('x')]) });
    assert.equal(m.statusCode, 201, m.body);
    const id = m.json().id; const key = (await app.pool.query('SELECT storage_key FROM media WHERE id=$1', [id])).rows[0].storage_key;
    const vend = await userWithRole(app, 'ventas', 'v@test.local');
    assert.equal((await call(app, vend, 'DELETE', `/api/v1/media/${id}`)).statusCode, 403);

    await app.pool.query(`INSERT INTO product_categories(slug,name) VALUES ('c','C')`);
    const p = await app.pool.query(`INSERT INTO products(slug,name,category_id) VALUES ('p','P',1) RETURNING id`);
    await app.pool.query('INSERT INTO product_media(product_id, media_id) VALUES ($1,$2)', [p.rows[0].id, id]);
    const inUse = await call(app, mk, 'DELETE', `/api/v1/media/${id}`);
    assert.equal(inUse.statusCode, 409); assert.equal(inUse.json().error.code, 'MEDIA_IN_USE');
    assert.ok(app.storage.objects.has(key));

    await app.pool.query('DELETE FROM product_media WHERE media_id=$1', [id]);
    assert.equal((await call(app, mk, 'DELETE', `/api/v1/media/${id}`)).statusCode, 200);
    assert.ok(!app.storage.objects.has(key), 'objeto borrado del storage');
    assert.ok((await app.pool.query('SELECT archived_at FROM media WHERE id=$1', [id])).rows[0].archived_at, 'fila archivada, no borrada');
    assert.equal((await call(app, mk, 'DELETE', `/api/v1/media/${id}`)).statusCode, 404);
  });
  test('sin STORAGE configurado, la subida responde 503 explícito (no falla en silencio)', async () => {
    const a2 = await makeApp({ STORAGE_DRIVER: 'none' });
    const s = await userWithRole(a2, 'marketing', 'mk@test.local');
    const r = await upload(a2, s, { content: PNG_1PX });
    assert.equal(r.statusCode, 503); assert.equal(r.json().error.code, 'STORAGE_NOT_CONFIGURED');
    await a2.close_all();
  });
});
