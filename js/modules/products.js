// Products & prices: fuels (sold through nozzles) and goods (lubricants, shop items). Price changes keep a dated history,
// because OMC and government notified rates change and every shift keeps the rate it was opened with.
import { getAll, write } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, uuid, nowISO, today, fmtDate } from '../core/utils.js';
import { fmt, fmtQty, money, parseAmount } from '../core/money.js';
import { setPrice } from '../services/posting.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

const CATEGORY = {
  fuel: { label: 'Fuel', unit: 'L', inv: 'inv_fuel', cogs: 'cogs_fuel' },
  goods: { label: 'Lubricant / shop goods', unit: 'pc', inv: 'inv_goods', cogs: 'cogs_goods' },
};

async function render(el) {
  el.innerHTML = UI.spinner('Loading products…');
  const [products, history] = await Promise.all([getAll('products'), getAll('priceHistory')]);
  const sorted = products.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Products & prices</h1>
      <button class="btn btn-primary btn-sm" data-act="new" ${Auth.can('master') ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>Add product</button></div>
    <div class="small text-body-secondary mb-3">Set today's rate after each government or OMC price notification. Shifts keep the rate that was in force when they were opened.</div>
    <div class="list-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report">
      <thead><tr><th>Product</th><th>Type</th><th class="num">Rate (Rs)</th><th class="num">Tax %</th><th class="num">Stock</th><th class="num">Avg cost</th><th class="num">Stock value</th><th></th></tr></thead>
      <tbody>${sorted.map((p) => `<tr class="${p.active === false ? 'opacity-50' : ''}">
        <td><div class="fw-semibold">${esc(p.name)}</div><div class="small text-body-secondary">${esc(p.unit)}</div></td>
        <td>${esc(CATEGORY[p.category]?.label || p.category)}</td>
        <td class="num"><span class="fw-semibold">${p.price ? fmt(p.price) : '<span class="text-danger">Not set</span>'}</span></td>
        <td class="num">${fmt(p.taxRate || 0, 2)}</td>
        <td class="num">${fmtQty(p.stockQty)}</td><td class="num">${fmt(p.avgCost || 0)}</td><td class="num">${fmt(p.stockValue || 0)}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm btn-outline-primary" data-act="price" data-id="${esc(p.id)}" ${Auth.can('master') ? '' : 'disabled'}><i class="bi bi-currency-exchange"></i> Rate</button>
          <button class="btn btn-sm btn-link" data-act="edit" data-id="${esc(p.id)}" ${Auth.can('master') ? '' : 'disabled'} aria-label="Edit"><i class="bi bi-pencil"></i></button>
        </td></tr>`).join('')}</tbody></table></div></div>
    <div class="list-card mt-4"><div class="p-3 pb-2 fw-semibold">Rate history (latest 30)</div>
      ${history.length ? `<div class="table-responsive"><table class="table table-sm mb-0 table-report"><thead><tr><th>Effective</th><th>Product</th><th class="num">Old rate</th><th class="num">New rate</th></tr></thead><tbody>
        ${history.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 30).map((h) => `<tr><td>${fmtDate(h.effectiveFrom)}</td><td>${esc(sorted.find((p) => p.id === h.productId)?.name || '')}</td><td class="num">${fmt(h.oldPrice || 0)}</td><td class="num fw-semibold">${fmt(h.price)}</td></tr>`).join('')}</tbody></table></div>`
        : UI.emptyState('No rate changes recorded yet', 'clock-history')}</div>`;
  bind(el, sorted);
}

function productBody(p = null) {
  const cat = p?.category || 'goods';
  return `<div class="row g-3">
    <div class="col-md-8"><label class="form-label small">Product name</label><input class="form-control" name="name" value="${esc(p?.name || '')}" required></div>
    <div class="col-md-4"><label class="form-label small">Type</label><select class="form-select" name="category" ${p ? 'disabled' : ''}>
      <option value="fuel" ${cat === 'fuel' ? 'selected' : ''}>Fuel (sold through nozzles)</option>
      <option value="goods" ${cat === 'goods' ? 'selected' : ''}>Lubricant / shop goods (counter)</option></select></div>
    <div class="col-md-4"><label class="form-label small">Unit</label><select class="form-select" name="unit"><option value="L" ${p?.unit === 'L' ? 'selected' : ''}>Litre (L)</option><option value="kg" ${p?.unit === 'kg' ? 'selected' : ''}>Kilogram (kg)</option><option value="pc" ${p?.unit === 'pc' || (!p && cat === 'goods') ? 'selected' : ''}>Piece (pc)</option></select></div>
    <div class="col-md-4"><label class="form-label small">Current rate (Rs)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="price" value="${p?.price ? Number(p.price).toFixed(4) : ''}" ${p ? 'disabled' : ''} placeholder="0.0000"></div>
    <div class="col-md-4"><label class="form-label small">Sales tax %</label><input type="number" step="0.01" min="0" max="100" class="form-control money-input" name="taxRate" value="${Number(p?.taxRate || 0)}"><div class="form-text">Use the rate on your OMC or supplier invoices. Fuel is usually 0 here; confirm with your accountant.</div></div>
    <div class="col-md-6"><label class="form-label small">Sales income account</label><select class="form-select" name="incomeAccountId">
      <option value="sales_petrol" ${p?.incomeAccountId === 'sales_petrol' ? 'selected' : ''}>4000 · Sales - Petrol / Hi-Octane</option>
      <option value="sales_diesel" ${p?.incomeAccountId === 'sales_diesel' ? 'selected' : ''}>4010 · Sales - High Speed Diesel</option>
      <option value="sales_other_fuel" ${p?.incomeAccountId === 'sales_other_fuel' ? 'selected' : ''}>4020 · Sales - LDO, Kerosene & CNG</option>
      <option value="sales_lube" ${p?.incomeAccountId === 'sales_lube' ? 'selected' : ''}>4100 · Sales - Lubricants</option>
      <option value="sales_shop" ${p?.incomeAccountId === 'sales_shop' ? 'selected' : ''}>4110 · Sales - Shop & other goods</option></select></div>
    <div class="col-md-6"><label class="form-label small">Barcode (optional)</label><input class="form-control" name="barcode" value="${esc(p?.barcode || '')}"></div>
    ${p ? `<div class="col-md-6"><label class="form-label small">Status</label><select class="form-select" name="active"><option value="true" ${p.active !== false ? 'selected' : ''}>Active</option><option value="false" ${p.active === false ? 'selected' : ''}>Inactive (hidden from sales)</option></select></div>` : ''}
  </div>`;
}

function bind(el, products) {
  const $el = $(el).off();
  const again = () => render(el);
  $el.on('click', '[data-act="new"]', async () => {
    const v = await UI.formModal({
      title: 'Add product', body: productBody(), submitLabel: 'Save product',
      onSubmit: async (f) => {
        if (!f.name?.trim()) throw new Error('Enter the product name.');
        const cat = CATEGORY[f.category];
        if (!cat) throw new Error('Choose the type.');
        const price = parseAmount(f.price) ?? 0;
        const row = {
          id: uuid(), name: f.name.trim(), nameLc: f.name.trim().toLowerCase(), category: f.category, unit: f.unit || cat.unit,
          taxRate: parseAmount(f.taxRate) ?? 0, incomeAccountId: f.incomeAccountId, inventoryAccountId: cat.inv, cogsAccountId: cat.cogs,
          price: 0, barcode: (f.barcode || '').trim(), active: true, stockQty: 0, stockValue: 0, avgCost: 0, createdAt: nowISO(), updatedAt: nowISO(),
        };
        await write(['products'], (t) => t.put('products', row));
        if (price > 0) await setPrice(row.id, price, today());
        return true;
      },
    });
    if (v) { UI.toast('Product added'); again(); }
  });
  $el.on('click', '[data-act="edit"]', async function () {
    const p = products.find((x) => x.id === this.dataset.id);
    const v = await UI.formModal({
      title: 'Edit product', body: productBody(p), submitLabel: 'Update',
      onSubmit: async (f) => {
        if (!f.name?.trim()) throw new Error('Enter the product name.');
        await write(['products'], async (t) => {
          const row = await t.get('products', p.id);
          await t.put('products', { ...row, name: f.name.trim(), nameLc: f.name.trim().toLowerCase(), unit: f.unit, taxRate: parseAmount(f.taxRate) ?? 0, incomeAccountId: f.incomeAccountId, barcode: (f.barcode || '').trim(), active: f.active !== 'false', updatedAt: nowISO() });
        });
        return true;
      },
    });
    if (v) { UI.toast('Product updated'); again(); }
  });
  $el.on('click', '[data-act="price"]', async function () {
    const p = products.find((x) => x.id === this.dataset.id);
    const v = await UI.formModal({
      title: `Rate of ${p.name}`, submitLabel: 'Set rate',
      body: `<div class="row g-3"><div class="col-md-6"><label class="form-label small">Current rate</label><div class="fw-bold fs-5">${p.price ? money(p.price) : 'Not set'}</div></div>
        <div class="col-md-6"><label class="form-label small">New rate (Rs)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="price" required></div>
        <div class="col-md-6"><label class="form-label small">Effective from</label><input type="date" class="form-control" name="eff" value="${today()}"></div>
        <div class="col-12 small text-body-secondary">Shifts already opened keep their own rate. New shifts use this rate.</div></div>`,
      onSubmit: async (f) => {
        const price = parseAmount(f.price);
        if (!(price > 0)) throw new Error('Enter a rate greater than zero.');
        await setPrice(p.id, price, f.eff || today());
        return true;
      },
    });
    if (v) { UI.toast('Rate updated'); again(); }
  });
}

export default {
  render,
  destroy() {},
};
