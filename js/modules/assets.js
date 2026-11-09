// Fixed assets: machinery, tanks, building and vehicles. Straight-line depreciation is posted month by month.
import { getAll } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, today, monthKey } from '../core/utils.js';
import { fmt, money, parseAmount, rnd } from '../core/money.js';
import { createAsset, postDepreciation, ASSET_CATEGORIES } from '../services/posting.js';
import { statusBadge } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function render(el) {
  el.innerHTML = UI.spinner('Loading assets…');
  const [assets, accounts, parties] = await Promise.all([getAll('fixedAssets'), getAll('accounts'), getAll('parties')]);
  const cost = rnd(assets.reduce((s, a) => s + a.cost, 0));
  const acc = rnd(assets.reduce((s, a) => s + (a.accumulated || 0), 0));
  const month = monthKey(today());
  const dueThisMonth = assets.filter((a) => !a.postedMonths.includes(month) && a.purchaseDate <= today()).length;
  const payFrom = accounts.filter((a) => ['cash', 'bank', 'wallet'].includes(a.kind) && a.active !== false);
  const supplierOpts = parties.filter((p) => p.kind === 'supplier').map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Fixed assets</h1>
      <button class="btn btn-outline-primary btn-sm" data-act="dep" ${Auth.can('assets') ? '' : 'disabled'}><i class="bi bi-calendar-check me-1"></i>Post depreciation</button>
      <button class="btn btn-primary btn-sm" data-act="new" ${Auth.can('assets') ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>Add asset</button></div>
    <div class="row g-3 mb-3">
      <div class="col-md-4"><div class="kpi" style="--tint:#0891b2"><div class="kpi-label">Cost</div><div class="kpi-value">${money(cost)}</div><div class="kpi-sub">${assets.length} asset(s)</div></div></div>
      <div class="col-md-4"><div class="kpi" style="--tint:#f97316"><div class="kpi-label">Accumulated depreciation</div><div class="kpi-value">${money(acc)}</div></div></div>
      <div class="col-md-4"><div class="kpi" style="--tint:#16a34a"><div class="kpi-label">Written-down value</div><div class="kpi-value">${money(rnd(cost - acc))}</div><div class="kpi-sub">${dueThisMonth} asset(s) not yet depreciated in ${esc(month)}</div></div></div>
    </div>
    <div class="list-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report"><thead><tr><th>No.</th><th>Asset</th><th>Category</th><th>Bought</th><th class="num">Cost</th><th class="num">Life (yrs)</th><th class="num">Accumulated</th><th class="num">Book value</th></tr></thead>
      <tbody>${assets.length ? assets.sort((a, b) => (a.number < b.number ? -1 : 1)).map((a) => `<tr><td class="fw-semibold">${esc(a.number)}</td><td>${esc(a.name)}</td><td class="small">${esc(ASSET_CATEGORIES[a.category]?.label || a.category)}</td>
        <td>${fmtDate(a.purchaseDate)}</td><td class="num">${fmt(a.cost)}</td><td class="num">${a.lifeYears}</td><td class="num">${fmt(a.accumulated || 0)}</td><td class="num fw-semibold">${fmt(rnd(a.cost - (a.accumulated || 0)))}</td></tr>`).join('')
        : `<tr><td colspan="8">${UI.emptyState('No fixed assets yet. Add dispensers, tanks, building and vehicles here.', 'bricks')}</td></tr>`}</tbody></table></div></div>`;

  $(el).off().on('click', '[data-act="new"]', async () => {
    const v = await UI.formModal({
      title: 'Add fixed asset', size: 'lg', submitLabel: 'Save asset',
      body: `<div class="row g-3">
        <div class="col-md-8"><label class="form-label small">Asset name</label><input class="form-control" name="name" placeholder="e.g. Tokheim dispenser set 2" required></div>
        <div class="col-md-4"><label class="form-label small">Category</label><select class="form-select" name="category">${Object.entries(ASSET_CATEGORIES).map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select></div>
        <div class="col-md-4"><label class="form-label small">Cost (Rs)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="cost" required></div>
        <div class="col-md-4"><label class="form-label small">Purchase date</label><input type="date" class="form-control" name="purchaseDate" value="${today()}"></div>
        <div class="col-md-2"><label class="form-label small">Life (years)</label><input type="number" min="1" max="50" class="form-control" name="lifeYears" value="5"></div>
        <div class="col-md-2"><label class="form-label small">Salvage (Rs)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="salvage" value="0"></div>
        <div class="col-md-6"><label class="form-label small">Paid from</label><select class="form-select" name="paidFrom">${payFrom.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="ap">Bought on credit (supplier payable)</option></select></div>
        <div class="col-md-6"><label class="form-label small">Supplier (if on credit)</label><select class="form-select" name="supplierId"><option value="">—</option>${supplierOpts}</select></div>
      </div>`,
      onSubmit: async (f) => {
        const cost = parseAmount(f.cost);
        await createAsset({ name: f.name, category: f.category, cost, purchaseDate: f.purchaseDate || today(), lifeYears: Number(f.lifeYears) || 5, salvage: parseAmount(f.salvage) || 0, paidFrom: f.paidFrom, supplierId: f.supplierId || null });
        return true;
      },
    });
    if (v) { UI.toast('Asset added'); render(el); }
  });

  $(el).off().on('click', '[data-act="dep"]', async () => {
    const v = await UI.formModal({
      title: 'Post monthly depreciation', submitLabel: 'Post depreciation',
      body: `<div class="row g-3"><div class="col-md-6"><label class="form-label small">Month</label><input type="month" class="form-control" name="month" value="${month}" required></div>
        <div class="col-12 small text-body-secondary">Straight-line: (cost − salvage) ÷ (life × 12) for each asset bought on or before the month end. Each month can be posted once per asset.</div></div>`,
      onSubmit: async (f) => {
        const r = await postDepreciation(f.month);
        UI.toast(r.count ? `Depreciation posted for ${r.count} asset(s): ${money(r.total)}` : 'Nothing to post for this month');
        return true;
      },
    });
    if (v) render(el);
  });
  void statusBadge;
}

export default {
  render,
  destroy() {},
};
