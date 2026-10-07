'use strict';
/**
 * Bootstrap controlado del primer Administrador. No existen credenciales por defecto.
 *   npm run create-admin -- --email dueño@dominio.com --name "Nombre Apellido"
 * La contraseña se pide por consola (sin eco) o, en entornos sin TTY (shell de Render), de BOOTSTRAP_ADMIN_PASSWORD.
 * Se niega a correr si ya existe un Administrador activo, salvo --allow-additional.
 */
const readline = require('node:readline');
const { parseEnv } = require('../src/config/env');
const { createPool, withTransaction } = require('../src/db/pool');
const { makeHasher, passwordProblem } = require('../src/lib/passwords');
const { seedRbac } = require('../src/modules/rbac/seed');
const { audit } = require('../src/modules/audit/audit');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : undefined; }

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const email = arg('email'); const name = arg('name');
  if (!email || !name) { console.error('Uso: npm run create-admin -- --email <email> --name "<nombre>" [--allow-additional]'); process.exit(2); }
  const config = parseEnv();
  const pool = createPool(config);
  try {
    let password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!password) {
      if (!process.stdin.isTTY) throw new Error('Sin TTY: definí BOOTSTRAP_ADMIN_PASSWORD temporalmente (y borrala después)');
      password = await askHidden('Contraseña (mín. 12 caracteres): ');
      if (password !== await askHidden('Repetí la contraseña: ')) throw new Error('Las contraseñas no coinciden');
    }
    const problem = passwordProblem(password, { email, fullName: name });
    if (problem) throw new Error(problem);
    const hash = await makeHasher(config.argonMemoryKiB).hash(password);

    const id = await withTransaction(pool, async (tx) => {
      await seedRbac(tx);
      await tx.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const { rows: ex } = await tx.query(`SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.is_superuser AND u.active`);
      if (ex[0].n > 0 && !process.argv.includes('--allow-additional')) throw new Error('Ya existe un Administrador activo (usar --allow-additional para crear otro)');
      const { rows } = await tx.query(
        `INSERT INTO users(email, full_name, password_hash, role_id, must_change_password)
         VALUES ($1,$2,$3,(SELECT id FROM roles WHERE code='administrador'), true) RETURNING id`, [email.trim(), name.trim(), hash]);
      await audit(tx, { ip: 'cli' }, { action: 'user.bootstrap_admin', entity: 'user', entityId: rows[0].id, userId: null, after: { email: email.trim(), fullName: name.trim() } });
      return rows[0].id;
    });
    console.log(`Administrador creado (id ${id}). Deberá cambiar la contraseña en el primer ingreso.`);
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
