// Chart of accounts: balances by account, adding accounts, and the ledger of any account with a running balance.
import { getAll, write } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, uuid, nowISO, today, monthStart, toCSV, downloadFile } from '../core/utils.js';
import { rnd, balanceText } from '../core/money.js';
import { loadBooks, ledgerOf } from '../services/finance.js';
import { dateFilter, bindDateFilter, ledgerTable } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
const GROUPS = { asset: 'Assets', liability: 'Liabilities', equity: 'Capital & equity', income: 'Income', expense: 'Expenses' };
const KINDS = { cash: 'Cash', bank: 'Bank', wallet: 'Mobile wallet', receivable: 'Receivable', payable: 'Payable', inventory: 'Inventory', fixed: 'Fixed asset', contra: 'Contra', equity: 'Equity', income: 'Income', expense: 'Expense', other: 'Other' };

async function render(el, ctx) {
  if (ctx.params[0]) return renderLedger(el, ctx.params[0]);
  el.innerHTML = UI.spinner('Loading accounts…');
  const books = await loadBooks();
  const bal = (id) => { const e = books.entries.filter((x) => x.accountId === id); return rnd(e.reduce((s, x) => s + x.debit, 0) - e.reduce((s, x) => s + x.credit, 0)); };
  const byGroup = Object.keys(GROUPS).map((g) => [g, books.accountList.filter((a) => a.group === g)]);
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Chart of accounts</h1>
      <button class="btn btn-primary btn-sm" data-act="add" ${Auth.can('accounts') ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>Add account</button></div>
    <div class="small text-body-secondary mb-3">Click an account to open its ledger. Cash, bank and wallet accounts appear in vouchers and shift settlement.</div>
    ${byGroup.map(([g, list]) => `<div class="list-card mb-3"><div class="p-3 pb-2 fw-semibold d-flex justify-content-between"><span>${esc(GROUPS[g])}</span><span class="small text-body-secondary">${list.length} accounts</span></div>
      <div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report"><thead><tr><th style="width:90px">Code</th><th>Account</th><th>Type</th><th class="num">Balance</th></tr></thead><tbody>
      ${list.map((a) => {
        const b = bal(a.id);
        const natural = a.normal === 'dr' ? b : -b;
        return `<tr role="button" style="cursor:pointer" data-act="open" data-id="${esc(a.id)}"><td class="fw-semibold">${esc(a.code)}</td><td>${esc(a.name)}${a.system ? '' : ' <span class="badge text-bg-light">custom</span>'}</td>
          <td class="small text-body-secondary">${esc(KINDS[a.kind] || a.kind)}</td><td class="num">${balanceText(natural, 'dr')}</td></tr>`;
      }).join('')}</tbody></table></div></div>`).join('')}`;
  const $el = $(el).off();
  $el.on('click', '[data-act="open"]', function () { location.hash = `#/accounts/${encodeURIComponent(this.dataset.id)}`; });
  $el.on('click', '[data-act="add"]', async () => {
    const v = await UI.formModal({
      title: 'Add account', submitLabel: 'Save account',
      body: `<div class="row g-3">
        <div class="col-md-4"><label class="form-label small">Code</label><input class="form-control" name="code" placeholder="e.g. 5230" required></div>
        <div class="col-md-8"><label class="form-label small">Name</label><input class="form-control" name="name" required></div>
        <div class="col-md-6"><label class="form-label small">Group</label><select class="form-select" name="group">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="col-md-6"><label class="form-label small">Type</label><select class="form-select" name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="col-12 small text-body-secondary">Cash, bank and wallet types appear in payment lists. Choose "Contra" for accounts that reduce their group, such as drawings.</div></div>`,
      onSubmit: async (f) => {
        const code = String(f.code || '').trim();
        if (!code || !f.name?.trim()) throw new Error('Enter the code and name.');
        const dup = books.accountList.find((a) => a.code === code);
        if (dup) throw new Error(`Code ${code} is used by ${dup.name}.`);
        const normal = f.group === 'asset' || f.group === 'expense' ? 'dr' : 'cr';
        const contraNormal = f.kind === 'contra' ? (normal === 'dr' ? 'cr' : 'dr') : normal;
        await write(['accounts'], (t) => t.put('accounts', { id: uuid(), code, name: f.name.trim(), group: f.group, kind: f.kind, normal: contraNormal, system: false, active: true, createdAt: nowISO() }));
        return true;
      },
    });
    if (v) { UI.toast('Account added'); render(el, ctx); }
  });
}

async function renderLedger(el, id) {
  const state = { from: monthStart(today()), to: today() };
  const $el = $(el).off();
  const draw = async () => {
    const books = await loadBooks();
    const acc = books.accounts.get(id);
    if (!acc) { el.querySelector('#led').innerHTML = UI.emptyState('Account not found', 'question-circle'); return; }
    const led = ledgerOf(books, id, { from: state.from, to: state.to });
    el.querySelector('#led').innerHTML = `<div class="card p-3">${ledgerTable(led, { natural: acc.normal, showParty: true })}</div>`;
    el.__rows = led.rows.map((r) => [r.date, r.refNo || '', r.partyName, r.memo || '', r.debit, r.credit, r.running]);
    el.__acc = acc;
  };
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap no-print">
      <a class="btn btn-light btn-sm" href="#/accounts" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <div class="flex-grow-1 min-w-0"><h1 class="h5 mb-0 text-truncate" id="led-title"></h1><div class="small text-body-secondary" id="led-sub"></div></div>
      <button class="btn btn-outline-secondary btn-sm" data-act="csv"><i class="bi bi-filetype-csv me-1"></i>CSV</button>
      <button class="btn btn-outline-secondary btn-sm" data-act="print"><i class="bi bi-printer me-1"></i>Print</button></div>
    ${dateFilter(state.from, state.to)}<div id="led"></div>`;
  const books = await loadBooks();
  const acc = books.accounts.get(id);
  if (acc) { el.querySelector('#led-title').textContent = `${acc.code} · ${acc.name}`; el.querySelector('#led-sub').textContent = KINDS[acc.kind] || acc.kind; }
  await draw();
  bindDateFilter($el, async (f, t) => { state.from = f; state.to = t; await draw(); });
  $el.on('click', '[data-act="print"]', () => window.print());
  $el.on('click', '[data-act="csv"]', () => {
    if (!el.__rows) return;
    downloadFile(`ledger-${el.__acc?.code || id}.csv`, toCSV([['Date', 'Ref', 'Party', 'Details', 'Debit', 'Credit', 'Running'], ...el.__rows]), 'text/csv');
  });
}

export default {
  render,
  destroy() {},
};
