'use strict';
/** Número correlativo atómico (sin duplicados aun con concurrencia): 'V' → V-000001. */
async function nextNumber(tx, key, prefix) {
  const { rows } = await tx.query(
    `INSERT INTO number_sequences(key, last_value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET last_value = number_sequences.last_value + 1 RETURNING last_value`, [key]);
  return `${prefix}-${String(rows[0].last_value).padStart(6, '0')}`;
}
module.exports = { nextNumber };
