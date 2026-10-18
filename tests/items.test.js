const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./fakes/apps-script.js');

function seeded() {
  const app = loadBackend();
  app.db.tables.Locations.push({ location_id: 'P1', name: 'Pantri 1', type: 'PANTRY', active: true });
  app.db.tables.Staff.push(
    { email: 'admin@uitm.edu.my', role: 'admin', active: true },
    { email: 'staff@uitm.edu.my', role: 'staff', active: true },
  );
  app.user.email = 'staff@uitm.edu.my';
  return app;
}

const save = (app, form) => app.fn('staffSaveItem')(Object.assign({ name: 'Beras 5kg', category: '', unit: '', sort_order: '', active: true }, form));

test('lists are split on commas, trimmed, without blanks or repeats', () => {
  const app = seeded();
  assert.deepEqual(Array.from(app.fn('listSetting_')(' Makanan ,Minuman,, Makanan , Kebersihan  diri ')), ['Makanan', 'Minuman', 'Kebersihan diri']);
});

test('staff get the category and unit lists, with defaults before an admin changes them', () => {
  const app = seeded();
  const boot = app.fn('staffBootstrap')();
  assert.deepEqual(Array.from(boot.item_categories), ['Makanan', 'Minuman', 'Kebersihan diri', 'Lain-lain']);
  assert.ok(boot.item_units.includes('botol'));
});

test('an item takes its category and unit from the lists, or leaves them blank', () => {
  const app = seeded();
  assert.equal(save(app, { category: 'Makanan', unit: 'pek' }).item_id, 'NB-001');
  assert.equal(save(app, { name: 'Roti' }).item_id, 'NB-002');
  assert.throws(() => save(app, { name: 'Gula', category: 'Groceries' }), /Choose the category and unit from the lists/);
  assert.throws(() => save(app, { name: 'Gula', unit: 'sack' }), /Choose the category and unit from the lists/);
});

test('an item keeps a value an admin later removed from the list, but cannot switch to another unlisted one', () => {
  const app = seeded();
  app.db.tables.Settings.push({ key: 'item_units', value: 'pek, guni' });
  save(app, { unit: 'guni' });
  app.db.tables.Settings[0].value = 'pek, botol';
  assert.equal(save(app, { item_id: 'NB-001', name: 'Beras 10kg', unit: 'guni' }).item_id, 'NB-001');
  assert.equal(app.db.tables.Items[0].name, 'Beras 10kg');
  assert.throws(() => save(app, { item_id: 'NB-001', unit: 'karung' }), /Choose the category and unit/);
});

test('admins can change the lists; bad lists are refused', () => {
  const app = seeded();
  app.user.email = 'admin@uitm.edu.my';
  app.fn('adminSaveSettings')({ item_categories: 'Makanan, Minuman, Pakaian' });
  app.user.email = 'staff@uitm.edu.my';
  assert.ok(app.fn('staffBootstrap')().item_categories.includes('Pakaian'));
  app.user.email = 'admin@uitm.edu.my';
  assert.throws(() => app.fn('adminSaveSettings')({ item_units: '' }), /settings is not valid/);
  assert.throws(() => app.fn('adminSaveSettings')({ item_units: '=HYPERLINK("x")' }), /settings is not valid/);
  assert.throws(() => app.fn('adminSaveSettings')({ item_units: 'a'.repeat(31) }), /settings is not valid/);
});
