// Reusable view fragments: date filters, ledger tables, document links, status badges, list pager.
import { esc, fmtDate, today, monthStart, addDays } from './utils.js';
import { fmt, money, balanceText } from './money.js';

const REF_ROUTES = {
  sale: (id) => `#/sales/${id}`, purchase: (id) => `#/purchases/${id}`, shift: () => '#/shifts',
  voucher: () => '#/vouchers', dip: () => '#/tanks', adjust: () => '#/stock', asset: () => '#/assets',
  depreciation: () => '#/assets',
};
export const REF_LABELS = {
  sale: 'Sale', purchase: 'Purchase', shift: 'Shift', voucher: 'Voucher', dip: 'Tank dip', adjust: 'Stock adjustment',
  asset: 'Asset purchase', depreciation: 'Depreciation', void: 'Reversal', opening: 'Opening balance', manual: 'Journal',
};

export function refLink(refType, id, text) {
  const r = REF_ROUTES[refType];
  return r ? `<a href="${r(encodeURIComponent(id || ''))}">${esc(text || '')}</a>` : esc(text || '');
}

// Date range filter with quick buttons. `extra` is extra HTML inserted into the form.
export function dateFilter(from, to, extra = '') {
  return `<form class="filters date-filter">
    <div><label class="form-label small mb-0">From</label><input type="date" name="from" class="form-control form-control-sm" value="${esc(from)}"></div>
    <div><label class="form-label small mb-0">To</label><input type="date" name="to" class="form-control form-control-sm" value="${esc(to)}"></div>
    ${extra}
    <div class="d-flex align-items-end gap-1 flex-wrap">
      <div class="btn-group btn-group-sm">
        <button type="button" class="btn btn-outline-secondary" data-range="today">Today</button>
        <button type="button" class="btn btn-outline-secondary" data-range="week">7 days</button>
        <button type="button" class="btn btn-outline-secondary" data-range="month">Month</button>
        <button type="button" class="btn btn-outline-secondary" data-range="year">Year</button>
      </div>
      <button class="btn btn-primary btn-sm">Apply</button>
    </div></form>`;
}

export function rangeFor(key) {
  const t = today();
  if (key === 'today') return [t, t];
  if (key === 'week') return [addDays(t, -6), t];
  if (key === 'year') return [t.slice(0, 4) + '-01-01', t];
  if (key === 'month') return [monthStart(t), t];
  return ['2000-01-01', t];
}

// Wires the quick-range buttons and form submit of a date filter; cb(from, to, values).
export function bindDateFilter($root, cb) {
  $root.on('click', '.date-filter [data-range]', function () {
    const [f, t] = rangeFor(this.dataset.range);
    const $f = $(this).closest('form');
    $f.find('[name=from]').val(f); $f.find('[name=to]').val(t);
    $f.trigger('submit');
  });
  $root.on('submit', '.date-filter', function (e) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(this).entries());
    cb(fd.from || '2000-01-01', fd.to || today(), fd);
  });
}

// Ledger table with running balance. natural: 'dr' or 'cr' side shown for a positive balance.
export function ledgerTable(led, { natural = 'dr', showAccount = false, showParty = false } = {}) {
  const cols = 6 + (showAccount ? 1 : 0) + (showParty ? 1 : 0);
  const rows = led.rows.map((e) => `<tr>
      <td class="text-nowrap">${fmtDate(e.date)}</td>
      <td class="text-nowrap">${refLink(e.refType, e.refId, e.refNo || '')}<div class="small text-body-secondary">${esc(REF_LABELS[e.refType] || e.refType)}</div></td>
      ${showAccount ? `<td class="small">${esc(e.accountName || e.accountId)}</td>` : ''}
      ${showParty ? `<td class="small">${esc(e.partyName || '')}</td>` : ''}
      <td class="small">${esc(e.memo || '')}</td>
      <td class="num">${e.debit ? fmt(e.debit) : ''}</td>
      <td class="num">${e.credit ? fmt(e.credit) : ''}</td>
      <td class="num fw-semibold">${balanceText(e.running, natural)}</td></tr>`).join('');
  return `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0 table-report">
    <thead><tr><th>Date</th><th>Ref</th>${showAccount ? '<th>Account</th>' : ''}${showParty ? '<th>Party</th>' : ''}<th>Details</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
    <tbody><tr class="table-light"><td colspan="${cols - 1}">Opening balance</td><td class="num fw-semibold">${balanceText(led.opening, natural)}</td></tr>
    ${rows || `<tr><td colspan="${cols}" class="text-center text-body-secondary py-4">No transactions in this period</td></tr>`}</tbody>
    <tfoot><tr class="fw-semibold"><td colspan="${cols - 3}">Totals / closing</td><td class="num">${fmt(led.dr)}</td><td class="num">${fmt(led.cr)}</td><td class="num">${balanceText(led.closing, natural)}</td></tr></tfoot>
  </table></div>`;
}

export function statusBadge(status) {
  const map = { posted: ['success', 'Posted'], void: ['secondary', 'Void'], open: ['primary', 'Open'], closed: ['dark', 'Closed'], active: ['success', 'Active'], inactive: ['secondary', 'Inactive'] };
  const [c, label] = map[status] || ['light', status || ''];
  return `<span class="badge text-bg-${c}">${esc(label)}</span>`;
}

// Simple incremental "load more" list rendering (keeps the DOM small on long lists).
export function pager($container, items, rowFn, pageSize = 60, empty = '') {
  let shown = 0;
  const more = () => {
    const chunk = items.slice(shown, shown + pageSize);
    shown += chunk.length;
    $container.find('.pager-more').remove();
    $container.append(chunk.map((it, i) => rowFn(it, shown - chunk.length + i)).join(''));
    if (shown < items.length) $container.append(`<button class="list-row pager-more justify-content-center text-primary">Show more (${items.length - shown} remaining)</button>`);
  };
  $container.empty();
  if (!items.length) { $container.html(empty); return; }
  $container.off('click.pager').on('click.pager', '.pager-more', more);
  more();
}

// Animated tank gauge: liquid level and a moving wave. pct is 0–100 of capacity.
let gaugeId = 0;
export function tankGauge(pct, { label = '', sub = '' } = {}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const id = `tk${++gaugeId}`;
  const y = 130 - 120 * (p / 100);
  const color = p < 15 ? '#dc2626' : p < 35 ? '#f59e0b' : '#0ea5e9';
  return `<div class="tank ${p < 15 ? 'low' : ''}" role="img" aria-label="${esc(label)} ${p.toFixed(1)} percent full">
    <svg viewBox="0 0 100 140" aria-hidden="true">
      <defs>
        <clipPath id="${id}"><rect x="10" y="10" width="80" height="120" rx="20"/></clipPath>
        <linearGradient id="${id}g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".85"/><stop offset="1" stop-color="${color}"/></linearGradient>
      </defs>
      <rect x="10" y="10" width="80" height="120" rx="20" fill="var(--line)" opacity=".55"/>
      <g clip-path="url(#${id})"><g class="liquid" transform="translate(0 ${y.toFixed(2)})"><path class="wave" d="M-100 4 q25 -8 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 V140 H-100 Z" fill="url(#${id}g)"/></g></g>
      <rect x="10" y="10" width="80" height="120" rx="20" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="2"/>
    </svg>
    <div class="tank-meta"><div class="fw-bold">${p.toFixed(1)}%</div><div class="small fw-medium">${esc(label)}</div><div class="small text-body-secondary">${esc(sub)}</div></div>
  </div>`;
}

export { money };
