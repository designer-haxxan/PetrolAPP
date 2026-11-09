// Double-entry core. Every money or stock event becomes a balanced "transaction" (txnId) made of entries.
// Entries are never edited; a correction is a reversing transaction.
import { uuid, nowISO, AppError } from '../core/utils.js';
import { rnd } from '../core/money.js';
import { getSettings } from '../core/settings.js';

const TOL = 0.00005;

// Next document number for a sequence key, e.g. nextNumber(t, 'sale', 'INV') -> "INV-000123".
// Must run inside a write transaction so numbers never repeat.
export async function nextNumber(t, seqKey, prefixKey) {
  const row = (await t.get('meta', `seq.${seqKey}`)) || { key: `seq.${seqKey}`, value: 0 };
  const n = Number(row.value || 0) + 1;
  await t.put('meta', { key: row.key, value: n });
  const prefix = getSettings().prefixes?.[prefixKey] || prefixKey.toUpperCase();
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

// Writes one balanced transaction inside an open write transaction `t`.
// lines: [{ accountId, debit, credit, partyId?, memo? }]
export async function journal(t, { date, memo = '', refType = 'manual', refId = null, refNo = '', lines }) {
  if (!Array.isArray(lines) || lines.length < 2) throw new AppError('A transaction needs at least two lines.');
  let dr = 0; let cr = 0;
  const clean = [];
  for (const l of lines) {
    const debit = rnd(l.debit || 0);
    const credit = rnd(l.credit || 0);
    if (debit < 0 || credit < 0) throw new AppError('Amounts cannot be negative.');
    if (debit === 0 && credit === 0) continue; // zero lines are dropped
    if (debit > 0 && credit > 0) throw new AppError('A line cannot be both debit and credit.');
    const acc = await t.get('accounts', l.accountId);
    if (!acc) throw new AppError(`Unknown account: ${l.accountId}`);
    clean.push({ accountId: l.accountId, debit, credit, partyId: l.partyId || null, memo: l.memo || '' });
    dr += debit; cr += credit;
  }
  if (clean.length < 2) throw new AppError('Enter an amount greater than zero.');
  if (Math.abs(dr - cr) > TOL) throw new AppError(`Entries do not balance (debit ${dr.toFixed(4)} vs credit ${cr.toFixed(4)}).`);
  const txnId = uuid();
  const at = nowISO();
  for (const l of clean) {
    await t.put('entries', { id: uuid(), txnId, date, refType, refId, refNo, createdAt: at, ...l });
  }
  return txnId;
}

// Reverses every entry of a transaction (used when a sale, purchase or voucher is voided).
export async function reverseTxn(t, txnId, date, memo = 'Reversal') {
  const rows = await t.getAllByIndex('entries', 'txnId', txnId);
  if (!rows.length) throw new AppError('Original transaction not found.');
  const lines = rows.map((r) => ({ accountId: r.accountId, debit: r.credit, credit: r.debit, partyId: r.partyId, memo }));
  return journal(t, { date, memo, refType: rows[0].refType, refId: rows[0].refId, refNo: rows[0].refNo, lines });
}

// Sum of each side for transactions (for validation in forms).
export function totalsOf(lines) {
  return lines.reduce((s, l) => ({ dr: rnd(s.dr + (Number(l.debit) || 0)), cr: rnd(s.cr + (Number(l.credit) || 0)) }), { dr: 0, cr: 0 });
}
