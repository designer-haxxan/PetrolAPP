// Settings: company profile (printed on bills and reports), number display, tax-inclusive pricing, document numbering,
// theme, and changing the signed-in user's password.
import * as UI from '../core/ui.js';
import { esc } from '../core/utils.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { applyTheme } from '../core/settings.js';
import { CONFIG } from '../config.js';
import { DB_NAME } from '../db/schema.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

function render(el) {
  const s = getSettings();
  const canEdit = Auth.can('settings');
  const dis = canEdit ? '' : 'disabled';
  el.innerHTML = `<div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap"><h1 class="h5 mb-0 flex-grow-1">Settings</h1></div>
    <div class="row g-3">
      <div class="col-lg-6"><form class="card p-4 h-100" id="f-company">
        <div class="fw-bold mb-3"><i class="bi bi-building me-1"></i>Pump / company</div>
        <div class="row g-3">
          <div class="col-12"><label class="form-label small">Company name (shown on reports)</label><input class="form-control" name="name" value="${esc(s.company.name)}" ${dis}></div>
          <div class="col-12"><label class="form-label small">Address</label><input class="form-control" name="address" value="${esc(s.company.address)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label small">City</label><input class="form-control" name="city" value="${esc(s.company.city)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label small">Phone</label><input class="form-control" name="phone" value="${esc(s.company.phone)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label small">NTN</label><input class="form-control" name="ntn" value="${esc(s.company.ntn)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label small">STRN (sales tax no.)</label><input class="form-control" name="strn" value="${esc(s.company.strn)}" ${dis}></div>
          <div class="col-12"><label class="form-label small">Footer line on bills</label><input class="form-control" name="footer" value="${esc(s.company.footer)}" ${dis}></div>
        </div>
        ${canEdit ? '<button class="btn btn-primary mt-3" type="submit">Save company</button>' : ''}
      </form></div>
      <div class="col-lg-6"><form class="card p-4 h-100" id="f-rules">
        <div class="fw-bold mb-3"><i class="bi bi-sliders me-1"></i>Numbers, tax & rules</div>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label small">Decimal places shown</label><select class="form-select" name="decimals" ${dis}>${[2, 3, 4].map((d) => `<option value="${d}" ${Number(s.decimals) === d ? 'selected' : ''}>${d} decimals</option>`).join('')}</select>
            <div class="form-text">Stored with 4 decimals always. Litres, rates and amounts are shown with this many.</div></div>
          <div class="col-md-6"><label class="form-label small">Currency label</label><input class="form-control" name="currency" value="${esc(s.currency)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label small">Counter rates include sales tax?</label><select class="form-select" name="pricesIncludeTax" ${dis}><option value="true" ${s.pricesIncludeTax !== false ? 'selected' : ''}>Yes (tax inside the rate)</option><option value="false" ${s.pricesIncludeTax === false ? 'selected' : ''}>No (tax added on top)</option></select></div>
          <div class="col-md-6"><label class="form-label small">Allow goods to go below zero?</label><select class="form-select" name="allowNegativeStock" ${dis}><option value="false" ${!s.allowNegativeStock ? 'selected' : ''}>No (block the sale)</option><option value="true" ${s.allowNegativeStock ? 'selected' : ''}>Yes (allow, warn later)</option></select></div>
          <div class="col-md-6"><label class="form-label small">Theme</label><select class="form-select" name="theme">${['auto', 'light', 'dark'].map((t) => `<option value="${t}" ${s.theme === t ? 'selected' : ''}>${t === 'auto' ? 'Follow device' : t === 'light' ? 'Light' : 'Dark'}</option>`).join('')}</select></div>
          ${Object.entries({ sale: 'Counter sale no.', purchase: 'Purchase no.', voucher: 'Voucher no.', shift: 'Shift no.', asset: 'Asset no.', dip: 'Dip no.' }).map(([k, l]) => `<div class="col-md-4 col-6"><label class="form-label small">${esc(l)} prefix</label><input class="form-control form-control-sm" name="p_${k}" value="${esc(s.prefixes[k])}" maxlength="6" ${dis}></div>`).join('')}
        </div>
        ${canEdit ? '<button class="btn btn-primary mt-3" type="submit">Save rules</button>' : '<div class="small text-body-secondary mt-3">Only the owner or a manager can change these settings.</div>'}
      </form></div>
      <div class="col-lg-6"><div class="card p-4 h-100 small">
        <div class="fw-bold mb-3"><i class="bi bi-info-circle me-1"></i>About this app</div>
        <div>Version ${esc(CONFIG.APP_VERSION)} · Local database <code>${esc(DB_NAME)}</code></div>
        <div class="mt-2 text-body-secondary">All data is stored on this device and works offline. Keep regular backups (Backup & restore). Multi-device sync is not included: use one device per pump, or move data with backups.</div>
      </div></div>
    </div>`;

  const $el = $(el).off();
  $el.on('submit', '#f-company', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    saveSettings({ company: { name: f.name.trim() || 'My Petrol Pump', address: f.address.trim(), city: f.city.trim(), phone: f.phone.trim(), ntn: f.ntn.trim(), strn: f.strn.trim(), footer: f.footer.trim() } });
    UI.toast('Company profile saved');
  });
  $el.on('submit', '#f-rules', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    const prefixes = Object.fromEntries(Object.keys(s.prefixes).map((k) => [k, (f[`p_${k}`] || s.prefixes[k]).trim().toUpperCase().slice(0, 6) || s.prefixes[k]]));
    saveSettings({ decimals: Number(f.decimals), currency: f.currency.trim() || 'Rs', pricesIncludeTax: f.pricesIncludeTax === 'true', allowNegativeStock: f.allowNegativeStock === 'true', theme: f.theme, prefixes });
    applyTheme();
    UI.toast('Settings saved');
    render(el);
  });
}

export default {
  render: async (el) => render(el),
  destroy() {},
};
