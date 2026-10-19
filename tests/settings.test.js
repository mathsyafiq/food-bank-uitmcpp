const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./fakes/apps-script.js');

function seeded() {
  const app = loadBackend();
  app.db.tables.Staff.push({ email: 'admin@uitm.edu.my', role: 'admin', active: true });
  app.user.email = 'admin@uitm.edu.my';
  return app;
}

const pwaDefault = (app) => app.run('APP_URLS').pwa;
const storedPwa = (app) => (app.db.tables.Settings.find((r) => r.key === 'pwa_url') || {}).value;

test('a blank student app link follows the default address', () => {
  const app = seeded();
  assert.equal(app.fn('getSettings_')().pwa_url, pwaDefault(app));
  assert.match(pwaDefault(app), /food-bank-uitmcpp\/$/);
});

test('a link still holding the old address follows the new default', () => {
  const app = seeded();
  app.db.tables.Settings.push({ key: 'pwa_url', value: 'https://mathsyafiq.github.io/food-bank-urhp/' });
  assert.equal(app.fn('getSettings_')().pwa_url, pwaDefault(app));
  app.db.tables.Settings[0].value = 'https://mathsyafiq.github.io/food-bank-urhp';
  assert.equal(app.fn('getSettings_')().pwa_url, pwaDefault(app));
});

test('a link an admin chose on purpose is kept', () => {
  const app = seeded();
  app.db.tables.Settings.push({ key: 'pwa_url', value: 'https://foodbank.example.edu.my/' });
  assert.equal(app.fn('getSettings_')().pwa_url, 'https://foodbank.example.edu.my/');
});

test('saving the Setup form with the default link stores it blank, so it keeps following the default', () => {
  const app = seeded();
  app.fn('adminSaveSettings')({ pwa_url: pwaDefault(app), staff_url: app.run('APP_URLS').staff, thanks_seconds: '6' });
  assert.equal(storedPwa(app), '');
  assert.equal(app.db.tables.Settings.find((r) => r.key === 'staff_url').value, '');
  assert.equal(app.fn('getSettings_')().thanks_seconds, 6);
  app.fn('adminSaveSettings')({ pwa_url: 'https://foodbank.example.edu.my/' });
  assert.equal(storedPwa(app), 'https://foodbank.example.edu.my/');
});
