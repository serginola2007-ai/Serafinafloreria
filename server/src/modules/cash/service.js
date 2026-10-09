'use strict';
const { conflict } = require('../../lib/errors');

/** Caja abierta (bloqueada FOR SHARE: los movimientos pueden convivir, pero el cierre espera a que terminen). */
async function requireOpenSession(db) {
  const { rows } = await db.query('SELECT * FROM cash_sessions WHERE closed_at IS NULL FOR SHARE');
  if (!rows.length) throw conflict('La caja está cerrada. Abrí la caja para operar con efectivo.', 'CASH_CLOSED');
  return rows[0];
}
const currentSession = async (db) => (await db.query('SELECT * FROM cash_sessions WHERE closed_at IS NULL')).rows[0] ?? null;
const expectedCash = async (db, sessionId) => Number((await db.query('SELECT COALESCE(sum(amount_pyg), 0)::bigint AS s FROM cash_movements WHERE session_id = $1', [sessionId])).rows[0].s);

/** Registra un movimiento de efectivo (signo: + entra, − sale). Impide dejar la caja en negativo. */
async function addCashMovement(tx, { sessionId, type, amountPyg, concept = null, referenceType = null, referenceId = null, userId = null }) {
  if (!Number.isSafeInteger(amountPyg) || amountPyg === 0) throw new TypeError('amountPyg inválido');
  if (amountPyg < 0) {
    const have = await expectedCash(tx, sessionId);
    if (have + amountPyg < 0) throw conflict(`No hay suficiente efectivo en caja (hay ${have} Gs.)`, 'INSUFFICIENT_CASH', { availablePyg: have, requiredPyg: -amountPyg });
  }
  const { rows } = await tx.query(
    `INSERT INTO cash_movements(session_id, type, amount_pyg, concept, reference_type, reference_id, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [sessionId, type, amountPyg, concept, referenceType, referenceId, userId]);
  return rows[0].id;
}
module.exports = { requireOpenSession, currentSession, expectedCash, addCashMovement };
