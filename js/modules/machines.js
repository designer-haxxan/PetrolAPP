// Pumps (dispensing machines) and their nozzles: each nozzle dispenses one product from one tank and keeps its meter.
import { getAll, write } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, uuid, nowISO } from '../core/utils.js';
import { fmt, fmtQty, parseAmount } from '../core/money.js';
import { statusBadge } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function data() {
  const [pumps, nozzles, tanks, products] = await Promise.all([getAll('pumps'), getAll('nozzles'), getAll('tanks'), getAll('products')]);
  return {
    pumps: pumps.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    nozzles, tanks: tanks.filter((t) => t.active !== false), products: products.filter((p) => p.category === 'fuel' && p.active !== false),
    productMap: new Map(products.map((p) => [p.id, p])), tankMap: new Map(tanks.map((t) => [t.id, t])),
  };
}

async function render(el) {
  el.innerHTML = UI.spinner('Loading pumps…');
  const d = await data();
  el.innerHTML = page(d);
  bind(el, d);
}

function page(d) {
  const cards = d.pumps.map((p) => {
    const ns = d.nozzles.filter((n) => n.pumpId === p.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const list = ns.map((n) => {
      const pr = d.productMap.get(n.productId);
      const tk = d.tankMap.get(n.tankId);
      return `<div class="d-flex align-items-center gap-2 py-2 border-top">
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold">${esc(n.name)} ${n.active === false ? statusBadge('inactive') : ''}</div>
          <div class="small text-body-secondary text-truncate">${esc(pr?.name || 'No product')} · ${esc(tk?.name || 'No tank')}</div></div>
        <div class="text-end small"><div class="fw-semibold">${fmt(n.lastReading || 0)}</div><div class="text-body-secondary">meter</div></div>
        <button class="btn btn-sm btn-outline-secondary" data-act="edit-nozzle" data-id="${esc(n.id)}" ${Auth.can('master') ? '' : 'disabled'} aria-label="Edit nozzle"><i class="bi bi-pencil"></i></button></div>`;
    }).join('');
    return `<div class="col-md-6 col-xl-4"><div class="card p-3 h-100">
      <div class="d-flex align-items-center gap-2 mb-1"><span class="avatar tint-indigo"><i class="bi bi-fuel-pump"></i></span>
        <div class="flex-grow-1 min-w-0"><div class="fw-bold text-truncate">${esc(p.name)}</div><div class="small text-body-secondary">${ns.length} nozzle${ns.length === 1 ? '' : 's'}</div></div>
        <button class="btn btn-sm btn-outline-primary" data-act="add-nozzle" data-id="${esc(p.id)}" ${Auth.can('master') ? '' : 'disabled'}><i class="bi bi-plus-lg"></i></button></div>
      ${list || '<div class="small text-body-secondary py-2">No nozzles yet.</div>'}
    </div></div>`;
  }).join('');
  return `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Pumps & nozzles</h1>
      <button class="btn btn-primary btn-sm" data-act="add-pump" ${Auth.can('master') ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>Add pump</button></div>
    <div class="small text-body-secondary mb-3">A pump (dispenser) has one or more nozzles. Each nozzle sells one fuel from one tank. Opening and closing readings are taken on the Shifts page.</div>
    ${d.pumps.length ? `<div class="row g-3 stagger">${cards}</div>` : UI.emptyState('No pumps yet. Add each dispenser machine.', 'fuel-pump', '<button class="btn btn-primary mt-3" data-act="add-pump">Add pump</button>')}`;
}

function nozzleBody(d, n = null, pumpId = '') {
  const pumpOpts = d.pumps.map((p) => `<option value="${esc(p.id)}" ${p.id === (n?.pumpId || pumpId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const prodOpts = d.products.map((p) => `<option value="${esc(p.id)}" ${p.id === n?.productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return `<div class="row g-3">
    <div class="col-md-6"><label class="form-label small">Pump</label><select class="form-select" name="pumpId">${pumpOpts}</select></div>
    <div class="col-md-6"><label class="form-label small">Nozzle name</label><input class="form-control" name="name" value="${esc(n?.name || '')}" placeholder="e.g. N1 (Petrol)" required></div>
    <div class="col-md-6"><label class="form-label small">Product</label><select class="form-select" name="productId" id="noz-prod">${prodOpts}</select></div>
    <div class="col-md-6"><label class="form-label small">Tank it draws from</label><select class="form-select" name="tankId" id="noz-tank"></select></div>
    ${n ? `<div class="col-md-6"><label class="form-label small">Meter reading (correct only if the meter was replaced)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="lastReading" value="${Number(n.lastReading || 0).toFixed(4)}"></div>
    <div class="col-md-6"><label class="form-label small">Status</label><select class="form-select" name="active"><option value="true" ${n.active !== false ? 'selected' : ''}>Active</option><option value="false" ${n.active === false ? 'selected' : ''}>Inactive</option></select></div>` : ''}
  </div>`;
}

function fillTanks(m, d) {
  const pid = m.find('#noz-prod').val();
  const cur = m.find('#noz-tank').data('cur') || '';
  m.find('#noz-tank').html(d.tanks.filter((t) => t.productId === pid).map((t) => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${esc(t.name)}</option>`).join('') || '<option value="">No tank for this product — add one first</option>');
}

function bind(el, d) {
  const $el = $(el).off();
  $el.on('click', '[data-act="add-pump"]', async () => {
    const v = await UI.formModal({
      title: 'Add pump', submitLabel: 'Save pump',
      body: `<div class="row g-3"><div class="col-md-8"><label class="form-label small">Pump name / number</label><input class="form-control" name="name" placeholder="e.g. Dispenser 1" required></div>
        <div class="col-md-4"><label class="form-label small">Make (optional)</label><input class="form-control" name="make" placeholder="Tokheim, Wayne…"></div></div>`,
      onSubmit: async (f) => {
        if (!f.name?.trim()) throw new Error('Enter the pump name.');
        await write(['pumps'], (t) => t.put('pumps', { id: uuid(), name: f.name.trim(), make: (f.make || '').trim(), active: true, createdAt: nowISO() }));
        return true;
      },
    });
    if (v) { UI.toast('Pump added'); render(el); }
  });

  const openNozzle = async (n, pumpId = '') => {
    const v = await UI.formModal({
      title: n ? 'Edit nozzle' : 'Add nozzle', body: nozzleBody(d, n, pumpId), submitLabel: n ? 'Update' : 'Add nozzle',
      onShown: (m) => { m.find('#noz-tank').data('cur', n?.tankId || ''); fillTanks(m, d); m.on('change', '#noz-prod', () => { m.find('#noz-tank').data('cur', ''); fillTanks(m, d); }); },
      onSubmit: async (f) => {
        if (!f.name?.trim()) throw new Error('Enter the nozzle name.');
        if (!f.productId) throw new Error('Choose the product (add fuel products first).');
        if (!f.tankId) throw new Error('Add a tank for this product first (Tanks & dips).');
        const dup = (await getAll('nozzles')).find((x) => x.pumpId === f.pumpId && x.name.toLowerCase() === f.name.trim().toLowerCase() && x.id !== n?.id);
        if (dup) throw new Error('This pump already has a nozzle with that name.');
        const lastReading = parseAmount(f.lastReading);
        await write(['nozzles'], async (t) => {
          const base = n ? await t.get('nozzles', n.id) : { id: uuid(), lastReading: 0, createdAt: nowISO() };
          await t.put('nozzles', { ...base, pumpId: f.pumpId, name: f.name.trim(), productId: f.productId, tankId: f.tankId, active: n ? f.active !== 'false' : true,
            ...(n && lastReading !== null ? { lastReading } : {}), updatedAt: nowISO() });
        });
        return true;
      },
    });
    if (v) { UI.toast(n ? 'Nozzle updated' : 'Nozzle added'); render(el); }
  };
  $el.on('click', '[data-act="add-nozzle"]', function () { openNozzle(null, this.dataset.id); });
  $el.on('click', '[data-act="edit-nozzle"]', async function () {
    const n = (await getAll('nozzles')).find((x) => x.id === this.dataset.id);
    if (n) openNozzle(n);
  });
}

export default {
  render,
  destroy() {},
};

export { fmtQty };
