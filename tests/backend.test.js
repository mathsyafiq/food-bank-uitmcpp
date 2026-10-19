const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadBackend } = require('./fakes/apps-script.js');

function seeded() {
  const app = loadBackend();
  const t = app.db.tables;
  t.Locations.push(
    { location_id: 'S1', name: 'Central Store', type: 'STORE', active: true },
    { location_id: 'P1', name: 'Pantri 1', type: 'PANTRY', active: true },
    { location_id: 'P2', name: 'Pantri 2', type: 'PANTRY', active: true },
  );
  t.Items.push(
    { item_id: 'NB-001', name: 'Rice 1kg', category: 'Staples', unit: 'pack', sort_order: 1, active: true, photo_version: '' },
    { item_id: 'NB-002', name: 'Cooking oil', category: 'Staples', unit: 'bottle', sort_order: 2, active: true, photo_version: '' },
  );
  t.Barcodes.push({ code: '09556001000017', item_id: 'NB-001' });
  t.Faculties.push({ faculty_code: 'FSKM', name_ms: 'Fakulti Sains Komputer', name_en: 'Computer Science', active: true });
  t.Staff.push(
    { email: 'admin@uitm.edu.my', name: 'Admin', role: 'admin', receives_alerts: true, active: true },
    { email: 'staff@uitm.edu.my', name: 'Staff', role: 'staff', receives_alerts: false, active: true },
  );
  return app;
}

const student = (extra) => Object.assign({ id: '2023123456', name: 'Ali bin Abu', faculty_code: 'FSKM', consent: true }, extra);
const visit = (lines, extra) => Object.assign({
  visit_id: crypto.randomUUID(),
  occurred_at: new Date().toISOString(),
  student: student(),
  lines,
}, extra);
const post = (app, body) => JSON.parse(app.fn('doPost')({ postData: { contents: JSON.stringify(body) } }).text);
const submit = (app, v, extra) => post(app, Object.assign({ action: 'submitVisit', pantry_id: 'P1', payload: v }, extra));
const onHand = (app, item, loc) => {
  const row = app.db.tables.Stock.find((r) => r.item_id === item && r.location_id === loc);
  return row ? row.on_hand : 0;
};
const asStaff = (app, email, name, ...args) => {
  app.user.email = email;
  return app.fn(name)(...args);
};

test('a visit writes one Visits row, OUT rows, stock and the student record', () => {
  const app = seeded();
  const res = submit(app, visit([{ item_id: 'NB-001', qty: 2 }, { item_id: 'NB-002', qty: 1 }]));
  assert.deepEqual(res, { ok: true, data: { status: 'saved' } });
  const t = app.db.tables;
  assert.equal(t.Visits.length, 1);
  assert.deepEqual(t.Transactions.map((r) => [r.type, r.item_id, r.quantity]), [['OUT', 'NB-001', -2], ['OUT', 'NB-002', -1]]);
  assert.equal(onHand(app, 'NB-001', 'P1'), -2); // stock may go negative
  assert.equal(t.Students.length, 1);
  assert.equal(t.Students[0].student_id, '2023123456');
  assert.equal(t.Students[0].name, 'Ali bin Abu');
  // The ledger and visits hold only the HMAC key, never the plain ID.
  assert.match(t.Visits[0].student_key, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(t.Transactions).includes('2023123456'), false);
  assert.equal(JSON.stringify(t.Visits).includes('2023123456'), false);
});

test('the same visit sent twice is counted once', () => {
  const app = seeded();
  const v = visit([{ item_id: 'NB-001', qty: 3 }]);
  assert.equal(submit(app, v).data.status, 'saved');
  assert.equal(submit(app, v).data.status, 'duplicate');
  assert.equal(app.db.tables.Visits.length, 1);
  assert.equal(onHand(app, 'NB-001', 'P1'), -3);
  assert.equal(app.db.tables.Students[0].visit_count, 1);
});

test('student details are required in self-registration mode', () => {
  const app = seeded();
  const code = (v) => submit(app, v).error.code;
  assert.equal(code(visit([{ item_id: 'NB-001', qty: 1 }], { student: student({ consent: false }) })), 'CONSENT_REQUIRED');
  assert.equal(code(visit([{ item_id: 'NB-001', qty: 1 }], { student: student({ id: '12' }) })), 'STUDENT_ID_INVALID');
  assert.equal(code(visit([{ item_id: 'NB-001', qty: 1 }], { student: student({ name: ' ' }) })), 'NAME_REQUIRED');
  assert.equal(code(visit([{ item_id: 'NB-001', qty: 1 }], { student: student({ faculty_code: 'NOPE' }) })), 'FACULTY_REQUIRED');
  assert.equal(app.db.tables.Visits.length, 0);
});

test('a name that looks like a formula is stored as text', () => {
  const app = seeded();
  submit(app, visit([{ item_id: 'NB-001', qty: 1 }], { student: student({ name: '=IMPORTXML("x")' }) }));
  assert.equal(app.db.tables.Students[0].name, '\'=IMPORTXML("x")');
});

test('only an active pantry can receive visits', () => {
  const app = seeded();
  assert.equal(submit(app, visit([{ item_id: 'NB-001', qty: 1 }]), { pantry_id: 'S1' }).error.code, 'PANTRY_UNKNOWN');
  assert.equal(submit(app, visit([{ item_id: 'NB-001', qty: 1 }]), { pantry_id: 'XX' }).error.code, 'PANTRY_UNKNOWN');
});

test('a line of 10 or more is saved and flagged', () => {
  const app = seeded();
  submit(app, visit([{ item_id: 'NB-001', qty: 12 }, { item_id: 'NB-002', qty: 1 }]));
  assert.equal(app.db.tables.Visits[0].flagged, true);
  assert.deepEqual(app.db.tables.Transactions.map((r) => r.flag), ['LARGE', '']);
});

test('in self-registration mode the ID check never looks anyone up', () => {
  const app = seeded();
  const res = post(app, { action: 'checkStudent', pantry_id: 'P1', payload: { id: '2023123456' } });
  assert.deepEqual(res.data, { mode: 'SELF' });
});

test('unknown barcodes scanned by students are listed for staff', () => {
  const app = seeded();
  submit(app, visit([{ item_id: 'NB-001', qty: 1 }], { unknown_barcodes: ['4006381333931', '09556001000017', 'junk'] }));
  assert.deepEqual(app.db.tables.UnknownBarcodes.map((u) => u.code), ['04006381333931']);
});

test('bad requests get clear error codes and unexpected errors reveal nothing', () => {
  const app = seeded();
  assert.equal(JSON.parse(app.fn('doPost')({ postData: { contents: '{nope' } }).text).error.code, 'BAD_REQUEST');
  assert.equal(post(app, { action: 'dropTables', pantry_id: 'P1' }).error.code, 'UNKNOWN_ACTION');
  const body = app.fn('errorBody_')(new Error('secret detail 2023123456'));
  assert.equal(body.error.code, 'SERVER_ERROR');
  assert.equal(JSON.stringify(body).includes('2023123456'), false);
});

test('public submissions are capped per minute', () => {
  const app = seeded();
  app.db.tables.Settings.push({ key: 'public_submits_per_minute', value: '5' });
  for (let i = 0; i < 5; i++) assert.equal(submit(app, visit([{ item_id: 'NB-001', qty: 1 }])).ok, true);
  assert.equal(submit(app, visit([{ item_id: 'NB-001', qty: 1 }])).error.code, 'TOO_MANY_REQUESTS');
});

test('receive, transfer, count and adjust keep stock equal to the ledger', () => {
  const app = seeded();
  const staff = 'staff@uitm.edu.my';
  asStaff(app, staff, 'staffReceive', { location_id: 'S1', quantities: { 'NB-001': '50', 'NB-002': '20' }, donor_source: 'Zakat' });
  asStaff(app, staff, 'staffTransfer', { from_location_id: 'S1', to_location_id: 'P1', quantities: { 'NB-001': 10, 'NB-002': '' } });
  submit(app, visit([{ item_id: 'NB-001', qty: 2 }]));
  const counted = asStaff(app, staff, 'staffCount', { location_id: 'P1', quantities: { 'NB-001': '7', 'NB-002': '' } });
  assert.equal(counted.adjusted, 1);
  asStaff(app, staff, 'staffAdjust', { location_id: 'S1', item_id: 'NB-002', quantity: '-2', reason: 'damaged' });

  assert.equal(onHand(app, 'NB-001', 'S1'), 40);
  assert.equal(onHand(app, 'NB-001', 'P1'), 7);
  assert.equal(onHand(app, 'NB-002', 'S1'), 18);
  assert.equal(app.db.tables.Batches.map((b) => b.type).join(','), 'IN,TRANSFER,COUNT,ADJUST');
  assert.equal(app.db.tables.Batches[0].staff_email, staff);

  app.user.email = 'admin@uitm.edu.my';
  assert.equal(app.fn('adminRunStockCheck')().mismatches, 0);
});

test('the stock check reports a direct edit to the Stock tab', () => {
  const app = seeded();
  asStaff(app, 'staff@uitm.edu.my', 'staffReceive', { location_id: 'S1', quantities: { 'NB-001': 5 } });
  app.db.tables.Stock[0].on_hand = 99;
  assert.equal(asStaff(app, 'admin@uitm.edu.my', 'adminRunStockCheck').mismatches, 1);
  assert.equal(app.mail.length, 1);
});

test('voiding a visit reverses its stock once', () => {
  const app = seeded();
  const v = visit([{ item_id: 'NB-001', qty: 4 }]);
  submit(app, v);
  const found = asStaff(app, 'staff@uitm.edu.my', 'staffFindVisit', v.visit_id.toUpperCase());
  assert.equal(found.lines.length, 1);
  asStaff(app, 'staff@uitm.edu.my', 'staffVoidVisit', { visit_id: v.visit_id, reason: 'test entry' });
  assert.equal(onHand(app, 'NB-001', 'P1'), 0);
  assert.throws(() => app.fn('staffVoidVisit')({ visit_id: v.visit_id, reason: 'again' }), /already been voided/);
});

test('staff functions refuse anonymous callers, non-staff, and staff calling admin functions', () => {
  const app = seeded();
  assert.throws(() => asStaff(app, '', 'staffReceive', { location_id: 'S1', quantities: { 'NB-001': 1 } }), /sign in/);
  assert.throws(() => asStaff(app, 'random@uitm.edu.my', 'staffBootstrap'), /does not have staff access/);
  assert.throws(() => asStaff(app, 'staff@uitm.edu.my', 'adminStudentsCsv'), /Only an admin/);
  assert.throws(() => asStaff(app, '', 'setup'), /owner/);
  assert.throws(() => asStaff(app, 'staff@uitm.edu.my', 'nightlyJobs'), /Only an admin/);
  assert.equal(app.db.tables.Transactions.length, 0);
});

test('the last admin cannot be removed', () => {
  const app = seeded();
  assert.throws(() => asStaff(app, 'admin@uitm.edu.my', 'adminSaveStaff', { email: 'admin@uitm.edu.my', role: 'staff' }), /at least one active admin/);
});

test('a pantry device is set up with a one-time code and can sync queued visits', () => {
  const app = seeded();
  const { code } = asStaff(app, 'staff@uitm.edu.my', 'staffCreateDeviceCode', { location_id: 'P2', label: 'Laptop' });
  const redeemed = post(app, { action: 'redeemSetupCode', payload: { code: code.toLowerCase() } });
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.data.location_id, 'P2');
  assert.equal(post(app, { action: 'redeemSetupCode', payload: { code } }).error.code, 'SETUP_CODE_INVALID'); // single use
  assert.notEqual(app.db.tables.Devices[0].key_hash, redeemed.data.device_key); // only the hash is stored

  const device = { id: redeemed.data.device_id, key: redeemed.data.device_key };
  const queued = [visit([{ item_id: 'NB-001', qty: 1 }]), visit([{ item_id: 'NOPE', qty: 1 }])];
  const sync = post(app, { action: 'syncVisits', device, payload: { visits: queued } });
  assert.deepEqual(sync.data.results.map((r) => r.status), ['saved', 'rejected']);
  assert.equal(app.db.tables.Visits[0].location_id, 'P2'); // the device's pantry, not one sent by the page
  assert.equal(app.db.tables.Visits[0].source, 'PANTRY_DEVICE');

  assert.equal(post(app, { action: 'catalog', device: { id: device.id, key: 'wrong' } }).error.code, 'DEVICE_REVOKED');
  assert.equal(post(app, { action: 'syncVisits', pantry_id: 'P1', payload: { visits: [] } }).error.code, 'DEVICE_REQUIRED');
  asStaff(app, 'staff@uitm.edu.my', 'staffRevokeDevice', device.id);
  assert.equal(post(app, { action: 'catalog', device }).error.code, 'DEVICE_REVOKED');
});

test('the catalogue lists active items and barcodes, and says when nothing changed', () => {
  const app = seeded();
  app.db.tables.Items.push({ item_id: 'NB-003', name: 'Old item', active: false });
  const first = post(app, { action: 'catalog', pantry_id: 'P1', payload: {} }).data;
  assert.deepEqual(first.items.map((i) => i.item_id), ['NB-001', 'NB-002']);
  assert.deepEqual(first.barcodes, { '09556001000017': 'NB-001' });
  assert.equal(first.location.name, 'Pantri 1');
  const again = post(app, { action: 'catalog', pantry_id: 'P1', payload: { version: first.version } }).data;
  assert.deepEqual(again, { unchanged: true, version: first.version });
});

test('retention blanks old student keys and removes students not seen for a year', () => {
  const app = seeded();
  submit(app, visit([{ item_id: 'NB-001', qty: 1 }]));
  submit(app, visit([{ item_id: 'NB-001', qty: 1 }], { student: student({ id: '2022000001' }) }));
  const t = app.db.tables;
  const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  t.Visits[0].recorded_at = old;
  t.Students[0].last_visit_at = old;
  const result = app.fn('applyRetention_')(new Date());
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { visits_anonymised: 1, students_removed: 1 });
  assert.equal(t.Visits[0].student_key, '');
  assert.notEqual(t.Visits[1].student_key, '');
  assert.deepEqual(t.Students.map((s) => s.student_id), ['2022000001']);
  assert.equal(t.Transactions.length, 2); // the ledger is untouched
});

test('low and zero stock alerts go out once a day and name the location', () => {
  const app = seeded();
  asStaff(app, 'staff@uitm.edu.my', 'staffReceive', { location_id: 'S1', quantities: { 'NB-001': 3, 'NB-002': 20 } });
  asStaff(app, 'staff@uitm.edu.my', 'staffTransfer', { from_location_id: 'S1', to_location_id: 'P1', quantities: { 'NB-001': 3 } });
  const sent = app.fn('sendStockAlerts_')(new Date());
  assert.equal(sent, 2); // Rice: zero at the store, low (3 <= 5) at Pantri 1
  assert.deepEqual(app.mail.map((m) => m.subject).sort(), ['Low stock at Pantri 1: 1 item(s)', '[URGENT] Out of stock at Central Store: 1 item(s)']);
  assert.equal(app.mail[0].to, 'admin@uitm.edu.my');
  assert.equal(app.fn('sendStockAlerts_')(new Date()), 0);
});

test('the large-quantity digest lists visits without student data', () => {
  const app = seeded();
  submit(app, visit([{ item_id: 'NB-001', qty: 15 }]));
  assert.equal(app.fn('sendLargeQuantityDigest_')(new Date(Date.now() + 1000)), 1);
  assert.match(app.mail[0].subject, /Pantri 1/);
  assert.equal(/2023123456|Ali bin Abu/.test(app.mail[0].htmlBody), false);
});

test('an admin can look up a student and export the list for HEP, and it is audited', () => {
  const app = seeded();
  submit(app, visit([{ item_id: 'NB-001', qty: 2 }]));
  app.user.email = 'admin@uitm.edu.my';
  const found = app.fn('adminStudentLookup')('2023 123 456');
  assert.equal(found.student.name, 'Ali bin Abu');
  assert.equal(found.visits[0].lines, 'Rice 1kg × 2');
  const csv = app.fn('adminStudentsCsv')();
  assert.match(csv.csv, /^student_id,name,program,faculty,on_namelist,/);
  assert.match(csv.csv, /2023123456,Ali bin Abu,,Fakulti Sains Komputer,no,/);
  assert.deepEqual(app.db.tables.AuditLog.map((a) => a.action), ['student_lookup', 'students_export']);
});

test('items get the next NB code; barcodes link once and clear the unknown list', () => {
  const app = seeded();
  app.user.email = 'staff@uitm.edu.my';
  assert.equal(app.fn('staffSaveItem')({ name: 'Sugar', category: 'Makanan', unit: 'pek', sort_order: '', active: true }).item_id, 'NB-003');
  app.db.tables.UnknownBarcodes.push({ code: '04006381333931', times_seen: 2 });
  assert.equal(app.fn('staffLinkBarcode')('4006381333931', 'NB-003').code, '04006381333931');
  assert.equal(app.db.tables.UnknownBarcodes.length, 0);
  assert.throws(() => app.fn('staffLinkBarcode')('4006381333931', 'NB-001'), /already linked/);
  assert.throws(() => app.fn('staffLinkBarcode')('NB-001', 'NB-003'), /not valid/);
});

test('photos must be small image data', () => {
  const app = seeded();
  app.user.email = 'staff@uitm.edu.my';
  assert.ok(app.fn('staffSetItemPhoto')('NB-001', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==').photo_version);
  assert.throws(() => app.fn('staffSetItemPhoto')('NB-001', 'javascript:alert(1)'), /photo/);
  assert.throws(() => app.fn('staffSetItemPhoto')('NB-001', 'data:image/jpeg;base64,' + 'A'.repeat(50000)), /photo/);
  const photos = post(app, { action: 'photos', payload: { item_ids: ['NB-001'] } }).data.photos;
  assert.equal(photos['NB-001'].data.startsWith('data:image/jpeg'), true);
});

test('reports return the date range, and CSV export works', () => {
  const app = seeded();
  submit(app, visit([{ item_id: 'NB-001', qty: 2 }]));
  app.user.email = 'staff@uitm.edu.my';
  const today = app.fn('formatDay_')(new Date());
  const report = app.fn('staffTransactionsReport')({ from: today, to: today });
  assert.equal(report.total, 1);
  assert.equal(report.rows[0].item, 'Rice 1kg');
  assert.match(app.fn('staffReportCsv')('visits', { from: today, to: today }).csv, /^visit_id,occurred_at/);
  assert.throws(() => app.fn('staffTransactionsReport')({ from: 'yesterday', to: today }), /valid date range/);
});

test('QR posters: one per active pantry, admins only, and each code reads back as its pantry link', () => {
  const { readQr } = require('./support/zxing.js');
  const app = seeded();
  app.db.tables.Locations.push({ location_id: 'P3', name: 'Closed pantry', type: 'PANTRY', active: false });
  app.user.email = 'admin@uitm.edu.my';
  const posters = app.fn('adminQrPosters')();
  assert.deepEqual(posters.map((p) => [p.location_id, p.name, p.url]), [
    ['P1', 'Pantri 1', 'https://mathsyafiq.github.io/food-bank-uitmcpp/?p=P1'],
    ['P2', 'Pantri 2', 'https://mathsyafiq.github.io/food-bank-uitmcpp/?p=P2'],
  ]);
  const modules = posters[0].modules.map((row) => row.split('').map((c) => c === '1'));
  assert.equal(readQr(modules).text, posters[0].url);
  app.user.email = 'staff@uitm.edu.my';
  assert.throws(() => app.fn('adminQrPosters')(), /Only an admin/);
});

test('the pantry link keeps other query values and replaces an old pantry ID', () => {
  const app = seeded();
  const link = app.fn('pantryLink_');
  assert.equal(link('https://example.edu.my/app/', 'P2'), 'https://example.edu.my/app/?p=P2');
  assert.equal(link('http://localhost:8090/?p=P1', 'P2'), 'http://localhost:8090/?p=P2');
  assert.equal(link('https://example.edu.my/?lang=ms&p=P1#top', 'P2'), 'https://example.edu.my/?lang=ms&p=P2');
});

test('barcode labels cover every internal item code and scan back as that item', () => {
  const { readCode128 } = require('./support/zxing.js');
  const app = seeded();
  app.db.tables.Items.push({ item_id: 'X-1', name: 'Hand-typed ID', active: true });
  app.user.email = 'staff@uitm.edu.my';
  const labels = app.fn('staffItemLabels')();
  assert.deepEqual(Object.keys(labels), ['NB-001', 'NB-002']);
  assert.equal(readCode128(labels['NB-002']), 'NB-002');
  app.user.email = 'stranger@uitm.edu.my';
  assert.throws(() => app.fn('staffItemLabels')(), /does not have staff access/);
});
