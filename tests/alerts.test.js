const test = require('node:test');
const assert = require('node:assert/strict');
const Alerts = require('../core/alerts.js');

const base = {
  items: { RICE: { active: true }, OIL: { active: true }, OLD: { active: false } },
  locations: { P1: { active: true }, P2: { active: false } },
  thresholds: { 'OIL|P1': 10 },
  defaultThreshold: 5,
  sentToday: {},
};

test('low, zero and negative stock raise the right alert', () => {
  const alerts = Alerts.due(Object.assign({}, base, {
    stock: [
      { item_id: 'RICE', location_id: 'P1', on_hand: 5 },
      { item_id: 'OIL', location_id: 'P1', on_hand: 0 },
    ],
  }));
  assert.deepEqual(alerts.map((a) => [a.type, a.item_id]), [['LOW', 'RICE'], ['ZERO', 'OIL']]);
  const negative = Alerts.due(Object.assign({}, base, { stock: [{ item_id: 'RICE', location_id: 'P1', on_hand: -2 }] }));
  assert.equal(negative[0].type, 'ZERO');
});

test('stock above the threshold raises nothing; a per-location threshold overrides the default', () => {
  const alerts = Alerts.due(Object.assign({}, base, {
    stock: [
      { item_id: 'RICE', location_id: 'P1', on_hand: 6 },
      { item_id: 'OIL', location_id: 'P1', on_hand: 9 },
    ],
  }));
  assert.deepEqual(alerts.map((a) => [a.item_id, a.threshold]), [['OIL', 10]]);
});

test('inactive items and locations are ignored', () => {
  const alerts = Alerts.due(Object.assign({}, base, {
    stock: [
      { item_id: 'OLD', location_id: 'P1', on_hand: 0 },
      { item_id: 'RICE', location_id: 'P2', on_hand: 0 },
      { item_id: 'GONE', location_id: 'P1', on_hand: 0 },
    ],
  }));
  assert.deepEqual(alerts, []);
});

test('an alert already sent today is not repeated', () => {
  const sentToday = { [Alerts.logKey('LOW', 'RICE', 'P1')]: true };
  const stock = [{ item_id: 'RICE', location_id: 'P1', on_hand: 3 }];
  assert.deepEqual(Alerts.due(Object.assign({}, base, { stock, sentToday })), []);
  const zero = Alerts.due(Object.assign({}, base, { stock: [{ item_id: 'RICE', location_id: 'P1', on_hand: 0 }], sentToday }));
  assert.equal(zero[0].type, 'ZERO'); // a different alert type still goes out
});
