'use strict';
const argon2 = require('argon2');

const COMMON = new Set(['password1234', '123456789012', 'qwertyuiop12', 'serafina1234', 'serafina2024', 'serafina2025', 'serafina2026', 'contraseña123', 'administrador1', 'passwordpassword']);

function makeHasher(memoryKiB) {
  const opts = { type: argon2.argon2id, memoryCost: memoryKiB, timeCost: 3, parallelism: 1 };
  let dummy;
  return {
    hash: (plain) => argon2.hash(plain, opts),
    verify: async (hash, plain) => { try { return await argon2.verify(hash, plain); } catch { return false; } },
    needsRehash: (hash) => argon2.needsRehash(hash, opts),
    /** Verifica contra un hash descartable para igualar tiempos cuando el usuario no existe. */
    async verifyDummy(plain) { dummy ||= await argon2.hash('dummy-' + Math.random(), opts); await this.verify(dummy, plain); },
  };
}

/** Devuelve un mensaje de error o null si la contraseña es aceptable. */
function passwordProblem(plain, { email, fullName } = {}) {
  if (typeof plain !== 'string') return 'La contraseña es obligatoria';
  if (plain.length < 12) return 'La contraseña debe tener al menos 12 caracteres';
  if (plain.length > 128) return 'La contraseña no puede superar 128 caracteres';
  const low = plain.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(plain)) return 'La contraseña es demasiado común';
  const local = email ? String(email).split('@')[0].toLowerCase() : '';
  if (local.length >= 4 && low.includes(local)) return 'La contraseña no puede contener tu email';
  if (fullName && fullName.length >= 4 && low.includes(fullName.toLowerCase())) return 'La contraseña no puede contener tu nombre';
  return null;
}

module.exports = { makeHasher, passwordProblem };
