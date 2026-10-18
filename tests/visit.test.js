const test = require('node:test');
const assert = require('node:assert/strict');
const Visit = require('../core/visit.js');

const options = { knownItems: { RICE: true, OIL: true, OLD: true }, maxLineQty: 999, largeQty: 10 };
const visit = (lines, extra) =>
  Object.assign({ visit_id: '3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f', occurred_at: '2026-10-18T10:00:00Z', lines }, extra);

test('a normal visit passes and lines for the same item are merged', () => {
  const result = Visit.validate(visit([{ item_id: 'RICE', qty: 2 }, { item_id: 'OIL', qty: 1 }, { item_id: 'RICE', qty: 1 }]), options);
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, [{ item_id: 'RICE', qty: 3 }, { item_id: 'OIL', qty: 1 }]);
  assert.equal(result.flagged, false);
});

test('a line of 10 or more is flagged, not rejected', () => {
  const result = Visit.validate(visit([{ item_id: 'RICE', qty: 10 }]), options);
  assert.equal(result.ok, true);
  assert.equal(result.flagged, true);
});

test('merged lines that reach 10 are flagged', () => {
  const result = Visit.validate(visit([{ item_id: 'RICE', qty: 6 }, { item_id: 'RICE', qty: 4 }]), options);
  assert.equal(result.flagged, true);
});

test('an item deactivated after the visit was queued is still accepted', () => {
  assert.equal(Visit.validate(visit([{ item_id: 'OLD', qty: 1 }]), options).ok, true);
});

test('bad visits are rejected with reasons', () => {
  const cases = [
    [visit([{ item_id: 'RICE', qty: 1 }], { visit_id: 'not-a-uuid' }), 'VISIT_ID_INVALID'],
    [visit([{ item_id: 'RICE', qty: 1 }], { occurred_at: 'yesterday-ish' }), 'TIME_INVALID'],
    [visit([]), 'BASKET_EMPTY'],
    [visit([{ item_id: 'NOPE', qty: 1 }]), 'ITEM_UNKNOWN'],
    [visit([{ item_id: 'RICE', qty: 0 }]), 'QTY_INVALID'],
    [visit([{ item_id: 'RICE', qty: 1.5 }]), 'QTY_INVALID'],
    [visit([{ item_id: 'RICE', qty: '2' }]), 'QTY_INVALID'],
    [visit([{ item_id: 'RICE', qty: 600 }, { item_id: 'RICE', qty: 600 }]), 'QTY_INVALID'],
  ];
  for (const [input, code] of cases) {
    const result = Visit.validate(input, options);
    assert.equal(result.ok, false, code);
    assert.ok(result.errors.includes(code), `${code} in ${result.errors}`);
  }
});

test('a basket over the line limit is rejected', () => {
  const lines = Array.from({ length: Visit.MAX_LINES + 1 }, () => ({ item_id: 'RICE', qty: 1 }));
  assert.ok(Visit.validate(visit(lines), options).errors.includes('BASKET_TOO_LARGE'));
});

test('a missing visit is rejected', () => {
  assert.deepEqual(Visit.validate(null, options).errors, ['VISIT_MISSING']);
});
