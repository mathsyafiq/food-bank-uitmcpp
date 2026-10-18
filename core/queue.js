// Offline visit queue for pantry devices (CLAUDE.md section 9). Used by the PWA and Node tests.
// Storage is injected so the PWA can use IndexedDB and tests can use memory:
//   storage.getAll() -> Promise<entry[]>, storage.put(entry) -> Promise, storage.remove(visitId) -> Promise
// send(visits) -> Promise<[{visit_id, status: 'saved' | 'duplicate' | 'rejected', error}]>,
// and rejects when the network or server is unavailable.
var VisitQueue = (function () {
  'use strict';

  var BATCH = 20;

  function byTime(a, b) {
    return a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0;
  }

  function create(storage, send) {
    var running = null;

    /** Saves a visit before it is sent, so a closed page or flat battery never loses it. */
    function add(visit) {
      return storage.put({
        visit_id: visit.visit_id,
        occurred_at: visit.occurred_at,
        visit: visit,
        sync_status: 'pending',
        error: null,
      });
    }

    function entries() {
      return storage.getAll().then(function (all) {
        return all.slice().sort(byTime);
      });
    }

    function syncAll() {
      return entries().then(function (all) {
        var pending = all.filter(function (e) { return e.sync_status === 'pending'; });
        var done = 0;
        function nextBatch() {
          var batch = pending.slice(done, done + BATCH);
          if (batch.length === 0) return done;
          return send(batch.map(function (e) { return e.visit; })).then(function (results) {
            var byId = {};
            results.forEach(function (r) { byId[r.visit_id] = r; });
            return Promise.all(batch.map(function (entry) {
              var result = byId[entry.visit_id];
              if (!result) return null; // No answer for this visit: it stays pending for the next run.
              if (result.status === 'saved' || result.status === 'duplicate') return storage.remove(entry.visit_id);
              return storage.put(Object.assign({}, entry, { sync_status: 'rejected', error: result.error || 'REJECTED' }));
            })).then(function () {
              done += batch.length;
              return nextBatch();
            });
          });
        }
        return nextBatch();
      });
    }

    /**
     * Sends pending visits oldest first, in batches. Calls made while a sync is running share it.
     * Resolves {ok: true, sent} or, when the connection fails, {ok: false, error}; visits stay pending.
     */
    function sync() {
      if (!running) {
        running = syncAll().then(
          function (sent) { return { ok: true, sent: sent }; },
          function (err) { return { ok: false, error: String((err && err.message) || err) }; }
        ).then(function (result) {
          running = null;
          return result;
        });
      }
      return running;
    }

    /** Puts a rejected visit back in the queue, for example after staff fixed the item list. */
    function retry(visitId) {
      return entries().then(function (all) {
        var entry = all.filter(function (e) { return e.visit_id === visitId; })[0];
        if (!entry) return null;
        return storage.put(Object.assign({}, entry, { sync_status: 'pending', error: null }));
      });
    }

    /** Removes a visit from the device for good. Staff only, after confirming. */
    function discard(visitId) {
      return storage.remove(visitId);
    }

    return { add: add, entries: entries, sync: sync, retry: retry, discard: discard };
  }

  return { BATCH: BATCH, create: create };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VisitQueue;
