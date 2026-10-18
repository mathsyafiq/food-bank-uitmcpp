// Validation for a student visit sent by a device. Shared by Apps Script, the browser, and Node tests.
var Visit = (function () {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var MAX_LINES = 50;

  function isUuid(value) {
    return UUID.test(String(value == null ? '' : value));
  }

  /**
   * Checks a visit and merges lines for the same item.
   * options.knownItems: {item_id: true} for every item in the Items tab, active or not, because a
   *   queued offline visit may arrive after an item was deactivated.
   * options.maxLineQty: highest quantity accepted on one line.
   * options.largeQty: a line at or above this is flagged for staff review (never blocked).
   */
  function validate(visit, options) {
    if (!visit || typeof visit !== 'object') return { ok: false, errors: ['VISIT_MISSING'], lines: [] };
    var errors = [];
    if (!isUuid(visit.visit_id)) errors.push('VISIT_ID_INVALID');
    var occurredAt = new Date(visit.occurred_at);
    if (!visit.occurred_at || isNaN(occurredAt.getTime())) errors.push('TIME_INVALID');

    var lines = Array.isArray(visit.lines) ? visit.lines : [];
    if (lines.length === 0) errors.push('BASKET_EMPTY');
    if (lines.length > MAX_LINES) errors.push('BASKET_TOO_LARGE');

    var totals = {};
    var order = [];
    lines.slice(0, MAX_LINES).forEach(function (line) {
      var itemId = String((line && line.item_id) || '');
      var qty = line && line.qty;
      if (!options.knownItems[itemId]) return errors.push('ITEM_UNKNOWN');
      if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) return errors.push('QTY_INVALID');
      if (!(itemId in totals)) {
        totals[itemId] = 0;
        order.push(itemId);
      }
      totals[itemId] += qty;
    });

    var merged = order.map(function (itemId) {
      return { item_id: itemId, qty: totals[itemId] };
    });
    if (merged.some(function (l) { return l.qty > options.maxLineQty; })) errors.push('QTY_INVALID');

    return {
      ok: errors.length === 0,
      errors: errors.filter(function (e, i) { return errors.indexOf(e) === i; }),
      lines: merged,
      occurredAt: occurredAt,
      flagged: merged.some(function (l) { return l.qty >= options.largeQty; }),
    };
  }

  return { MAX_LINES: MAX_LINES, isUuid: isUuid, validate: validate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Visit;
