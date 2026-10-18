const test = require('node:test');
const assert = require('node:assert/strict');
const VisitQueue = require('../core/queue.js');

// Stands in for IndexedDB. Data lives outside the queue, so a new queue on the same storage is a "reload".
function memoryStorage() {
  const data = new Map();
  return {
    getAll: async () => [...data.values()].map((v) => structuredClone(v)),
    put: async (entry) => void data.set(entry.visit_id, structuredClone(entry)),
    remove: async (id) => void data.delete(id),
  };
}

const visit = (n) => ({
  visit_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  occurred_at: new Date(Date.UTC(2026, 9, 18, 8, 0, n)).toISOString(),
  lines: [{ item_id: 'RICE', qty: 1 }],
});
const answerAll = (status) => async (visits) => visits.map((v) => ({ visit_id: v.visit_id, status }));

test('queued visits survive a reload', async () => {
  const storage = memoryStorage();
  await VisitQueue.create(storage, answerAll('saved')).add(visit(1));
  const reloaded = VisitQueue.create(storage, answerAll('saved'));
  const entries = await reloaded.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sync_status, 'pending');
});

test('saved and duplicate visits are removed from the device', async () => {
  const storage = memoryStorage();
  const queue = VisitQueue.create(storage, async (visits) => [
    { visit_id: visits[0].visit_id, status: 'saved' },
    { visit_id: visits[1].visit_id, status: 'duplicate' },
  ]);
  await queue.add(visit(1));
  await queue.add(visit(2));
  assert.deepEqual(await queue.sync(), { ok: true, sent: 2 });
  assert.deepEqual(await queue.entries(), []);
});

test('a network failure leaves visits pending', async () => {
  const queue = VisitQueue.create(memoryStorage(), async () => { throw new Error('offline'); });
  await queue.add(visit(1));
  const result = await queue.sync();
  assert.equal(result.ok, false);
  assert.equal((await queue.entries())[0].sync_status, 'pending');
});

test('rejected visits stay on the device for staff, and can be retried or discarded', async () => {
  const storage = memoryStorage();
  let status = 'rejected';
  const queue = VisitQueue.create(storage, async (visits) => visits.map((v) => ({ visit_id: v.visit_id, status, error: 'ITEM_UNKNOWN' })));
  await queue.add(visit(1));
  await queue.add(visit(2));
  await queue.sync();
  let entries = await queue.entries();
  assert.deepEqual(entries.map((e) => [e.sync_status, e.error]), [['rejected', 'ITEM_UNKNOWN'], ['rejected', 'ITEM_UNKNOWN']]);

  await queue.discard(entries[1].visit_id);
  await queue.retry(entries[0].visit_id);
  status = 'saved';
  await queue.sync();
  assert.deepEqual(await queue.entries(), []);
});

test('visits are sent oldest first in batches', async () => {
  const sent = [];
  const queue = VisitQueue.create(memoryStorage(), async (visits) => {
    sent.push(visits.map((v) => v.visit_id));
    return visits.map((v) => ({ visit_id: v.visit_id, status: 'saved' }));
  });
  for (let n = 45; n >= 1; n--) await queue.add(visit(n)); // added newest first
  await queue.sync();
  assert.deepEqual(sent.map((b) => b.length), [20, 20, 5]);
  assert.equal(sent[0][0], visit(1).visit_id);
  assert.equal(sent[2][4], visit(45).visit_id);
});

test('two syncs at once share a single run', async () => {
  let calls = 0;
  const queue = VisitQueue.create(memoryStorage(), async (visits) => {
    calls++;
    return visits.map((v) => ({ visit_id: v.visit_id, status: 'saved' }));
  });
  await queue.add(visit(1));
  await Promise.all([queue.sync(), queue.sync()]);
  assert.equal(calls, 1);
});

test('a visit the server did not answer for stays pending', async () => {
  const queue = VisitQueue.create(memoryStorage(), async () => []);
  await queue.add(visit(1));
  await queue.sync();
  assert.equal((await queue.entries())[0].sync_status, 'pending');
});
