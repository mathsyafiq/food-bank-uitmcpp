const test = require('node:test');
const assert = require('node:assert/strict');
const Stock = require('../core/stock.js');

const total = (stock) => Object.values(stock).reduce((a, b) => a + b, 0);

test('apply adds signed quantities without changing the input', () => {
  const before = { 'RICE|P1': 5 };
  const after = Stock.apply(before, [
    { item_id: 'RICE', location_id: 'P1', quantity: -2 },
    { item_id: 'OIL', location_id: 'P1', quantity: 3 },
  ]);
  assert.deepEqual(after, { 'RICE|P1': 3, 'OIL|P1': 3 });
  assert.deepEqual(before, { 'RICE|P1': 5 });
});

test('stock may go negative', () => {
  assert.equal(Stock.apply({}, [{ item_id: 'RICE', location_id: 'P1', quantity: -4 }])['RICE|P1'], -4);
});

test('receive skips blank and zero rows and rejects bad numbers', () => {
  assert.deepEqual(Stock.receiveRows('STORE', { RICE: '12', OIL: '', SUGAR: 0, SALT: null }), [
    { item_id: 'RICE', location_id: 'STORE', quantity: 12 },
  ]);
  assert.throws(() => Stock.receiveRows('STORE', { RICE: -1 }), /QTY_INVALID/);
  assert.throws(() => Stock.receiveRows('STORE', { RICE: 2.5 }), /QTY_INVALID/);
});

test('a transfer leaves total stock across locations unchanged', () => {
  const start = { 'RICE|STORE': 50, 'OIL|STORE': 20 };
  const rows = Stock.transferRows('STORE', 'P1', { RICE: 10, OIL: 5, SUGAR: '' });
  const after = Stock.apply(start, rows);
  assert.equal(total(after), total(start));
  assert.deepEqual(after, { 'RICE|STORE': 40, 'OIL|STORE': 15, 'RICE|P1': 10, 'OIL|P1': 5 });
  assert.throws(() => Stock.transferRows('P1', 'P1', { RICE: 1 }), /SAME_LOCATION/);
});

test('a stock count writes only differences; blank is skipped and zero is counted', () => {
  const stock = { 'RICE|P1': 8, 'OIL|P1': 3, 'SUGAR|P1': 2 };
  const rows = Stock.countRows(stock, 'P1', { RICE: 6, OIL: '', SUGAR: 0, SALT: 4, MILO: 3 });
  assert.deepEqual(rows, [
    { item_id: 'RICE', location_id: 'P1', quantity: -2 },
    { item_id: 'SUGAR', location_id: 'P1', quantity: -2 },
    { item_id: 'SALT', location_id: 'P1', quantity: 4 },
    { item_id: 'MILO', location_id: 'P1', quantity: 3 },
  ]);
  const after = Stock.apply(stock, rows);
  assert.equal(after['RICE|P1'], 6);
  assert.equal(after['SUGAR|P1'], 0);
  assert.equal(after['OIL|P1'], 3);
});

test('incremental updates match a full recompute of the ledger plus archived totals', () => {
  const items = ['RICE', 'OIL', 'SUGAR'];
  const locations = ['STORE', 'P1', 'P2'];
  let seed = 7;
  const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
  const ledger = Array.from({ length: 500 }, () => ({
    item_id: items[random(3)],
    location_id: locations[random(3)],
    quantity: random(21) - 10,
  }));
  const archived = { 'RICE|STORE': 100, 'OIL|P1': -3 };

  let incremental = Object.assign({}, archived);
  for (let i = 0; i < ledger.length; i += 7) incremental = Stock.apply(incremental, ledger.slice(i, i + 7));
  const recomputed = Stock.apply(archived, ledger);

  assert.deepEqual(Stock.mismatches(recomputed, incremental), []);
});

test('mismatches lists every item and location that differs', () => {
  assert.deepEqual(Stock.mismatches({ 'RICE|P1': 5, 'OIL|P1': 2 }, { 'RICE|P1': 4, 'SALT|P1': 1 }), [
    { item_id: 'RICE', location_id: 'P1', expected: 5, cached: 4 },
    { item_id: 'OIL', location_id: 'P1', expected: 2, cached: 0 },
    { item_id: 'SALT', location_id: 'P1', expected: 0, cached: 1 },
  ]);
});
