// Opening balances: stock already in tanks or on shelves when the books start, and the opening
// balance of cash, bank, receivables and payables. Each is posted against Opening Balance Equity.
import { write } from '../db/idb.js';
import { STORE_NAMES } from '../db/schema.js';
import { AppError, today, uuid, nowISO } from '../core/utils.js';
import { rnd } from '../core/money.js';
import { journal } from './ledger.js';
import { stockIn } from './stock.js';

// Adds opening stock to a product (and a tank, for fuel) at a unit cost, and posts Dr Inventory / Cr Opening equity.
export async function postOpeningStock({ productId, tankId = null, qty, unitCost, date = today() }) {
  return write(STORE_NAMES, async (t) => {
    const p = await t.get('products', productId);
    if (!p) throw new AppError('Product not found.');
    if (p.category === 'fuel' && !tankId) throw new AppError('Choose the tank that holds this fuel.');
    const si = await stockIn(t, { productId, tankId: p.category === 'fuel' ? tankId : null, qty, unitCost, date, refType: 'opening', refId: uuid(), memo: 'Opening stock' });
    if (si.value > 0) {
      await journal(t, { date, memo: `Opening stock: ${p.name}`, refType: 'opening', refId: null, lines: [{ accountId: p.inventoryAccountId, debit: si.value }, { accountId: 'obe', credit: si.value }] });
    }
    return si;
  });
}

// Opening balance of a single account (cash, bank, wallet, receivable, payable, capital, loans, fixed assets).
// Amount is the balance on the account's normal side; debit or credit is decided by the account type.
export async function postOpeningBalance({ accountId, amount, partyId = null, date = today(), memo = 'Opening balance' }) {
  const amt = rnd(amount);
  if (!(amt > 0)) throw new AppError('Enter an amount greater than zero.');
  return write(STORE_NAMES, async (t) => {
    const acc = await t.get('accounts', accountId);
    if (!acc) throw new AppError('Account not found.');
    const debitSide = acc.normal === 'dr';
    const lines = [
      debitSide ? { accountId, debit: amt, partyId, memo } : { accountId, credit: amt, partyId, memo },
      debitSide ? { accountId: 'obe', credit: amt, memo } : { accountId: 'obe', debit: amt, memo },
    ];
    await journal(t, { date, memo: `${memo}: ${acc.name}`, refType: 'opening', lines });
    return { at: nowISO() };
  });
}
