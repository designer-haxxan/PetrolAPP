// Users: owner creates accounts for managers, accountants and attendants, resets passwords and deactivates accounts.
import { getAll, write } from '../db/idb.js';
import * as UI from '../core/ui.js';
import { esc, nowISO } from '../core/utils.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

async function render(el) {
  el.innerHTML = UI.spinner('Loading users…');
  const users = (await getAll('users')).sort((a, b) => a.name.localeCompare(b.name));
  const me = Auth.user();
  const owners = users.filter((u) => u.role === 'owner' && u.active).length;
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Users & roles</h1>
      <button class="btn btn-primary btn-sm" data-act="add"><i class="bi bi-person-plus me-1"></i>Add user</button></div>
    <div class="card p-3 mb-3 small">
      <div class="row g-2">
        <div class="col-md-3"><b>Owner</b><div class="text-body-secondary">Everything, including users and backups.</div></div>
        <div class="col-md-3"><b>Manager</b><div class="text-body-secondary">Shifts, sales, purchases, tanks, masters, vouchers, reports.</div></div>
        <div class="col-md-3"><b>Accountant</b><div class="text-body-secondary">Vouchers, accounts, reports, assets, backup export.</div></div>
        <div class="col-md-3"><b>Attendant / cashier</b><div class="text-body-secondary">Open and close shifts, counter sales, dips, stock view.</div></div>
      </div></div>
    <div class="list-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0 table-report"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td class="fw-semibold">${esc(u.name)} ${u.id === me?.id ? '<span class="badge text-bg-light">You</span>' : ''}</td><td>${esc(u.username)}</td><td>${esc(Auth.ROLES[u.role] || u.role)}</td>
        <td>${u.active ? '<span class="badge text-bg-success">Active</span>' : '<span class="badge text-bg-secondary">Disabled</span>'}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm btn-outline-secondary" data-act="pw" data-id="${esc(u.id)}"><i class="bi bi-key"></i> Reset password</button>
          <button class="btn btn-sm btn-link ${u.id === me?.id ? 'disabled' : ''}" data-act="toggle" data-id="${esc(u.id)}" ${u.role === 'owner' && u.active && owners <= 1 ? 'disabled' : ''}>${u.active ? 'Disable' : 'Enable'}</button>
        </td></tr>`).join('')}</tbody></table></div></div>`;

  const $el = $(el).off();
  $el.on('click', '[data-act="add"]', async () => {
    const v = await UI.formModal({
      title: 'Add user', submitLabel: 'Create user',
      body: `<div class="row g-3">
        <div class="col-md-6"><label class="form-label small">Full name</label><input class="form-control" name="name" required></div>
        <div class="col-md-6"><label class="form-label small">Username</label><input class="form-control" name="username" autocapitalize="none" required></div>
        <div class="col-md-6"><label class="form-label small">Role</label><select class="form-select" name="role"><option value="manager">Manager</option><option value="accountant">Accountant</option><option value="cashier" selected>Attendant / cashier</option><option value="owner">Owner</option></select></div>
        <div class="col-md-6"><label class="form-label small">Temporary password</label><input type="password" class="form-control" name="password" autocomplete="new-password" required></div>
        <div class="col-12 small text-body-secondary">Share the password privately and ask the user to change it in Settings after the first sign-in.</div></div>`,
      onSubmit: async (f) => { await Auth.createUser(f); return true; },
    });
    if (v) { UI.toast('User created'); render(el); }
  });
  $el.on('click', '[data-act="pw"]', async function () {
    const u = users.find((x) => x.id === this.dataset.id);
    const v = await UI.formModal({
      title: `Reset password · ${u.name}`, submitLabel: 'Reset password',
      body: `<label class="form-label small">New password (min 6 characters)</label><input type="password" class="form-control" name="pw" autocomplete="new-password" required>`,
      onSubmit: async (f) => { await Auth.resetPassword(u.id, f.pw); return true; },
    });
    if (v) UI.toast('Password reset');
  });
  $el.on('click', '[data-act="toggle"]', async function () {
    const u = users.find((x) => x.id === this.dataset.id);
    if (u.id === me?.id) return;
    const ok = await UI.confirmDialog(`${u.active ? 'Disable' : 'Enable'} ${u.name}?`, { okLabel: u.active ? 'Disable' : 'Enable', okClass: u.active ? 'btn-warning' : 'btn-primary' });
    if (!ok) return;
    await write(['users'], async (t) => { const row = await t.get('users', u.id); await t.put('users', { ...row, active: !row.active, updatedAt: nowISO() }); });
    UI.toast(u.active ? 'User disabled' : 'User enabled');
    render(el);
  });
}

export default {
  render,
  destroy() {},
};
