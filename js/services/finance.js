// Read-only financial statements built from the entries table: trial balance, P&L, balance sheet,
// ledgers, day book and FIFO receivable / payable aging.
import { getAll } from '../db/idb.js';
import { rnd } from '../core/money.js';
import { daysBetween } from '../core/utils.js';

export async function loadBooks() {
  const [accountList, entries, parties] = await Promise.all([getAll('accounts'), getAll('entries'), getAll('parties')]);
  const accounts = new Map(accountList.map((a) => [a.id, a]));
  const partyMap = new Map(parties.map((p) => [p.id, p]));
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : 1));
  return { accounts, accountList: [...accountList].sort((a, b) => a.code.localeCompare(b.code)), entries, parties: partyMap };
}

// Natural balance of an account: positive when the balance sits on its normal side.
export function natural(acc, dr, cr) {
  return acc.normal === 'dr' ? rnd(dr - cr) : rnd(cr - dr);
}

// Sums debit and credit per account for entries matching the filter.
function sumsBy(books, { from = null, to = null, asOf = null, partyId = null, accountIds = null } = {}) {
  const m = new Map();
  for (const e of books.entries) {
    if (asOf && e.date > asOf) continue;
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    if (partyId && e.partyId !== partyId) continue;
    if (accountIds && !accountIds.has(e.accountId)) continue;
    const s = m.get(e.accountId) || { dr: 0, cr: 0 };
    s.dr = rnd(s.dr + e.debit); s.cr = rnd(s.cr + e.credit);
    m.set(e.accountId, s);
  }
  return m;
}

export function trialBalance(books, asOf) {
  const sums = sumsBy(books, { asOf });
  const rows = books.accountList.map((a) => {
    const s = sums.get(a.id) || { dr: 0, cr: 0 };
    const net = rnd(s.dr - s.cr);
    return { account: a, dr: s.dr, cr: s.cr, debitBal: net > 0 ? net : 0, creditBal: net < 0 ? -net : 0 };
  }).filter((r) => r.dr || r.cr);
  const totals = rows.reduce((t, r) => ({ dr: rnd(t.dr + r.debitBal), cr: rnd(t.cr + r.creditBal), tdr: rnd(t.tdr + r.dr), tcr: rnd(t.tcr + r.cr) }), { dr: 0, cr: 0, tdr: 0, tcr: 0 });
  return { rows, totals, balanced: Math.abs(totals.dr - totals.cr) < 0.0005 };
}

// Profit and loss for a period. Income and expense accounts only.
export function incomeStatement(books, from, to) {
  const sums = sumsBy(books, { from, to });
  const income = []; const expense = [];
  for (const a of books.accountList) {
    if (a.group !== 'income' && a.group !== 'expense') continue;
    const s = sums.get(a.id);
    if (!s) continue;
    const amount = a.group === 'income' ? rnd(s.cr - s.dr) : rnd(s.dr - s.cr);
    if (Math.abs(amount) < 0.00005) continue;
    (a.group === 'income' ? income : expense).push({ account: a, amount });
  }
  const totalIncome = rnd(income.reduce((s, r) => s + r.amount, 0));
  const totalExpense = rnd(expense.reduce((s, r) => s + r.amount, 0));
  return { income, expense, totalIncome, totalExpense, netProfit: rnd(totalIncome - totalExpense) };
}

// Balance sheet as of a date. Current-period profit is added to equity so the sheet always balances.
export function balanceSheet(books, asOf) {
  const sums = sumsBy(books, { asOf });
  const sec = { asset: [], liability: [], equity: [] };
  let assets = 0; let liabilities = 0; let equity = 0; let income = 0; let expense = 0;
  for (const a of books.accountList) {
    const s = sums.get(a.id) || { dr: 0, cr: 0 };
    if (a.group === 'income') { income = rnd(income + s.cr - s.dr); continue; }
    if (a.group === 'expense') { expense = rnd(expense + s.dr - s.cr); continue; }
    const nat = natural(a, s.dr, s.cr);
    if (!nat && !s.dr && !s.cr) continue;
    const shown = a.kind === 'contra' ? -nat : nat; // contra accounts reduce their section
    sec[a.group].push({ account: a, amount: shown });
    if (a.group === 'asset') assets = rnd(assets + shown);
    else if (a.group === 'liability') liabilities = rnd(liabilities + shown);
    else equity = rnd(equity + shown);
  }
  const profit = rnd(income - expense);
  equity = rnd(equity + profit);
  return {
    assetRows: sec.asset, liabilityRows: sec.liability, equityRows: sec.equity,
    profit, assets, liabilities, equityTotal: equity, totalLiabEquity: rnd(liabilities + equity),
    balanced: Math.abs(assets - (liabilities + equity)) < 0.0005,
  };
}

// Ledger of one account (optionally one party) with running balance.
export function ledgerOf(books, accountId, { from = null, to = null, partyId = null } = {}) {
  const acc = books.accounts.get(accountId);
  let opening = 0;
  const rows = [];
  let dr = 0; let cr = 0; let running = 0;
  for (const e of books.entries) {
    if (e.accountId !== accountId) continue;
    if (partyId && e.partyId !== partyId) continue;
    if (from && e.date < from) { opening = rnd(opening + e.debit - e.credit); continue; }
    if (to && e.date > to) continue;
    running = rnd(running + e.debit - e.credit);
    dr = rnd(dr + e.debit); cr = rnd(cr + e.credit);
    rows.push({ ...e, partyName: books.parties.get(e.partyId)?.name || '', running: rnd(opening + running) });
  }
  return { account: acc, opening, rows, dr, cr, closing: rnd(opening + dr - cr) };
}

// Day book: every transaction in the period with its total.
export function dayBook(books, from, to) {
  const groups = new Map();
  for (const e of books.entries) {
    if (e.date < from || e.date > to) continue;
    const g = groups.get(e.txnId) || { txnId: e.txnId, date: e.date, refType: e.refType, refId: e.refId, refNo: e.refNo, memo: e.memo, total: 0, lines: [] };
    g.total = rnd(g.total + e.debit);
    g.lines.push({ accountId: e.accountId, debit: e.debit, credit: e.credit, memo: e.memo, partyId: e.partyId });
    groups.set(e.txnId, g);
  }
  return [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// All entries that belong to a party (customer, supplier, employee, investor).
export function partyLedger(books, partyId, from = null, to = null) {
  const rows = [];
  let dr = 0; let cr = 0;
  for (const e of books.entries) {
    if (e.partyId !== partyId) continue;
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    dr = rnd(dr + e.debit); cr = rnd(cr + e.credit);
    rows.push({ ...e, accountName: books.accounts.get(e.accountId)?.name || e.accountId });
  }
  return { rows, dr, cr, net: rnd(dr - cr) };
}

// Receivable (accountId 'ar') or payable ('ap') aging, FIFO: each receipt/payment settles the oldest open item first.
// Buckets: 0–30, 31–60, 61–90 and over 90 days old, measured from the item date to asOf.
export function aging(books, accountId, asOf) {
  const acc = books.accounts.get(accountId);
  const byParty = new Map();
  for (const e of books.entries) {
    if (e.accountId !== accountId || e.date > asOf) continue;
    const key = e.partyId || '__none';
    if (!byParty.has(key)) byParty.set(key, []);
    byParty.get(key).push(e);
  }
  const increaseSide = acc.normal; // 'dr' for receivables, 'cr' for payables
  const rows = [];
  const grand = { total: 0, b0: 0, b1: 0, b2: 0, b3: 0, advance: 0 };
  for (const [key, list] of byParty) {
    const open = []; // FIFO queue of { date, amount }
    let advance = 0;
    for (const e of list) {
      const inc = increaseSide === 'dr' ? e.debit : e.credit;
      const dec = increaseSide === 'dr' ? e.credit : e.debit;
      if (inc > 0) {
        // An advance received earlier settles this new item first.
        let amt = inc;
        if (advance > 0) { const use = Math.min(advance, amt); amt = rnd(amt - use); advance = rnd(advance - use); }
        if (amt > 0.00005) open.push({ date: e.date, amount: amt, memo: e.memo, refNo: e.refNo });
      }
      if (dec > 0) {
        let left = dec;
        while (left > 0.00005 && open.length) {
          const first = open[0];
          const used = Math.min(first.amount, left);
          first.amount = rnd(first.amount - used); left = rnd(left - used);
          if (first.amount <= 0.00005) open.shift();
        }
        if (left > 0.00005) advance = rnd(advance + left);
      }
    }
    const b = { b0: 0, b1: 0, b2: 0, b3: 0 };
    for (const it of open) {
      const days = daysBetween(it.date, asOf);
      if (days <= 30) b.b0 = rnd(b.b0 + it.amount);
      else if (days <= 60) b.b1 = rnd(b.b1 + it.amount);
      else if (days <= 90) b.b2 = rnd(b.b2 + it.amount);
      else b.b3 = rnd(b.b3 + it.amount);
    }
    const total = rnd(b.b0 + b.b1 + b.b2 + b.b3);
    if (total < 0.00005 && advance < 0.00005) continue;
    const party = key === '__none' ? null : books.parties.get(key);
    rows.push({ partyId: key === '__none' ? null : key, name: party?.name || 'Unallocated / opening balance', phone: party?.phone || '', open, ...b, total, advance });
    grand.total = rnd(grand.total + total); grand.b0 = rnd(grand.b0 + b.b0); grand.b1 = rnd(grand.b1 + b.b1);
    grand.b2 = rnd(grand.b2 + b.b2); grand.b3 = rnd(grand.b3 + b.b3); grand.advance = rnd(grand.advance + advance);
  }
  rows.sort((a, b) => b.total - a.total);
  return { rows, grand };
}
