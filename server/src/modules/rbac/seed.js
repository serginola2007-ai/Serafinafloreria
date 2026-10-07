'use strict';
const { PERMISSIONS, ROLES } = require('./catalog');

/**
 * Sincroniza permisos y roles del catálogo. Idempotente.
 * - Permisos nuevos se insertan; permisos que ya no existen en el catálogo se eliminan (cascade a roles/usuarios).
 * - Los permisos de roles de sistema solo se siembran la PRIMERA vez que el rol se crea:
 *   así los ajustes hechos luego por el Administrador no se pisan en cada deploy.
 */
async function seedRbac(client) {
  for (const p of PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions(code,module,description) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module, description=EXCLUDED.description`, [p.code, p.module, p.description]);
  }
  await client.query('DELETE FROM permissions WHERE code <> ALL($1::text[])', [PERMISSIONS.map((p) => p.code)]);

  for (const r of ROLES) {
    const ins = await client.query(
      `INSERT INTO roles(code,name,description,is_system,is_superuser) VALUES ($1,$2,$3,true,$4)
       ON CONFLICT (code) DO NOTHING RETURNING id`, [r.code, r.name, r.description, !!r.is_superuser]);
    if (ins.rowCount === 1 && r.permissions.length) {
      await client.query(
        `INSERT INTO role_permissions(role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`, [ins.rows[0].id, r.permissions]);
    } else if (ins.rowCount === 0) {
      await client.query('UPDATE roles SET name=$2, description=$3 WHERE code=$1', [r.code, r.name, r.description]);
    }
  }
}
module.exports = { seedRbac };
