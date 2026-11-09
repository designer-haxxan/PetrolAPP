// Business transactions for a petrol pump. Each function is atomic: the document, stock movements and
// journal entries are written in one IndexedDB transaction, or nothing is written.
import { uuid, nowISO, today, AppError, monthEnd } from '../core/utils.js';
import { rnd } from '../core/money.js';
import { getSettings } from '../core/settings.js';
import { write } from '../db/idb.js';
import { STORE_NAMES } from '../db/schema.js';
import { journal, reverseTxn, nextNumber } from './ledger.js';
import { stockIn, stockOut, reverseStock } from './stock.js';

const EPS = 0.00005;
const ALL = STORE_NAMES;
const MONEY_KINDS = ['cash', 'bank', 'wallet'];

export const VOUCHER_TYPES = {
  receipt: { label: 'Receipt from customer (udhaar paid)', party: 'customer', money: true },
  cust_adv: { label: 'Customer advance received', party: 'customer', money: true },
  pay_supplier: { label: 'Payment to supplier / OMC', party: 'supplier', money: true },
  expense: { label: 'Expense or asset payment', party: 'optional', money: true, other: 'Expense / asset account' },
  salary: { label: 'Salary paid', party: 'employee', money: true },
  advance: { label: 'Employee advance / loan given', party: 'employee', money: true },
  capital: { label: 'Investor capital received', party: 'investor', money: true },
  drawing: { label: 'Investor drawing (withdrawal)', party: 'investor', money: true },
  profit_share: { label: 'Investor profit paid', party: 'investor', money: true },
  loan_in: { label: 'Bank loan / borrowing received', party: 'optional', money: true },
  loan_out: { label: 'Loan / markup repaid', party: 'optional', money: true },
  transfer: { label: 'Bank deposit, withdrawal or transfer', party: null, money: true, other: 'Money account received in' },
  journal: { label: 'Journal voucher (manual entry)', party: null, money: false },
};

const addAmt = (map, key, v) => { if (key && v) map.set(key, rnd((map.get(key) || 0) + v)); };
const pricesInclusive = () => getSettings().pricesIncludeTax !== false;

// Splits a tax-inclusive (or exclusive) amount into net, tax and gross, rounded to 4 decimals.
export function splitTax(amount, taxRate, inclusive = pricesInclusive()) {
  const r = Number(taxRate) || 0;
  if (r <= 0) return { net: rnd(amount), tax: 0, gross: rnd(amount) };
  if (inclusive) {
    const net = rnd(amount / (1 + r / 100));
    return { net, tax: rnd(amount - net), gross: rnd(amount) };
  }
  const tax = rnd(amount * r / 100);
  return { net: rnd(amount), tax, gross: rnd(amount + tax) };
}

async function moneyAccount(t, id, what = 'cash, bank or wallet account') {
  const a = await t.get('accounts', id);
  if (!a || !MONEY_KINDS.includes(a.kind)) throw new AppError(`Choose a ${what}.`);
  return a;
}

async function partyOf(t, id, kind) {
  if (!id) return null;
  const p = await t.get('parties', id);
  if (!p) throw new AppError('Party not found.');
  if (kind && p.kind !== kind) throw new AppError(`Choose a ${kind}.`);
  return p;
}

function paymentRows(list = []) {
  return list.map((x) => ({ accountId: x.accountId, amount: rnd(x.amount || 0) })).filter((x) => x.amount > EPS);
}

// ---------------------------------------------------------------- counter sales (goods only)
export async function postSale({ date = today(), customerId = null, lines = [], paid = [], memo = '' }) {
  if (!lines.length) throw new AppError('Add at least one item.');
  return write(ALL, async (t) => {
    const id = uuid();
    const cust = await partyOf(t, customerId, 'customer');
    const out = []; const inc = new Map(); const tax = { v: 0 }; const cg = new Map(); const inv = new Map();
    let gross = 0; let net = 0; let cost = 0;
    for (const l of lines) {
      const p = await t.get('products', l.productId);
      if (!p) throw new AppError('Product not found.');
      if (p.category === 'fuel') throw new AppError(`${p.name} is sold through the pump nozzles (open a shift), not over the counter.`);
      const qty = rnd(l.qty); const rate = rnd(l.rate);
      if (!(qty > 0)) throw new AppError(`Enter a quantity for ${p.name}.`);
      if (rate < 0) throw new AppError(`Rate of ${p.name} cannot be negative.`);
      const s = splitTax(rnd(qty * rate), p.taxRate);
      const st = await stockOut(t, { productId: p.id, qty, date, refType: 'sale', refId: id, memo: 'Counter sale' });
      out.push({ productId: p.id, name: p.name, unit: p.unit, qty, rate, taxRate: Number(p.taxRate) || 0, net: s.net, tax: s.tax, gross: s.gross, cost: st.cost });
      gross = rnd(gross + s.gross); net = rnd(net + s.net); tax.v = rnd(tax.v + s.tax); cost = rnd(cost + st.cost);
      addAmt(inc, p.incomeAccountId, s.net); addAmt(cg, p.cogsAccountId, st.cost); addAmt(inv, p.inventoryAccountId, st.cost);
    }
    const payRows = paymentRows(paid);
    let paidTotal = 0;
    for (const r of payRows) { await moneyAccount(t, r.accountId); paidTotal = rnd(paidTotal + r.amount); }
    if (paidTotal > gross + EPS) throw new AppError('Payments are more than the bill total.');
    const credit = rnd(gross - paidTotal);
    if (credit > EPS && !cust) throw new AppError('Choose a customer for a credit (udhaar) sale.');

    const jl = [];
    for (const r of payRows) jl.push({ accountId: r.accountId, debit: r.amount });
    if (credit > EPS) jl.push({ accountId: 'ar', debit: credit, partyId: cust.id, memo: 'Credit sale' });
    for (const [a, v] of inc) jl.push({ accountId: a, credit: v });
    if (tax.v > EPS) jl.push({ accountId: 'tax_payable', credit: tax.v });
    for (const [a, v] of cg) jl.push({ accountId: a, debit: v });
    for (const [a, v] of inv) jl.push({ accountId: a, credit: v });

    const number = await nextNumber(t, 'sale', 'sale');
    const txnId = await journal(t, { date, memo: memo || `Counter sale ${number}`, refType: 'sale', refId: id, refNo: number, lines: jl });
    const doc = {
      id, number, date, customerId: cust?.id || null, customerName: cust?.name || 'Walk-in customer',
      lines: out, gross, net, tax: tax.v, cost, paid: payRows, credit, memo, txnId, status: 'posted', createdAt: nowISO(),
    };
    await t.put('sales', doc);
    return doc;
  });
}

export async function voidSale(id) {
  return write(ALL, async (t) => {
    const s = await t.get('sales', id);
    if (!s) throw new AppError('Sale not found.');
    if (s.status !== 'posted') throw new AppError('This sale is already void.');
    const d = today();
    await reverseTxn(t, s.txnId, d, `Void ${s.number}`);
    await reverseStock(t, id, d, `Void ${s.number}`);
    s.status = 'void'; s.voidedAt = nowISO();
    await t.put('sales', s);
    return s;
  });
}

// ---------------------------------------------------------------- purchases (fuel into tanks, goods into stock)
export async function postPurchase({ date = today(), supplierId = null, invoiceNo = '', lines = [], extras = [], paid = [], memo = '' }) {
  if (!lines.length) throw new AppError('Add at least one product line.');
  return write(ALL, async (t) => {
    const id = uuid();
    const sup = await partyOf(t, supplierId, 'supplier');
    const out = []; const inv = new Map(); let subtotal = 0; let tax = 0;
    for (const l of lines) {
      const p = await t.get('products', l.productId);
      if (!p) throw new AppError('Product not found.');
      const qty = rnd(l.qty); const rate = rnd(l.rate);
      if (!(qty > 0)) throw new AppError(`Enter a quantity for ${p.name}.`);
      if (rate < 0) throw new AppError(`Rate of ${p.name} cannot be negative.`);
      const tankId = p.category === 'fuel' ? (l.tankId || null) : null;
      if (p.category === 'fuel' && !tankId) throw new AppError(`Choose the tank that receives ${p.name}.`);
      await stockIn(t, { productId: p.id, tankId, qty, unitCost: rate, date, refType: 'purchase', refId: id, memo: invoiceNo || 'Purchase' });
      const amount = rnd(qty * rate);
      const lineTax = rnd(amount * (Number(p.taxRate) || 0) / 100);
      out.push({ productId: p.id, name: p.name, unit: p.unit, qty, rate, amount, taxRate: Number(p.taxRate) || 0, tax: lineTax, tankId });
      subtotal = rnd(subtotal + amount); tax = rnd(tax + lineTax);
      addAmt(inv, p.inventoryAccountId, amount);
    }
    const exOut = []; let extrasTotal = 0;
    for (const x of extras) {
      const amt = rnd(x.amount || 0);
      if (amt <= EPS) continue;
      const acc = await t.get('accounts', x.accountId);
      if (!acc) throw new AppError('Choose an account for each extra charge.');
      exOut.push({ accountId: acc.id, label: x.label || acc.name, amount: amt });
      extrasTotal = rnd(extrasTotal + amt);
    }
    const total = rnd(subtotal + tax + extrasTotal);
    const payRows = paymentRows(paid);
    let paidTotal = 0;
    for (const r of payRows) { await moneyAccount(t, r.accountId); paidTotal = rnd(paidTotal + r.amount); }
    if (paidTotal > total + EPS) throw new AppError('Payments are more than the purchase total.');
    const payable = rnd(total - paidTotal);
    if (payable > EPS && !sup) throw new AppError('Choose a supplier for a credit purchase.');

    const jl = [];
    for (const [a, v] of inv) jl.push({ accountId: a, debit: v });
    if (tax > EPS) jl.push({ accountId: 'input_tax', debit: tax });
    for (const x of exOut) jl.push({ accountId: x.accountId, debit: x.amount, memo: x.label });
    for (const r of payRows) jl.push({ accountId: r.accountId, credit: r.amount });
    if (payable > EPS) jl.push({ accountId: 'ap', credit: payable, partyId: sup.id, memo: 'Purchase on credit' });

    const number = await nextNumber(t, 'purchase', 'purchase');
    const txnId = await journal(t, { date, memo: memo || `Purchase ${number}`, refType: 'purchase', refId: id, refNo: number, lines: jl });
    const doc = {
      id, number, date, supplierId: sup?.id || null, supplierName: sup?.name || 'Cash purchase', invoiceNo,
      lines: out, extras: exOut, subtotal, tax, total, paid: payRows, payable, memo, txnId, status: 'posted', createdAt: nowISO(),
    };
    await t.put('purchases', doc);
    return doc;
  });
}

export async function voidPurchase(id) {
  return write(ALL, async (t) => {
    const p = await t.get('purchases', id);
    if (!p) throw new AppError('Purchase not found.');
    if (p.status !== 'posted') throw new AppError('This purchase is already void.');
    const d = today();
    await reverseTxn(t, p.txnId, d, `Void ${p.number}`);
    await reverseStock(t, id, d, `Void ${p.number}`);
    p.status = 'void'; p.voidedAt = nowISO();
    await t.put('purchases', p);
    return p;
  });
}

// ---------------------------------------------------------------- shifts (nozzle readings and cash settlement)
export async function openShift({ employeeIds = [], date = today(), overrides = [] } = {}) {
  return write(ALL, async (t) => {
    const all = await t.getAll('shifts');
    const open = all.find((s) => s.status === 'open');
    if (open) throw new AppError(`Shift ${open.number} is still open. Close it before opening another.`);
    const nozzles = (await t.getAll('nozzles')).filter((n) => n.active !== false);
    if (!nozzles.length) throw new AppError('Add pumps and nozzles first (Machines).');
    const readings = []; const prices = {};
    for (const n of nozzles) {
      const ov = overrides.find((o) => o.nozzleId === n.id);
      const reading = rnd(ov ? ov.reading : (n.lastReading || 0));
      if (!Number.isFinite(reading) || reading < 0) throw new AppError(`Enter a valid opening reading for ${n.name}.`);
      const p = await t.get('products', n.productId);
      if (!p) throw new AppError(`Nozzle ${n.name} has no product.`);
      if (!(p.price > 0)) throw new AppError(`Set today's price of ${p.name} first (Products & prices).`);
      prices[p.id] = p.price;
      readings.push({ nozzleId: n.id, nozzleName: n.name, pumpId: n.pumpId, productId: n.productId, productName: p.name, tankId: n.tankId, opening: reading });
    }
    const number = await nextNumber(t, 'shift', 'shift');
    const shift = { id: uuid(), number, date, status: 'open', openedAt: nowISO(), employeeIds, readings, prices, createdAt: nowISO() };
    await t.put('shifts', shift);
    return shift;
  });
}

export async function closeShift(id, { closings = [], cashCounted = 0, nonCash = [], credits = [], memo = '' }) {
  return write(ALL, async (t) => {
    const shift = await t.get('shifts', id);
    if (!shift || shift.status !== 'open') throw new AppError('This shift is not open.');
    const d = shift.date;
    const closeMap = new Map(closings.map((c) => [c.nozzleId, rnd(c.reading)]));
    const byProduct = new Map(); // productId -> { litres, gross, cost }
    const readings = [];
    let saleGross = 0;
    for (const r of shift.readings) {
      const closing = closeMap.get(r.nozzleId);
      if (closing === undefined || !Number.isFinite(closing)) throw new AppError(`Enter the closing reading for ${r.nozzleName}.`);
      if (closing < r.opening) throw new AppError(`Closing reading of ${r.nozzleName} is less than its opening reading.`);
      const litres = rnd(closing - r.opening);
      const price = shift.prices[r.productId];
      const amount = rnd(litres * price);
      readings.push({ ...r, closing, litres, price, amount });
      const agg = byProduct.get(r.productId) || { litres: 0, gross: 0, cost: 0, productName: r.productName };
      agg.litres = rnd(agg.litres + litres); agg.gross = rnd(agg.gross + amount);
      byProduct.set(r.productId, agg);
      saleGross = rnd(saleGross + amount);
      if (litres > 0) {
        const st = await stockOut(t, { productId: r.productId, tankId: r.tankId, qty: litres, date: d, refType: 'shift', refId: shift.id, memo: `${shift.number} ${r.nozzleName}` });
        agg.cost = rnd(agg.cost + st.cost);
      }
      const nz = await t.get('nozzles', r.nozzleId);
      if (nz) { nz.lastReading = closing; nz.updatedAt = nowISO(); await t.put('nozzles', nz); }
    }

    // Tax, income and cost per product
    const inc = new Map(); const cg = new Map(); const inv = new Map();
    let gross = 0; let net = 0; let tax = 0; let cost = 0; const productRows = [];
    for (const [pid, agg] of byProduct) {
      const p = await t.get('products', pid);
      const s = splitTax(agg.gross, p?.taxRate || 0);
      gross = rnd(gross + s.gross); net = rnd(net + s.net); tax = rnd(tax + s.tax); cost = rnd(cost + agg.cost);
      addAmt(inc, p.incomeAccountId, s.net); addAmt(cg, p.cogsAccountId, agg.cost); addAmt(inv, p.inventoryAccountId, agg.cost);
      productRows.push({ productId: pid, name: agg.productName, litres: agg.litres, gross: s.gross, net: s.net, tax: s.tax, cost: agg.cost });
    }

    // Settlement: card/bank, mobile wallet and credit (udhaar) amounts; the rest must be cash in hand.
    const nonCashRows = []; let nonCashTotal = 0;
    for (const n of paymentRows(nonCash)) {
      const a = await moneyAccount(t, n.accountId, 'bank or wallet account');
      if (a.kind === 'cash') throw new AppError('Count cash separately; use a bank or wallet line for card and wallet amounts.');
      nonCashRows.push({ accountId: a.id, name: a.name, amount: n.amount });
      nonCashTotal = rnd(nonCashTotal + n.amount);
    }
    const creditRows = []; let creditTotal = 0;
    for (const c of credits) {
      const amt = rnd(c.amount || 0);
      if (amt <= EPS) continue;
      const cu = await t.get('parties', c.customerId);
      if (!cu || cu.kind !== 'customer') throw new AppError('Choose a customer for each credit line.');
      creditRows.push({ customerId: cu.id, name: cu.name, amount: amt });
      creditTotal = rnd(creditTotal + amt);
    }
    const allNonCash = rnd(nonCashTotal + creditTotal);
    const expectedCash = rnd(gross - allNonCash);
    if (expectedCash < -EPS) throw new AppError('Card, wallet and credit amounts are more than the total sales of this shift.');
    const counted = rnd(cashCounted || 0);
    if (counted < 0) throw new AppError('Counted cash cannot be negative.');
    const variance = rnd(counted - expectedCash);

    const jl = [];
    if (counted > EPS) jl.push({ accountId: 'cash', debit: counted, memo: 'Cash counted' });
    for (const n of nonCashRows) jl.push({ accountId: n.accountId, debit: n.amount });
    for (const c of creditRows) jl.push({ accountId: 'ar', debit: c.amount, partyId: c.customerId, memo: `Shift ${shift.number} credit` });
    if (variance < -EPS) jl.push({ accountId: 'exp_cash_diff', debit: -variance, memo: 'Cash short' });
    if (variance > EPS) jl.push({ accountId: 'exp_cash_diff', credit: variance, memo: 'Cash excess' });
    for (const [a, v] of inc) jl.push({ accountId: a, credit: v });
    if (tax > EPS) jl.push({ accountId: 'tax_payable', credit: tax });
    for (const [a, v] of cg) jl.push({ accountId: a, debit: v });
    for (const [a, v] of inv) jl.push({ accountId: a, credit: v });

    const txnId = await journal(t, { date: d, memo: `Shift ${shift.number} closed`, refType: 'shift', refId: shift.id, refNo: shift.number, lines: jl });
    Object.assign(shift, {
      status: 'closed', closedAt: nowISO(), readings, products: productRows,
      totals: { litres: rnd(readings.reduce((s, r) => s + r.litres, 0)), gross, net, tax, cost },
      saleGross, cashCounted: counted, expectedCash, variance, nonCash: nonCashRows, credits: creditRows,
      txnId, memo,
    });
    await t.put('shifts', shift);
    return shift;
  });
}

// ---------------------------------------------------------------- tank dips (physical stock vs book)
export async function recordDip({ tankId, date = today(), dipLitres, note = '' }) {
  return write(ALL, async (t) => {
    const tank = await t.get('tanks', tankId);
    if (!tank) throw new AppError('Choose a tank.');
    const dip = rnd(dipLitres);
    if (!Number.isFinite(dip) || dip < 0) throw new AppError('Enter the measured dip in litres.');
    const book = rnd(tank.bookLitres || 0);
    const row = { id: uuid(), number: await nextNumber(t, 'dip', 'dip'), tankId, productId: tank.productId, date, dipLitres: dip, bookLitres: book, variance: rnd(dip - book), note, posted: false, createdAt: nowISO() };
    await t.put('dips', row);
    return row;
  });
}

// Posts a dip variance: a shortage is a loss expense, an excess is a gain. The tank book is set to the dip.
export async function postDipVariance(id) {
  return write(ALL, async (t) => {
    const dip = await t.get('dips', id);
    if (!dip) throw new AppError('Dip record not found.');
    if (dip.posted) throw new AppError('This dip is already posted.');
    const tank = await t.get('tanks', dip.tankId);
    const p = await t.get('products', dip.productId);
    if (!tank || !p) throw new AppError('Tank or product no longer exists.');
    const v = rnd(dip.variance);
    if (Math.abs(v) > EPS) {
      if (v < 0) {
        const st = await stockOut(t, { productId: p.id, tankId: tank.id, qty: -v, date: dip.date, refType: 'dip', refId: dip.id, memo: 'Dip shortage' });
        if (st.cost > EPS) await journal(t, { date: dip.date, memo: `Fuel shortage - ${tank.name} (${dip.number})`, refType: 'dip', refId: dip.id, refNo: dip.number, lines: [{ accountId: 'exp_loss', debit: st.cost }, { accountId: p.inventoryAccountId, credit: st.cost }] });
      } else {
        const si = await stockIn(t, { productId: p.id, tankId: tank.id, qty: v, unitCost: p.avgCost || 0, date: dip.date, refType: 'dip', refId: dip.id, memo: 'Dip excess' });
        if (si.value > EPS) await journal(t, { date: dip.date, memo: `Fuel excess - ${tank.name} (${dip.number})`, refType: 'dip', refId: dip.id, refNo: dip.number, lines: [{ accountId: p.inventoryAccountId, debit: si.value }, { accountId: 'gain_stock', credit: si.value }] });
      }
    }
    dip.posted = true; dip.postedAt = nowISO();
    await t.put('dips', dip);
    return dip;
  });
}

// Goods stock count correction (lubricants and shop items). qty is signed.
export async function postStockAdjustment({ productId, qty, date = today(), memo = 'Stock count adjustment' }) {
  return write(ALL, async (t) => {
    const p = await t.get('products', productId);
    if (!p) throw new AppError('Product not found.');
    const q = rnd(qty);
    if (Math.abs(q) < EPS) throw new AppError('Enter the quantity difference.');
    if (q > 0) {
      const si = await stockIn(t, { productId, qty: q, unitCost: p.avgCost || 0, date, refType: 'adjust', memo });
      if (si.value > EPS) await journal(t, { date, memo, refType: 'adjust', lines: [{ accountId: p.inventoryAccountId, debit: si.value }, { accountId: 'gain_stock', credit: si.value }] });
    } else {
      const st = await stockOut(t, { productId, qty: -q, date, refType: 'adjust', memo });
      if (st.cost > EPS) await journal(t, { date, memo, refType: 'adjust', lines: [{ accountId: 'exp_loss', debit: st.cost }, { accountId: p.inventoryAccountId, credit: st.cost }] });
    }
    return true;
  });
}

// ---------------------------------------------------------------- vouchers (cash, bank and wallet movements)
export async function postVoucher({ type, date = today(), accountId = null, otherAccountId = null, partyId = null, amount = 0, memo = '', refNo = '', lines = [] }) {
  const spec = VOUCHER_TYPES[type];
  if (!spec) throw new AppError('Choose a voucher type.');
  return write(ALL, async (t) => {
    const id = uuid();
    const party = await partyOf(t, partyId, spec.party && spec.party !== 'optional' ? spec.party : null);
    if (spec.party && spec.party !== 'optional' && !party) throw new AppError(`Choose a ${spec.party}.`);
    let jl; let amt;
    if (type === 'journal') {
      const dr = rnd(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
      amt = dr;
      jl = lines.map((l) => ({ accountId: l.accountId, debit: rnd(l.debit || 0), credit: rnd(l.credit || 0), partyId: l.partyId || null, memo: l.memo || '' }));
    } else {
      amt = rnd(amount);
      if (!(amt > 0)) throw new AppError('Enter an amount greater than zero.');
      await moneyAccount(t, accountId);
      const pid = party?.id || null;
      const other = otherAccountId ? await t.get('accounts', otherAccountId) : null;
      if ((spec.other || type === 'transfer') && !other) throw new AppError('Choose the account for this voucher.');
      if (type === 'transfer') {
        if (!MONEY_KINDS.includes(other.kind)) throw new AppError('A transfer must go to a cash, bank or wallet account.');
        if (other.id === accountId) throw new AppError('Choose two different accounts.');
      }
      const map = {
        receipt: [{ accountId, debit: amt }, { accountId: 'ar', credit: amt, partyId: pid }],
        cust_adv: [{ accountId, debit: amt }, { accountId: 'cust_adv', credit: amt, partyId: pid }],
        pay_supplier: [{ accountId: 'ap', debit: amt, partyId: pid }, { accountId, credit: amt }],
        expense: [{ accountId: other?.id, debit: amt, partyId: pid }, { accountId, credit: amt }],
        salary: [{ accountId: 'exp_salary', debit: amt, partyId: pid }, { accountId, credit: amt }],
        advance: [{ accountId: 'emp_adv', debit: amt, partyId: pid }, { accountId, credit: amt }],
        capital: [{ accountId, debit: amt }, { accountId: 'capital', credit: amt, partyId: pid }],
        drawing: [{ accountId: 'drawings', debit: amt, partyId: pid }, { accountId, credit: amt }],
        profit_share: [{ accountId: 'profit_dist', debit: amt, partyId: pid }, { accountId, credit: amt }],
        loan_in: [{ accountId, debit: amt }, { accountId: 'loans', credit: amt, partyId: pid }],
        loan_out: [{ accountId: 'loans', debit: amt, partyId: pid }, { accountId, credit: amt }],
        transfer: [{ accountId: other?.id, debit: amt }, { accountId, credit: amt }],
      }[type];
      jl = map.map((l) => ({ ...l, memo }));
    }
    const number = await nextNumber(t, 'voucher', 'voucher');
    const label = spec.label;
    const txnId = await journal(t, { date, memo: memo || label, refType: 'voucher', refId: id, refNo: refNo || number, lines: jl });
    const doc = {
      id, number, date, type, label, partyId: party?.id || null, partyName: party?.name || '', accountId: accountId || null,
      otherAccountId: otherAccountId || null, amount: type === 'journal' ? amt : amt, memo, refNo, txnId, status: 'posted', createdAt: nowISO(),
    };
    await t.put('vouchers', doc);
    return doc;
  });
}

export async function voidVoucher(id) {
  return write(ALL, async (t) => {
    const v = await t.get('vouchers', id);
    if (!v) throw new AppError('Voucher not found.');
    if (v.status !== 'posted') throw new AppError('This voucher is already void.');
    await reverseTxn(t, v.txnId, today(), `Void ${v.number}`);
    v.status = 'void'; v.voidedAt = nowISO();
    await t.put('vouchers', v);
    return v;
  });
}

// ---------------------------------------------------------------- fixed assets and depreciation
export const ASSET_CATEGORIES = {
  machinery: { label: 'Dispensers & machinery', account: 'fa_machinery' },
  tanks: { label: 'Underground tanks & pipelines', account: 'fa_tanks' },
  building: { label: 'Building, canopy & civil work', account: 'fa_building' },
  vehicles: { label: 'Vehicles & equipment', account: 'fa_vehicles' },
};

export async function createAsset({ name, category, cost, purchaseDate = today(), lifeYears = 5, salvage = 0, paidFrom, supplierId = null }) {
  const cat = ASSET_CATEGORIES[category];
  if (!cat) throw new AppError('Choose an asset category.');
  const c = rnd(cost);
  if (!(c > 0)) throw new AppError('Enter the cost of the asset.');
  const life = Math.max(1, Math.round(Number(lifeYears) || 0));
  const sv = rnd(salvage || 0);
  if (sv >= c) throw new AppError('Salvage value must be less than the cost.');
  return write(ALL, async (t) => {
    const id = uuid();
    const sup = paidFrom === 'ap' ? await partyOf(t, supplierId, 'supplier') : null;
    if (paidFrom === 'ap' && !sup) throw new AppError('Choose the supplier for an asset bought on credit.');
    let creditLine;
    if (paidFrom === 'ap') creditLine = { accountId: 'ap', credit: c, partyId: sup.id, memo: name };
    else { await moneyAccount(t, paidFrom); creditLine = { accountId: paidFrom, credit: c, memo: name }; }
    const number = await nextNumber(t, 'asset', 'asset');
    const txnId = await journal(t, { date: purchaseDate, memo: `Asset purchase: ${name}`, refType: 'asset', refId: id, refNo: number, lines: [{ accountId: cat.account, debit: c, memo: name }, creditLine] });
    const row = { id, number, name: String(name).trim(), category, accountId: cat.account, cost: c, purchaseDate, lifeYears: life, salvage: sv, accumulated: 0, postedMonths: [], txnId, status: 'active', createdAt: nowISO() };
    await t.put('fixedAssets', row);
    return row;
  });
}

// Posts one month of straight-line depreciation for every active asset. month = 'YYYY-MM'.
export async function postDepreciation(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new AppError('Choose a month.');
  const end = monthEnd(`${month}-01`);
  return write(ALL, async (t) => {
    const assets = await t.getAll('fixedAssets');
    let count = 0; let total = 0;
    for (const a of assets) {
      if (a.postedMonths.includes(month) || a.purchaseDate > end) continue;
      const base = rnd(a.cost - a.salvage);
      const monthly = rnd(base / (a.lifeYears * 12));
      const remaining = rnd(base - (a.accumulated || 0));
      const amt = Math.min(monthly, remaining);
      if (amt <= EPS) continue;
      await journal(t, { date: end, memo: `Depreciation ${month}: ${a.name}`, refType: 'depreciation', refId: a.id, refNo: a.number, lines: [{ accountId: 'exp_dep', debit: amt }, { accountId: 'acc_dep', credit: amt }] });
      a.accumulated = rnd((a.accumulated || 0) + amt);
      a.postedMonths = [...a.postedMonths, month];
      await t.put('fixedAssets', a);
      count++; total = rnd(total + amt);
    }
    return { count, total };
  });
}

// ---------------------------------------------------------------- product prices (government-notified rates)
export async function setPrice(productId, newPrice, effectiveFrom = today()) {
  const price = rnd(newPrice);
  if (!(price > 0)) throw new AppError('Enter a price greater than zero.');
  return write(ALL, async (t) => {
    const p = await t.get('products', productId);
    if (!p) throw new AppError('Product not found.');
    const old = p.price;
    p.price = price; p.updatedAt = nowISO();
    await t.put('products', p);
    await t.put('priceHistory', { id: uuid(), productId, oldPrice: old, price, effectiveFrom, createdAt: nowISO() });
    return p;
  });
}
