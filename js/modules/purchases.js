// Purchases: fuel received from OMCs into a chosen tank, goods bought for stock, extra charges
// (freight, levy, handling), payment now and the rest on credit (payable to the supplier).
import { getAll, get } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtTime, today } from '../core/utils.js';
import { fmt, fmtQty, money, parseAmount, rnd } from '../core/money.js';
import { postPurchase, voidPurchase } from '../services/posting.js';
import { statusBadge, refLink } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function data() {
  const [products, parties, accounts, tanks, purchases] = await Promise.all([getAll('products'), getAll('parties'), getAll('accounts'), getAll('tanks'), getAll('purchases')]);
  return {
    products: products.filter((p) => p.active !== false).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    suppliers: parties.filter((p) => p.kind === 'supplier' && p.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    payAccounts: accounts.filter((a) => ['cash', 'bank', 'wallet'].includes(a.kind) && a.active !== false),
    extraAccounts: accounts.filter((a) => (a.group === 'expense' && a.kind === 'expense') || a.id === 'levy_payable'),
    tanks: tanks.filter((t) => t.active !== false),
    purchases: purchases.sort((a, b) => (a.number < b.number ? 1 : -1)),
  };
}

const lineAmount = (l) => rnd(l.qty * l.rate);

function layout(d) {
  const supOpts = `<option value="">Cash purchase (no supplier)</option>${d.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}`;
  const payOpts = d.payAccounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  const exOpts = d.extraAccounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  return `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">New purchase</h1></div>
    <div class="card p-3 p-md-4 page-enter">
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label small mb-1">Date</label><input type="date" class="form-control" id="p-date" value="${today()}"></div>
        <div class="col-md-4"><label class="form-label small mb-1">Supplier / OMC</label><select class="form-select" id="p-sup">${supOpts}</select></div>
        <div class="col-md-4"><label class="form-label small mb-1">Invoice / challan no.</label><input class="form-control" id="p-inv" placeholder="Optional"></div>
      </div>
      <div class="d-flex align-items-center justify-content-between mt-4 mb-2"><div class="fw-semibold">Items received</div><button class="btn btn-sm btn-outline-primary" data-act="add-line"><i class="bi bi-plus-lg"></i> Add item</button></div>
      <div class="table-responsive"><table class="table table-sm align-middle" id="lines"><thead><tr><th style="min-width:180px">Product</th><th style="min-width:150px">Tank (fuel)</th><th style="width:130px">Quantity</th><th style="width:130px">Rate</th><th class="num">Amount</th><th></th></tr></thead><tbody></tbody></table></div>
      <div class="d-flex align-items-center justify-content-between mt-3 mb-2"><div class="fw-semibold">Other charges <span class="small text-body-secondary fw-normal">(freight, levy, handling)</span></div><button class="btn btn-sm btn-outline-primary" data-act="add-extra"><i class="bi bi-plus-lg"></i> Add charge</button></div>
      <div id="extras" data-opts="${esc(exOpts)}"></div>
      <div class="row g-3 mt-2">
        <div class="col-lg-6">
          <div class="row g-2">
            <div class="col-7"><label class="form-label small mb-1">Paid now</label><input type="number" step="0.0001" min="0" class="form-control money-input" id="p-paid" placeholder="0.0000"></div>
            <div class="col-5"><label class="form-label small mb-1">Paid from</label><select class="form-select" id="p-acc">${payOpts}</select></div>
            <div class="col-12"><div class="small text-body-secondary">Anything not paid now is added to the supplier's payable.</div></div>
          </div>
        </div>
        <div class="col-lg-6"><div class="summary-box" id="p-sum"></div></div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <a class="btn btn-light" href="#/purchases">Cancel</a>
        <button class="btn btn-primary px-4" data-act="save" ${Auth.can('purchase') ? '' : 'disabled'}><i class="bi bi-check2-circle me-1"></i>Save purchase</button>
      </div>
    </div>
    <div class="list-card mt-4"><div class="p-3 pb-2 fw-semibold">Recent purchases</div>${listHtml(d)}</div>`;
}

function listHtml(d) {
  const list = d.purchases.slice(0, 40);
  if (!list.length) return UI.emptyState('No purchases yet', 'truck');
  return `<div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report"><thead><tr><th>No.</th><th>Date</th><th>Supplier</th><th>Invoice</th><th class="num">Total</th><th class="num">Payable</th><th>Status</th></tr></thead><tbody>
    ${list.map((p) => `<tr role="button" style="cursor:pointer" data-act="open" data-id="${esc(p.id)}"><td class="fw-semibold">${esc(p.number)}</td><td>${fmtDate(p.date)}</td><td>${esc(p.supplierName)}</td><td>${esc(p.invoiceNo || '')}</td>
      <td class="num">${fmt(p.total)}</td><td class="num">${fmt(p.payable)}</td><td>${statusBadge(p.status)}</td></tr>`).join('')}</tbody></table></div>`;
}

function lineRow(d, i, l = {}) {
  const prodOpts = `<option value="">Choose…</option>${d.products.map((p) => `<option value="${esc(p.id)}" data-cat="${esc(p.category)}" ${p.id === l.productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const tankOpts = `<option value="">Choose tank…</option>${d.tanks.filter((t) => !l.productId || t.productId === l.productId).map((t) => `<option value="${esc(t.id)}" ${t.id === l.tankId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}`;
  return `<tr data-i="${i}">
    <td><select class="form-select form-select-sm" data-field="productId">${prodOpts}</select></td>
    <td><select class="form-select form-select-sm" data-field="tankId">${tankOpts}</select></td>
    <td><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-field="qty" value="${l.qty ?? ''}" placeholder="0.0000"></td>
    <td><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-field="rate" value="${l.rate ?? ''}" placeholder="0.0000"></td>
    <td class="num fw-semibold" data-amt>${fmt(lineAmount({ qty: l.qty || 0, rate: l.rate || 0 }))}</td>
    <td><button class="btn btn-sm btn-link text-danger p-0" data-act="rm-line" aria-label="Remove"><i class="bi bi-x-lg"></i></button></td></tr>`;
}

function extraRow(opts, i) {
  return `<div class="row g-2 align-items-center mb-2" data-x="${i}">
    <div class="col-md-4"><input class="form-control form-control-sm" data-field="label" placeholder="Label e.g. Freight"></div>
    <div class="col-md-4"><select class="form-select form-select-sm" data-field="accountId">${opts}</select></div>
    <div class="col-md-3"><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-field="amount" placeholder="0.0000"></div>
    <div class="col-md-1"><button class="btn btn-sm btn-link text-danger p-0" data-act="rm-x" aria-label="Remove"><i class="bi bi-x-lg"></i></button></div></div>`;
}

function collect(el) {
  const $el = $(el);
  const lines = $el.find('#lines tbody tr').map((_, tr) => {
    const $tr = $(tr);
    return { productId: $tr.find('[data-field=productId]').val(), tankId: $tr.find('[data-field=tankId]').val(), qty: parseAmount($tr.find('[data-field=qty]').val()) || 0, rate: parseAmount($tr.find('[data-field=rate]').val()) || 0, cat: $tr.find('[data-field=productId] option:selected').data('cat') };
  }).get();
  const extras = $el.find('[data-x]').map((_, row) => ({ label: $(row).find('[data-field=label]').val(), accountId: $(row).find('[data-field=accountId]').val(), amount: parseAmount($(row).find('[data-field=amount]').val()) || 0 })).get();
  return { lines, extras };
}

function recalc(el) {
  const $el = $(el);
  const { lines, extras } = collect(el);
  let sub = 0; let tax = 0;
  for (const l of lines) {
    if (!l.productId) continue;
    const amt = rnd(l.qty * l.rate);
    $el.find(`#lines tbody tr`).eq(lines.indexOf(l)).find('[data-amt]').text(fmt(amt));
    sub = rnd(sub + amt);
    const p = (window.__productTax || {})[l.productId] || 0;
    tax = rnd(tax + rnd(amt * p / 100));
  }
  const ex = rnd(extras.reduce((s, x) => s + (x.amount || 0), 0));
  const total = rnd(sub + tax + ex);
  const paid = parseAmount($el.find('#p-paid').val()) || 0;
  $el.find('#p-sum').html(`<div class="row-line"><span>Subtotal</span><span>${fmt(sub)}</span></div>
    <div class="row-line"><span>Input sales tax</span><span>${fmt(tax)}</span></div>
    <div class="row-line"><span>Other charges</span><span>${fmt(ex)}</span></div>
    <div class="row-line total"><span>Invoice total</span><span>${money(total)}</span></div>
    <div class="row-line small"><span>Paid now</span><span>${money(Math.min(paid, total))}</span></div>
    <div class="row-line small text-warning fw-semibold"><span>Payable to supplier</span><span>${money(Math.max(0, rnd(total - paid)))}</span></div>`);
}

async function render(el, ctx) {
  if (ctx.params[0]) return renderDetail(el, ctx.params[0]);
  el.innerHTML = UI.spinner('Loading purchases…');
  const d = await data();
  window.__productTax = Object.fromEntries(d.products.map((p) => [p.id, Number(p.taxRate) || 0]));
  el.innerHTML = layout(d);
  const $el = $(el).off();
  $el.find('#lines tbody').append(lineRow(d, 0));
  recalc(el);

  $el.on('click', '[data-act="add-line"]', () => { $el.find('#lines tbody').append(lineRow(d, Date.now())); recalc(el); });
  $el.on('click', '[data-act="rm-line"]', function () { $(this).closest('tr').remove(); recalc(el); });
  $el.on('click', '[data-act="add-extra"]', () => { $el.find('#extras').append(extraRow($el.find('#extras').attr('data-opts'), Date.now())); recalc(el); });
  $el.on('click', '[data-act="rm-x"]', function () { $(this).closest('[data-x]').remove(); recalc(el); });
  $el.on('change', '[data-field=productId]', function () {
    const tr = $(this).closest('tr');
    const cat = $(this).find('option:selected').data('cat');
    const tankSel = tr.find('[data-field=tankId]');
    tankSel.prop('disabled', cat !== 'fuel');
    tankSel.find('option').each((_, o) => { if (o.value) $(o).toggle(!this.value || d.tanks.find((t) => t.id === o.value)?.productId === this.value); });
    recalc(el);
  });
  $el.on('input change', 'input, select', () => recalc(el));

  $el.on('click', '[data-act="save"]', async function () {
    const $btn = $(this);
    try {
      const { lines, extras } = collect(el);
      const valid = lines.filter((l) => l.productId);
      if (!valid.length) throw new Error('Add at least one item.');
      const payLines = valid.map((l) => {
        if (!(l.qty > 0)) throw new Error('Enter the quantity of every item.');
        if (l.cat === 'fuel' && !l.tankId) throw new Error('Choose the tank that receives each fuel item.');
        return { productId: l.productId, tankId: l.tankId || null, qty: l.qty, rate: l.rate };
      });
      $btn.prop('disabled', true);
      const paid = parseAmount($el.find('#p-paid').val()) || 0;
      const doc = await postPurchase({
        date: $el.find('#p-date').val() || today(),
        supplierId: $el.find('#p-sup').val() || null,
        invoiceNo: $el.find('#p-inv').val().trim(),
        lines: payLines,
        extras: extras.filter((x) => x.amount > 0 && x.accountId),
        paid: paid > 0 ? [{ accountId: $el.find('#p-acc').val(), amount: paid }] : [],
      });
      UI.toast(`Purchase ${doc.number} saved · ${money(doc.total)}`);
      location.hash = `#/purchases/${encodeURIComponent(doc.id)}`;
    } catch (e) { UI.toastError(e); $btn.prop('disabled', false); }
  });
  $el.on('click', '[data-act="open"]', function () { location.hash = `#/purchases/${encodeURIComponent(this.dataset.id)}`; });
}

async function renderDetail(el, id) {
  el.innerHTML = UI.spinner();
  const p = await get('purchases', id);
  if (!p) { el.innerHTML = UI.emptyState('Purchase not found.', 'question-circle'); return; }
  const rows = p.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.tankId ? (l.tankName || 'Tank') : '')}</td><td class="num">${fmtQty(l.qty)}</td><td class="num">${fmt(l.rate)}</td><td class="num">${fmt(l.amount)}</td><td class="num">${fmt(l.tax)}</td></tr>`).join('');
  const ex = (p.extras || []).map((x) => `<tr><td colspan="5">${esc(x.label)}</td><td class="num">${fmt(x.amount)}</td></tr>`).join('');
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap no-print">
      <a class="btn btn-light btn-sm" href="#/purchases" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <h1 class="h5 mb-0 flex-grow-1">Purchase ${esc(p.number)} ${statusBadge(p.status)}</h1>
      <button class="btn btn-outline-secondary btn-sm" data-act="print"><i class="bi bi-printer me-1"></i>Print</button>
      ${p.status === 'posted' && Auth.can('accounts') ? '<button class="btn btn-outline-danger btn-sm" data-act="void"><i class="bi bi-x-circle me-1"></i>Void</button>' : ''}</div>
    <div class="card p-3 page-enter">
      <div class="small text-body-secondary mb-2">${fmtDate(p.date)} · ${esc(p.supplierName)} ${p.invoiceNo ? '· Invoice ' + esc(p.invoiceNo) : ''}</div>
      <div class="table-responsive"><table class="table table-sm align-middle table-report"><thead><tr><th>Item</th><th>Tank</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th class="num">Tax</th></tr></thead>
      <tbody>${rows}${ex}</tbody><tfoot><tr class="fw-semibold"><td colspan="5">Invoice total</td><td class="num">${money(p.total)}</td></tr><tr><td colspan="5">Paid now</td><td class="num">${money(p.paid.reduce((s, x) => s + x.amount, 0))}</td></tr><tr class="fw-semibold"><td colspan="5">Payable</td><td class="num">${money(p.payable)}</td></tr></tfoot></table></div>
      <div class="small text-body-secondary mt-2">Journal: ${refLink('purchase', p.id, p.number)}</div>
    </div>`;
  $(el).off().on('click', '[data-act="print"]', () => window.print());
  $(el).off().on('click', '[data-act="void"]', async function () {
    if (!await UI.confirmDialog(`Void purchase ${p.number}? Stock is removed again and the ledger entries are reversed.`, { okLabel: 'Void purchase', okClass: 'btn-danger' })) return;
    try { await voidPurchase(p.id); UI.toast('Purchase voided'); location.hash = '#/purchases'; } catch (e) { UI.toastError(e); }
  });
}

export default {
  render,
  destroy() { delete window.__productTax; },
};
