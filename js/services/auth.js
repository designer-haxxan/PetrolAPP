// Local user accounts (works fully offline). Passwords are hashed with PBKDF2-SHA-256 and never stored in clear text.
// Session = { userId, at } in LocalStorage; the user row is read from IndexedDB on each start.
import { storageKey } from '../config.js';
import { AppError, uuid, nowISO, lc } from '../core/utils.js';
import { get, getAll, write, read } from '../db/idb.js';

const SESSION_KEY = storageKey('session');
const ITER = 210000;
const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000; // sign in again after 12 hours without use

export const ROLES = { owner: 'Owner', manager: 'Manager', accountant: 'Accountant', cashier: 'Attendant / Cashier' };

// Permission names: shift, sale, purchase, stock, dip, master, voucher, accounts, reports, assets, settings, users, backup
const PERMS = {
  owner: ['*'],
  manager: ['shift', 'sale', 'purchase', 'stock', 'dip', 'master', 'voucher', 'accounts', 'reports', 'assets', 'settings'],
  accountant: ['voucher', 'accounts', 'reports', 'assets', 'master', 'backup'],
  cashier: ['shift', 'sale', 'dip', 'stock'],
};

let current = null;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

export async function hashPassword(password, saltHex = null, iter = ITER) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
  return { salt: hex(salt), hash: hex(bits), iter };
}

const publicUser = (u) => (u ? { id: u.id, username: u.username, name: u.name, role: u.role } : null);

export async function hasUsers() {
  const all = await getAll('users');
  return all.length > 0;
}

// Creates a user row (password required). Throws if the username already exists.
export async function createUser({ name, username, password, role }) {
  if (!ROLES[role]) throw new AppError('Choose a valid role.');
  if (String(password || '').length < 6) throw new AppError('Password must be at least 6 characters.');
  const uname = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(uname)) throw new AppError('Username: 3–30 letters, numbers, dot, dash or underscore.');
  const { salt, hash, iter } = await hashPassword(password);
  const row = { id: uuid(), name: String(name || uname).trim(), username: uname, usernameLc: lc(uname), role, salt, hash, iter, active: true, createdAt: nowISO() };
  await write(['users'], async (t) => {
    if (await t.getByIndex('users', 'username', row.usernameLc)) throw new AppError('That username is already taken.');
    await t.put('users', row);
  });
  return publicUser(row);
}

export async function verifyPassword(row, password) {
  const { hash } = await hashPassword(password, row.salt, row.iter || ITER);
  return hash === row.hash;
}

export async function login(username, password) {
  const uname = lc(username);
  if (!uname || !password) throw new AppError('Enter your username and password.');
  const row = (await read(['users'], (t) => t.getByIndex('users', 'username', uname))) || null;
  // Same message for unknown user and wrong password, to avoid leaking which usernames exist.
  if (!row || !row.active || !(await verifyPassword(row, password))) throw new AppError('Wrong username or password.');
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: row.id, at: Date.now() }));
  current = publicUser(row);
  return current;
}

// Restores the session from LocalStorage on app start. Resolves to the user or null.
export async function restoreSession() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { s = null; }
  if (!s?.userId || Date.now() - Number(s.at) > IDLE_LIMIT_MS) { logout(); return null; }
  const row = await get('users', s.userId);
  if (!row || !row.active) { logout(); return null; }
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: row.id, at: Date.now() }));
  current = publicUser(row);
  return current;
}

export const user = () => current;

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

export async function changeOwnPassword(oldPw, newPw) {
  if (!current) throw new AppError('Sign in first.');
  if (String(newPw || '').length < 6) throw new AppError('New password must be at least 6 characters.');
  const row = await get('users', current.id);
  if (!(await verifyPassword(row, oldPw))) throw new AppError('Current password is wrong.');
  const { salt, hash, iter } = await hashPassword(newPw);
  await write(['users'], (t) => t.put('users', { ...row, salt, hash, iter }));
}

// Owner resets another user's password (no old password needed).
export async function resetPassword(userId, newPw) {
  require('users');
  if (String(newPw || '').length < 6) throw new AppError('Password must be at least 6 characters.');
  const row = await get('users', userId);
  if (!row) throw new AppError('User not found.');
  const { salt, hash, iter } = await hashPassword(newPw);
  await write(['users'], (t) => t.put('users', { ...row, salt, hash, iter }));
}
