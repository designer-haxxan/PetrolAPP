// Stock engine: moving-average cost per product, book stock per tank (fuel), and a movement log.
// All functions run inside a write transaction `t` (see db/idb.js).
import { uuid, nowISO, AppError } from '../core/utils.js';
import { rnd, fmt } from '../core/money.js';
import { getSettings } from '../core/settings.js';

const EPS = 0.00005;

async function loadProduct(t, productId) {
  const p = await t.get('products', productId);
  if (!p) throw new AppError('Product not found.');
  return p;
}

// Receives stock (purchase, opening stock, dip gain, reversal). Recalculates the moving average cost.
export async function stockIn(t, { productId, tankId = null, qty, unitCost, date, refType = '', refId = null, memo = '' }) {
  const q = rnd(qty);
  if (!(q > 0)) throw new AppError('Quantity must be greater than zero.');
  const p = await loadProduct(t, productId);
  const cost = rnd(unitCost);
  const value = rnd(q * cost);
  const newQty = rnd(p.stockQty + q);
  const newValue = rnd(p.stockValue + value);
  p.avgCost = newQty > 0 ? rnd(newValue / newQty) : cost;
  p.stockQty = newQty;
  p.stockValue = newValue;
  p.updatedAt = nowISO();
  await t.put('products', p);
  if (tankId) await adjustTank(t, tankId, productId, q);
  await t.put('stockMoves', { id: uuid(), productId, tankId, qty: q, unitCost: cost, value, date, refType, refId, memo, voided: false, createdAt: nowISO() });
  return { value, unitCost: cost };
}

// Issues stock at the current average cost. Returns { cost, unitCost }.
// Fuel books may go negative (a missed receipt shows up as a warning, not a blocked sale); goods follow the setting.
export async function stockOut(t, { productId, tankId = null, qty, date, refType = '', refId = null, memo = '' }) {
  const q = rnd(qty);
  if (!(q > 0)) throw new AppError('Quantity must be greater than zero.');
  const p = await loadProduct(t, productId);
  const allowNeg = p.category === 'fuel' || getSettings().allowNegativeStock;
  if (!allowNeg && p.stockQty + EPS < q) {
    throw new AppError(`Not enough stock of ${p.name}: available ${fmt(p.stockQty)}, needed ${fmt(q)}.`);
  }
  const unitCost = p.avgCost || 0;
  const cost = rnd(q * unitCost);
  p.stockQty = rnd(p.stockQty - q);
  p.stockValue = p.stockQty > EPS ? rnd(p.stockValue - cost) : 0;
  p.updatedAt = nowISO();
  await t.put('products', p);
  if (tankId) await adjustTank(t, tankId, productId, -q);
  await t.put('stockMoves', { id: uuid(), productId, tankId, qty: -q, unitCost, value: -cost, date, refType, refId, memo, voided: false, createdAt: nowISO() });
  return { cost, unitCost };
}

async function adjustTank(t, tankId, productId, delta) {
  const tank = await t.get('tanks', tankId);
  if (!tank) throw new AppError('Tank not found.');
  if (tank.productId !== productId) throw new AppError(`Tank ${tank.name} holds a different product.`);
  tank.bookLitres = rnd((tank.bookLitres || 0) + delta);
  tank.updatedAt = nowISO();
  await t.put('tanks', tank);
}

// Reverses the stock movements of a document (void). Original rows stay in the log, marked voided.
export async function reverseStock(t, refId, date, memo = 'Void') {
  const moves = (await t.getAllByIndex('stockMoves', 'refId', refId)).filter((m) => !m.voided);
  for (const m of moves) {
    m.voided = true;
    await t.put('stockMoves', m);
    if (m.qty > 0) await stockOut(t, { productId: m.productId, tankId: m.tankId, qty: m.qty, date, refType: 'void', refId, memo });
    else await stockIn(t, { productId: m.productId, tankId: m.tankId, qty: -m.qty, unitCost: m.unitCost, date, refType: 'void', refId, memo });
  }
  return moves.length;
}
