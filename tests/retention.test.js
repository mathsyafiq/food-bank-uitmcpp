const test = require('node:test');
const assert = require('node:assert/strict');
const Retention = require('../core/retention.js');

const now = new Date('2026-10-18T02:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

test('visits older than 365 days lose their student key', () => {
  const visits = [
    { recorded_at: daysAgo(400), student_key: 'a' },
    { recorded_at: daysAgo(366), student_key: 'b' },
    { recorded_at: daysAgo(364), student_key: 'c' },
    { recorded_at: daysAgo(500), student_key: '' }, // already anonymised
  ];
  assert.deepEqual(Retention.visitsToAnonymise(visits, now, 365), [0, 1]);
});

test('self-registered students not seen for 365 days are removed; roster entries stay', () => {
  const students = [
    { source: 'SELF', last_visit_at: daysAgo(400) },
    { source: 'SELF', last_visit_at: daysAgo(10) },
    { source: 'ROSTER', last_visit_at: daysAgo(400) },
    { source: 'SELF', last_visit_at: '' }, // unknown date: kept, never guessed
  ];
  assert.deepEqual(Retention.studentsToRemove(students, now, 365), [0]);
});

test('dates stored as text are understood', () => {
  assert.deepEqual(Retention.visitsToAnonymise([{ recorded_at: daysAgo(400).toISOString(), student_key: 'a' }], now, 365), [0]);
});
