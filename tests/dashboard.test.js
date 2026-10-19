const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadBackend } = require('./fakes/apps-script.js');

const DAY = 24 * 60 * 60 * 1000;

function seeded() {
  const app = loadBackend();
  const t = app.db.tables;
  t.Locations.push(
    { location_id: 'S1', name: 'Central Store', type: 'STORE', active: true },
    { location_id: 'P1', name: 'Pantri 1', type: 'PANTRY', active: true },
    { location_id: 'P2', name: 'Pantri 2', type: 'PANTRY', active: true },
  );
  t.Items.push(
    { item_id: 'NB-001', name: 'Rice', active: true },
    { item_id: 'NB-002', name: 'Oil', active: true },
  );
  t.Faculties.push({ faculty_code: 'FSKM', name_ms: 'FSKM', active: true });
  t.Staff.push({ email: 'staff@uitm.edu.my', role: 'staff', active: true });
  return app;
}

const day = (app, date) => app.fn('formatDay_')(date);
const post = (app, body) => JSON.parse(app.fn('doPost')({ postData: { contents: JSON.stringify(body) } }).text);
const visitFor = (id, lines) => ({
  visit_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
  student: { id, name: 'Student ' + id, faculty_code: 'FSKM', consent: true }, lines,
});

test('the dashboard totals visits, students, items given out and received, and nets out voids', () => {
  const app = seeded();
  app.user.email = 'staff@uitm.edu.my';
  app.fn('staffReceive')({ location_id: 'S1', quantities: { 'NB-001': 40, 'NB-002': 10 } });
  post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visitFor('2024000001', [{ item_id: 'NB-001', qty: 3 }]) });
  post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visitFor('2024000001', [{ item_id: 'NB-002', qty: 1 }]) });
  const big = visitFor('2024000002', [{ item_id: 'NB-001', qty: 12 }]);
  post(app, { action: 'submitVisit', pantry_id: 'P2', payload: big });
  const mistake = visitFor('2024000003', [{ item_id: 'NB-002', qty: 5 }]);
  post(app, { action: 'submitVisit', pantry_id: 'P2', payload: mistake });
  app.fn('staffVoidVisit')({ visit_id: mistake.visit_id, reason: 'test' });

  const today = day(app, new Date());
  const d = JSON.parse(JSON.stringify(app.fn('staffDashboard')({ from: today, to: today })));
  assert.deepEqual(d.kpis, { visits: 3, students: 2, items_out: 16, received: 50, flagged: 1, not_on_namelist: 0 });
  assert.deepEqual(d.top_items.map((i) => [i.name, i.quantity]), [['Rice', 15], ['Oil', 1]]);
  assert.deepEqual(d.by_location, [{ name: 'Pantri 1', visits: 2 }, { name: 'Pantri 2', visits: 1 }]);
  assert.equal(d.visits_over_time.unit, 'day');
  assert.deepEqual(d.visits_over_time.points, [{ key: today, visits: 3 }]);
  assert.equal(d.flagged_visits[0].visit_id, big.visit_id);
  // Aggregates only: no student keys, IDs or names leave the server.
  const text = JSON.stringify(d);
  assert.equal(/2024000001|Student 2024|[0-9a-f]{64}/.test(text), false);
});

test('one location can be picked, and stock at or below its threshold is listed, worst first', () => {
  const app = seeded();
  app.user.email = 'staff@uitm.edu.my';
  app.fn('staffReceive')({ location_id: 'S1', quantities: { 'NB-001': 3, 'NB-002': 20 } });
  app.fn('staffTransfer')({ from_location_id: 'S1', to_location_id: 'P1', quantities: { 'NB-001': 3 } });
  post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visitFor('2024000001', [{ item_id: 'NB-001', qty: 1 }]) });
  post(app, { action: 'submitVisit', pantry_id: 'P2', payload: visitFor('2024000002', [{ item_id: 'NB-002', qty: 2 }]) });
  const today = day(app, new Date());
  const p1 = JSON.parse(JSON.stringify(app.fn('staffDashboard')({ from: today, to: today, location_id: 'P1' })));
  assert.equal(p1.location, 'Pantri 1');
  assert.equal(p1.kpis.visits, 1);
  assert.deepEqual(p1.low_stock.map((s) => [s.item, s.location, s.on_hand, s.status]), [['Rice', 'Pantri 1', 2, 'low']]);
  const all = JSON.parse(JSON.stringify(app.fn('staffDashboard')({ from: today, to: today })));
  assert.deepEqual(all.low_stock.map((s) => [s.location, s.status]), [['Pantri 2', 'out'], ['Central Store', 'out'], ['Pantri 1', 'low']]);
});

test('long ranges are grouped by week or month so the chart never has hundreds of bars', () => {
  const app = seeded();
  app.user.email = 'staff@uitm.edu.my';
  const now = new Date();
  const weeks = JSON.parse(JSON.stringify(app.fn('staffDashboard')({ from: day(app, new Date(now - 89 * DAY)), to: day(app, now) })));
  assert.equal(weeks.visits_over_time.unit, 'week');
  assert.ok(weeks.visits_over_time.points.length >= 13 && weeks.visits_over_time.points.length <= 14);
  const months = JSON.parse(JSON.stringify(app.fn('staffDashboard')({ from: day(app, new Date(now - 364 * DAY)), to: day(app, now) })));
  assert.equal(months.visits_over_time.unit, 'month');
  assert.ok(months.visits_over_time.points.length >= 12 && months.visits_over_time.points.length <= 13);
});

test('the dashboard is staff-only', () => {
  const app = seeded();
  app.user.email = '';
  assert.throws(() => app.fn('staffDashboard')({ from: '2026-10-01', to: '2026-10-19' }), /sign in/);
});
