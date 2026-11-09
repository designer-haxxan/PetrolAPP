// Money and quantity helpers. Everything is stored and calculated with 4 decimal places (litres, rates, amounts).
import { getSettings } from './settings.js';

export const STORE_DP = 4;            // precision used for every stored value
const EPS = 1e-9;

// Round to 4 decimal places (the stored precision). Use after every multiplication or division.
export const rnd = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Math.sign(n) * EPS) * 10000) / 10000;
};

// Display decimals chosen by the owner in Settings (2–4, default 4).
export const displayDp = () => {
  const d = Number(getSettings().decimals);
  return Number.isInteger(d) && d >= 0 && d <= 4 ? d : 4;
};

const fmtCache = new Map();
function formatterFor(dp) {
  if (!fmtCache.has(dp)) {
    fmtCache.set(dp, new Intl.NumberFormat('en-PK', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  }
  return fmtCache.get(dp);
}

// Plain number with grouping and fixed decimals, e.g. 12345.5 -> "12,345.5000".
export function fmt(n, dp = displayDp()) {
  const v = Number(n);
  if (!Number.isFinite(v)) return formatterFor(dp).format(0);
  // Avoid "-0.0000" when a tiny negative rounds to zero.
  const r = rnd(v);
  return formatterFor(dp).format(Math.abs(r) < 0.5 / 10 ** dp ? 0 : r);
}

export const fmtQty = (n) => fmt(n, displayDp());
export const cur = () => getSettings().currency || 'Rs';
// Money with currency: "Rs 12,345.5000"
export const money = (n) => {
  const v = Number(n) || 0;
  return `${v < 0 && Math.abs(rnd(v)) > 0 ? '-' : ''}${cur()} ${fmt(Math.abs(v))}`;
};

// Balance with Dr/Cr suffix. `net` is debit minus credit; natural = 'dr' or 'cr' for how the balance is shown positive.
export function balanceText(net, natural = 'dr') {
  const r = rnd(net);
  if (r === 0) return money(0);
  const isNatural = natural === 'dr' ? r > 0 : r < 0;
  return `${money(Math.abs(r))} <span class="small text-body-secondary">${isNatural ? '' : (natural === 'dr' ? 'Cr' : 'Dr')}</span>`;
}

// Sum with 4 decimal precision (avoids floating drift when adding many rows).
export const sum = (arr, f = (x) => x) => rnd(arr.reduce((s, x) => s + Number(f(x) || 0), 0));

// Parse a user-typed number (commas allowed). Returns null when empty or invalid.
export function parseAmount(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? rnd(n) : null;
}
