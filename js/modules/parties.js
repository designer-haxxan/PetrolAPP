// Parties: customers (udhaar), suppliers and OMCs, employees, and investors.
// Each party has a statement, quick actions (receive, pay, salary, advance, profit) and, for investors, a profit-share view.
import { getAll, get, write } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, uuid, nowISO, today, fmtDate, toCSV, downloadFile } from '../core/utils.js';
import { fmt, money, parseAmount, rnd, balanceText } from '../core/money.js';
import { loadBooks, partyLedger, incomeStatement } from '../services/finance.js';
import { postVoucher } from '../services/posting.js';
import { dateFilter, bindDateFilter, refLink } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

const KINDS = {
  customer: {
    title: 'Customers (udhaar)', one: 'customer', icon: 'person-lines-fill', tint: 'tint-amber', perm: 'sale',
    balance: 'Receivable (owes us)', action: { label: 'Receive payment', type: 'receipt' },
    fields: [['name', 'Name', 'text', true], ['phone', 'Phone', 'text'], ['cnic', 'CNIC / NTN', 'text'], ['address', 'Address', 'text'], ['creditLimit', 'Credit limit (Rs)', 'number']],
  },
  supplier: {
    title: 'Suppliers & OMCs', one: 'supplier', icon: 'building', tint: 'tint-indigo', perm: 'purchase',
    balance: 'Payable (we owe)', action: { label: 'Pay supplier', type: 'pay_supplier' },
    fields: [['name', 'Company / supplier name', 'text', true], ['phone', 'Phone', 'text'], ['address', 'Address', 'text'], ['ntn', 'NTN / STRN', 'text'], ['contact', 'Contact person', 'text']],
  },
  employee: {
    title: 'Employees', one: 'employee', icon: 'person-badge', tint: 'tint-green', perm: 'master',
    balance: 'Advance outstanding', action: { label: 'Pay salary', type: 'salary', second: { label: 'Give advance', type: 'advance' } },
    fields: [['name', 'Full name', 'text', true], ['designation', 'Designation', 'text'], ['phone', 'Phone', 'text'], ['cnic', 'CNIC', 'text'], ['salary', 'Monthly salary (Rs)', 'number'], ['joinDate', 'Joining date', 'date']],
  },
  investor: {
    title: 'Investors', one: 'investor', icon: 'piggy-bank', tint: 'tint-violet', perm: 'accounts',
    balance: 'Capital balance (credit)', action: { label: 'Record profit paid', type: 'profit_share', second: { label: 'Capital received', type: 'capital' } },
    fields: [['name', 'Investor name', 'text', true], ['phone', 'Phone', 'text'], ['cnic', 'CNIC', 'text'], ['sharePct', 'Profit share (%)', 'number'], ['notes', 'Notes', 'text']],
  },
};

const ROUTE = { customer: 'customers', supplier: 'suppliers', employee: 'employees', investor: 'investors' };
const KIND_OF_ROUTE = { customers: 'customer', suppliers: 'supplier', employees: 'employee', investors: 'investor' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Balance shown in lists and statements. Customers and employees: positive = owed to us.
// Suppliers: positive = we owe. Investors: positive = capital still in the business.
function balanceFor(kind, books, id) {
  if (kind === 'employee') return books.entries.reduce((s, e) => (e.partyId === id && e.accountId === 'emp_adv' ? rnd(s + e.debit - e.credit) : s), 0);
  const net = partyLedger(books, id).net;
  return kind === 'customer' ? net : -net;
}

function subtitle(kind, p) {
  if (kind === 'investor') return `${p.phone ? esc(p.phone) + ' · ' : ''}${Number(p.sharePct || 0)}% profit share`;
  if (kind === 'employee') return [p.designation, p.phone].filter(Boolean).map(esc).join(' · ');
  return esc(p.phone || p.address || '');
}

async function render(el, ctx) {
  const kind = KIND_OF_ROUTE[ctx.route];
  if (ctx.params[0]) return renderStatement(el, kind, ctx.params[0]);
  el.innerHTML = UI.spinner('Loading…');
  const [parties, books] = await Promise.all([getAll('parties'), loadBooks()]);
  const cfg = KINDS[kind];
  const rows = parties.filter((p) => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ p, bal: balanceFor(kind, books, p.id) }));
  const total = rnd(rows.reduce((s, r) => s + r.bal, 0));
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">${esc(cfg.title)}</h1>
      <button class="btn btn-primary btn-sm" data-act="new" ${Auth.can(cfg.perm) ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>Add ${esc(cfg.one)}</button></div>
    <div class="row g-3 mb-3">
      <div class="col-md-4"><div class="kpi" style="--tint:var(--brand)"><div class="kpi-label">${esc(cfg.balance)}</div><div class="kpi-value">${money(Math.abs(total))}</div><div class="kpi-sub">${rows.length} ${esc(cfg.title.toLowerCase())}</div></div></div>
      <div class="col-md-8"><div class="input-group"><span class="input-group-text"><i class="bi bi-search"></i></span><input class="form-control" id="q" placeholder="Search by name or phone"></div></div>
    </div>
    <div class="list-card">${rows.length ? rows.map((r, i) => `<button class="list-row" data-act="open" data-id="${esc(r.p.id)}" data-q="${esc((r.p.name + ' ' + (r.p.phone || '')).toLowerCase())}" style="animation:rise .45s var(--ease) both;animation-delay:${Math.min(i, 14) * 40}ms">
        <span class="avatar ${cfg.tint}">${esc(initials(r.p.name))}</span>
        <span class="flex-grow-1 min-w-0"><span class="d-block fw-semibold text-truncate">${esc(r.p.name)}</span><span class="d-block small text-body-secondary text-truncate">${subtitle(kind, r.p)}</span></span>
        <span class="text-end">${balanceText(r.bal, kind === 'supplier' || kind === 'investor' ? 'cr' : 'dr')}</span></button>`).join('')
      : UI.emptyState(`No ${cfg.title.toLowerCase()} yet`, cfg.icon, Auth.can(cfg.perm) ? '<button class="btn btn-primary mt-3" data-act="new">Add</button>' : '')}</div>`;

  const $el = $(el).off();
  const again = () => render(el, ctx);
  $el.on('input', '#q', function () {
    const q = this.value.trim().toLowerCase();
    $el.find('[data-q]').each((_, r) => $(r).toggle(!q || r.dataset.q.includes(q)));
  });
  $el.on('click', '[data-act="open"]', function () { location.hash = `#/${ROUTE[kind]}/${encodeURIComponent(this.dataset.id)}`; });
  $el.on('click', '[data-act="new"]', async () => { if (await openForm(kind, null)) again(); });
}

async function openForm(kind, party) {
  const cfg = KINDS[kind];
  const body = `<div class="row g-3">${cfg.fields.map(([key, label, type, req]) => `<div class="${key === 'address' || key === 'notes' ? 'col-12' : 'col-md-6'}">
      <label class="form-label small">${esc(label)}</label>
      <input type="${type}" ${type === 'number' ? 'step="0.0001" min="0" class="form-control money-input"' : 'class="form-control"'} name="${key}" value="${esc(party?.[key] ?? '')}" ${req ? 'required' : ''}></div>`).join('')}</div>`;
  return UI.formModal({
    title: party ? `Edit ${cfg.one}` : `Add ${cfg.one}`, body, submitLabel: party ? 'Update' : 'Save',
    onSubmit: async (f) => {
      if (!f.name?.trim()) throw new Error('Enter the name.');
      const row = { ...(party || { id: uuid(), kind, createdAt: nowISO() }), updatedAt: nowISO(), active: party ? party.active !== false : true };
      for (const [key, , type] of cfg.fields) row[key] = type === 'number' ? (parseAmount(f[key]) ?? 0) : String(f[key] ?? '').trim();
      if (kind === 'investor' && (row.sharePct < 0 || row.sharePct > 100)) throw new Error('Profit share must be between 0 and 100.');
      row.nameLc = row.name.toLowerCase();
      await write(['parties'], (t) => t.put('parties', row));
      UI.toast(party ? 'Saved' : `${cap(cfg.one)} added`);
      return true;
    },
  });
}

// ---------------------------------------------------------------- statement of one party
async function renderStatement(el, kind, id) {
  const cfg = KINDS[kind];
  el.innerHTML = UI.spinner();
  const party = await get('parties', id);
  if (!party || party.kind !== kind) { el.innerHTML = UI.emptyState('Not found.', 'question-circle'); return; }
  const state = { from: '2000-01-01', to: today(), rows: [] };
  const $el = $(el).off();

  const draw = async () => {
    const books = await loadBooks();
    const led = partyLedger(books, id, state.from, state.to);
    const bal = balanceFor(kind, books, id);
    let running = 0;
    state.rows = led.rows.map((e) => { running = rnd(running + e.debit - e.credit); return { ...e, running }; });
    el.querySelector('#stmt-body').innerHTML = `
      <div class="row g-3 mb-3">
        <div class="col-md-4"><div class="kpi" style="--tint:var(--brand)"><div class="kpi-label">${esc(cfg.balance)}</div><div class="kpi-value">${money(Math.abs(bal))}</div></div></div>
        <div class="col-md-4"><div class="kpi" style="--tint:#16a34a"><div class="kpi-label">Debits (period)</div><div class="kpi-value">${money(led.dr)}</div></div></div>
        <div class="col-md-4"><div class="kpi" style="--tint:#dc2626"><div class="kpi-label">Credits (period)</div><div class="kpi-value">${money(led.cr)}</div></div></div>
      </div>
      ${kind === 'investor' ? investorBlock(books, party, state) : ''}
      <div class="list-card"><div class="p-3 pb-2 d-flex align-items-center justify-content-between flex-wrap gap-2"><div class="fw-semibold">Statement</div>
        <div class="d-flex gap-2 no-print"><button class="btn btn-sm btn-outline-secondary" data-act="csv"><i class="bi bi-filetype-csv me-1"></i>CSV</button><button class="btn btn-sm btn-outline-secondary" data-act="print"><i class="bi bi-printer me-1"></i>Print</button></div></div>
      <div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0 table-report"><thead><tr><th>Date</th><th>Ref</th><th>Account</th><th>Details</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Running</th></tr></thead>
      <tbody>${state.rows.length ? state.rows.map((e) => `<tr><td class="text-nowrap">${fmtDate(e.date)}</td><td class="text-nowrap">${refLink(e.refType, e.refId, e.refNo || '')}</td><td class="small">${esc(e.accountName)}</td><td class="small">${esc(e.memo || '')}</td>
        <td class="num">${e.debit ? fmt(e.debit) : ''}</td><td class="num">${e.credit ? fmt(e.credit) : ''}</td><td class="num fw-semibold">${fmt(e.running)}</td></tr>`).join('') : '<tr><td colspan="7" class="text-center text-body-secondary py-4">No entries in this period</td></tr>'}</tbody></table></div></div>`;
  };

  const quick = cfg.action ? `<button class="btn btn-primary btn-sm" data-act="quick" data-type="${cfg.action.type}">${esc(cfg.action.label)}</button>`
    + (cfg.action.second ? `<button class="btn btn-outline-primary btn-sm" data-act="quick" data-type="${cfg.action.second.type}">${esc(cfg.action.second.label)}</button>` : '') : '';
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap no-print">
      <a class="btn btn-light btn-sm" href="#/${ROUTE[kind]}" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <div class="flex-grow-1 min-w-0"><h1 class="h5 mb-0 text-truncate">${esc(party.name)}</h1><div class="small text-body-secondary">${cap(cfg.one)}${party.phone ? ' · ' + esc(party.phone) : ''}</div></div>
      ${Auth.can(cfg.perm) ? quick : ''}
      <button class="btn btn-outline-secondary btn-sm" data-act="edit"><i class="bi bi-pencil me-1"></i>Edit</button></div>
    ${dateFilter(state.from, state.to)}
    <div id="stmt-body"></div>`;
  await draw();
  bindDateFilter($el, async (f, t) => { state.from = f; state.to = t; await draw(); });
  $el.on('click', '[data-act="edit"]', async () => { if (await openForm(kind, party)) renderStatement(el, kind, id); });
  $el.on('click', '[data-act="print"]', () => window.print());
  $el.on('click', '[data-act="csv"]', () => {
    const rows = state.rows.map((e) => [e.date, e.refNo || '', e.accountName, e.memo || '', e.debit, e.credit, e.running]);
    downloadFile(`${party.name}-statement.csv`, toCSV([['Date', 'Ref', 'Account', 'Details', 'Debit', 'Credit', 'Running'], ...rows]), 'text/csv');
  });
  $el.on('click', '[data-act="quick"]', async function () {
    if (await quickAction(this.dataset.type, party)) { UI.toast('Posted'); draw(); }
  });
}

async function quickAction(type, party) {
  const books = await loadBooks();
  const bal = balanceFor(party.kind, books, party.id);
  const payAccounts = (await getAll('accounts')).filter((a) => ['cash', 'bank', 'wallet'].includes(a.kind) && a.active !== false);
  const label = { receipt: 'Receive payment', pay_supplier: 'Pay supplier', salary: 'Pay salary', advance: 'Give advance', profit_share: 'Record profit paid', capital: 'Capital received' }[type];
  const suggested = { salary: party.salary, profit_share: Math.max(0, profitDue(books, party)), receipt: Math.max(0, bal), pay_supplier: Math.max(0, bal) }[type];
  const hint = {
    receipt: `Current udhaar: ${money(Math.max(0, bal))}.`,
    pay_supplier: `Current payable: ${money(Math.max(0, bal))}.`,
    profit_share: `Profit due this year so far: ${money(Math.max(0, profitDue(books, party)))}.`,
  }[type] || '';
  return UI.formModal({
    title: `${label} · ${party.name}`, submitLabel: 'Save & post',
    body: `<div class="row g-3">
      <div class="col-md-6"><label class="form-label small">Amount (Rs)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="amount" value="${suggested ? Number(suggested).toFixed(4) : ''}" required></div>
      <div class="col-md-6"><label class="form-label small">${type === 'receipt' || type === 'advance' || type === 'capital' ? 'Into account' : 'Paid from'}</label><select class="form-select" name="accountId">${payAccounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label small">Date</label><input type="date" class="form-control" name="date" value="${today()}"></div>
      <div class="col-12"><label class="form-label small">Reference / note</label><input class="form-control" name="memo" placeholder="Cheque no., receipt no., note"></div>
      ${hint ? `<div class="col-12 small text-body-secondary">${esc(hint)}</div>` : ''}
    </div>`,
    onSubmit: async (f) => {
      const amount = parseAmount(f.amount);
      if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
      await postVoucher({ type, date: f.date || today(), accountId: f.accountId, partyId: party.id, amount, memo: f.memo || label });
      return true;
    },
  });
}

// Profit share: the investor's share of net profit from the start of the year to today, less profit already paid.
function profitDue(books, party) {
  const pl = incomeStatement(books, today().slice(0, 4) + '-01-01', today());
  const share = rnd(pl.netProfit * (Number(party.sharePct) || 0) / 100);
  const paid = books.entries.reduce((s, e) => (e.partyId === party.id && e.accountId === 'profit_dist' ? rnd(s + e.debit - e.credit) : s), 0);
  return rnd(share - paid);
}

function investorBlock(books, party, state) {
  const pl = incomeStatement(books, state.from, state.to);
  const share = rnd(pl.netProfit * (Number(party.sharePct) || 0) / 100);
  const sumOf = (acc, sign) => books.entries.reduce((s, e) => (e.partyId === party.id && e.accountId === acc ? rnd(s + sign * (e.credit - e.debit)) : s), 0);
  return `<div class="card p-3 mb-3"><div class="fw-semibold mb-2">Investor summary · ${esc(party.name)}</div>
    <div class="row g-3">
      <div class="col-md-3 col-6"><div class="small text-body-secondary">Capital contributed</div><div class="fw-bold">${money(sumOf('capital', 1))}</div></div>
      <div class="col-md-3 col-6"><div class="small text-body-secondary">Drawings</div><div class="fw-bold">${money(sumOf('drawings', -1))}</div></div>
      <div class="col-md-3 col-6"><div class="small text-body-secondary">Profit share (${esc(String(party.sharePct || 0))}%) for period</div><div class="fw-bold">${money(share)}</div><div class="small text-body-secondary">Company net profit ${money(pl.netProfit)}</div></div>
      <div class="col-md-3 col-6"><div class="small text-body-secondary">Profit paid to date</div><div class="fw-bold">${money(sumOf('profit_dist', -1))}</div></div>
    </div></div>`;
}

export default {
  render,
  destroy() {},
};
