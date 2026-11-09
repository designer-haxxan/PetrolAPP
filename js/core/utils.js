// Small, dependency-free helpers shared by all modules.

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export function num(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : def;
}

const pad = (n) => String(n).padStart(2, '0');
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const today = () => localDate();
export const nowISO = () => new Date().toISOString();
export const monthKey = (dateStr = today()) => dateStr.slice(0, 7);
export const monthStart = (dateStr = today()) => dateStr.slice(0, 8) + '01';
export function monthEnd(dateStr = today()) {
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number);
  return localDate(new Date(y, m, 0));
}
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return localDate(d);
}
// Whole days from a to b (b - a), both YYYY-MM-DD.
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).length === 10 ? dateStr + 'T00:00:00' : dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

export const lc = (s) => String(s ?? '').trim().toLowerCase();
export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function downloadFile(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

export class AppError extends Error {
  constructor(message, code = 'APP') { super(message); this.code = code; }
}
