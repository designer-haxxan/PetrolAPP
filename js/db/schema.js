// IndexedDB schema, seed data (chart of accounts, fuel and lubricant products) and migrations.
import { CONFIG } from '../config.js';

export const DB_NAME = `${CONFIG.APP_ID}_erp`;
export const DB_VERSION = 1;

// Every store is part of the backup. Ledger rows (entries) are immutable; corrections are reversals.
export const STORE_NAMES = [
  'meta', 'accounts', 'entries', 'vouchers', 'parties', 'products', 'priceHistory',
  'tanks', 'pumps', 'nozzles', 'shifts', 'dips', 'sales', 'purchases', 'stockMoves', 'fixedAssets', 'auditLog',
];

const STORES = {
  meta: { keyPath: 'key', indexes: {} },
  accounts: { indexes: { group: 'group', kind: 'kind', code: ['code', true] } },
  entries: {
    indexes: {
      txnId: 'txnId', accountId: 'accountId', date: 'date', partyId: 'partyId',
      acctDate: [['accountId', 'date'], false],
    },
  },
  vouchers: { indexes: { number: ['number', true], date: 'date', type: 'type', partyId: 'partyId' } },
  parties: { indexes: { kind: 'kind', nameLc: 'nameLc' } },
  products: { indexes: { category: 'category', nameLc: 'nameLc' } },
  priceHistory: { indexes: { productId: 'productId', effectiveFrom: 'effectiveFrom' } },
  tanks: { indexes: { productId: 'productId' } },
  pumps: { indexes: {} },
  nozzles: { indexes: { pumpId: 'pumpId', tankId: 'tankId' } },
  shifts: { indexes: { number: ['number', true], status: 'status', date: 'date' } },
  dips: { indexes: { tankId: 'tankId', date: 'date' } },
  sales: { indexes: { number: ['number', true], date: 'date', customerId: 'customerId' } },
  purchases: { indexes: { number: ['number', true], date: 'date', supplierId: 'supplierId' } },
  stockMoves: { indexes: { productId: 'productId', tankId: 'tankId', refId: 'refId', date: 'date' } },
  fixedAssets: { indexes: { category: 'category' } },
  auditLog: { indexes: { at: 'at' } },
};

// Chart of accounts. `normal` is the side that increases the balance. `kind` marks money accounts and control accounts.
// IDs are stable strings used by the posting code, so they must not change.
export const SEED_ACCOUNTS = [
  // Assets
  { id: 'cash', code: '1000', name: 'Cash in Hand', group: 'asset', kind: 'cash', normal: 'dr' },
  { id: 'bank_main', code: '1010', name: 'Bank Account (Main)', group: 'asset', kind: 'bank', normal: 'dr' },
  { id: 'wallet', code: '1020', name: 'Mobile Wallet (JazzCash / Easypaisa)', group: 'asset', kind: 'wallet', normal: 'dr' },
  { id: 'ar', code: '1100', name: 'Accounts Receivable (Customers / Udhaar)', group: 'asset', kind: 'receivable', normal: 'dr' },
  { id: 'emp_adv', code: '1110', name: 'Employee Advances', group: 'asset', kind: 'receivable', normal: 'dr' },
  { id: 'inv_fuel', code: '1200', name: 'Stock - Fuel (Petrol, Diesel, Oils)', group: 'asset', kind: 'inventory', normal: 'dr' },
  { id: 'inv_goods', code: '1210', name: 'Stock - Lubricants & Shop Items', group: 'asset', kind: 'inventory', normal: 'dr' },
  { id: 'input_tax', code: '1300', name: 'Input Sales Tax Recoverable', group: 'asset', kind: 'other', normal: 'dr' },
  { id: 'fa_machinery', code: '1400', name: 'Fixed Assets - Dispensers & Machinery', group: 'asset', kind: 'fixed', normal: 'dr' },
  { id: 'fa_tanks', code: '1410', name: 'Fixed Assets - Underground Tanks', group: 'asset', kind: 'fixed', normal: 'dr' },
  { id: 'fa_building', code: '1420', name: 'Fixed Assets - Building & Canopy', group: 'asset', kind: 'fixed', normal: 'dr' },
  { id: 'fa_vehicles', code: '1430', name: 'Fixed Assets - Vehicles & Equipment', group: 'asset', kind: 'fixed', normal: 'dr' },
  { id: 'acc_dep', code: '1490', name: 'Accumulated Depreciation (contra)', group: 'asset', kind: 'contra', normal: 'cr' },
  // Liabilities
  { id: 'ap', code: '2000', name: 'Accounts Payable (Suppliers / OMCs)', group: 'liability', kind: 'payable', normal: 'cr' },
  { id: 'tax_payable', code: '2100', name: 'Sales Tax Payable', group: 'liability', kind: 'other', normal: 'cr' },
  { id: 'levy_payable', code: '2110', name: 'Petroleum Levy / Carbon Levy Payable', group: 'liability', kind: 'other', normal: 'cr' },
  { id: 'salary_payable', code: '2200', name: 'Salaries Payable', group: 'liability', kind: 'other', normal: 'cr' },
  { id: 'loans', code: '2300', name: 'Bank Loan / Borrowings', group: 'liability', kind: 'other', normal: 'cr' },
  { id: 'cust_adv', code: '2400', name: 'Customer Advances', group: 'liability', kind: 'payable', normal: 'cr' },
  // Equity
  { id: 'capital', code: '3000', name: "Investors' Capital", group: 'equity', kind: 'equity', normal: 'cr' },
  { id: 'drawings', code: '3100', name: 'Investor Drawings (contra)', group: 'equity', kind: 'contra', normal: 'dr' },
  { id: 'profit_dist', code: '3200', name: 'Investor Profit Distributions (contra)', group: 'equity', kind: 'contra', normal: 'dr' },
  { id: 'obe', code: '3900', name: 'Opening Balance Equity', group: 'equity', kind: 'equity', normal: 'cr' },
  // Income
  { id: 'sales_petrol', code: '4000', name: 'Sales - Petrol / Hi-Octane', group: 'income', kind: 'income', normal: 'cr' },
  { id: 'sales_diesel', code: '4010', name: 'Sales - High Speed Diesel', group: 'income', kind: 'income', normal: 'cr' },
  { id: 'sales_other_fuel', code: '4020', name: 'Sales - LDO, Kerosene & CNG', group: 'income', kind: 'income', normal: 'cr' },
  { id: 'sales_lube', code: '4100', name: 'Sales - Lubricants (Mobil & others)', group: 'income', kind: 'income', normal: 'cr' },
  { id: 'sales_shop', code: '4110', name: 'Sales - Shop & Other Goods', group: 'income', kind: 'income', normal: 'cr' },
  { id: 'other_income', code: '4200', name: 'Other Income (commission, rent received)', group: 'income', kind: 'income', normal: 'cr' },
  { id: 'gain_stock', code: '4210', name: 'Fuel Stock Gain', group: 'income', kind: 'income', normal: 'cr' },
  // Expenses
  { id: 'cogs_fuel', code: '5000', name: 'Cost of Fuel Sold', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'cogs_goods', code: '5010', name: 'Cost of Lubricants & Goods Sold', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_salary', code: '5100', name: 'Salaries & Wages', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_util', code: '5110', name: 'Electricity, Gas & Water', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_rent', code: '5120', name: 'Rent', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_repair', code: '5130', name: 'Repairs & Machine Maintenance', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_security', code: '5140', name: 'Security & Guards', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_transport', code: '5150', name: 'Transport & Fuel for Vehicles', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_office', code: '5160', name: 'Stationery, Printing & Office', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_bank', code: '5170', name: 'Bank Charges & Card Fees', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_dep', code: '5180', name: 'Depreciation', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_loss', code: '5190', name: 'Fuel Shrinkage / Loss', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_cash_diff', code: '5200', name: 'Cash Short / (Excess)', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_interest', code: '5210', name: 'Interest & Markup on Loans', group: 'expense', kind: 'expense', normal: 'dr' },
  { id: 'exp_misc', code: '5300', name: 'Miscellaneous Expenses', group: 'expense', kind: 'expense', normal: 'dr' },
];

// Products seeded on first run (all editable). Fuel is sold through nozzles; goods are sold over the counter.
export const SEED_PRODUCTS = [
  { name: 'Petrol (PMG)', category: 'fuel', unit: 'L', taxRate: 0, incomeAccountId: 'sales_petrol', inventoryAccountId: 'inv_fuel', cogsAccountId: 'cogs_fuel', price: 0 },
  { name: 'Hi-Octane (Super)', category: 'fuel', unit: 'L', taxRate: 0, incomeAccountId: 'sales_petrol', inventoryAccountId: 'inv_fuel', cogsAccountId: 'cogs_fuel', price: 0 },
  { name: 'High Speed Diesel (HSD)', category: 'fuel', unit: 'L', taxRate: 0, incomeAccountId: 'sales_diesel', inventoryAccountId: 'inv_fuel', cogsAccountId: 'cogs_fuel', price: 0 },
  { name: 'Light Diesel Oil (LDO)', category: 'fuel', unit: 'L', taxRate: 0, incomeAccountId: 'sales_other_fuel', inventoryAccountId: 'inv_fuel', cogsAccountId: 'cogs_fuel', price: 0 },
  { name: 'Kerosene Oil', category: 'fuel', unit: 'L', taxRate: 0, incomeAccountId: 'sales_other_fuel', inventoryAccountId: 'inv_fuel', cogsAccountId: 'cogs_fuel', price: 0 },
  { name: 'CNG', category: 'fuel', unit: 'kg', taxRate: 0, incomeAccountId: 'sales_other_fuel', inventoryAccountId: 'inv_fuel', cogsAccountId: 'cogs_fuel', price: 0 },
  { name: 'Mobil Super 4L Engine Oil', category: 'goods', unit: 'pc', taxRate: 18, incomeAccountId: 'sales_lube', inventoryAccountId: 'inv_goods', cogsAccountId: 'cogs_goods', price: 0 },
  { name: 'Mobil 1L Engine Oil', category: 'goods', unit: 'pc', taxRate: 18, incomeAccountId: 'sales_lube', inventoryAccountId: 'inv_goods', cogsAccountId: 'cogs_goods', price: 0 },
  { name: 'Coolant / Brake Fluid', category: 'goods', unit: 'pc', taxRate: 18, incomeAccountId: 'sales_lube', inventoryAccountId: 'inv_goods', cogsAccountId: 'cogs_goods', price: 0 },
  { name: 'Mineral Water / Snacks', category: 'goods', unit: 'pc', taxRate: 0, incomeAccountId: 'sales_shop', inventoryAccountId: 'inv_goods', cogsAccountId: 'cogs_goods', price: 0 },
];

const ISO = () => new Date().toISOString();

// Creates tables and seeds data on first install. `t` is the versionchange transaction.
export function upgrade(db, oldVersion, t) {
  if (oldVersion < 1) {
    for (const [name, def] of Object.entries(STORES)) {
      const os = db.createObjectStore(name, { keyPath: def.keyPath || 'id' });
      for (const [idx, spec] of Object.entries(def.indexes)) {
        const [keyPath, unique] = Array.isArray(spec) ? spec : [spec, false];
        os.createIndex(idx, keyPath, { unique: !!unique });
      }
    }
    const now = ISO();
    const acc = t.objectStore('accounts');
    for (const a of SEED_ACCOUNTS) acc.put({ ...a, system: true, active: true, createdAt: now });
    const prod = t.objectStore('products');
    for (const p of SEED_PRODUCTS) {
      prod.put({
        ...p, id: crypto.randomUUID ? crypto.randomUUID() : `p-${Math.random().toString(36).slice(2)}`,
        nameLc: p.name.toLowerCase(), barcode: '', active: true, stockQty: 0, stockValue: 0, avgCost: 0,
        createdAt: now, updatedAt: now,
      });
    }
    t.objectStore('meta').put({ key: 'schemaVersion', value: 1 });
    t.objectStore('meta').put({ key: 'createdAt', value: now });
  }
  // Future migrations: if (oldVersion < 2) { ... }
}
