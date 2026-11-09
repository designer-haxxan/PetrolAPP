# PetroPump ERP

Offline-first ERP for a Pakistani petrol pump: fuel and lubricant sales, nozzle-wise shifts, tanks and dip readings, OMC purchases, udhaar (credit) customers, suppliers, employees, investors, vouchers, a full double-entry ledger, and financial statements.

It is a static PWA: no build step, no server, no external login. It works offline.

Stack: HTML5 · ES modules · jQuery · Bootstrap 5 · Bootstrap Icons · IndexedDB · Service Worker.

## What it covers

| Area | What you can do |
| --- | --- |
| **Shifts & meters** | Open a shift with the opening meter of every nozzle. At close, enter the closing meters. Litres and amount per nozzle show live, at the rate in force when the shift opened. Settle cash, card or bank, JazzCash/Easypaisa and udhaar. A cash short or excess is posted automatically. |
| **Counter sales** | Lubricants and shop items. Tax is split out of the tax-inclusive rate. Part payment now, the rest on udhaar. A void reverses the stock and the ledger. |
| **Purchases** | Fuel from OMCs into a chosen tank, goods into stock. Freight, levy and other charges. Payment now, the rest payable to the supplier. |
| **Tanks & dips** | Animated tank gauges. Book stock = opening + receipts − nozzle sales. Record a physical dip, see the variance, and post a shortage (loss) or excess (gain). |
| **Stock** | Moving-average cost per product. Goods counted with adjustments. Movement ledger per product. |
| **Products & rates** | Set the rate after each government or OMC notification. Dated rate history. |
| **Pumps & nozzles** | Each nozzle draws one product from one tank. Meter readings carry over to the next shift. |
| **Customers (udhaar)** | Statement with running balance, receipts, credit limit. |
| **Suppliers & OMCs** | Statement, payments, payable balance. |
| **Employees** | Salary and advance vouchers, advance balance, statement. |
| **Investors** | Capital in, drawings, profit share (% of period profit), profit paid, unpaid profit. |
| **Fixed assets** | Machinery, tanks, building, vehicles. Straight-line depreciation, one posting per asset per month. |
| **Vouchers** | Receipts, supplier payments, expenses, salaries, advances, capital, drawings, profit paid, bank deposits, transfers, loans, customer advances, and manual journal vouchers that must balance. |
| **Accounts** | Chart of accounts with balances. Add accounts. Ledger for any account. |
| **Reports** | Trial balance, profit and loss, balance sheet, cash and bank book, day book, receivable and payable aging (FIFO: 0–30, 31–60, 61–90, over 90 days), sales by product, shift cash, tank reconciliation, investor shares. Print and CSV. |
| **Sign-in and roles** | Accounts come from eposwala. Sign in with the same username and password as the eposwala apps. The server's role (admin, manager, accountant, cashier) sets what each user can open. Only the phone bound to the account can sign in. |
| **Backup & restore** | One JSON file with every record, the settings and a SHA-256 checksum. A restore asks for confirmation and checks the checksum first. |

Amounts, litres and rates are stored and calculated to **4 decimal places**. The display can be set to 2, 3 or 4 decimals in Settings. Values are rounded to 4 decimals after each multiplication or division, so totals do not drift.

## Accounting model

- Every business event (sale, purchase, shift, dip, voucher, depreciation, asset purchase) writes a balanced transaction to the `entries` store. It is written in the same IndexedDB transaction as the document and its stock movements. If any step fails, nothing is written.
- Entries are never edited. A void is a reversing transaction, and the document is marked `void`.
- Control accounts (Receivable, Payable, Employee advance, Investor capital) carry a `partyId`. Each party's statement is a filter on the same ledger.
- Account IDs (for example `sales_petrol`, `inv_fuel`, `cash`) are stable strings used by the posting code (see `js/db/schema.js`). New accounts can be added with new codes. Existing IDs must not be renamed.
- Shift posting: `Dr Cash (counted)`, `Dr Bank/Wallet` per line, `Dr Udhaar` per customer, and `Dr Cash short` if short. Against these: `Cr Fuel income` per product, `Cr Sales tax payable`, and `Cr Cash excess` if over. Cost of fuel sold is `Dr COGS / Cr Fuel stock` at average cost.

## Assumptions to confirm with your accountant

These are defaults. Change them in Products & rates, in Settings, or in the chart of accounts before go-live.

1. **"Mobile" in the brief** is read as Mobil lubricants (engine oil). If you meant mobile phone top-ups or recharge cards, that needs its own stock type.
2. **Sales tax**: fuel is 0% per product by default. Lubricants are 18%. Shop items are 0%. Check the rates on your OMC and supplier invoices.
3. **Counter rates include tax** by default (Settings: "Counter rates include sales tax?"). Set it to "No" if your rates exclude tax.
4. **Petroleum levy and carbon levy** are not calculated automatically. Enter them as "other charges" on the purchase that carries them, or post a journal voucher to *Petroleum Levy Payable*.
5. **Depreciation** is straight-line over the life you enter, one posting per month.
6. **Investor profit share** is the investor's % of net profit for the period you select. Profit payments are recorded as separate vouchers.
7. **One device.** Data lives in one browser on one device. Use Backup & restore to move or copy it. There is no multi-device sync.

## Run it

Serve the folder over HTTP. The service worker needs `http://localhost` or HTTPS.

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://localhost:8765`. Sign-in uses the eposwala login API, which only accepts browser requests from `https://petrolapp.eposwala.com`. Sign-in therefore works only when the app is served from that host (see `CNAME`, currently `petrolapp.eposwala.com`). On other hosts you will see "Could not reach the login server". Offline use is allowed until the session's `expiresAt`, then the app asks for an online sign-in again.

The chart of accounts and ten sample products (fuel and lubricants) are seeded automatically. Then:

1. **Products & rates**: set today's rate for each fuel and lubricant.
2. **Pumps & nozzles**: add the dispensers and nozzles. Add tanks under **Tanks & dips**, with opening stock.
3. **Investors, suppliers, customers, employees**: add the parties.
4. Open a shift, close it, and check the cash reconciliation.

Deploy: static hosting over HTTPS on the host in `CNAME` (`petrolapp.eposwala.com`). Any other host needs the API to allow its origin.

**Shipping updates:** the service worker caches the app shell. When you change any file, bump `VERSION` in `service-worker.js` (for example `petropump-v2.0.1`). Otherwise phones keep serving the old files.

## Project layout

```
index.html                 App shell: first-run setup, sign-in, layout
manifest.json              PWA manifest
service-worker.js          Precache and offline cache (bump VERSION on every release)
css/app.css                Design system: tokens, dark mode, motion, print styles
js/config.js               App id, version, backup version
js/app.js                  Boot, setup and sign-in gate, router, menu
js/core/money.js           4-decimal rounding and formatting
js/core/settings.js        Company profile and rules (LocalStorage)
js/core/ui.js              Modals, toasts, confirm dialogs, skeletons, count-up
js/core/views.js           Ledger tables, date filters, tank gauge, badges
js/db/schema.js            IndexedDB stores, indexes, chart of accounts, seed products
js/db/idb.js               Promise wrapper with atomic multi-store transactions
js/services/auth.js        eposwala sign-in, device binding, session expiry, roles and permissions
js/services/ledger.js      Document numbering, journal (balanced transactions), reversals
js/services/stock.js       Moving-average stock, tank book, reversals
js/services/posting.js     Sales, purchases, shifts, dips, vouchers, assets, depreciation, rates
js/services/openings.js    Opening stock and opening balances
js/services/finance.js     Trial balance, P&L, balance sheet, ledgers, day book, FIFO aging
js/modules/*.js            One file per screen
```

## Limits and next steps

- **Not included yet:** thermal (ESC/POS) receipt printing, Urdu receipts, bank reconciliation, cheque register, payroll tax and EOBI/PESSI deductions, withholding tax, e-invoicing and FBR POS integration, multi-device sync, barcode scanning, and an automated test suite. Each can be added on top of the current ledger.
- **User management is not in the app.** Create, disable and reset accounts in eposwala.
- **Existing SaleAPP data is not migrated.** The new app uses its own database (`petropump_erp`), so it cannot touch the old one. Use the old app's backup if you need that data.
