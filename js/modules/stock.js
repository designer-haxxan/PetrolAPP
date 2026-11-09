// Stock & valuation: fuel (sum of tank book stock) and goods (counted with adjustments), with a movement ledger per product.
import { getAll, get } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtDateTime, today } from '../core/utils.js';
import { fmt, fmtQty, money, parseAmount, rnd } from '../core/money.js';
import { postStockAdjustment } from '../services/posting.js';
import { statusBadge, REF_LABELS, refLink } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function render(el, ctx) {
  if (ctx.params[0]) return renderMovements(el, ctx.params[0]);
  el.innerHTML = UI.spinner('Loading stock…');
  const [products, tanks] = await Promise.all([getAll('products'), getAll('tanks')]);
  const fuel = products.filter((p) => p.category === 'fuel' && p.active !== false);
  const goods = products.filter((p) => p.category === 'goods' && p.active !== false);
  const fuelValue = rnd(fuel.reduce((s, p) => s + (p.stockValue || 0), 0));
  const goodsValue = rnd(goods.reduce((s, p) => s + (p.stockValue || 0), 0));
  const row = (p) => `<tr>
      <td><div class="fw-semibold">${esc(p.name)}</div><div class="small text-body-secondary">${p.category === 'fuel' ? 'Fuel · from tanks' : 'Goods · counted'}</div></td>
      <td class="num ${p.stockQty < 0 ? 'text-danger fw-bold' : p.stockQty === 0 ? 'text-body-secondary' : ''}">${fmtQty(p.stockQty)} ${esc(p.unit)}</td>
      <td class="num">${fmt(p.avgCost || 0)}</td><td class="num fw-semibold">${fmt(p.stockValue || 0)}</td>
      <td class="text-end text-nowrap">
        ${p.category === 'goods' ? `<button class="btn btn-sm btn-outline-primary" data-act="adjust" data-id="${esc(p.id)}" ${Auth.can('stock') ? '' : 'disabled'}><i class="bi bi-clipboard-check"></i> Count</button>` : ''}
        <a class="btn btn-sm btn-link" href="#/stock/${encodeURIComponent(p.id)}" aria-label="Movements"><i class="bi bi-list-ul"></i></a></td></tr>`;
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap"><h1 class="h5 mb-0 flex-grow-1">Stock & valuation</h1></div>
    <div class="row g-3 mb-3">
      <div class="col-md-4"><div class="kpi" style="--tint:#0891b2"><div class="kpi-icon"><i class="bi bi-droplet-half"></i></div><div class="kpi-label">Fuel value (book)</div><div class="kpi-value">${money(fuelValue)}</div><div class="kpi-sub">${fmtQty(rnd(tanks.reduce((s, t) => s + t.bookLitres, 0)))} litres in tanks</div></div></div>
      <div class="col-md-4"><div class="kpi" style="--tint:#7c3aed"><div class="kpi-icon"><i class="bi bi-box-seam"></i></div><div class="kpi-label">Goods value</div><div class="kpi-value">${money(goodsValue)}</div><div class="kpi-sub">${goods.length} items</div></div></div>
      <div class="col-md-4"><div class="kpi" style="--tint:#dc2626"><div class="kpi-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="kpi-label">Needs attention</div><div class="kpi-value">${fuel.filter((p) => p.stockQty < 0).length + goods.filter((p) => p.stockQty <= 0).length}</div><div class="kpi-sub">negative fuel books or empty goods</div></div></div>
    </div>
    <div class="list-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report">
      <thead><tr><th>Product</th><th class="num">Quantity</th><th class="num">Avg cost</th><th class="num">Value</th><th></th></tr></thead>
      <tbody>${[...fuel, ...goods].map(row).join('') || `<tr><td colspan="5">${UI.emptyState('No products yet', 'boxes')}</td></tr>`}</tbody></table></div></div>
    <div class="small text-body-secondary mt-2">Fuel is measured in tanks: use Tanks & dips to record physical readings. Goods are counted here.</div>`;
  $(el).off().on('click', '[data-act="adjust"]', async function () {
    const p = products.find((x) => x.id === this.dataset.id);
    const v = await UI.formModal({
      title: `Count · ${p.name}`, submitLabel: 'Post adjustment',
      body: `<div class="row g-3"><div class="col-md-6"><div class="small text-body-secondary">Book quantity</div><div class="fw-bold fs-5">${fmtQty(p.stockQty)} ${esc(p.unit)}</div></div>
        <div class="col-md-6"><label class="form-label small">Counted quantity</label><input type="number" step="0.0001" min="0" class="form-control money-input" id="counted" required></div>
        <div class="col-12"><div class="summary-box" id="diff">Enter the counted quantity.</div></div>
        <div class="col-12"><label class="form-label small">Reason</label><input class="form-control" name="memo" placeholder="e.g. Monthly count, breakage"></div></div>`,
      onShown: (m) => m.on('input', '#counted', () => {
        const c = parseAmount(m.find('#counted').val());
        if (c === null) return;
        const diff = rnd(c - p.stockQty);
        m.find('#diff').html(`Difference: <b class="${diff < 0 ? 'text-danger' : 'text-success'}">${fmtQty(diff)} ${esc(p.unit)}</b> — ${diff < 0 ? 'loss posted to shrinkage' : diff > 0 ? 'gain posted to stock gain' : 'no change'}`);
      }),
      onSubmit: async (f, m) => {
        const c = parseAmount(m.find('#counted').val());
        if (c === null) throw new Error('Enter the counted quantity.');
        await postStockAdjustment({ productId: p.id, qty: rnd(c - p.stockQty), date: today(), memo: f.memo || 'Stock count' });
        return true;
      },
    });
    if (v) { UI.toast('Stock adjusted'); render(el, ctx); }
  });
}

async function renderMovements(el, productId) {
  el.innerHTML = UI.spinner();
  const [p, moves] = await Promise.all([get('products', productId), getAll('stockMoves')]);
  if (!p) { el.innerHTML = UI.emptyState('Product not found.', 'question-circle'); return; }
  const list = moves.filter((m) => m.productId === productId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  let run = 0;
  const rows = list.map((m) => { run = rnd(run + m.qty); return { ...m, run }; }).reverse();
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <a class="btn btn-light btn-sm" href="#/stock" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <h1 class="h5 mb-0 flex-grow-1 text-truncate">Movements · ${esc(p.name)}</h1>
      <span class="small text-body-secondary">Stock now: <b>${fmtQty(p.stockQty)} ${esc(p.unit)}</b> · avg ${fmt(p.avgCost || 0)}</span></div>
    <div class="list-card"><div class="table-responsive"><table class="table table-sm align-middle mb-0 table-report"><thead><tr><th>Date</th><th>Source</th><th class="num">In / (out)</th><th class="num">Unit cost</th><th class="num">Value</th><th class="num">Balance</th></tr></thead>
    <tbody>${rows.length ? rows.slice(0, 500).map((m) => `<tr class="${m.voided ? 'text-body-secondary' : ''}"><td class="text-nowrap">${fmtDate(m.date)}</td>
      <td><div class="small">${esc(REF_LABELS[m.refType] || m.refType || '')} ${m.voided ? statusBadge('void') : ''}</div><div class="small text-body-secondary">${esc(m.memo || '')}</div></td>
      <td class="num ${m.qty < 0 ? 'text-danger' : 'text-success'}">${fmtQty(m.qty)}</td><td class="num">${fmt(m.unitCost || 0)}</td><td class="num">${fmt(m.value || 0)}</td><td class="num fw-semibold">${fmtQty(m.run)}</td></tr>`).join('')
      : `<tr><td colspan="6">${UI.emptyState('No stock movements yet', 'list-ul')}</td></tr>`}</tbody></table></div></div>
    ${rows.length > 500 ? '<div class="small text-body-secondary mt-2">Showing the latest 500 movements.</div>' : ''}
    <div class="small text-body-secondary mt-2">Created ${esc(fmtDateTime(p.createdAt))}</div>`;
}

export default {
  render,
  destroy() {},
};

export { refLink };
