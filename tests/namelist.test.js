const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadBackend } = require('./fakes/apps-script.js');

const NAMELIST_ID = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
const LINK = `https://docs.google.com/spreadsheets/d/${NAMELIST_ID}/edit#gid=0`;

// Made-up students, laid out like a typical registrar list: title rows, then headers, then data.
const LIST = [
  ['SENARAI NAMA RESIDEN KOLEJ', '', '', '', '', ''],
  ['SESI 20264', '', '', '', '', ''],
  ['BIL', 'NO. PELAJAR', 'NAMA PELAJAR', 'NO. KP', 'PROGRAM', 'KOLEJ KEDIAMAN'],
  ['1', '2024000001', 'AHMAD FAIZ BIN RAHMAN', '050101-07-1234', 'CS230', 'NILAM'],
  ['2', '2024000002', 'NUR AINA BINTI ISMAIL', '050202-07-2345', 'AS120', 'KK KRISTAL-A'],
  ['3', '2024 000 003', 'LIM WEI JIE', '050303-07-3456', 'BA232', 'MUTIARA'],
  ['4', 'ABC', 'BAD ROW', '', 'XX', 'NILAM'],
  ['5', '2024000001', 'AHMAD FAIZ BIN RAHMAN', '050101-07-1234', 'CS230', 'NILAM'],
  ['', '', '', '', '', ''],
];

function seeded(mode) {
  const app = loadBackend();
  const t = app.db.tables;
  t.Locations.push({ location_id: 'P1', name: 'Pantri 1', type: 'PANTRY', active: true });
  t.Items.push({ item_id: 'NB-001', name: 'Rice', active: true });
  t.Staff.push({ email: 'admin@uitm.edu.my', role: 'admin', active: true }, { email: 'staff@uitm.edu.my', role: 'staff', active: true });
  if (mode) t.Settings.push({ key: 'student_mode', value: mode });
  app.books[NAMELIST_ID] = { name: 'Namelist RESIDEN KOLEJ 20264', tabs: { Sheet1: LIST.map((r) => r.slice()) } };
  return app;
}

const post = (app, body) => JSON.parse(app.fn('doPost')({ postData: { contents: JSON.stringify(body) } }).text);
const visit = (student) => ({ visit_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), student, lines: [{ item_id: 'NB-001', qty: 1 }] });
const importAll = (app) => {
  app.user.email = 'admin@uitm.edu.my';
  return app.fn('adminImportNamelist')({ link: LINK, header_row: 3, id_col: 1, name_col: 2, college_col: 5 });
};

test('headers are recognised in BM and English; IC and phone columns are never taken', () => {
  const app = seeded();
  const kind = app.fn('classifyHeader_');
  assert.equal(kind('NO. PELAJAR'), 'id');
  assert.equal(kind('Student ID'), 'id');
  assert.equal(kind('No. Matrik'), 'id');
  assert.equal(kind('NAMA PELAJAR'), 'name');
  assert.equal(kind('Student Name'), 'name');
  assert.equal(kind('Nama Program'), 'program');
  assert.equal(kind('PROGRAM'), 'program');
  assert.equal(kind('KOLEJ'), 'college');
  assert.equal(kind('Nama Kolej'), 'college');
  assert.equal(kind('College'), 'college');
  assert.equal(kind('NO. KP'), 'never');
  assert.equal(kind('No. Kad Pengenalan'), 'never');
  assert.equal(kind('No. Tel'), 'never');
  assert.equal(kind('Hostel'), null);
});

test('the preview finds the header row and columns, and blanks out columns we must not take', () => {
  const app = seeded();
  app.user.email = 'admin@uitm.edu.my';
  const preview = app.fn('adminPreviewNamelist')({ link: LINK });
  assert.equal(preview.file_name, 'Namelist RESIDEN KOLEJ 20264');
  assert.equal(preview.header_row, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.columns)), { id: 1, name: 2, college: 5 });
  assert.equal(preview.total_rows, 5);
  assert.equal(preview.headers[3].allowed, false);
  assert.ok(preview.sample.every((row) => row[3] === '—'));
  assert.equal(JSON.stringify(preview).includes('050101-07-1234'), false);
});

test('only admins can preview or import, and the database itself cannot be used as a namelist', () => {
  const app = seeded();
  app.user.email = 'staff@uitm.edu.my';
  assert.throws(() => app.fn('adminPreviewNamelist')({ link: LINK }), /Only an admin/);
  app.user.email = 'admin@uitm.edu.my';
  app.properties.SPREADSHEET_ID = NAMELIST_ID;
  assert.throws(() => app.fn('adminPreviewNamelist')({ link: LINK }), /not the food bank database/);
  delete app.properties.SPREADSHEET_ID;
  assert.throws(() => app.fn('adminPreviewNamelist')({ link: 'https://example.com' }), /Paste the link/);
  assert.throws(() => app.fn('adminImportNamelist')({ link: LINK, header_row: 3, id_col: 3, name_col: 2 }), /Choose different columns/);
});

test('importing keeps ID, name and college, skips bad and repeated IDs, and switches to the namelist', () => {
  const app = seeded();
  const result = importAll(app);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    imported: 3, invalid: 1, duplicates: 1, removed: 0, kept_as_self: 0, file_name: 'Namelist RESIDEN KOLEJ 20264',
    other_colleges: [{ name: 'MUTIARA', students: 1 }],
  });
  const students = app.db.tables.Students;
  // Colleges are matched to the list; one that is not on it is kept as written and reported. No programme.
  assert.deepEqual(JSON.parse(JSON.stringify(students.map((s) => [s.student_id, s.name, s.college, s.program, s.source]))), [
    ['2024000001', 'AHMAD FAIZ BIN RAHMAN', 'Nilam', '', 'ROSTER'],
    ['2024000002', 'NUR AINA BINTI ISMAIL', 'Kristal A', '', 'ROSTER'],
    ['2024000003', 'LIM WEI JIE', 'MUTIARA', '', 'ROSTER'],
  ]);
  assert.equal(JSON.stringify(students).includes('CS230'), false);
  assert.equal(JSON.stringify(students).includes('050101'), false); // No IC numbers
  assert.equal(app.fn('getSettings_')().student_mode, 'ROSTER');
  assert.equal(app.fn('getSettings_')().namelist_id, NAMELIST_ID);
  assert.equal(app.db.tables.AuditLog[0].action, 'namelist_import');
});

test('re-importing keeps visit history, and handles students no longer on the list', () => {
  const app = seeded();
  const t = app.db.tables;
  t.Students.push(
    { student_key: app.fn('studentKey_')('2024000002'), student_id: '2024000002', name: 'Aina', college: 'Nilam', source: 'SELF', visit_count: 4 },
    { student_key: app.fn('studentKey_')('2023999998'), student_id: '2023999998', name: 'Old resident', source: 'ROSTER', visit_count: 0 },
    { student_key: app.fn('studentKey_')('2023999999'), student_id: '2023999999', name: 'Old visitor', source: 'ROSTER', visit_count: 2 },
    { student_key: app.fn('studentKey_')('2022000000'), student_id: '2022000000', name: 'Walk-in', college: 'Nilam', source: 'SELF', visit_count: 1 },
  );
  const result = importAll(app);
  assert.equal(result.removed, 1);
  assert.equal(result.kept_as_self, 1);
  const byId = Object.fromEntries(t.Students.map((s) => [s.student_id, s]));
  assert.equal(byId['2024000002'].source, 'ROSTER');
  assert.equal(byId['2024000002'].name, 'NUR AINA BINTI ISMAIL');
  assert.equal(byId['2024000002'].visit_count, 4);
  assert.equal(byId['2023999998'], undefined);
  assert.equal(byId['2023999999'].source, 'SELF');
  assert.equal(byId['2022000000'].source, 'SELF');
});

test('an ID on the namelist returns the name and college; any other ID is a non-resident not seen before', () => {
  const app = seeded();
  importAll(app);
  const found = post(app, { action: 'checkStudent', pantry_id: 'P1', payload: { id: '2024 000 002' } });
  assert.deepEqual(found.data, { mode: 'ROSTER', found: true, name: 'NUR AINA BINTI ISMAIL', college: 'Kristal A', on_namelist: true });
  const missing = post(app, { action: 'checkStudent', pantry_id: 'P1', payload: { id: '2021000000' } });
  assert.deepEqual(missing.data, { mode: 'ROSTER', found: false });
});

test('ID look-ups from students\' own phones are capped per minute; pantry devices are not', () => {
  const app = seeded();
  importAll(app);
  app.db.tables.Settings.push({ key: 'public_lookups_per_minute', value: '5' });
  for (let i = 0; i < 5; i++) assert.equal(post(app, { action: 'checkStudent', pantry_id: 'P1', payload: { id: '2024000001' } }).ok, true);
  assert.equal(post(app, { action: 'checkStudent', pantry_id: 'P1', payload: { id: '2024000001' } }).error.code, 'TOO_MANY_REQUESTS');

  app.user.email = 'staff@uitm.edu.my';
  const { code } = app.fn('staffCreateDeviceCode')({ location_id: 'P1', label: 'Laptop' });
  const device = post(app, { action: 'redeemSetupCode', payload: { code } }).data;
  const res = post(app, { action: 'checkStudent', device: { id: device.device_id, key: device.device_key }, payload: { id: '2024000001' } });
  assert.equal(res.data.found, true);
});

test('a student on the namelist checks out with only their ID; the namelist name is kept', () => {
  const app = seeded();
  importAll(app);
  const res = post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2024000001', consent: true }) });
  assert.equal(res.data.status, 'saved');
  assert.equal(app.db.tables.Visits[0].unverified_student, false);
  const student = app.db.tables.Students.find((s) => s.student_id === '2024000001');
  assert.equal(student.visit_count, 1);
  // A queued offline visit carries typed details; the namelist still wins.
  post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2024000001', name: 'Typed name', college: 'Nilam', consent: true }) });
  assert.equal(app.db.tables.Students.find((s) => s.student_id === '2024000001').name, 'AHMAD FAIZ BIN RAHMAN');
  assert.equal(post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2024000001' }) }).error.code, 'CONSENT_REQUIRED');
});

test('a student not on the namelist gives their details, and the visit is marked "not on namelist"', () => {
  const app = seeded();
  importAll(app);
  assert.equal(post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2021000000', consent: true }) }).error.code, 'NAME_REQUIRED');
  const res = post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2021000000', name: 'Walk In', college: 'Nilam', consent: true }) });
  assert.equal(res.data.status, 'saved');
  assert.equal(app.db.tables.Visits[0].unverified_student, true);
  assert.equal(app.db.tables.Students.find((s) => s.student_id === '2021000000').source, 'SELF');
});

test('a walk-in gives their name and college once, then is recognised by ID like a student on the namelist', () => {
  const app = seeded();
  importAll(app);
  post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2021000000', name: 'Walk In', college: 'NR', consent: true }) });
  const again = post(app, { action: 'checkStudent', pantry_id: 'P1', payload: { id: '2021000000' } });
  assert.deepEqual(again.data, { mode: 'ROSTER', found: true, name: 'Walk In', college: 'NR', on_namelist: false });
  const res = post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2021000000', consent: true }) });
  assert.equal(res.data.status, 'saved');
  const t = app.db.tables;
  assert.equal(t.Visits[1].unverified_student, true); // Still "not on namelist" in reports.
  const walkIn = () => t.Students.find((s) => s.student_id === '2021000000');
  assert.equal(walkIn().visit_count, 2);
  // A walk-in who later types different details (for example offline) updates them.
  post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2021000000', name: 'Walk In Bin Ali', college: 'Delima', consent: true }) });
  assert.deepEqual([walkIn().name, walkIn().college], ['Walk In Bin Ali', 'Delima']);
});

test('in self-registration mode nothing is looked up, so details are asked every visit', () => {
  const app = seeded();
  post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2021000000', name: 'Walk In', college: 'NR', consent: true }) });
  assert.deepEqual(post(app, { action: 'checkStudent', pantry_id: 'P1', payload: { id: '2021000000' } }).data, { mode: 'SELF' });
  assert.equal(post(app, { action: 'submitVisit', pantry_id: 'P1', payload: visit({ id: '2021000000', consent: true }) }).error.code, 'NAME_REQUIRED');
});
