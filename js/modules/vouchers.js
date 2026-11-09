// Vouchers: receipts, payments, salaries, advances, investor capital and drawings, bank deposits and
// transfers, loans, expenses and asset payments, and manual journal vouchers. Every voucher is posted to the ledger.
import { getAll } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, today, monthStart } from '../core/utils.js';
import { fmt, money, parseAmount, rnd } from '../core/money.js';
import { postVoucher, voidVoucher, VOUCHER_TYPES } from '../services/posting.js';
import { dateFilter, bindDateFilter, statusBadge, refLink } from '../core/views.js';
import { pref } from '../core/settings.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function data() {
  const [accounts, parties, vouchers] = await Promise.all([getAll('accounts'), getAll('parties'), getAll('vouchers')]);
  return {
    accounts: accounts.filter((a) => a.active !== false).sort((a, b) => a.code.localeCompare(b.code)),
    parties: parties.sort((a, b) => a.name.localeCompare(b.name)),
    vouchers: vouchers.sort((a, b) => (a.number < b.number ? 1 : -1)),
  };
}

const MONEY_KINDS = ['cash', 'bank', 'wallet'];

function accountOptions(list, selected = '', filter = () => true) {
  return list.filter(filter).map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('');
}

function formBody(d, type) {
  const money_ = d.accounts.filter((a) => MONEY_KINDS.includes(a.kind));
  const otherCandidates = d.accounts.filter((a) => !MONEY_KINDS.includes(a.kind) && ['asset', 'expense', 'liability'].includes(a.group) && !['ar', 'ap'].includes(a.id));
  const typeOpts = Object.entries(VOUCHER_TYPES).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  return `<div class="row g-3">
    <div class="col-12"><label class="form-label small">Voucher type</label><select class="form-select" name="type" id="v-type">${typeOpts}</select></div>
    <div class="col-md-6" id="row-date"><label class="form-label small">Date</label><input type="date" class="form-control" name="date" value="${today()}"></div>
    <div class="col-md-6" id="row-amt"><label class="form-label small">Amount (Rs)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="amount" placeholder="0.0000"></div>
    <div class="col-12" id="row-party"><label class="form-label small" id="party-label">Party</label><select class="form-select" name="partyId" id="v-party"></select></div>
    <div class="col-12" id="row-acc"><label class="form-label small" id="acc-label">Cash / bank / wallet</label><select class="form-select" name="accountId">${accountOptions(money_)}</select></div>
    <div class="col-12 d-none" id="row-other"><label class="form-label small" id="other-label">Account</label><select class="form-select" name="otherAccountId" id="v-other">${accountOptions(otherCandidates)}</select></div>
    <div class="col-12" id="row-memo"><label class="form-label small">Description / reference</label><input class="form-control" name="memo" placeholder="e.g. cheque no., bill no., reason"></div>
    <div class="col-12 d-none" id="row-journal">
      <div class="d-flex align-items-center justify-content-between mb-2"><div class="fw-semibold">Journal lines</div><button class="btn btn-sm btn-outline-primary" type="button" data-act="j-add"><i class="bi bi-plus-lg"></i> Line</button></div>
      <div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Account</th><th style="width:130px">Debit</th><th style="width:130px">Credit</th><th style="width:160px">Party</th><th></th></tr></thead><tbody id="j-lines"></tbody>
      <tfoot><tr class="fw-semibold"><td>Totals</td><td class="num" id="j-dr">0.0000</td><td class="num" id="j-cr">0.0000</td><td colspan="2" id="j-chk" class="small"></td></tr></tfoot></table></div>
    </div>
  </div>`;
}

const PARTY_KIND = (t) => VOUCHER_TYPES[t]?.party;

// Shows the fields that apply to the chosen voucher type.
function applyType($m, d, type) {
  const spec = VOUCHER_TYPES[type] || {};
  const isJournal = type === 'journal';
  $m.find('#row-journal').toggleClass('d-none', !isJournal);
  $m.find('#row-amt, #row-acc').toggleClass('d-none', isJournal);
  // Account labels
  const other = spec.other;
  $m.find('#acc-label').text(type === 'transfer' ? 'Money account paid out of' : 'Cash / bank / wallet');
  $m.find('#row-other').toggleClass('d-none', !other);
  $m.find('#other-label').text(type === 'transfer' ? 'Money account received in' : (other || 'Account'));
  if (type === 'transfer') {
    $m.find('#v-other').html(accountOptions(d.accounts.filter((a) => MONEY_KINDS.includes(a.kind))));
  } else if (other) {
    $m.find('#v-other').html(accountOptions(d.accounts.filter((a) => !MONEY_KINDS.includes(a.kind) && ['asset', 'expense', 'liability'].includes(a.group) && !['ar', 'ap'].includes(a.id))));
  }
  // Party
  const pk = PARTY_KIND(type);
  $m.find('#row-party').toggleClass('d-none', !pk || isJournal);
  if (pk) {
    const list = pk === 'optional' ? d.parties : d.parties.filter((p) => p.kind === pk);
    $m.find('#party-label').text({ customer: 'Customer', supplier: 'Supplier / OMC', employee: 'Employee', investor: 'Investor', optional: 'Party (optional)' }[pk]);
    $m.find('#v-party').html(`<option value="">${pk === 'optional' ? 'None' : 'Choose…'}</option>${list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.kind)}</option>`).join('')}`);
  }
}

function journalRow(d, i) {
  const opts = accountOptions(d.accounts);
  const parties = `<option value="">—</option>${d.parties.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  return `<tr data-j="${i}"><td><select class="form-select form-select-sm" data-f="accountId"><option value="">Choose…</option>${opts}</select></td>
    <td><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-f="debit" placeholder="0.0000"></td>
    <td><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-f="credit" placeholder="0.0000"></td>
    <td><select class="form-select form-select-sm" data-f="partyId">${parties}</select></td>
    <td><button type="button" class="btn btn-sm btn-link text-danger p-0" data-act="j-rm"><i class="bi bi-x-lg"></i></button></td></tr>`;
}

function journalTotals($m) {
  let dr = 0; let cr = 0;
  $m.find('#j-lines tr').each((_, tr) => {
    dr = rnd(dr + (parseAmount($(tr).find('[data-f=debit]').val()) || 0));
    cr = rnd(cr + (parseAmount($(tr).find('[data-f=credit]').val()) || 0));
  });
  $m.find('#j-dr').text(fmt(dr)); $m.find('#j-cr').text(fmt(cr));
  const ok = Math.abs(dr - cr) < 0.00005 && dr > 0;
  $m.find('#j-chk').html(ok ? '<span class="text-success"><i class="bi bi-check2-circle"></i> Balanced</span>' : `<span class="text-danger">Difference ${fmt(Math.abs(dr - cr))}</span>`);
}

async function render(el, ctx) {
  el.innerHTML = UI.spinner('Loading vouchers…');
  const d = await data();
  const from = pref.get('vch.from', monthStart(today()));
  const to = pref.get('vch.to', today());
  el.innerHTML = page(d, from, to);
  bind(el, d, from, to);
}

function page(d, from, to) {
  const list = d.vouchers.filter((v) => v.date >= from && v.date <= to);
  const totals = list.filter((v) => v.status === 'posted').reduce((s, v) => { s[v.type] = rnd((s[v.type] || 0) + v.amount); return s; }, {});
  const cards = [['receipt', 'Received from customers', 'arrow-down-circle', '#16a34a'], ['pay_supplier', 'Paid to suppliers', 'arrow-up-circle', '#dc2626'], ['expense', 'Expenses & assets', 'receipt-cutoff', '#f97316']]
    .map(([t, label, icon, tint]) => `<div class="col-md-4"><div class="kpi" style="--tint:${tint}"><div class="kpi-icon"><i class="bi bi-${icon}"></i></div><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${money(totals[t] || 0)}</div></div></div>`).join('');
  return `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Vouchers & payments</h1>
      <button class="btn btn-primary btn-sm" data-act="new" ${Auth.can('voucher') ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>New voucher</button></div>
    <div class="row g-3 mb-3">${cards}</div>
    ${dateFilter(from, to)}
    <div class="list-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report"><thead><tr><th>No.</th><th>Date</th><th>Type</th><th>Party / details</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.length ? list.slice(0, 300).map((v) => `<tr><td class="fw-semibold text-nowrap">${refLink('voucher', v.id, v.number)}</td><td class="text-nowrap">${fmtDate(v.date)}</td>
        <td><span class="small">${esc(v.label || v.type)}</span></td><td><div class="fw-medium">${esc(v.partyName || '')}</div><div class="small text-body-secondary">${esc(v.memo || '')}</div></td>
        <td class="num">${fmt(v.amount)}</td><td>${statusBadge(v.status)}</td>
        <td class="text-end">${v.status === 'posted' && Auth.can('accounts') ? `<button class="btn btn-sm btn-link text-danger p-0" data-act="void" data-id="${esc(v.id)}" aria-label="Void"><i class="bi bi-x-circle"></i></button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="7">${UI.emptyState('No vouchers in this period', 'cash-coin')}</td></tr>`}</tbody></table></div></div>`;
}

function bind(el, d, from, to) {
  const $el = $(el).off();
  bindDateFilter($el, (f, t) => { pref.set('vch.from', f); pref.set('vch.to', t); render(el, { params: [] }); });
  $el.on('click', '[data-act="void"]', async function () {
    const v = d.vouchers.find((x) => x.id === this.dataset.id);
    if (!await UI.confirmDialog(`Void voucher ${v.number} (${v.label})? The ledger entries are reversed.`, { okLabel: 'Void', okClass: 'btn-danger' })) return;
    try { await voidVoucher(v.id); UI.toast('Voucher voided'); render(el, { params: [] }); } catch (e) { UI.toastError(e); }
  });
  $el.on('click', '[data-act="new"]', () => newVoucher(el, d));
}

async function newVoucher(el, d) {
  let journalSeq = 0;
  const v = await UI.formModal({
    title: 'New voucher', size: 'lg', submitLabel: 'Post voucher',
    body: formBody(d, 'receipt'),
    onShown: (m) => {
      const update = () => applyType(m, d, m.find('#v-type').val());
      m.on('change', '#v-type', () => {
        update();
        if (m.find('#v-type').val() === 'journal' && !m.find('#j-lines tr').length) { m.find('#j-lines').append(journalRow(d, journalSeq++), journalRow(d, journalSeq++)); }
        journalTotals(m);
      });
      m.on('click', '[data-act="j-add"]', () => { m.find('#j-lines').append(journalRow(d, journalSeq++)); journalTotals(m); });
      m.on('click', '[data-act="j-rm"]', function () { $(this).closest('tr').remove(); journalTotals(m); });
      m.on('input change', '#j-lines input, #j-lines select', () => journalTotals(m));
      update();
    },
    onSubmit: async (f, m) => {
      const type = f.type;
      if (type === 'journal') {
        const lines = m.find('#j-lines tr').map((_, tr) => ({
          accountId: $(tr).find('[data-f=accountId]').val(), debit: parseAmount($(tr).find('[data-f=debit]').val()) || 0,
          credit: parseAmount($(tr).find('[data-f=credit]').val()) || 0, partyId: $(tr).find('[data-f=partyId]').val() || null,
        })).get().filter((l) => l.accountId || l.debit || l.credit);
        if (lines.some((l) => !l.accountId)) throw new Error('Choose an account for each line.');
        const doc = await postVoucher({ type, date: f.date || today(), memo: f.memo || 'Journal voucher', lines });
        UI.toast(`Journal ${doc.number} posted`);
        return true;
      }
      const doc = await postVoucher({
        type, date: f.date || today(), accountId: f.accountId || null, otherAccountId: f.otherAccountId || null,
        partyId: f.partyId || null, amount: parseAmount(f.amount) || 0, memo: f.memo || '',
      });
      UI.toast(`${doc.number} posted · ${money(doc.amount)}`);
      return true;
    },
  });
  if (v) render(el, { params: [] });
}

export default {
  render,
  destroy() {},
};
