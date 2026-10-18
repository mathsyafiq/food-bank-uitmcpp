// Low-stock and zero-stock alert rules (CLAUDE.md section 8). Shared by Apps Script and Node tests.
var Alerts = (function () {
  'use strict';

  function logKey(type, itemId, locationId) {
    return type + '|' + itemId + '|' + locationId;
  }

  /**
   * Returns the alerts due now: ZERO when on-hand is 0 or less, LOW when it is at or below the threshold.
   * Each type is sent at most once per day per item and location (input.sentToday).
   * Only item and location pairs that have a Stock row are checked, so an item never stocked at a
   * pantry does not raise a daily zero alert there.
   *
   * input.stock: [{item_id, location_id, on_hand}]
   * input.items / input.locations: {id: {active}}
   * input.thresholds: {"item_id|location_id": number}; input.defaultThreshold: number
   * input.sentToday: {logKey: true}
   */
  function due(input) {
    var alerts = [];
    input.stock.forEach(function (row) {
      var item = input.items[row.item_id];
      var location = input.locations[row.location_id];
      if (!item || !item.active || !location || !location.active) return;
      var pair = row.item_id + '|' + row.location_id;
      var threshold = pair in input.thresholds ? input.thresholds[pair] : input.defaultThreshold;
      var type = row.on_hand <= 0 ? 'ZERO' : row.on_hand <= threshold ? 'LOW' : null;
      if (!type || input.sentToday[logKey(type, row.item_id, row.location_id)]) return;
      alerts.push({
        type: type,
        item_id: row.item_id,
        location_id: row.location_id,
        on_hand: row.on_hand,
        threshold: threshold,
      });
    });
    return alerts;
  }

  return { logKey: logKey, due: due };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Alerts;
