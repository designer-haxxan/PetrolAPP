// Sign-in with the eposwala login API (POST {AUTH_API_BASE}/login). Accounts are created and managed by eposwala.
// One account is bound server-side to one device (deviceId). After a successful online login the session
// { token, expiresAt, username, role } is kept in LocalStorage and the app works offline until expiresAt.
// Passwords are never stored.
import { CONFIG, storageKey } from '../config.js';
import { AppError } from '../core/utils.js';

const SESSION_KEY = storageKey('session');
// Device id identifies the PHONE (the server binds the account to it). It uses the same key as the original
// eposwala apps on this origin, so an existing device binding keeps working.
const DEVICE_KEY = 'minipos.deviceId';

// Exact error codes returned by the API → user-facing messages.
const ERRORS = {
  missing_fields: 'Enter your username and password.',
  invalid_credentials: 'Wrong username or password.',
  device_mismatch: `This account is already active on another phone. Call ${CONFIG.SUPPORT_PHONE} for help.`,
  account_disabled: `This account has been disabled. Call ${CONFIG.SUPPORT_PHONE} for help.`,
};
const GENERIC = 'Login failed. Try again.';
const EXPIRED = 'Your session has expired. Connect to the internet and sign in again.';

// Roles from the server (admin, manager, cashier, accountant) map to the app's permission sets.
// A missing or unknown role gets the owner set, as the eposwala login always did.
export const ROLES = { owner: 'Owner', manager: 'Manager', accountant: 'Accountant', cashier: 'Attendant / Cashier' };
const SERVER_ROLE = { admin: 'owner', owner: 'owner', manager: 'manager', accountant: 'accountant', cashier: 'cashier' };

// Permission names: shift, sale, purchase, stock, dip, master, voucher, accounts, reports, assets, settings, users, backup
const PERMS = {
  owner: ['*'],
  manager: ['shift', 'sale', 'purchase', 'stock', 'dip', 'master', 'voucher', 'accounts', 'reports', 'assets', 'settings'],
  accountant: ['voucher', 'accounts', 'reports', 'assets', 'master', 'backup'],
  cashier: ['shift', 'sale', 'dip', 'stock'],
};

let current = null;

// Stable per-browser device id (sent with every login).
export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

const isValid = (s) => !!(s && typeof s.token === 'string' && s.token && typeof s.username === 'string' && Number(s.expiresAt) > Date.now());

function toUser(s) {
  const role = SERVER_ROLE[s.role] || 'owner';
  return { id: s.username, name: s.username, username: s.username, role };
}

// Sign in online. Stores the session until the server's expiresAt.
export async function login(username, password) {
  username = String(username ?? '').trim();
  password = String(password ?? '');
  if (!username || !password) throw new AppError(ERRORS.missing_fields);
  if (!navigator.onLine) throw new AppError('Internet connection is required to sign in.');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res;
  try {
    res = await fetch(`${CONFIG.AUTH_API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceId: deviceId() }),
      credentials: 'omit', cache: 'no-store', signal: ctrl.signal,
    });
  } catch {
    throw new AppError('Could not reach the login server. Check your internet connection and try again.');
  } finally { clearTimeout(timer); }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) throw new AppError(ERRORS[data?.error] || GENERIC);

  const session = { token: data?.token, expiresAt: Number(data?.expiresAt), username: data?.username || username };
  if (data?.role) session.role = data.role;
  if (!isValid(session)) throw new AppError(GENERIC);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  current = toUser(session);
  return current;
}

// Restores the session on app start (works offline). Resolves to the user, or null when signed out or expired.
let expiredOnRestore = false;
export function restoreSession() {
  const s = readSession();
  if (!s) return null;
  if (!isValid(s)) { localStorage.removeItem(SESSION_KEY); current = null; expiredOnRestore = true; return null; }
  current = toUser(s);
  return current;
}
// True when the last restore found a session that had expired (so the sign-in page can explain why).
export const wasExpiredOnRestore = () => expiredOnRestore;

// True when a signed-in session has reached its expiry (the app then asks for an online sign-in).
export const sessionExpired = () => !!current && !isValid(readSession());
export const expiryMessage = () => EXPIRED;
export const expiresAt = () => Number(readSession()?.expiresAt) || 0;

export const user = () => current;

// Logout only clears the local session (the API has no logout endpoint). The device binding stays on the server.
export function logout() {
  localStorage.removeItem(SESSION_KEY);
  current = null;
}

export function can(perm) {
  if (!current) return false;
  const p = PERMS[current.role] || [];
  return p.includes('*') || p.includes(perm);
}

export function require(perm) {
  if (!can(perm)) throw new AppError('You do not have permission for this action.', 'FORBIDDEN');
}
