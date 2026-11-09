// Reports: trial balance, profit & loss, balance sheet, cash and bank books, day book, receivable and payable aging,
// sales by product, shift cash reconciliation, tank reconciliation and investor profit shares. All print and export to CSV.
import { getAll } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, today, monthStart, toCSV, downloadFile } from '../core/utils.js';
import { fmt, fmtQty, money, rnd } from '../core/money.js';
import { pref, getSettings } from '../core/settings.js';
import { loadBooks, trialBalance, incomeStatement, balanceSheet, dayBook, aging, ledgerOf } from '../services/finance.js';
import { dateFilter, bindDateFilter, REF_LABELS, ledgerTable } from '../core/views.js';

const $ = window.jQuery;

const TABS = [
  ['tb', 'Trial balance', 'list-check'],
  ['pl', 'Profit & loss', 'graph-up'],
  ['bs', 'Balance sheet', 'layout-three-columns'],
  ['cash', 'Cash & bank book', 'cash-stack'],
  ['day', 'Day book', 'journal-text'],
  ['ar', 'Receivables (udhaar)', 'people'],
  ['ap', 'Payables (suppliers)', 'building'],
  ['sales', 'Sales by product', 'bar-chart'],
  ['shifts', 'Shift cash', 'fuel-pump'],
  ['tanks', 'Tank reconciliation', 'droplet-half'],
  ['inv', 'Investor shares', 'piggy-bank'],
];

const page = (tab, body, from, to) => `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap no-print">
    <h1 class="h5 mb-0 flex-grow-1">Reports</h1>
    <button class="btn btn-outline-secondary btn-sm" data-act="csv" aria-label="Export CSV"><i class="bi bi-filetype-csv me-1"></i>CSV</button>
    <button class="btn btn-outline-secondary btn-sm" data-act="print"><i class="bi bi-printer me-1"></i>Print</button></div>
  <div class="nav nav-pills gap-2 mb-3 no-print report-tabs flex-nowrap overflow-auto pb-1">${TABS.map(([k, l, i]) => `<a class="nav-link ${k === tab ? 'active' : ''} text-nowrap" href="#/reports/${k}"><i class="bi bi-${i} me-1"></i>${esc(l)}</a>`).join('')}</div>
  ${dateFilter(from, to)}
  <div class="print-title"><h2 class="h5">${esc(getSettings().company.name)} · ${esc(TABS.find((t) => t[0] === tab)[1])}</h2><div class="small">${esc(fmtDate(from))} to ${esc(fmtDate(to))}</div></div>
  <div id="rep-body" class="page-enter">${body}</div>`;

async function render(el, ctx) {
  const tab = TABS.some((t) => t[0] === ctx.params[0]) ? ctx.params[0] : 'tb';
  const from = pref.get('rep.from', monthStart(today()));
  const to = pref.get('rep.to', today());
  const state = { from, to, rows: [], name: '' };
  const draw = async (f = state.from, t = state.to, extra = {}) => {
    state.from = f; state.to = t;
    el.querySelector('#rep-body').innerHTML = UI.spinner();
    const books = await loadBooks();
    const out = await build(tab, books, f, t, extra);
    el.querySelector('#rep-body').innerHTML = out.html;
    state.rows = out.csv || []; state.name = out.name || tab;
    bindExtra(el, draw, extra);
  };
  el.innerHTML = page(tab, '', from, to);
  await draw(from, to);
  const $el = $(el).off();
  bindDateFilter($el, (f, t) => { pref.set('rep.from', f); pref.set('rep.to', t); draw(f, t); });
  $el.on('click', '[data-act="print"]', () => window.print());
  $el.on('click', '[data-act="csv"]', () => {
    if (!state.rows.length) return UI.toast('Nothing to export for this report', 'warning');
    downloadFile(`${state.name}-${state.to}.csv`, toCSV(state.rows), 'text/csv');
  });
}

function bindExtra(el, draw, extra) {
  const $el = $(el);
  $el.off('change.rep').on('change.rep', '#acc-pick', function () { draw(undefined, undefined, { acc: this.value }); });
  void extra;
}

const tableHtml = (head, rows, foot = '') => `<div class="list-card"><div class="table-responsive"><table class="table table-sm align-middle mb-0 table-report"><thead><tr>${head.map((h) => `<th${h.num ? ' class="num"' : ''}>${esc(h.t)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div></div>`;
const numCell = (v, cls = '') => `<td class="num ${cls}">${v === 0 || v === '' ? '' : fmt(v)}</td>`;

async function build(tab, books, from, to, extra) {
  if (tab === 'tb') {
    const tb = trialBalance(books, to);
    const rows = tb.rows.map((r) => `<tr><td class="fw-semibold">${esc(r.account.code)}</td><td>${esc(r.account.name)}</td>${numCell(r.debitBal)}${numCell(r.creditBal)}</tr>`).join('');
    const foot = `<tr class="fw-semibold"><td colspan="2">Totals</td>${numCell(tb.totals.dr)}${numCell(tb.totals.cr)}</tr>`;
    return {
      html: `<div class="mb-2">${tb.balanced ? '<span class="badge text-bg-success"><i class="bi bi-check2"></i> Debits equal credits</span>' : '<span class="badge text-bg-danger">Does not balance — check entries</span>'} <span class="small text-body-secondary">as of ${esc(fmtDate(to))}</span></div>` + tableHtml([{ t: 'Code' }, { t: 'Account' }, { t: 'Debit', num: 1 }, { t: 'Credit', num: 1 }], rows, foot),
      csv: [['Code', 'Account', 'Debit', 'Credit'], ...tb.rows.map((r) => [r.account.code, r.account.name, r.debitBal, r.creditBal]), ['', 'Totals', tb.totals.dr, tb.totals.cr]],
      name: 'trial-balance',
    };
  }
  if (tab === 'pl') {
    const pl = incomeStatement(books, from, to);
    const sec = (list) => list.map((r) => `<tr><td>${esc(r.account.code)} · ${esc(r.account.name)}</td>${numCell(r.amount)}</tr>`).join('') || '<tr><td colspan="2" class="text-body-secondary">None</td></tr>';
    return {
      html: `<div class="row g-3"><div class="col-lg-6">${tableHtml([{ t: 'Income' }, { t: 'Amount', num: 1 }], sec(pl.income), `<tr class="fw-semibold"><td>Total income</td>${numCell(pl.totalIncome)}</tr>`)}</div>
        <div class="col-lg-6">${tableHtml([{ t: 'Expenses' }, { t: 'Amount', num: 1 }], sec(pl.expense), `<tr class="fw-semibold"><td>Total expenses</td>${numCell(pl.totalExpense)}</tr>`)}</div></div>
        <div class="summary-box mt-3 d-flex justify-content-between align-items-center"><span class="fw-bold">${pl.netProfit >= 0 ? 'Net profit' : 'Net loss'}</span><span class="fs-4 fw-bold ${pl.netProfit < 0 ? 'text-danger' : 'text-success'}">${money(Math.abs(pl.netProfit))}</span></div>`,
      csv: [['Type', 'Account', 'Amount'], ...pl.income.map((r) => ['Income', r.account.name, r.amount]), ...pl.expense.map((r) => ['Expense', r.account.name, r.amount]), ['', 'Net profit', pl.netProfit]],
      name: 'profit-and-loss',
    };
  }
  if (tab === 'bs') {
    const bs = balanceSheet(books, to);
    const sec = (list) => list.map((r) => `<tr><td>${esc(r.account.code)} · ${esc(r.account.name)}</td>${numCell(r.amount)}</tr>`).join('');
    return {
      html: `<div class="mb-2">${bs.balanced ? '<span class="badge text-bg-success"><i class="bi bi-check2"></i> Assets = liabilities + equity</span>' : '<span class="badge text-bg-danger">Does not balance</span>'} <span class="small text-body-secondary">as of ${esc(fmtDate(to))}</span></div>
        <div class="row g-3"><div class="col-lg-6">${tableHtml([{ t: 'Assets' }, { t: 'Amount', num: 1 }], sec(bs.assetRows), `<tr class="fw-semibold"><td>Total assets</td>${numCell(bs.assets)}</tr>`)}</div>
        <div class="col-lg-6">${tableHtml([{ t: 'Liabilities' }, { t: 'Amount', num: 1 }], sec(bs.liabilityRows), `<tr class="fw-semibold"><td>Total liabilities</td>${numCell(bs.liabilities)}</tr>`)}
          <div class="mt-3">${tableHtml([{ t: 'Capital & equity' }, { t: 'Amount', num: 1 }], sec(bs.equityRows) + `<tr><td>Profit for the period (to date)</td>${numCell(bs.profit)}</tr>`, `<tr class="fw-semibold"><td>Total equity</td>${numCell(bs.equityTotal)}</tr>`)}</div></div></div>`,
      csv: [['Section', 'Account', 'Amount'], ...bs.assetRows.map((r) => ['Asset', r.account.name, r.amount]), ...bs.liabilityRows.map((r) => ['Liability', r.account.name, r.amount]), ...bs.equityRows.map((r) => ['Equity', r.account.name, r.amount]), ['Equity', 'Profit to date', bs.profit]],
      name: 'balance-sheet',
    };
  }
  if (tab === 'cash') {
    const money_ = books.accountList.filter((a) => ['cash', 'bank', 'wallet'].includes(a.kind));
    const id = extra.acc || money_[0]?.id;
    if (!id) return { html: UI.emptyState('No cash or bank accounts yet', 'cash-stack') };
    const led = ledgerOf(books, id, { from, to });
    const acc = books.accounts.get(id);
    const opts = money_.map((a) => `<option value="${esc(a.id)}" ${a.id === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    return {
      html: `<div class="mb-2 d-flex align-items-center gap-2"><label class="small text-body-secondary">Account</label><select class="form-select form-select-sm w-auto" id="acc-pick">${opts}</select></div>
        <div class="card p-3">${ledgerTable(led, { natural: acc.normal, showParty: true })}</div>`,
      csv: [['Date', 'Ref', 'Party', 'Details', 'Debit', 'Credit', 'Running'], ...led.rows.map((r) => [r.date, r.refNo, r.partyName, r.memo, r.debit, r.credit, r.running])],
      name: `cash-book-${acc.code}`,
    };
  }
  if (tab === 'day') {
    const groups = dayBook(books, from, to);
    const rows = groups.map((g) => `<tr><td class="text-nowrap">${fmtDate(g.date)}</td><td class="text-nowrap fw-semibold">${esc(g.refNo || '')}</td><td class="small">${esc(REF_LABELS[g.refType] || g.refType)}</td><td class="small">${esc(g.memo || '')}<div class="text-body-secondary">${g.lines.map((l) => esc(books.accounts.get(l.accountId)?.name || l.accountId) + (l.debit ? ' Dr ' + fmt(l.debit) : ' Cr ' + fmt(l.credit))).join(' · ')}</div></td>${numCell(g.total)}</tr>`).join('');
    return {
      html: tableHtml([{ t: 'Date' }, { t: 'Ref' }, { t: 'Type' }, { t: 'Details & lines' }, { t: 'Amount', num: 1 }], rows || '<tr><td colspan="5" class="text-center text-body-secondary py-4">No transactions in this period</td></tr>'),
      csv: [['Date', 'Ref', 'Type', 'Memo', 'Amount'], ...groups.map((g) => [g.date, g.refNo, g.refType, g.memo, g.total])],
      name: 'day-book',
    };
  }
  if (tab === 'ar' || tab === 'ap') {
    const ag = aging(books, tab === 'ar' ? 'ar' : 'ap', to);
    const rows = ag.rows.map((r) => `<tr><td class="fw-semibold">${esc(r.name)}<div class="small text-body-secondary">${esc(r.phone || '')}</div></td>${numCell(r.b0)}${numCell(r.b1)}${numCell(r.b2)}${numCell(r.b3, r.b3 > 0 ? 'text-danger fw-semibold' : '')}${numCell(r.total)}${numCell(r.advance)}</tr>`).join('');
    const g = ag.grand;
    const foot = `<tr class="fw-semibold"><td>Total</td>${numCell(g.b0)}${numCell(g.b1)}${numCell(g.b2)}${numCell(g.b3)}${numCell(g.total)}${numCell(g.advance)}</tr>`;
    return {
      html: `<div class="small text-body-secondary mb-2">Aged as of ${esc(fmtDate(to))}. Each receipt or payment is matched to the oldest open item first (FIFO).</div>` +
        tableHtml([{ t: tab === 'ar' ? 'Customer' : 'Supplier' }, { t: '0–30 days', num: 1 }, { t: '31–60', num: 1 }, { t: '61–90', num: 1 }, { t: 'Over 90', num: 1 }, { t: 'Total', num: 1 }, { t: 'Advance', num: 1 }], rows || '<tr><td colspan="7" class="text-center text-body-secondary py-4">Nothing outstanding</td></tr>', foot),
      csv: [['Party', '0-30', '31-60', '61-90', 'Over 90', 'Total', 'Advance'], ...ag.rows.map((r) => [r.name, r.b0, r.b1, r.b2, r.b3, r.total, r.advance])],
      name: tab === 'ar' ? 'receivables-aging' : 'payables-aging',
    };
  }
  if (tab === 'sales') {
    const [sales, shifts, products] = await Promise.all([getAll('sales'), getAll('shifts'), getAll('products')]);
    const agg = new Map();
    const add = (pid, name, unit, cat, qty, gross, net, tax, cost) => {
      const a = agg.get(pid) || { name, unit, cat, qty: 0, gross: 0, net: 0, tax: 0, cost: 0 };
      a.qty = rnd(a.qty + qty); a.gross = rnd(a.gross + gross); a.net = rnd(a.net + net); a.tax = rnd(a.tax + tax); a.cost = rnd(a.cost + cost);
      agg.set(pid, a);
    };
    for (const s of shifts.filter((x) => x.status === 'closed' && x.date >= from && x.date <= to)) {
      for (const p of s.products || []) {
        const prod = products.find((x) => x.id === p.productId);
        add(p.productId, p.name, prod?.unit || 'L', 'fuel', p.litres, p.gross, p.net, p.tax, p.cost);
      }
    }
    for (const s of sales.filter((x) => x.status === 'posted' && x.date >= from && x.date <= to)) {
      for (const l of s.lines) add(l.productId, l.name, l.unit, 'goods', l.qty, l.gross, l.net, l.tax, l.cost);
    }
    const list = [...agg.values()].sort((a, b) => (a.cat === b.cat ? (a.name < b.name ? -1 : 1) : a.cat === 'fuel' ? -1 : 1));
    const rows = list.map((a) => `<tr><td class="fw-semibold">${esc(a.name)}<div class="small text-body-secondary">${a.cat === 'fuel' ? 'Fuel (nozzles)' : 'Counter goods'}</div></td><td class="num">${fmtQty(a.qty)} ${esc(a.unit)}</td>${numCell(a.net)}${numCell(a.tax)}${numCell(a.gross)}${numCell(a.cost)}${numCell(rnd(a.net - a.cost))}</tr>`).join('');
    const tot = list.reduce((t, a) => ({ net: rnd(t.net + a.net), tax: rnd(t.tax + a.tax), gross: rnd(t.gross + a.gross), cost: rnd(t.cost + a.cost) }), { net: 0, tax: 0, gross: 0, cost: 0 });
    const foot = `<tr class="fw-semibold"><td colspan="2">Total</td>${numCell(tot.net)}${numCell(tot.tax)}${numCell(tot.gross)}${numCell(tot.cost)}${numCell(rnd(tot.net - tot.cost))}</tr>`;
    return {
      html: tableHtml([{ t: 'Product' }, { t: 'Quantity', num: 1 }, { t: 'Net sales', num: 1 }, { t: 'Tax', num: 1 }, { t: 'Gross', num: 1 }, { t: 'Cost', num: 1 }, { t: 'Margin', num: 1 }], rows || '<tr><td colspan="7" class="text-center text-body-secondary py-4">No sales in this period</td></tr>', foot),
      csv: [['Product', 'Quantity', 'Net', 'Tax', 'Gross', 'Cost', 'Margin'], ...list.map((a) => [a.name, a.qty, a.net, a.tax, a.gross, a.cost, rnd(a.net - a.cost)])],
      name: 'sales-by-product',
    };
  }
  if (tab === 'shifts') {
    const list = (await getAll('shifts')).filter((s) => s.status === 'closed' && s.date >= from && s.date <= to).sort((a, b) => (a.number < b.number ? -1 : 1));
    const rows = list.map((s) => `<tr><td><a href="#/shifts/${encodeURIComponent(s.id)}" class="fw-semibold">${esc(s.number)}</a></td><td>${fmtDate(s.date)}</td>${numCell(s.totals?.litres || 0)}${numCell(s.totals?.gross || 0)}${numCell(s.expectedCash || 0)}${numCell(s.cashCounted || 0)}<td class="num ${s.variance < 0 ? 'text-danger' : s.variance > 0 ? 'text-success' : ''}">${fmt(s.variance || 0)}</td></tr>`).join('');
    const v = rnd(list.reduce((s, x) => s + (x.variance || 0), 0));
    const foot = `<tr class="fw-semibold"><td colspan="2">Total (${list.length} shifts)</td>${numCell(rnd(list.reduce((s, x) => s + (x.totals?.litres || 0), 0)))}${numCell(rnd(list.reduce((s, x) => s + (x.totals?.gross || 0), 0)))}${numCell(rnd(list.reduce((s, x) => s + (x.expectedCash || 0), 0)))}${numCell(rnd(list.reduce((s, x) => s + (x.cashCounted || 0), 0)))}<td class="num ${v < 0 ? 'text-danger' : ''}">${fmt(v)}</td></tr>`;
    return {
      html: tableHtml([{ t: 'Shift' }, { t: 'Date' }, { t: 'Litres', num: 1 }, { t: 'Sales', num: 1 }, { t: 'Expected cash', num: 1 }, { t: 'Counted', num: 1 }, { t: 'Variance', num: 1 }], rows || '<tr><td colspan="7" class="text-center text-body-secondary py-4">No closed shifts in this period</td></tr>', foot),
      csv: [['Shift', 'Date', 'Litres', 'Sales', 'Expected', 'Counted', 'Variance'], ...list.map((s) => [s.number, s.date, s.totals?.litres, s.totals?.gross, s.expectedCash, s.cashCounted, s.variance])],
      name: 'shift-cash',
    };
  }
  if (tab === 'tanks') {
    const [tanks, dips, products] = await Promise.all([getAll('tanks'), getAll('dips'), getAll('products')]);
    const rows = tanks.map((t) => {
      const ds = dips.filter((d) => d.tankId === t.id && d.date >= from && d.date <= to);
      const last = dips.filter((d) => d.tankId === t.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const posted = rnd(ds.filter((d) => d.posted).reduce((s, d) => s + d.variance, 0));
      return `<tr><td class="fw-semibold">${esc(t.name)}<div class="small text-body-secondary">${esc(products.find((p) => p.id === t.productId)?.name || '')}</div></td>${numCell(t.bookLitres)}
        <td class="num">${last ? fmtQty(last.dipLitres) + ' <span class="small text-body-secondary">' + fmtDate(last.date) + '</span>' : '–'}</td>${numCell(ds.length)}
        <td class="num ${posted < 0 ? 'text-danger fw-semibold' : posted > 0 ? 'text-success fw-semibold' : ''}">${fmtQty(posted)}</td></tr>`;
    }).join('');
    return {
      html: tableHtml([{ t: 'Tank' }, { t: 'Book now (L)', num: 1 }, { t: 'Last dip', num: 1 }, { t: 'Dips in period', num: 1 }, { t: 'Posted variance (L)', num: 1 }], rows || '<tr><td colspan="5" class="text-center text-body-secondary py-4">No tanks yet</td></tr>'),
      csv: [['Tank', 'Book', 'Dips in period', 'Posted variance'], ...tanks.map((t) => [t.name, t.bookLitres, dips.filter((d) => d.tankId === t.id && d.date >= from && d.date <= to).length, rnd(dips.filter((d) => d.tankId === t.id && d.date >= from && d.date <= to && d.posted).reduce((s, d) => s + d.variance, 0))])],
      name: 'tank-reconciliation',
    };
  }
  if (tab === 'inv') {
    const parties = (await getAll('parties')).filter((p) => p.kind === 'investor');
    const pl = incomeStatement(books, from, to);
    const sumOf = (pid, acc, sign) => books.entries.reduce((s, e) => (e.partyId === pid && e.accountId === acc ? rnd(s + sign * (e.credit - e.debit)) : s), 0);
    const rows = parties.map((p) => {
      const share = rnd(pl.netProfit * (Number(p.sharePct) || 0) / 100);
      const capital = sumOf(p.id, 'capital', 1); const drawings = sumOf(p.id, 'drawings', -1); const paid = sumOf(p.id, 'profit_dist', -1);
      return `<tr><td class="fw-semibold">${esc(p.name)}<div class="small text-body-secondary">${Number(p.sharePct || 0)}% share</div></td>${numCell(capital)}${numCell(drawings)}${numCell(share)}${numCell(paid)}${numCell(rnd(share - paid))}</tr>`;
    }).join('');
    const foot = `<tr class="small text-body-secondary"><td colspan="6">Company net profit for the period: ${money(pl.netProfit)}. Profit share is computed from the period's P&L; "unpaid" is what is still due to be paid to the investor.</td></tr>`;
    return {
      html: tableHtml([{ t: 'Investor' }, { t: 'Capital in', num: 1 }, { t: 'Drawings', num: 1 }, { t: 'Share of profit', num: 1 }, { t: 'Paid out', num: 1 }, { t: 'Unpaid profit', num: 1 }], rows || '<tr><td colspan="6" class="text-center text-body-secondary py-4">No investors yet</td></tr>', foot),
      csv: [['Investor', 'Capital', 'Drawings', 'Share', 'Paid', 'Unpaid'], ...parties.map((p) => [p.name, sumOf(p.id, 'capital', 1), sumOf(p.id, 'drawings', -1), rnd(pl.netProfit * (Number(p.sharePct) || 0) / 100), sumOf(p.id, 'profit_dist', -1), rnd(pl.netProfit * (Number(p.sharePct) || 0) / 100 - sumOf(p.id, 'profit_dist', -1))])],
      name: 'investor-shares',
    };
  }
  return { html: UI.emptyState('Unknown report', 'question-circle') };
}

export default {
  render,
  destroy() {},
};
