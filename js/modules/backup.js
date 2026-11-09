// Backup & restore: one JSON file with every store, the settings, a checksum and a summary before restoring.
import { getAll, write } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, today, downloadFile, AppError } from '../core/utils.js';
import { fmt } from '../core/money.js';
import { getSettings, replaceSettings } from '../core/settings.js';
import { CONFIG } from '../config.js';
import { STORE_NAMES } from '../db/schema.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildBackup() {
  const data = {};
  for (const s of STORE_NAMES) data[s] = await getAll(s);
  const payload = { data, settings: getSettings() };
  const body = JSON.stringify(payload);
  const checksum = await sha256Hex(body);
  const counts = Object.fromEntries(STORE_NAMES.map((s) => [s, data[s].length]));
  return { file: JSON.stringify({ app: CONFIG.APP_ID, backupVersion: CONFIG.BACKUP_VERSION, appVersion: CONFIG.APP_VERSION, createdAt: new Date().toISOString(), checksum, payload: body }), counts };
}

async function parseBackup(text) {
  let file;
  try { file = JSON.parse(text); } catch { throw new AppError('This file is not a valid backup.'); }
  if (file.app !== CONFIG.APP_ID) throw new AppError('This backup is from a different app.');
  if (file.backupVersion !== CONFIG.BACKUP_VERSION) throw new AppError(`Backup version ${file.backupVersion} is not supported by this app version.`);
  if (typeof file.payload !== 'string') throw new AppError('Backup is damaged (no payload).');
  if ((await sha256Hex(file.payload)) !== file.checksum) throw new AppError('Backup checksum does not match. The file was changed or damaged.');
  const payload = JSON.parse(file.payload);
  for (const s of STORE_NAMES) if (!Array.isArray(payload.data?.[s])) throw new AppError(`Backup is missing "${s}".`);
  return { payload, createdAt: file.createdAt, appVersion: file.appVersion };
}

async function render(el) {
  const canExport = Auth.can('backup');
  const canRestore = Auth.can('users');
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap"><h1 class="h5 mb-0 flex-grow-1">Backup & restore</h1></div>
    <div class="row g-3">
      <div class="col-lg-6"><div class="card p-4 h-100">
        <div class="d-flex align-items-center gap-3 mb-2"><span class="avatar tint-green"><i class="bi bi-cloud-arrow-down"></i></span><div><div class="fw-bold">Download a backup</div><div class="small text-body-secondary">Keep a copy on a pen drive or email it to yourself every week. All data lives on this device only.</div></div></div>
        <button class="btn btn-primary mt-2" data-act="export" ${canExport ? '' : 'disabled'}><i class="bi bi-download me-1"></i>Download backup (.json)</button>
      </div></div>
      <div class="col-lg-6"><div class="card p-4 h-100">
        <div class="d-flex align-items-center gap-3 mb-2"><span class="avatar tint-red"><i class="bi bi-cloud-arrow-up"></i></span><div><div class="fw-bold">Restore from a backup</div><div class="small text-body-secondary">Restoring replaces all data on this device with the file. Download a fresh backup first.</div></div></div>
        <input type="file" accept="application/json,.json" class="form-control mt-2" id="restore-file" ${canRestore ? '' : 'disabled'}>
        <div id="restore-preview" class="mt-3"></div>
      </div></div>
    </div>`;
  const $el = $(el).off();
  $el.on('click', '[data-act="export"]', async () => {
    try {
      const { file, counts } = await buildBackup();
      downloadFile(`petropump-backup-${today()}.json`, file, 'application/json');
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      UI.toast(`Backup downloaded (${fmt(total, 0)} records)`);
    } catch (e) { UI.toastError(e); }
  });
  $el.on('change', '#restore-file', async function () {
    const f = this.files?.[0];
    if (!f) return;
    const preview = $el.find('#restore-preview').empty();
    try {
      const parsed = await parseBackup(await f.text());
      const counts = STORE_NAMES.map((s) => `<tr><td>${esc(s)}</td><td class="num">${parsed.payload.data[s].length}</td></tr>`).join('');
      preview.html(`<div class="alert alert-warning small">Backup from ${esc(new Date(parsed.createdAt).toLocaleString('en-GB'))} (app ${esc(parsed.appVersion || '')}). Checksum verified.</div>
        <details class="mb-3"><summary class="small">Records in this backup</summary><table class="table table-sm mt-2"><tbody>${counts}</tbody></table></details>
        <button class="btn btn-danger w-100" data-act="do-restore"><i class="bi bi-arrow-counterclockwise me-1"></i>Replace all data with this backup</button>`);
      preview.find('[data-act="do-restore"]').data('payload', parsed.payload);
    } catch (e) { preview.html(`<div class="alert alert-danger small">${esc(e.message || String(e))}</div>`); }
  });
  $el.on('click', '[data-act="do-restore"]', async function () {
    const payload = $(this).data('payload');
    const ok = await UI.confirmDialog('This erases all current data on this device (sales, purchases, ledger, users, settings) and replaces it with the backup. This cannot be undone. Continue?', { okLabel: 'Erase and restore', okClass: 'btn-danger', title: 'Replace all data' });
    if (!ok) return;
    try {
      await write(STORE_NAMES, async (t) => {
        for (const s of STORE_NAMES) {
          await t.clear(s);
          for (const row of payload.data[s]) await t.put(s, row);
        }
      });
      if (payload.settings) replaceSettings(payload.settings);
      Auth.logout();
      UI.toast('Restore complete. Please sign in again.', 'success', 4000);
      setTimeout(() => location.reload(), 900);
    } catch (e) { UI.toastError(e); }
  });
}

export default {
  render,
  destroy() {},
};
