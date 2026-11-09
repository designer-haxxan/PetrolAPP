// Tanks & dips: animated tank gauges, book stock vs physical dip, shortage / excess posting, and tank setup.
import { getAll, get, write } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, fmtDate, uuid, nowISO, today, AppError } from '../core/utils.js';
import { fmt, fmtQty, parseAmount, rnd } from '../core/money.js';
import { recordDip, postDipVariance } from '../services/posting.js';
import { postOpeningStock } from '../services/openings.js';
import { tankGauge, statusBadge } from '../core/views.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function data() {
  const [tanks, products, dips, nozzles] = await Promise.all([getAll('tanks'), getAll('products'), getAll('dips'), getAll('nozzles')]);
  return {
    tanks: tanks.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    fuel: products.filter((p) => p.category === 'fuel' && p.active !== false),
    products: new Map(products.map((p) => [p.id, p])),
    dips: dips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    nozzleCount: (tid) => nozzles.filter((n) => n.tankId === tid).length,
  };
}

async function render(el) {
  el.innerHTML = UI.spinner('Loading tanks…');
  const d = await data();
  el.innerHTML = page(d);
  bind(el, d);
}

function page(d) {
  const cards = d.tanks.map((t) => {
    const p = d.products.get(t.productId);
    const pct = t.capacity > 0 ? (t.bookLitres / t.capacity) * 100 : 0;
    const last = d.dips.find((x) => x.tankId === t.id);
    return `<div class="col-6 col-md-4 col-xl-3"><div class="card p-3 h-100 text-center">
      ${tankGauge(pct, { label: t.name, sub: `${p?.name || ''} · cap ${fmtQty(t.capacity)} L` })}
      <div class="mt-2 small">Book: <b>${fmtQty(t.bookLitres)} L</b>${last ? `<br>Last dip: ${fmtQty(last.dipLitres)} L on ${fmtDate(last.date)}` : '<br><span class="text-body-secondary">No dip recorded</span>'}</div>
      <div class="d-flex gap-2 justify-content-center mt-2 no-print">
        <button class="btn btn-sm btn-primary" data-act="dip" data-id="${esc(t.id)}" ${Auth.can('dip') ? '' : 'disabled'}><i class="bi bi-droplet me-1"></i>Dip</button>
        <button class="btn btn-sm btn-outline-secondary" data-act="edit-tank" data-id="${esc(t.id)}"><i class="bi bi-pencil"></i></button>
      </div>
      ${t.bookLitres < -0.00005 ? '<div class="small text-danger mt-1"><i class="bi bi-exclamation-triangle me-1"></i>Negative book: post a receipt or dip</div>' : ''}
    </div></div>`;
  }).join('');
  const rows = d.dips.slice(0, 60).map((x) => {
    const t = d.tanks.find((tk) => tk.id === x.tankId);
    return `<tr><td class="fw-semibold">${esc(x.number || '')}</td><td>${fmtDate(x.date)}</td><td>${esc(t?.name || 'Deleted tank')}</td>
      <td class="num">${fmtQty(x.dipLitres)}</td><td class="num">${fmtQty(x.bookLitres)}</td>
      <td class="num ${x.variance < 0 ? 'text-danger' : x.variance > 0 ? 'text-success' : ''}">${fmtQty(x.variance)}</td>
      <td>${x.posted ? statusBadge('posted') : '<span class="badge text-bg-warning">Pending</span>'}</td>
      <td class="text-end">${!x.posted && Auth.can('dip') ? `<button class="btn btn-sm btn-outline-primary" data-act="post-dip" data-id="${esc(x.id)}">Post</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Tanks & dip readings</h1>
      <button class="btn btn-outline-primary btn-sm" data-act="add-tank" ${Auth.can('master') ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>Add tank</button>
      <button class="btn btn-primary btn-sm" data-act="dip-any" ${Auth.can('dip') ? '' : 'disabled'}><i class="bi bi-droplet-half me-1"></i>Record dip</button></div>
    <div class="small text-body-secondary mb-3">Book stock = opening stock + fuel received − fuel sold through the nozzles. Measure the tank with the dip stick, record it here, and post the shortage or excess.</div>
    ${d.tanks.length ? `<div class="row g-3 stagger">${cards}</div>` : UI.emptyState('No tanks yet. Add the underground tanks first.', 'droplet-half', '<button class="btn btn-primary mt-3" data-act="add-tank">Add tank</button>')}
    <div class="list-card mt-4"><div class="p-3 pb-2 fw-semibold">Dip history</div>
      ${rows ? `<div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report"><thead><tr><th>No.</th><th>Date</th><th>Tank</th><th class="num">Dip</th><th class="num">Book</th><th class="num">Variance</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : UI.emptyState('No dip readings yet', 'droplet')}
    </div>`;
}

function tankFormBody(d, t = null) {
  const prodOpts = d.fuel.map((p) => `<option value="${esc(p.id)}" ${t?.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return `<div class="row g-3">
    <div class="col-md-6"><label class="form-label small">Tank name</label><input class="form-control" name="name" value="${esc(t?.name || '')}" placeholder="e.g. Petrol Tank 1" required></div>
    <div class="col-md-6"><label class="form-label small">Product stored</label><select class="form-select" name="productId" ${t ? 'disabled' : ''}>${prodOpts}</select></div>
    <div class="col-md-6"><label class="form-label small">Capacity (litres)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="capacity" value="${t ? Number(t.capacity).toFixed(4) : ''}" placeholder="0.0000"></div>
    ${t ? `<div class="col-md-6"><label class="form-label small">Status</label><select class="form-select" name="active"><option value="true" ${t.active !== false ? 'selected' : ''}>Active</option><option value="false" ${t.active === false ? 'selected' : ''}>Inactive</option></select></div>` : `
    <div class="col-12"><hr class="my-1"><div class="small fw-semibold mb-2">Opening stock (optional)</div></div>
    <div class="col-md-4"><label class="form-label small">Litres in tank now</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="openQty" placeholder="0.0000"></div>
    <div class="col-md-4"><label class="form-label small">Cost per litre</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="openCost" placeholder="0.0000"></div>
    <div class="col-md-4"><label class="form-label small">Date</label><input type="date" class="form-control" name="openDate" value="${today()}"></div>`}
  </div>`;
}

function dipFormBody(d, presetTankId = '') {
  const opts = d.tanks.filter((t) => t.active !== false).map((t) => `<option value="${esc(t.id)}" ${t.id === presetTankId ? 'selected' : ''}>${esc(t.name)} · ${esc(d.products.get(t.productId)?.name || '')}</option>`).join('');
  return `<div class="row g-3">
    <div class="col-md-6"><label class="form-label small">Tank</label><select class="form-select" name="tankId" required>${opts}</select></div>
    <div class="col-md-3"><label class="form-label small">Date</label><input type="date" class="form-control" name="date" value="${today()}"></div>
    <div class="col-md-3"><label class="form-label small">Dip (litres)</label><input type="number" step="0.0001" min="0" class="form-control money-input" name="dipLitres" placeholder="0.0000" required></div>
    <div class="col-12"><div class="summary-box" id="dip-preview"><span class="small text-body-secondary">Choose a tank and enter the dip to see the variance.</span></div></div>
    <div class="col-12"><label class="form-label small">Note</label><input class="form-control" name="note" placeholder="Optional"></div>
  </div>`;
}

function bind(el, d) {
  const $el = $(el).off();
  const tankById = (id) => d.tanks.find((t) => t.id === id);

  $el.on('click', '[data-act="add-tank"]', async () => {
    const v = await UI.formModal({
      title: 'Add tank', body: tankFormBody(d), submitLabel: 'Save tank',
      onSubmit: async (f) => {
        const cap = parseAmount(f.capacity);
        if (!f.name?.trim()) throw new Error('Enter the tank name.');
        if (!f.productId) throw new Error('Choose the product (add fuel products first).');
        if (!(cap > 0)) throw new Error('Enter the capacity of the tank.');
        const row = { id: uuid(), name: f.name.trim(), productId: f.productId, capacity: cap, bookLitres: 0, active: true, createdAt: nowISO(), updatedAt: nowISO() };
        await write(['tanks'], (t) => t.put('tanks', row));
        const openQty = parseAmount(f.openQty);
        if (openQty > 0) {
          const cost = parseAmount(f.openCost) ?? 0;
          await postOpeningStock({ productId: f.productId, tankId: row.id, qty: openQty, unitCost: cost, date: f.openDate || today() });
        }
        return true;
      },
    });
    if (v) { UI.toast('Tank added'); render(el); }
  });

  $el.on('click', '[data-act="edit-tank"]', async function () {
    const t = tankById(this.dataset.id);
    const v = await UI.formModal({
      title: 'Edit tank', body: tankFormBody(d, t), submitLabel: 'Update',
      onSubmit: async (f) => {
        const cap = parseAmount(f.capacity);
        if (!(cap > 0)) throw new Error('Enter the capacity.');
        if (cap < t.bookLitres) throw new Error('Capacity cannot be less than the current book stock.');
        await write(['tanks'], async (tx) => { const row = await tx.get('tanks', t.id); await tx.put('tanks', { ...row, name: f.name.trim(), capacity: cap, active: f.active !== 'false', updatedAt: nowISO() }); });
        return true;
      },
    });
    if (v) { UI.toast('Tank updated'); render(el); }
  });

  $el.on('click', '[data-act="dip"], [data-act="dip-any"]', async function () {
    const preset = this.dataset.id || '';
    const v = await UI.formModal({
      title: 'Record dip reading', body: dipFormBody(d, preset), submitLabel: 'Save dip',
      onShown: (m) => { const update = () => {
        const tk = tankById(m.find('[name=tankId]').val());
        const dip = parseAmount(m.find('[name=dipLitres]').val());
        if (!tk) return;
        const book = rnd(tk.bookLitres);
        const diff = dip === null ? null : rnd(dip - book);
        m.find('#dip-preview').html(`<div class="row-line"><span>Book stock</span><span>${fmtQty(book)} L</span></div>
          <div class="row-line"><span>Dip reading</span><span>${dip === null ? '–' : fmtQty(dip) + ' L'}</span></div>
          <div class="row-line fw-bold ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-success' : ''}"><span>${diff === null ? 'Variance' : diff < 0 ? 'Shortage' : diff > 0 ? 'Excess' : 'Matches book'}</span><span>${diff === null ? '–' : fmtQty(diff) + ' L'}</span></div>`);
      }; m.on('input change', 'input, select', update); update(); },
      onSubmit: async (f) => {
        const dip = parseAmount(f.dipLitres);
        if (dip === null) throw new Error('Enter the dip reading in litres.');
        await recordDip({ tankId: f.tankId, date: f.date || today(), dipLitres: dip, note: f.note });
        return true;
      },
    });
    if (v) { UI.toast('Dip recorded. Post the variance when you are happy with the reading.'); render(el); }
  });

  $el.on('click', '[data-act="post-dip"]', async function () {
    const dip = await get('dips', this.dataset.id);
    if (!dip) return;
    const ok = await UI.confirmDialog(
      Math.abs(dip.variance) < 0.00005 ? 'The dip matches the book stock. Mark it as posted?' : `Post a ${dip.variance < 0 ? 'shortage' : 'excess'} of ${fmtQty(Math.abs(dip.variance))} L? The tank book will be set to the dip, and the difference goes to ${dip.variance < 0 ? 'Fuel shortage' : 'Fuel gain'} in the ledger.`,
      { okLabel: 'Post', title: 'Post dip variance' });
    if (!ok) return;
    try { await postDipVariance(dip.id); UI.toast('Dip posted'); render(el); } catch (e) { UI.toastError(e); }
  });
}

export default {
  render,
  destroy() {},
};

export { AppError };
