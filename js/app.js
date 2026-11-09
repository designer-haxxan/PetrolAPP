// Application bootstrap: service worker, database, sign-in (eposwala accounts), session expiry, navigation and routing.
import { CONFIG } from './config.js';
import { applyTheme, getSettings } from './core/settings.js';
import * as UI from './core/ui.js';
import { esc } from './core/utils.js';
import { openDB } from './db/idb.js';
import * as Auth from './services/auth.js';

const $ = window.jQuery;

// Route table: name → [loader, title, permission|null, icon, menu section]
const M = (f) => () => import(`./modules/${f}.js`);
const ROUTES = {
  dashboard: [M('dashboard'), 'Dashboard', null, 'speedometer2', 'Main'],
  shifts: [M('shifts'), 'Shifts & Meters', 'shift', 'fuel-pump', 'Operations'],
  sales: [M('sales'), 'Counter Sales', 'sale', 'receipt', 'Operations'],
  purchases: [M('purchases'), 'Fuel & Goods Purchases', 'purchase', 'truck', 'Operations'],
  tanks: [M('tanks'), 'Tanks & Dip Readings', 'dip', 'droplet-half', 'Operations'],
  stock: [M('stock'), 'Stock & Valuation', 'stock', 'boxes', 'Operations'],
  products: [M('products'), 'Products & Prices', 'master', 'tags', 'Masters'],
  machines: [M('machines'), 'Pumps & Nozzles', 'master', 'ev-front', 'Masters'],
  customers: [M('parties'), 'Customers (Udhaar)', 'sale', 'people', 'Masters'],
  suppliers: [M('parties'), 'Suppliers & OMCs', 'purchase', 'building', 'Masters'],
  employees: [M('parties'), 'Employees', 'master', 'person-badge', 'Masters'],
  investors: [M('parties'), 'Investors', 'accounts', 'piggy-bank', 'Masters'],
  assets: [M('assets'), 'Fixed Assets', 'assets', 'bricks', 'Masters'],
  vouchers: [M('vouchers'), 'Vouchers & Payments', 'voucher', 'cash-coin', 'Accounts'],
  accounts: [M('accounts'), 'Chart of Accounts & Ledger', 'accounts', 'journal-bookmark', 'Accounts'],
  reports: [M('reports'), 'Reports', 'reports', 'bar-chart-line', 'Accounts'],
  backup: [M('backup'), 'Backup & Restore', 'backup', 'cloud-arrow-down', 'Administration'],
  settings: [M('settings'), 'Settings', 'settings', 'gear', 'Administration'],
};

let currentModule = null;
let routeToken = 0;
let deferredInstall = null;
let expiryTimer = null;

function showView(name) {
  $('#splash').addClass('d-none');
  $('#view-login').toggleClass('d-none', name !== 'login');
  $('#view-app').toggleClass('d-none', name !== 'app');
}

function fatal(msg) {
  $('#splash-error').text(msg);
  $('#splash .spinner-border').addClass('d-none');
}

// ---------- Service worker & install ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('service-worker.js').then((reg) => {
    const check = () => {
      if (!navigator.onLine) return;
      reg.update().catch(() => {});
      (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'ENSURE_CACHE' });
    };
    check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch((e) => console.warn('Service worker registration failed:', e));
  // Reload when an update replaces an existing worker, so the page never mixes files from two versions.
  let controlled = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled && !reloading) { reloading = true; location.reload(); }
    controlled = true;
  });
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#install-btn').removeClass('d-none'); });
window.addEventListener('appinstalled', () => { deferredInstall = null; $('#install-btn').addClass('d-none'); UI.toast('App installed'); });
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null; $('#install-btn').addClass('d-none');
  return true;
}

// ---------- Navigation ----------
function buildMenu() {
  let html = ''; let section = '';
  for (const [name, [, title, perm, icon, sec]] of Object.entries(ROUTES)) {
    if (perm && !Auth.can(perm)) continue;
    if (sec !== section) { section = sec; html += `<div class="nav-section">${esc(sec)}</div>`; }
    html += `<a class="nav-link" href="#/${name}" data-route="${name}"><i class="bi bi-${icon}"></i><span>${esc(title)}</span></a>`;
  }
  $('.nav-menu').html(html);
  const u = Auth.user();
  $('#user-name').text(u.name);
  $('#user-role').text(Auth.ROLES[u.role] || u.role);
  $('#user-avatar').text(UI.initials(u.name));
  $('#brand-name').text(getSettings().company.name || CONFIG.APP_NAME);
  $('#bottom-nav [data-route="sales"]').toggleClass('d-none', !Auth.can('sale'));
  $('#bottom-nav [data-route="shifts"]').toggleClass('d-none', !Auth.can('shift'));
}

async function route() {
  if (!Auth.user()) return;
  if (checkExpiry()) return;
  const token = ++routeToken;
  const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/').map(decodeURIComponent);
  const name = ROUTES[parts[0]] ? parts[0] : 'dashboard';
  const [loader, title, perm] = ROUTES[name];
  try { currentModule?.destroy?.(); } catch (e) { console.warn(e); }
  currentModule = null;
  bootstrap.Offcanvas.getInstance('#menu-offcanvas')?.hide();
  $('.nav-menu .nav-link, #bottom-nav a').removeClass('active');
  $(`.nav-menu [data-route="${name}"], #bottom-nav [data-route="${name}"]`).addClass('active');
  $('#topbar-title').text(title);
  // Each route renders into its own host element. If a slower, older route finishes after a newer one has
  // started, it writes into a host that is no longer on the page, so it cannot overwrite the current screen.
  const $c = $('#content').off();
  const host = document.createElement('div');
  host.className = 'route-host';
  $c[0].replaceChildren(host);
  if (perm && !Auth.can(perm)) { host.innerHTML = UI.emptyState('You do not have permission to open this page.', 'shield-lock'); return; }
  host.innerHTML = UI.spinner();
  try {
    const mod = (await loader()).default;
    if (token !== routeToken) return;
    currentModule = mod;
    window.scrollTo(0, 0);
    await mod.render(host, { route: name, params: parts.slice(1), setTitle: (t) => $('#topbar-title').text(t) });
    if (token === routeToken) { void host.offsetWidth; host.classList.add('page-enter'); }
  } catch (e) {
    console.error(e);
    if (token === routeToken) host.innerHTML = UI.errorState(e);
  }
}

// ---------- Sign-in gate and session ----------
async function startApp() {
  buildMenu();
  showView('app');
  clearInterval(expiryTimer);
  expiryTimer = setInterval(checkExpiry, 60000);
  if (navigator.storage?.persist) navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); });
  route();
}

// After the server's expiresAt the app needs an online sign-in again. Offline use stays allowed until then.
function checkExpiry() {
  if (!Auth.sessionExpired()) return false;
  UI.toast('Your session has expired. Please sign in again.', 'warning', 6000);
  doLogout(true, Auth.expiryMessage());
  return true;
}

async function doLogout(forced = false, notice = '') {
  if (!forced && !await UI.confirmDialog('Sign out of this device? Your data stays saved on this device, and signing in again needs an internet connection.', { okLabel: 'Sign out', okClass: 'btn-danger' })) return;
  clearInterval(expiryTimer);
  try { currentModule?.destroy?.(); } catch { /* ignore */ }
  currentModule = null;
  Auth.logout();
  $('#content').empty();
  showLogin(notice);
}

function showLogin(notice = '') {
  showView('login');
  $('#login-notice').toggleClass('d-none', !notice).text(notice);
  $('#login-error').addClass('d-none');
  setTimeout(() => $('#login-username').trigger('focus'), 50);
}

$('#login-form').on('submit', async (e) => {
  e.preventDefault();
  const $btn = $('#login-btn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span><span>Signing in…</span>');
  $('#login-error').addClass('d-none');
  $('#login-notice').addClass('d-none');
  try {
    await Auth.login($('#login-username').val(), $('#login-password').val());
    $('#login-password').val('');
    await startApp();
  } catch (err) {
    $('#login-error').text(err.message || String(err)).removeClass('d-none');
    $('.auth-card').removeClass('shake'); void $('.auth-card')[0].offsetWidth; $('.auth-card').addClass('shake');
  } finally { $btn.prop('disabled', false).html('<span>Sign in</span><i class="bi bi-arrow-right"></i>'); }
});

$('#toggle-pw').on('click', () => {
  const $i = $('#login-password'); const show = $i.attr('type') === 'password';
  $i.attr('type', show ? 'text' : 'password');
  $('#toggle-pw i').attr('class', show ? 'bi bi-eye-slash' : 'bi bi-eye');
});
$('#logout-btn').on('click', () => doLogout(false));
$('#install-btn').on('click', promptInstall);
window.addEventListener('hashchange', route);
document.addEventListener('settings:changed', () => { applyTheme(); if (Auth.user()) $('#brand-name').text(getSettings().company.name || CONFIG.APP_NAME); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
window.addEventListener('online', () => $('#conn-badge').attr('class', 'badge rounded-pill conn-online').html('<i class="bi bi-wifi"></i> <span>Online</span>'));
window.addEventListener('offline', () => $('#conn-badge').attr('class', 'badge rounded-pill conn-offline').html('<i class="bi bi-wifi-off"></i> <span>Offline</span>'));

// ---------- Boot ----------
(async function boot() {
  applyTheme();
  registerSW();
  if (!window.jQuery || !window.bootstrap) return fatal('Required libraries failed to load. Connect to the internet once so the app can be cached for offline use.');
  if (!navigator.onLine) $('#conn-badge').attr('class', 'badge rounded-pill conn-offline').html('<i class="bi bi-wifi-off"></i> <span>Offline</span>');
  try { await openDB(); } catch (e) { return fatal('Could not open the local database: ' + (e.message || e)); }
  try {
    if (Auth.restoreSession()) await startApp();
    else if (Auth.wasExpiredOnRestore()) showLogin(Auth.expiryMessage());
    else showLogin(navigator.onLine ? '' : 'Connect to the internet to sign in.');
  } catch (e) { console.error(e); fatal(e.message || String(e)); }
})();

export { doLogout, route };
