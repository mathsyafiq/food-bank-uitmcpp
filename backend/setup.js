// One-time setup. In the Apps Script editor, choose "setup" in the function list and click Run.
// Google asks the owner to approve the permissions the first time. Safe to run again: it only adds what is missing.

function setup() {
  const me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!me || me !== owner) throw new Error('Run setup() from the Apps Script editor, signed in as the owner.');
  const book = SpreadsheetApp.getActive();
  if (!book) throw new Error('Open the script from the spreadsheet (Extensions > Apps Script), then run setup again.');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', book.getId());
  if (!props.getProperty('STUDENT_HMAC_KEY')) props.setProperty('STUDENT_HMAC_KEY', randomHex_(64));

  Object.keys(SCHEMA).forEach((name) => ensureTab_(book, name));
  removeBlankDefaultTab_(book);
  Db.forget();
  seedDefaults_(owner);
  protectTabs_(book, owner);
  installTriggers_();
  console.log('Setup complete for ' + book.getName());
  return 'Setup complete';
}

function ensureTab_(book, name) {
  const columns = SCHEMA[name];
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  const header = sheet.getRange(1, 1, 1, columns.length);
  const current = header.getValues()[0];
  if (current.every((v) => v === '')) {
    header.setValues([columns]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (current.join('|') !== columns.join('|')) {
    throw new Error('Tab "' + name + '" has unexpected headers. Expected: ' + columns.join(', '));
  }
  columns.forEach((field, i) => {
    if (TEXT_COLUMNS.indexOf(field) >= 0) sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  });
}

function removeBlankDefaultTab_(book) {
  ['Sheet1', 'Helaian1'].forEach((name) => {
    const sheet = book.getSheetByName(name);
    if (sheet && !SCHEMA[name] && sheet.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(sheet);
  });
}

function seedDefaults_(owner) {
  const settings = Db.read('Settings').map((r) => String(r.key).trim());
  // The two links start blank, so they follow APP_URLS in backend/config.js.
  const missing = Object.keys(DEFAULT_SETTINGS).filter((k) => settings.indexOf(k) < 0).map((k) => ({
    key: k,
    value: String(DEFAULT_SETTINGS[k]),
  }));
  Db.append('Settings', missing);

  if (!Db.read('Locations').length) {
    Db.append('Locations', [
      { location_id: 'S1', name: 'Stor Pusat (Central Store)', type: 'STORE', active: true },
      { location_id: 'P1', name: 'Pantri 1', type: 'PANTRY', active: true },
    ]);
  }
  if (!Db.read('Faculties').length) {
    Db.append('Faculties', [{ faculty_code: 'OTHER', name_ms: 'Lain-lain', name_en: 'Other', active: true }]);
  }
  const admins = Db.read('Staff').filter((s) => truthy_(s.active) && String(s.role).toLowerCase() === 'admin');
  if (!admins.length) {
    Db.append('Staff', [{ email: owner, name: '', role: 'admin', receives_alerts: true, active: true }]);
  }
}

/** Ledger and personal-data tabs: owner only. Setup tabs: a warning before any direct edit. */
function protectTabs_(book, owner) {
  Object.keys(SCHEMA).forEach((name) => {
    const sheet = book.getSheetByName(name);
    if (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
    const protection = sheet.protect().setDescription('Food Bank: use the staff app to change this tab');
    if (LOCKED_TABS.indexOf(name) >= 0) {
      protection.addEditor(owner);
      protection.removeEditors(protection.getEditors().filter((u) => u.getEmail().toLowerCase() !== owner));
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
    } else {
      protection.setWarningOnly(true);
    }
  });
}
