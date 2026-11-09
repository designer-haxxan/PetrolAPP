// Counter sales for lubricants and shop goods (fuel is sold through nozzles on Shifts).
// Cart with live totals, tax split, payment (cash / bank / wallet) and udhaar for the rest.
import { getAll, get } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtTime, today } from '../core/utils.js';
import { fmt, fmtQty, money, parseAmount, rnd } from '../core/money.js';
import { getSettings } from '../core/settings.js';
import { postSale, voidSale, splitTax } from '../services/posting.js';
import { statusBadge, dateFilter, bindDateFilter, refLink } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
let cart = [];
let customerId = '';

async function data() {
  const [products, parties, accounts, sales] = await Promise.all([getAll('products'), getAll('parties'), getAll('accounts'), getAll('sales')]);
  return {
    products: products.filter((p) => p.category === 'goods' && p.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    customers: parties.filter((p) => p.kind === 'customer' && p.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    payAccounts: accounts.filter((a) => ['cash', 'bank', 'wallet'].includes(a.kind) && a.active !== false),
    sales: sales.sort((a, b) => (a.number < b.number ? 1 : -1)),
  };
}

const lineTotals = (line, products) => {
  const p = products.find((x) => x.id === line.productId);
  const amount = rnd(line.qty * line.rate);
  const s = splitTax(amount, p?.taxRate || 0);
  return { ...s, amount };
};

function page(d) {
  const tiles = d.products.map((p) => `<button class="product-tile" data-act="add" data-id="${esc(p.id)}">
      <div class="pt-icon"><i class="bi bi-${p.unit === 'pc' ? 'box-seam' : 'droplet'}"></i></div>
      <div class="fw-semibold small text-truncate">${esc(p.name)}</div>
      <div class="small text-body-secondary">${p.price ? money(p.price) : 'Set price'} · stock ${fmtQty(p.stockQty)} ${esc(p.unit)}</div></button>`).join('');
  const custOpts = `<option value="">Walk-in customer</option>${d.customers.map((c) => `<option value="${esc(c.id)}" ${c.id === customerId ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join('')}`;
  const payOpts = d.payAccounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  return `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Counter sale · lubricants & shop</h1>
      <span class="small text-body-secondary d-none d-md-inline">Fuel is sold through nozzles on Shifts.</span></div>
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="card p-3">
          <div class="d-flex align-items-center justify-content-between mb-2"><div class="fw-semibold">Items</div>
            <input type="search" class="form-control form-control-sm w-auto" id="item-search" placeholder="Search item…" style="min-width:180px"></div>
          ${d.products.length ? `<div class="row g-2" id="tiles">${d.products.map((p) => `<div class="col-6 col-md-4 item-col" data-name="${esc(p.name.toLowerCase())}"><button class="product-tile" data-act="add" data-id="${esc(p.id)}">
            <div class="pt-icon"><i class="bi bi-${p.unit === 'pc' ? 'box-seam' : 'droplet'}"></i></div>
            <div class="fw-semibold small text-truncate">${esc(p.name)}</div>
            <div class="small text-body-secondary">${p.price ? money(p.price) : '<span class="text-danger">Set price</span>'}</div>
            <div class="small text-body-secondary">In stock: ${fmtQty(p.stockQty)} ${esc(p.unit)}</div></button></div>`).join('')}</div>` : UI.emptyState('No goods items yet. Add lubricants and shop items under Products & prices.', 'box-seam', '<a class="btn btn-primary mt-3" href="#/products">Add products</a>')}
        </div>
      </div>
      <div class="col-lg-5">
        <div class="card p-3 sticky-lg-top" style="top:80px">
          <div class="d-flex align-items-center justify-content-between"><div class="fw-semibold">Bill</div><button class="btn btn-sm btn-link text-danger p-0" data-act="clear">Clear</button></div>
          <div id="cart">${cartHtml(d)}</div>
          <div class="row g-2 mt-2">
            <div class="col-12"><label class="form-label small mb-1">Customer</label><select class="form-select form-select-sm" id="cust">${custOpts}</select></div>
            <div class="col-7"><label class="form-label small mb-1">Received now</label><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" id="paid" placeholder="0.0000"></div>
            <div class="col-5"><label class="form-label small mb-1">Into</label><select class="form-select form-select-sm" id="pay-acc">${payOpts}</select></div>
            <div class="col-12"><button class="btn btn-link btn-sm p-0" data-act="fill">Received full amount</button></div>
          </div>
          <div class="summary-box mt-2" id="summary"></div>
          <input class="form-control form-control-sm mt-2" id="memo" placeholder="Note (optional)">
          <button class="btn btn-primary btn-lg w-100 mt-3" data-act="save" ${Auth.can('sale') ? '' : 'disabled'}><i class="bi bi-check2-circle me-1"></i>Save sale</button>
        </div>
      </div>
    </div>
    <div class="list-card mt-4"><div class="p-3 pb-2 d-flex align-items-center justify-content-between"><div class="fw-semibold">Recent sales</div></div>
      <div class="p-3 pt-0"><div class="date-slot"></div></div>
      <div id="sale-list"></div></div>`;
}

function cartHtml(d) {
  if (!cart.length) return '<div class="text-center text-body-secondary py-4"><i class="bi bi-cart3 fs-3 d-block mb-1 opacity-50"></i>Tap an item to add it</div>';
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Item</th><th style="width:88px">Qty</th><th style="width:104px">Rate</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${cart.map((l, i) => {
      const p = d.products.find((x) => x.id === l.productId);
      return `<tr data-i="${i}"><td class="small fw-medium">${esc(p?.name || 'Item')}<div class="text-body-secondary">${esc(p?.unit || '')}</div></td>
      <td><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-field="qty" value="${l.qty}"></td>
      <td><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-field="rate" value="${l.rate}"></td>
      <td class="num fw-semibold" data-amt>${fmt(rnd(l.qty * l.rate))}</td>
      <td><button class="btn btn-sm btn-link text-danger p-0" data-act="rm" aria-label="Remove"><i class="bi bi-x-lg"></i></button></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function updateSummary(d, el) {
  const $el = $(el);
  let gross = 0; let tax = 0; let net = 0;
  for (const l of cart) { const t = lineTotals(l, d.products); gross = rnd(gross + t.gross); tax = rnd(tax + t.tax); net = rnd(net + t.net); }
  const paid = parseAmount($el.find('#paid').val()) || 0;
  const credit = rnd(gross - paid);
  const taxOn = getSettings().pricesIncludeTax !== false;
  $el.find('#summary').html(`
    <div class="row-line"><span>${taxOn ? 'Subtotal (incl. tax)' : 'Net amount'}</span><span>${fmt(taxOn ? gross : net)}</span></div>
    <div class="row-line"><span>Sales tax</span><span>${fmt(tax)}</span></div>
    <div class="row-line total"><span>Bill total</span><span>${money(gross)}</span></div>
    <div class="row-line small"><span>Received</span><span>${money(Math.min(paid, gross))}</span></div>
    <div class="row-line small ${credit > 0.00005 ? 'text-warning fw-semibold' : ''}"><span>${credit < -0.00005 ? 'Change to customer' : 'Udhaar (credit)'}</span><span>${money(Math.abs(credit))}</span></div>`);
  if (paid > gross + 0.00005) $el.find('#summary').append('<div class="small text-danger mt-1">Received is more than the bill.</div>');
}

async function render(el, ctx) {
  if (ctx.params[0]) return renderDetail(el, ctx.params[0]);
  el.innerHTML = UI.spinner('Loading sales…');
  const d = await data();
  el.innerHTML = page(d);
  const $el = $(el).off();
  listSales(el, d);
  updateSummary(d, el);

  $el.on('input', '#item-search', function () {
    const q = this.value.trim().toLowerCase();
    $el.find('.item-col').each((_, c) => $(c).toggle(!q || c.dataset.name.includes(q)));
  });
  $el.on('click', '[data-act="add"]', (e) => {
    const id = e.currentTarget.dataset.id;
    const p = d.products.find((x) => x.id === id);
    if (!p) return;
    if (!(p.price > 0)) return UI.toast(`Set the price of ${p.name} first.`, 'warning');
    const existing = cart.find((l) => l.productId === id);
    if (existing) existing.qty = rnd(existing.qty + 1);
    else cart.push({ productId: id, qty: 1, rate: p.price });
    refreshCart(el, d);
  });
  $el.on('click', '[data-act="rm"]', function () { cart.splice(+$(this).closest('tr').data('i'), 1); refreshCart(el, d); });
  $el.on('click', '[data-act="clear"]', () => { cart = []; refreshCart(el, d); });
  $el.on('click', '[data-act="open"]', function () { location.hash = `#/sales/${encodeURIComponent(this.dataset.id)}`; });
  $el.on('input', '#cart input', function () {
    const i = +$(this).closest('tr').data('i');
    cart[i][this.dataset.field] = parseAmount(this.value) ?? 0;
    $(this).closest('tr').find('[data-amt]').text(fmt(rnd(cart[i].qty * cart[i].rate)));
    updateSummary(d, el);
  });
  $el.on('input change', '#paid, #cust', () => { customerId = $el.find('#cust').val(); updateSummary(d, el); });
  $el.on('click', '[data-act="fill"]', () => {
    let gross = 0; for (const l of cart) gross = rnd(gross + lineTotals(l, d.products).gross);
    $el.find('#paid').val(gross.toFixed(4)); updateSummary(d, el);
  });
  $el.on('click', '[data-act="save"]', async function () {
    const $btn = $(this);
    try {
      if (!cart.length) throw new Error('Add at least one item to the bill.');
      const paidAmt = parseAmount($el.find('#paid').val()) || 0;
      const cust = $el.find('#cust').val() || null;
      const accId = $el.find('#pay-acc').val();
      $btn.prop('disabled', true);
      const doc = await postSale({ customerId: cust, lines: cart.map((l) => ({ productId: l.productId, qty: l.qty, rate: l.rate })), paid: paidAmt > 0 ? [{ accountId: accId, amount: paidAmt }] : [], memo: $el.find('#memo').val() });
      cart = []; customerId = '';
      UI.toast(`Sale ${doc.number} saved · ${money(doc.gross)}`);
      location.hash = `#/sales/${encodeURIComponent(doc.id)}`;
    } catch (e) { UI.toastError(e); $btn.prop('disabled', false); }
  });
  // Re-render cart fields on refresh
  function refreshCart(root, dd) {
    $(root).find('#cart').html(cartHtml(dd));
    updateSummary(dd, root);
  }
}

function listSales(el, d) {
  const list = d.sales.filter((s) => s.date === today()).slice(0, 40);
  const $list = $(el).find('#sale-list');
  $list.html(list.length ? `<div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report"><thead><tr><th>Bill</th><th>Time</th><th>Customer</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
    ${list.map((s) => `<tr role="button" style="cursor:pointer" data-act="open" data-id="${esc(s.id)}">
      <td class="fw-semibold">${esc(s.number)}</td><td class="small">${esc(fmtTime(s.createdAt))}</td><td>${esc(s.customerName)}</td>
      <td class="num">${fmt(s.gross)}</td><td>${statusBadge(s.status)}</td></tr>`).join('')}</tbody></table></div>`
    : UI.emptyState('No sales today yet', 'receipt'));
}

async function renderDetail(el, id) {
  el.innerHTML = UI.spinner();
  const s = await get('sales', id);
  if (!s) { el.innerHTML = UI.emptyState('Sale not found.', 'question-circle'); return; }
  const rows = s.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${fmtQty(l.qty)}</td><td class="num">${fmt(l.rate)}</td><td class="num">${fmt(l.tax)}</td><td class="num fw-semibold">${fmt(l.gross)}</td></tr>`).join('');
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap no-print">
      <a class="btn btn-light btn-sm" href="#/sales" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <h1 class="h5 mb-0 flex-grow-1">Sale ${esc(s.number)} ${statusBadge(s.status)}</h1>
      <button class="btn btn-outline-secondary btn-sm" data-act="print"><i class="bi bi-printer me-1"></i>Print</button>
      ${s.status === 'posted' && Auth.can('accounts') ? '<button class="btn btn-outline-danger btn-sm" data-act="void"><i class="bi bi-x-circle me-1"></i>Void</button>' : ''}</div>
    <div class="card p-3 page-enter">
      <div class="d-flex flex-wrap justify-content-between gap-2 mb-2"><div><div class="fw-semibold">${esc(s.customerName)}</div><div class="small text-body-secondary">${fmtDate(s.date)} · ${esc(fmtTime(s.createdAt))}</div></div>
      ${s.credit > 0.00005 ? `<span class="badge text-bg-warning align-self-start">Udhaar ${fmt(s.credit)}</span>` : ''}</div>
      <div class="table-responsive"><table class="table table-sm align-middle table-report"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Tax</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr class="fw-semibold"><td colspan="4">Total</td><td class="num">${money(s.gross)}</td></tr></tfoot></table></div>
      ${s.memo ? `<div class="small">Note: ${esc(s.memo)}</div>` : ''}
      <div class="small text-body-secondary mt-2">Journal: ${refLink('sale', s.id, s.number)}</div>
    </div>`;
  $(el).off().on('click', '[data-act="print"]', () => window.print());
  $(el).off().on('click', '[data-act="void"]', async function () {
    if (!await UI.confirmDialog(`Void sale ${s.number}? Its stock returns to inventory and the ledger entries are reversed.`, { okLabel: 'Void sale', okClass: 'btn-danger' })) return;
    try { await voidSale(s.id); UI.toast('Sale voided'); location.hash = '#/sales'; } catch (e) { UI.toastError(e); }
  });
}

export default {
  render,
  destroy() {},
};
