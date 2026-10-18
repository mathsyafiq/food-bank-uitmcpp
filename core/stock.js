// Stock arithmetic. Shared by Apps Script and Node tests.
// A stock map is {"item_id|location_id": on_hand}. Ledger rows are {item_id, location_id, quantity}.
var Stock = (function () {
  'use strict';

  function key(itemId, locationId) {
    return itemId + '|' + locationId;
  }

  function isBlank(value) {
    return value === '' || value === null || value === undefined;
  }

  function wholeNumber(value, allowZero) {
    var n = Number(value);
    if (!Number.isInteger(n) || n < 0 || (!allowZero && n === 0)) throw new Error('QTY_INVALID');
    return n;
  }

  /** Returns a copy of the stock map with each row's signed quantity added. */
  function apply(stock, rows) {
    var next = Object.assign({}, stock);
    rows.forEach(function (row) {
      var k = key(row.item_id, row.location_id);
      next[k] = (next[k] || 0) + row.quantity;
    });
    return next;
  }

  /** Receive delivery: one positive row per item. Blank and zero quantities are skipped. */
  function receiveRows(locationId, quantities) {
    var rows = [];
    Object.keys(quantities).forEach(function (itemId) {
      var raw = quantities[itemId];
      if (isBlank(raw) || Number(raw) === 0) return;
      rows.push({ item_id: itemId, location_id: locationId, quantity: wholeNumber(raw) });
    });
    return rows;
  }

  /** Transfer: a negative row at the source and a positive row at the destination for each item. */
  function transferRows(fromId, toId, quantities) {
    if (fromId === toId) throw new Error('SAME_LOCATION');
    var rows = [];
    receiveRows(toId, quantities).forEach(function (row) {
      rows.push({ item_id: row.item_id, location_id: fromId, quantity: -row.quantity });
      rows.push(row);
    });
    return rows;
  }

  /**
   * Stock count: one row per counted item whose count differs from on-hand.
   * Blank means "not counted" and is skipped; zero means "counted, none left".
   */
  function countRows(stock, locationId, counts) {
    var rows = [];
    Object.keys(counts).forEach(function (itemId) {
      var raw = counts[itemId];
      if (isBlank(raw)) return;
      var diff = wholeNumber(raw, true) - (stock[key(itemId, locationId)] || 0);
      if (diff !== 0) rows.push({ item_id: itemId, location_id: locationId, quantity: diff });
    });
    return rows;
  }

  /** Lists every item and location where the cached stock differs from the expected stock. */
  function mismatches(expected, cached) {
    var keys = Object.keys(expected).concat(Object.keys(cached));
    return keys
      .filter(function (k, i) { return keys.indexOf(k) === i; })
      .filter(function (k) { return (expected[k] || 0) !== (cached[k] || 0); })
      .map(function (k) {
        var parts = k.split('|');
        return { item_id: parts[0], location_id: parts[1], expected: expected[k] || 0, cached: cached[k] || 0 };
      });
  }

  return {
    key: key,
    apply: apply,
    receiveRows: receiveRows,
    transferRows: transferRows,
    countRows: countRows,
    mismatches: mismatches,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Stock;
