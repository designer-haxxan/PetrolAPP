// Shifts: opening readings, closing readings per nozzle (litres and amount computed live), cash and
// settlement (bank, wallet, udhaar), cash variance, and the shift history.
import { getAll } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtDateTime, fmtTime } from '../core/utils.js';
import { fmt, fmtQty, money, parseAmount, rnd } from '../core/money.js';
import { openShift, closeShift } from '../services/posting.js';
import { statusBadge } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function loadData() {
  const [nozzles, pumps, tanks, products, parties, accounts, shifts] = await Promise.all([
    getAll('nozzles'), getAll('pumps'), getAll('tanks'), getAll('products'), getAll('parties'), getAll('accounts'), getAll('shifts'),
  ]);
  return {
    nozzles: nozzles.filter((n) => n.active !== false).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    pumps: new Map(pumps.map((p) => [p.id, p])),
    tanks: new Map(tanks.map((t) => [t.id, t])),
    products: new Map(products.map((p) => [p.id, p])),
    employees: parties.filter((p) => p.kind === 'employee' && p.active !== false),
    customers: parties.filter((p) => p.kind === 'customer' && p.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    settleAccounts: accounts.filter((a) => (a.kind === 'bank' || a.kind === 'wallet') && a.active !== false),
    shifts: shifts.sort((a, b) => (a.number < b.number ? 1 : -1)),
  };
}

const nozzleLabel = (n, d) => `${d.pumps.get(n.pumpId)?.name || 'Pump'} · ${n.name}`;

async function renderPage(el) {
  el.innerHTML = UI.spinner('Loading shifts…');
  const d = await loadData();
  const open = d.shifts.find((s) => s.status === 'open');
  if (!d.nozzles.length) {
    el.innerHTML = UI.emptyState('Add pumps and nozzles before opening a shift.', 'fuel-pump', '<a class="btn btn-primary mt-3" href="#/machines">Go to Pumps & Nozzles</a>');
    return;
  }
  el.innerHTML = open ? openView(open, d) : startView(d);
  bindOpen(el, open, d);
}

// ---------------------------------------------------------------- start a shift
function startView(d) {
  const rows = d.nozzles.map((n) => {
    const p = d.products.get(n.productId);
    const t = d.tanks.get(n.tankId);
    return `<tr>
      <td><div class="fw-semibold">${esc(nozzleLabel(n, d))}</div><div class="small text-body-secondary">${esc(p?.name || 'No product')} · ${esc(t?.name || 'No tank')}</div></td>
      <td class="text-end">${p?.price ? fmt(p.price) : '<span class="text-danger small">Set price</span>'}</td>
      <td style="max-width:200px"><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-open="${esc(n.id)}" value="${Number(n.lastReading || 0).toFixed(4)}"></td></tr>`;
  }).join('');
  const emps = d.employees.map((e) => `<label class="form-check d-inline-flex align-items-center gap-2 border rounded-3 px-3 py-2 me-2 mb-2">
      <input class="form-check-input mt-0" type="checkbox" name="emp" value="${esc(e.id)}"><span>${esc(e.name)}</span></label>`).join('');
  return `<div class="page-header d-flex align-items-center gap-2 mb-3"><h1 class="h5 mb-0 flex-grow-1">Shifts & meters</h1></div>
    <div class="card p-3 p-md-4 mb-4 page-enter">
      <div class="d-flex align-items-center gap-2 mb-1"><span class="badge text-bg-secondary">No shift open</span><span class="small text-body-secondary">Open a shift and record the opening meter of every nozzle.</span></div>
      <div class="fw-semibold mt-3 mb-2">Attendants on this shift</div>
      <div>${emps || '<div class="small text-body-secondary mb-2">No employees yet. You can still open the shift, or add employees under Masters.</div>'}</div>
      <div class="fw-semibold mt-3 mb-2">Opening readings</div>
      <div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Nozzle</th><th class="text-end">Price</th><th>Opening meter</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="d-flex justify-content-end"><button class="btn btn-primary btn-lg px-4" data-act="open" ${Auth.can('shift') ? '' : 'disabled'}><i class="bi bi-play-fill me-1"></i>Open shift</button></div>
    </div>${historyTable(d)}`;
}

function historyTable(d) {
  const closed = d.shifts.filter((s) => s.status === 'closed').slice(0, 30);
  if (!closed.length) return '';
  return `<div class="list-card"><div class="p-3 pb-2 fw-semibold">Recent shifts</div><div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report">
    <thead><tr><th>Shift</th><th>Date</th><th class="num">Litres</th><th class="num">Sales</th><th class="num">Expected cash</th><th class="num">Counted</th><th class="num">Variance</th></tr></thead>
    <tbody>${closed.map((s) => `<tr role="button" data-act="detail" data-id="${esc(s.id)}" style="cursor:pointer">
      <td class="fw-semibold">${esc(s.number)}</td><td>${fmtDate(s.date)}</td>
      <td class="num">${fmtQty(s.totals?.litres || 0)}</td><td class="num">${fmt(s.totals?.gross || 0)}</td>
      <td class="num">${fmt(s.expectedCash || 0)}</td><td class="num">${fmt(s.cashCounted || 0)}</td>
      <td class="num ${s.variance < 0 ? 'text-danger' : s.variance > 0 ? 'text-success' : ''}">${fmt(s.variance || 0)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------- open shift: closing readings and settlement
function openView(shift, d) {
  const emps = shift.employeeIds.map((id) => d.employees.find((e) => e.id === id)?.name).filter(Boolean);
  const rows = shift.readings.map((r) => {
    const n = d.nozzles.find((x) => x.id === r.nozzleId);
    const price = shift.prices[r.productId];
    return `<tr data-row="${esc(r.nozzleId)}">
      <td><div class="fw-semibold">${esc(r.pumpId ? (d.pumps.get(r.pumpId)?.name || '') + ' · ' : '')}${esc(r.nozzleName)}</div><div class="small text-body-secondary">${esc(r.productName)}</div></td>
      <td class="num text-body-secondary">${fmt(r.opening)}</td>
      <td style="min-width:150px"><input type="number" step="0.0001" min="${r.opening}" class="form-control form-control-sm money-input" data-close="${esc(r.nozzleId)}" placeholder="Closing"></td>
      <td class="num" data-litres="${esc(r.nozzleId)}">0.0000</td>
      <td class="num text-body-secondary">${fmt(price)}</td>
      <td class="num fw-semibold" data-amount="${esc(r.nozzleId)}">0.0000</td></tr>`;
  }).join('');
  const ncOpts = d.settleAccounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  const custOpts = d.customers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  return `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1"><span class="live-dot"></span>Shift ${esc(shift.number)} <span class="small text-body-secondary fw-normal">· opened ${esc(fmtDateTime(shift.openedAt))}</span></h1>
      <span class="badge text-bg-success">Open</span></div>
    <div class="small text-body-secondary mb-3">Attendants: ${esc(emps.join(', ') || 'Not recorded')}</div>
    <div class="row g-3">
      <div class="col-xl-8">
        <div class="card p-3 mb-3 page-enter">
          <div class="fw-semibold mb-2">Closing meter readings</div>
          <div class="table-responsive"><table class="table table-sm align-middle mb-0">
            <thead><tr><th>Nozzle</th><th class="num">Opening</th><th>Closing</th><th class="num">Litres</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="fw-semibold"><td colspan="3">Total</td><td class="num" id="tot-litres">0.0000</td><td></td><td class="num" id="tot-amount">0.0000</td></tr></tfoot>
          </table></div>
        </div>
        <div class="card p-3 page-enter">
          <div class="fw-semibold mb-2">Settlement</div>
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label small text-body-secondary mb-1">Cash counted in the drawer (Rs)</label>
              <input type="number" step="0.0001" min="0" class="form-control form-control-lg money-input" id="cash-counted" placeholder="0.0000">
            </div>
          </div>
          <div class="mt-3 d-flex align-items-center justify-content-between">
            <div class="fw-semibold">Card, bank & wallet receipts</div>
            <button class="btn btn-sm btn-outline-primary" data-act="add-nc"><i class="bi bi-plus-lg"></i> Add</button></div>
          <div class="small text-body-secondary mb-1">Card swipes, bank transfers and JazzCash / Easypaisa collected during the shift.</div>
          <div id="nc-rows" data-opts="${esc(ncOpts)}"></div>
          <div class="mt-3 d-flex align-items-center justify-content-between">
            <div class="fw-semibold">Udhaar / credit sales on this shift</div>
            <button class="btn btn-sm btn-outline-primary" data-act="add-cr"><i class="bi bi-plus-lg"></i> Add</button></div>
          <div class="small text-body-secondary mb-1">Fleet and corporate customers who buy fuel on credit.</div>
          <div id="cr-rows" data-opts="${esc(custOpts)}"></div>
        </div>
      </div>
      <div class="col-xl-4">
        <div class="summary-box sticky-xl-top" style="top:80px">
          <div class="fw-semibold mb-2">Cash reconciliation</div>
          <div class="row-line"><span>Total sales</span><span id="s-gross">0.0000</span></div>
          <div class="row-line"><span>Card, bank & wallet</span><span id="s-nc">0.0000</span></div>
          <div class="row-line"><span>Udhaar (credit)</span><span id="s-cr">0.0000</span></div>
          <div class="row-line total"><span>Expected cash</span><span id="s-exp">0.0000</span></div>
          <div class="row-line"><span>Counted cash</span><span id="s-counted">0.0000</span></div>
          <div class="row-line fw-bold"><span>Variance</span><span id="s-var">0.0000</span></div>
          <div class="small text-body-secondary mt-1" id="s-note"></div>
          <label class="form-label small mt-3 mb-1">Notes</label>
          <input class="form-control form-control-sm" id="shift-memo" placeholder="Optional">
          <button class="btn btn-success w-100 mt-3 py-2" data-act="close" ${Auth.can('shift') ? '' : 'disabled'}><i class="bi bi-check2-circle me-1"></i>Close shift & post</button>
        </div>
      </div>
    </div>
    ${historyTable(d)}`;
}

function rowHtml(kind, opts, idx) {
  if (kind === 'nc') return `<div class="row g-2 align-items-center mb-2" data-nc="${idx}">
    <div class="col-7"><select class="form-select form-select-sm" data-field="accountId">${opts}</select></div>
    <div class="col-4"><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-field="amount" placeholder="0.0000"></div>
    <div class="col-1"><button class="btn btn-sm btn-link text-danger p-0" data-act="rm" aria-label="Remove"><i class="bi bi-x-lg"></i></button></div></div>`;
  return `<div class="row g-2 align-items-center mb-2" data-cr="${idx}">
    <div class="col-7"><select class="form-select form-select-sm" data-field="customerId"><option value="">Choose customer…</option>${opts}</select></div>
    <div class="col-4"><input type="number" step="0.0001" min="0" class="form-control form-control-sm money-input" data-field="amount" placeholder="0.0000"></div>
    <div class="col-1"><button class="btn btn-sm btn-link text-danger p-0" data-act="rm" aria-label="Remove"><i class="bi bi-x-lg"></i></button></div></div>`;
}

function bindOpen(el, shift, d) {
  const $el = $(el).off();
  let seq = 0;
  $el.on('click', '[data-act="detail"]', function () { location.hash = `#/shifts/${encodeURIComponent(this.dataset.id)}`; });

  if (!shift) {
    $el.on('click', '[data-act="open"]', async function () {
      const $btn = $(this).prop('disabled', true);
      try {
        const employeeIds = $el.find('input[name=emp]:checked').map((_, x) => x.value).get();
        const overrides = $el.find('[data-open]').map((_, x) => ({ nozzleId: x.dataset.open, reading: parseAmount(x.value) })).get();
        if (overrides.some((o) => o.reading === null)) throw new Error('Enter the opening meter of every nozzle.');
        const s = await openShift({ employeeIds, overrides });
        UI.toast(`Shift ${s.number} opened`);
        await renderPage(el);
      } catch (e) { UI.toastError(e); $btn.prop('disabled', false); }
    });
    return;
  }

  const readings = shift.readings;
  const recalc = () => {
    let litres = 0; let gross = 0;
    for (const r of readings) {
      const c = parseAmount($el.find(`[data-close="${r.nozzleId}"]`).val());
      const valid = c !== null && c >= r.opening;
      const l = valid ? rnd(c - r.opening) : 0;
      const a = rnd(l * (shift.prices[r.productId] || 0));
      $el.find(`[data-litres="${r.nozzleId}"]`).text(fmtQty(l));
      $el.find(`[data-amount="${r.nozzleId}"]`).text(fmt(a));
      litres = rnd(litres + l); gross = rnd(gross + a);
    }
    let nc = 0; let cr = 0;
    $el.find('[data-nc]').each((_, row) => { nc = rnd(nc + (parseAmount($(row).find('[data-field=amount]').val()) || 0)); });
    $el.find('[data-cr]').each((_, row) => { cr = rnd(cr + (parseAmount($(row).find('[data-field=amount]').val()) || 0)); });
    const expected = rnd(gross - nc - cr);
    const counted = parseAmount($el.find('#cash-counted').val()) || 0;
    const variance = rnd(counted - expected);
    $el.find('#tot-litres').text(fmtQty(litres));
    $el.find('#tot-amount').text(fmt(gross));
    $el.find('#s-gross').text(fmt(gross));
    $el.find('#s-nc').text(fmt(nc));
    $el.find('#s-cr').text(fmt(cr));
    $el.find('#s-exp').text(fmt(expected));
    $el.find('#s-counted').text(fmt(counted));
    $el.find('#s-var').text(fmt(variance)).toggleClass('text-danger', variance < 0).toggleClass('text-success', variance > 0);
    $el.find('#s-note').text(variance < 0 ? 'Cash is short. The shortage is posted to Cash short / (excess).' : variance > 0 ? 'Cash is in excess. Recorded as excess.' : (gross ? 'Cash matches expected.' : ''));
    if (expected < -0.00005) $el.find('#s-note').text('Card, wallet and udhaar are more than the sales.').addClass('text-danger');
    else $el.find('#s-note').removeClass('text-danger');
  };
  $el.on('input change', 'input, select', recalc);

  $el.on('click', '[data-act="add-nc"]', () => { $el.find('#nc-rows').append(rowHtml('nc', $el.find('#nc-rows').attr('data-opts'), seq++)); recalc(); });
  $el.on('click', '[data-act="add-cr"]', () => { $el.find('#cr-rows').append(rowHtml('cr', $el.find('#cr-rows').attr('data-opts'), seq++)); recalc(); });
  $el.on('click', '[data-act="rm"]', function () { $(this).closest('[data-nc],[data-cr]').remove(); recalc(); });

  $el.on('click', '[data-act="close"]', async function () {
    const $btn = $(this);
    try {
      const closings = readings.map((r) => {
        const c = parseAmount($el.find(`[data-close="${r.nozzleId}"]`).val());
        if (c === null) throw new Error(`Enter the closing meter of ${r.nozzleName}.`);
        if (c < r.opening) throw new Error(`Closing meter of ${r.nozzleName} is less than its opening.`);
        return { nozzleId: r.nozzleId, reading: c };
      });
      const nonCash = $el.find('[data-nc]').map((_, row) => ({ accountId: $(row).find('[data-field=accountId]').val(), amount: parseAmount($(row).find('[data-field=amount]').val()) || 0 })).get();
      const credits = $el.find('[data-cr]').map((_, row) => ({ customerId: $(row).find('[data-field=customerId]').val(), amount: parseAmount($(row).find('[data-field=amount]').val()) || 0 })).get();
      if (credits.some((c) => c.amount > 0 && !c.customerId)) throw new Error('Choose the customer for each credit line.');
      const cashCounted = parseAmount($el.find('#cash-counted').val());
      if (cashCounted === null) throw new Error('Enter the cash counted in the drawer (enter 0 if none).');
      const variance = $el.find('#s-var').text();
      const ok = await UI.confirmDialog(`Close shift ${shift.number} and post sales of ${$el.find('#s-gross').text()}? Cash variance: ${variance}. Posted shifts cannot be edited.`, { okLabel: 'Close & post', title: 'Close shift' });
      if (!ok) return;
      $btn.prop('disabled', true);
      const s = await closeShift(shift.id, { closings, cashCounted, nonCash: nonCash.filter((x) => x.accountId), credits, memo: $el.find('#shift-memo').val() });
      UI.toast(`Shift ${s.number} closed. Litres ${fmtQty(s.totals.litres)}, sales ${money(s.totals.gross)}`);
      await renderPage(el);
    } catch (e) { UI.toastError(e); $btn.prop('disabled', false); }
  });
  recalc();
}

// ---------------------------------------------------------------- closed shift detail
async function renderDetail(el, id) {
  el.innerHTML = UI.spinner();
  const s = await (await import('../db/idb.js')).get('shifts', id);
  if (!s) { el.innerHTML = UI.emptyState('Shift not found.', 'question-circle'); return; }
  const rows = (s.readings || []).map((r) => `<tr><td>${esc(r.nozzleName)}<div class="small text-body-secondary">${esc(r.productName)}</div></td>
    <td class="num">${fmt(r.opening)}</td><td class="num">${fmt(r.closing ?? 0)}</td><td class="num">${fmtQty(r.litres || 0)}</td><td class="num">${fmt(r.price || 0)}</td><td class="num fw-semibold">${fmt(r.amount || 0)}</td></tr>`).join('');
  const nc = (s.nonCash || []).map((n) => `<tr><td>${esc(n.name)}</td><td class="num">${fmt(n.amount)}</td></tr>`).join('');
  const cr = (s.credits || []).map((c) => `<tr><td>${esc(c.name)} <span class="badge text-bg-light">Udhaar</span></td><td class="num">${fmt(c.amount)}</td></tr>`).join('');
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap no-print">
      <a class="btn btn-light btn-sm" href="#/shifts" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <h1 class="h5 mb-0 flex-grow-1">Shift ${esc(s.number)}</h1>
      <button class="btn btn-outline-secondary btn-sm" data-act="print"><i class="bi bi-printer me-1"></i>Print</button></div>
    <div class="print-title"><h2>Shift report ${esc(s.number)}</h2></div>
    <div class="row g-3 page-enter">
      <div class="col-12"><div class="card p-3">
        <div class="small text-body-secondary">${fmtDate(s.date)} · ${s.openedAt ? esc(fmtTime(s.openedAt)) : ''} – ${s.closedAt ? esc(fmtTime(s.closedAt)) : ''} · ${statusBadge(s.status)}</div>
        <div class="table-responsive mt-2"><table class="table table-sm align-middle table-report"><thead><tr><th>Nozzle</th><th class="num">Opening</th><th class="num">Closing</th><th class="num">Litres</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody><tfoot><tr class="fw-semibold"><td colspan="3">Total</td><td class="num">${fmtQty(s.totals?.litres || 0)}</td><td></td><td class="num">${fmt(s.totals?.gross || 0)}</td></tr></tfoot></table></div>
      </div></div>
      <div class="col-md-6"><div class="card p-3 h-100"><div class="fw-semibold mb-2">Settlement</div>
        <table class="table table-sm mb-0"><tbody>
          <tr><td>Total sales</td><td class="num">${fmt(s.totals?.gross || 0)}</td></tr>
          ${nc}${cr}
          <tr class="fw-semibold"><td>Expected cash</td><td class="num">${fmt(s.expectedCash || 0)}</td></tr>
          <tr><td>Counted cash</td><td class="num">${fmt(s.cashCounted || 0)}</td></tr>
          <tr class="fw-bold"><td>Variance (short / excess)</td><td class="num ${s.variance < 0 ? 'text-danger' : 'text-success'}">${fmt(s.variance || 0)}</td></tr>
        </tbody></table>${s.memo ? `<div class="small mt-2">Note: ${esc(s.memo)}</div>` : ''}</div></div>
      <div class="col-md-6"><div class="card p-3 h-100"><div class="fw-semibold mb-2">Products</div>
        <table class="table table-sm mb-0"><tbody>${(s.products || []).map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${fmtQty(p.litres)}</td><td class="num">${fmt(p.gross)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>`;
  $(el).off().on('click', '[data-act="print"]', () => window.print());
}

export default {
  async render(el, ctx) {
    if (ctx.params[0]) return renderDetail(el, ctx.params[0]);
    return renderPage(el);
  },
  destroy() {},
};
