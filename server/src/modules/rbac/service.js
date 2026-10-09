'use strict';

/** Permisos efectivos = (permisos del rol ∪ allow del usuario) − deny del usuario. El superusuario tiene todos. */
async function loadAccess(db, userId) {
  const { rows } = await db.query(
    `SELECT r.id AS role_id, r.code, r.name, r.is_superuser FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [userId]);
  if (!rows.length) return null;
  const role = rows[0];
  let codes;
  if (role.is_superuser) {
    codes = (await db.query('SELECT code FROM permissions')).rows.map((r) => r.code);
  } else {
    const { rows: pr } = await db.query(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1
       UNION
       SELECT p.code FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = $2 AND up.effect = 'allow'
       EXCEPT
       SELECT p.code FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = $2 AND up.effect = 'deny'`,
      [role.role_id, userId]);
    codes = pr.map((r) => r.code);
  }
  return { role: { id: role.role_id, code: role.code, name: role.name, isSuperuser: role.is_superuser }, permissions: new Set(codes) };
}

module.exports = { loadAccess };
