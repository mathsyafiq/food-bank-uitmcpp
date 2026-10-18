// Loads the backend into a Node VM with in-memory stand-ins for Apps Script services and the Sheet.
// The fake Db has the same functions as backend/db.js, so backend code runs unchanged.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['db.js', 'spike.js']);
const OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Kuala_Lumpur has no daylight saving.

const signed = (buffer) => Array.from(buffer).map((b) => (b > 127 ? b - 256 : b));
const pad = (n, width = 2) => String(n).padStart(width, '0');

function formatDate(date, tz, pattern) {
  const d = new Date(date.getTime() + OFFSET_MS);
  return pattern
    .replace('yyyy', d.getUTCFullYear())
    .replace('MM', pad(d.getUTCMonth() + 1))
    .replace('dd', pad(d.getUTCDate()))
    .replace('HH', pad(d.getUTCHours()))
    .replace('mm', pad(d.getUTCMinutes()))
    .replace('ss', pad(d.getUTCSeconds()));
}

function createFakeDb(schema) {
  const tables = {};
  Object.keys(schema).forEach((name) => { tables[name] = []; });
  const norm = (name, obj) => {
    const out = {};
    schema[name].forEach((c) => { out[c] = obj[c] === undefined || obj[c] === null ? '' : obj[c]; });
    return out;
  };
  const withRow = (r, i) => Object.assign({ _row: i + 2 }, r);
  const time = (v) => new Date(v).getTime();
  return {
    tables,
    spreadsheet: () => null,
    read: (n) => tables[n].map(withRow),
    readColumns: (n, fields) => tables[n].map((r, i) => {
      const o = { _row: i + 2 };
      fields.forEach((f) => { o[f] = r[f]; });
      return o;
    }),
    readRow: (n, row) => withRow(tables[n][row - 2], row - 2),
    append: (n, objs) => objs.forEach((o) => tables[n].push(norm(n, o))),
    writeRow: (n, obj) => { tables[n][obj._row - 2] = norm(n, obj); },
    writeAll: (n, objs) => { tables[n] = objs.map((o) => norm(n, o)); },
    writeColumn: (n, f, values) => values.forEach((v, i) => { tables[n][i][f] = v; }),
    findRow: (n, f, v) => {
      if (v === '' || v === null || v === undefined) return null;
      const i = tables[n].findIndex((r) => String(r[f]) === String(v));
      return i < 0 ? null : i + 2;
    },
    findRows: (n, f, v) => tables[n].map((r, i) => (String(r[f]) === String(v) ? i + 2 : 0)).filter(Boolean),
    deleteRows: (n, rows) => rows.slice().sort((a, b) => b - a).forEach((r) => tables[n].splice(r - 2, 1)),
    slice: (n, f, from, to) => tables[n].map(withRow).filter((r) => time(r[f]) >= from.getTime() && time(r[f]) < to.getTime()),
    withLock: (fn) => fn(),
    forget: () => {},
  };
}

function loadBackend() {
  const user = { email: '' };
  const properties = {};
  const cache = {};
  const mail = [];
  const context = {
    console: { log() {}, error() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, text) => signed(crypto.createHash(alg).update(text, 'utf8').digest()),
      computeHmacSha256Signature: (text, key) => signed(crypto.createHmac('sha256', key).update(text, 'utf8').digest()),
      formatDate,
      parseDate: (text) => {
        const [y, m, d] = text.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in properties ? properties[k] : null),
        setProperty: (k, v) => { properties[k] = String(v); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: (k) => { delete cache[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
    Session: {
      getActiveUser: () => ({ getEmail: () => user.email }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@uitm.edu.my' }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    MailApp: { sendEmail: (msg) => mail.push(msg) },
    ScriptApp: { getProjectTriggers: () => [] },
  };
  vm.createContext(context);
  const run = (code) => vm.runInContext(code, context);
  for (const dir of ['core', 'backend']) {
    for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js') && !SKIP.has(f)).sort()) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, dir, file), 'utf8'), context, { filename: `${dir}/${file}` });
    }
  }
  const db = createFakeDb(run('SCHEMA'));
  context.Db = db;
  properties.STUDENT_HMAC_KEY = 'test-secret-key';
  return { run, db, user, mail, cache, properties, fn: (name) => run(name) };
}

module.exports = { loadBackend };
