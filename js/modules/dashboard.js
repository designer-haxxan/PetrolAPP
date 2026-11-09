// Dashboard: today's sales, cash position, receivables and payables, tank gauges, 7-day chart and alerts.
import { getAll } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, today, monthStart, addDays, fmtDate, fmtTime } from '../core/utils.js';
import { fmt, money, fmtQty, rnd } from '../core/money.js';
import { loadBooks, incomeStatement, aging } from '../services/finance.js';
import { tankGauge, REF_LABELS } from '../core/views.js';
import * as Auth from '../services/auth.js';

const MONEY_KINDS = ['cash', 'bank', 'wallet'];

function kpi(label, value, icon, tint, sub = '', count = true) {
  return `<div class="kpi" style="--tint:${tint}">
    <div class="kpi-icon"><i class="bi bi-${icon}"></i></div>
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value" ${count ? `data-count="${Number(value) || 0}" data-money="1"` : ''}>${count ? money(0) : value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

export default {
  async render(el) {
    const [tanks, shifts, sales, purchases, vouchers, products, books, dips] = await Promise.all([
      getAll('tanks'), getAll('shifts'), getAll('sales'), getAll('purchases'), getAll('vouchers'), getAll('products'), loadBooks(), getAll('dips'),
    ]);
    const t = today();
    const closedToday = shifts.filter((s) => s.status === 'closed' && s.date === t);
    const openShift = shifts.find((s) => s.status === 'open');
    const salesToday = sales.filter((s) => s.status === 'posted' && s.date === t);
    const litresToday = rnd(closedToday.reduce((s, x) => s + (x.totals?.litres || 0), 0));
    const grossToday = rnd(closedToday.reduce((s, x) => s + (x.totals?.gross || 0), 0) + salesToday.reduce((s, x) => s + x.gross, 0));
    const cashAccounts = books.accountList.filter((a) => MONEY_KINDS.includes(a.kind));
    const balanceOf = (id) => books.entries.reduce((s, e) => (e.accountId === id ? rnd(s + e.debit - e.credit) : s), 0);
    const cashTotal = rnd(cashAccounts.filter((a) => a.kind === 'cash').reduce((s, a) => s + balanceOf(a.id), 0));
    const bankTotal = rnd(cashAccounts.filter((a) => a.kind !== 'cash').reduce((s, a) => s + balanceOf(a.id), 0));
    const ar = aging(books, 'ar', t).grand.total;
    const ap = aging(books, 'ap', t).grand.total;
    const stockValue = rnd(products.reduce((s, p) => s + (p.stockValue || 0), 0));
    const pl = incomeStatement(books, monthStart(t), t);
    const alerts = [];
    if (openShift) alerts.push({ icon: 'fuel-pump', tone: 'primary', text: `Shift ${openShift.number} is open since ${fmtTime(openShift.openedAt)}.`, href: '#/shifts' });
    for (const tk of tanks) {
      if (tk.bookLitres < -0.00005) alerts.push({ icon: 'exclamation-triangle', tone: 'danger', text: `${tk.name} book stock is negative (${fmtQty(tk.bookLitres)} L). A receipt or dip is missing.`, href: '#/tanks' });
    }
    const undipped = dips.filter((d) => !d.posted && Math.abs(d.variance) > 0.00005).length;
    if (undipped) alerts.push({ icon: 'droplet-half', tone: 'warning', text: `${undipped} tank dip variance(s) waiting to be posted.`, href: '#/tanks' });
    const old = aging(books, 'ar', t).rows.reduce((s, r) => s + r.b3, 0);
    if (old > 0.00005) alerts.push({ icon: 'hourglass-split', tone: 'warning', text: `${money(old)} of udhaar is over 90 days old.`, href: '#/reports' });
    // Only items that are on sale (have a rate) and have run out.
    const lowStock = products.filter((p) => p.category === 'goods' && p.price > 0 && p.stockQty <= 0 && p.active !== false);
    if (lowStock.length) alerts.push({ icon: 'box-seam', tone: 'warning', text: `${lowStock.length} goods item(s) out of stock.`, href: '#/stock' });

    // 7-day chart (gross sales per day from closed shifts and counter sales)
    const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
    const perDay = days.map((d) => rnd(
      shifts.filter((s) => s.status === 'closed' && s.date === d).reduce((s, x) => s + (x.totals?.gross || 0), 0)
      + sales.filter((s) => s.status === 'posted' && s.date === d).reduce((s, x) => s + x.gross, 0)));
    const maxDay = Math.max(1, ...perDay);
    const chart = days.map((d, i) => `<div class="col" title="${esc(fmtDate(d))}: ${esc(money(perDay[i]))}">
        <div class="val">${perDay[i] ? fmt(perDay[i], 0) : ''}</div>
        <div class="fill" style="--i:${i};height:${Math.max(3, (perDay[i] / maxDay) * 100)}%"></div>
        <div class="lbl">${esc(new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' }))}</div></div>`).join('');

    // Recent activity across modules
    const activity = [
      ...shifts.filter((s) => s.status === 'closed').map((s) => ({ at: s.closedAt, label: `Shift ${s.number} closed`, sub: `${fmtQty(s.totals?.litres || 0)} L · ${money(s.totals?.gross || 0)}`, icon: 'fuel-pump', href: '#/shifts' })),
      ...sales.map((s) => ({ at: s.createdAt, label: `Sale ${s.number}`, sub: `${esc(s.customerName)} · ${money(s.gross)}`, icon: 'receipt', href: '#/sales', status: s.status })),
      ...purchases.map((p) => ({ at: p.createdAt, label: `Purchase ${p.number}`, sub: `${esc(p.supplierName)} · ${money(p.total)}`, icon: 'truck', href: '#/purchases', status: p.status })),
      ...vouchers.map((v) => ({ at: v.createdAt, label: `${esc(v.label || 'Voucher')} ${v.number}`, sub: `${esc(v.partyName || '')} ${money(v.amount)}`, icon: 'cash-coin', href: '#/vouchers', status: v.status })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);

    const tankCards = tanks.filter((tk) => tk.active !== false).map((tk) => {
      const p = products.find((x) => x.id === tk.productId);
      const pct = tk.capacity > 0 ? (tk.bookLitres / tk.capacity) * 100 : 0;
      return `<div class="col-6 col-md-4 col-xl-3">${tankGauge(pct, { label: tk.name, sub: `${fmtQty(tk.bookLitres)} / ${fmtQty(tk.capacity)} L · ${p?.name || ''}` })}</div>`;
    }).join('');

    const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
    el.innerHTML = `
      <div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
        <div><div class="text-body-secondary small">${esc(greeting)}, ${esc(Auth.user()?.name || '')}</div>
          <h1 class="h4 fw-bold mb-0">${esc(fmtDate(t))}</h1></div>
        <div class="d-flex gap-2 no-print">
          ${openShift ? `<a href="#/shifts" class="btn btn-success btn-sm"><span class="live-dot"></span>Shift ${esc(openShift.number)} live</a>` : (Auth.can('shift') ? '<a href="#/shifts" class="btn btn-primary btn-sm"><i class="bi bi-play-fill me-1"></i>Open shift</a>' : '')}
          ${Auth.can('sale') ? '<a href="#/sales" class="btn btn-outline-primary btn-sm"><i class="bi bi-cart-plus me-1"></i>Counter sale</a>' : ''}
        </div>
      </div>

      <div class="row g-3 stagger">
        <div class="col-lg-5">
          <div class="hero-card h-100">
            <div class="small opacity-75">Today's sales (fuel + goods)</div>
            <div class="kpi-value mt-1" data-count="${grossToday}" data-money="1">${money(0)}</div>
            <div class="d-flex gap-4 mt-3 flex-wrap">
              <div><div class="small opacity-75">Litres sold</div><div class="fw-bold fs-5">${fmtQty(litresToday)} L</div></div>
              <div><div class="small opacity-75">Bills</div><div class="fw-bold fs-5">${salesToday.length + closedToday.length}</div></div>
              <div><div class="small opacity-75">Profit this month</div><div class="fw-bold fs-5">${money(pl.netProfit)}</div></div>
            </div>
          </div>
        </div>
        <div class="col-lg-7">
          <div class="row g-3">
            <div class="col-6 col-xl-3">${kpi('Cash in hand', cashTotal, 'cash-stack', '#16a34a')}</div>
            <div class="col-6 col-xl-3">${kpi('Bank & wallets', bankTotal, 'bank', '#0b5cad')}</div>
            <div class="col-6 col-xl-3">${kpi('Receivable (udhaar)', ar, 'people', '#f97316')}</div>
            <div class="col-6 col-xl-3">${kpi('Payable (OMCs)', ap, 'building', '#dc2626')}</div>
            <div class="col-6 col-xl-3">${kpi('Stock value', stockValue, 'boxes', '#7c3aed')}</div>
            <div class="col-6 col-xl-3">${kpi('Fixed assets (cost)', books.entries.reduce((s, e) => (e.accountId.startsWith('fa_') ? rnd(s + e.debit - e.credit) : s), 0), 'bricks', '#0891b2')}</div>
          </div>
        </div>
      </div>

      <div class="row g-3 mt-1 stagger">
        <div class="col-lg-7">
          <div class="card p-3 h-100">
            <div class="d-flex justify-content-between align-items-center mb-2"><div class="fw-semibold">Last 7 days — sales</div><div class="small text-body-secondary">${money(perDay.reduce((s, x) => s + x, 0))}</div></div>
            <div class="chart-bars">${chart}</div>
          </div>
        </div>
        <div class="col-lg-5">
          <div class="card p-3 h-100">
            <div class="fw-semibold mb-2">Alerts</div>
            ${alerts.length ? alerts.map((a) => `<a href="${a.href}" class="d-flex gap-2 align-items-start text-decoration-none text-body py-2 border-bottom">
              <span class="text-${a.tone}"><i class="bi bi-${a.icon}"></i></span><span class="small">${esc(a.text)}</span></a>`).join('') : '<div class="small text-body-secondary py-3"><i class="bi bi-check2-circle text-success me-1"></i>Nothing needs attention right now.</div>'}
          </div>
        </div>
      </div>

      <div class="row g-3 mt-1 stagger">
        <div class="col-lg-7">
          <div class="card p-3 h-100">
            <div class="fw-semibold mb-2">Tanks (book stock)</div>
            ${tankCards ? `<div class="row g-2 justify-content-center">${tankCards}</div>` : UI.emptyState('No tanks yet. Add tanks in Tanks & Dip Readings.', 'droplet-half')}
          </div>
        </div>
        <div class="col-lg-5">
          <div class="list-card h-100">
            <div class="p-3 pb-2 fw-semibold">Recent activity</div>
            ${activity.length ? activity.map((a) => `<a class="list-row text-decoration-none" href="${a.href}">
              <span class="avatar tint-slate"><i class="bi bi-${a.icon}"></i></span>
              <span class="flex-grow-1 min-w-0"><span class="d-block fw-medium text-truncate">${esc(a.label)} ${a.status === 'void' ? '<span class="badge text-bg-secondary ms-1">Void</span>' : ''}</span><span class="d-block small text-body-secondary text-truncate">${a.sub}</span></span>
              <span class="small text-body-secondary text-nowrap">${esc(fmtTime(a.at))}</span></a>`).join('') : UI.emptyState('No activity yet', 'clock-history')}
          </div>
        </div>
      </div>`;
    UI.countUp(el, (v) => money(v));
  },
  destroy() {},
};

export { REF_LABELS };
