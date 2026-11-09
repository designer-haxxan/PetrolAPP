// Settings and preferences. Company profile and business rules are kept in LocalStorage (never accounting data).
import { storageKey } from '../config.js';

const KEY = storageKey('settings');

export const DEFAULT_SETTINGS = {
  company: {
    name: 'My Petrol Pump', address: '', city: '', phone: '', ntn: '', strn: '',
    footer: 'Thank you for visiting. Drive safe!',
  },
  currency: 'Rs',
  decimals: 4,                 // display decimals for litres, rates and amounts (stored with 4)
  pricesIncludeTax: true,      // retail rates are tax-inclusive (typical at Pakistani pumps)
  allowNegativeStock: false,   // goods (lubricants, shop items) cannot go below zero
  prefixes: { sale: 'INV', purchase: 'PUR', voucher: 'VCH', shift: 'SH', asset: 'FA', dip: 'DIP' },
  theme: 'auto',
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

let cache = null;
export function getSettings() {
  if (!cache) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { stored = {}; }
    cache = merge(DEFAULT_SETTINGS, stored);
  }
  return cache;
}

export function saveSettings(patch) {
  cache = merge(getSettings(), patch);
  localStorage.setItem(KEY, JSON.stringify(cache));
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  return cache;
}

// Replaces every setting (used when restoring a backup).
export function replaceSettings(all) {
  cache = merge(DEFAULT_SETTINGS, all || {});
  localStorage.setItem(KEY, JSON.stringify(cache));
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  return cache;
}

// Small per-device preference helpers (e.g. last used tab).
export const pref = {
  get(k, d = null) { try { const v = localStorage.getItem(storageKey('pref.' + k)); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(storageKey('pref.' + k), JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

export function applyTheme() {
  const t = getSettings().theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1020' : '#f3f6fb');
}
