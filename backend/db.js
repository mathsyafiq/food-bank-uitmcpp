// Sheet access. Every read and write goes through here, so tests can swap in an in-memory fake
// with the same functions (tests/fakes/apps-script.js).
const Db = (() => {
  let book = null;
  const memo = {};

  function spreadsheet() {
    if (!book) {
      const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
      book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
      if (!book) throw new Error('Spreadsheet not found. Run setup() from the Apps Script editor.');
    }
    return book;
  }

  function sheet(name) {
    const s = spreadsheet().getSheetByName(name);
    if (!s) throw new Error('Missing tab "' + name + '". Run setup() from the Apps Script editor.');
    return s;
  }

  function columns(name) {
    if (!SCHEMA[name]) throw new Error('Unknown tab ' + name);
    return SCHEMA[name];
  }

  function column(name, field) {
    const index = columns(name).indexOf(field);
    if (index < 0) throw new Error('Unknown column ' + name + '.' + field);
    return index + 1;
  }

  function toObject(name, values, rowNumber) {
    const obj = { _row: rowNumber };
    columns(name).forEach((field, i) => { obj[field] = values[i]; });
    return obj;
  }

  function toValues(name, obj) {
    return columns(name).map((field) => (obj[field] === undefined || obj[field] === null ? '' : obj[field]));
  }

  /** Every row as an object with _row, its row number. Kept for this execution until the tab is written. */
  function read(name) {
    if (!memo[name]) {
      const s = sheet(name);
      const last = s.getLastRow();
      const values = last < 2 ? [] : s.getRange(2, 1, last - 1, columns(name).length).getValues();
      memo[name] = values.map((row, i) => toObject(name, row, i + 2));
    }
    return memo[name];
  }

  /** Only some columns of every row, for big tabs such as Transactions. */
  function readColumns(name, fields) {
    const s = sheet(name);
    const last = s.getLastRow();
    if (last < 2) return [];
    const indexes = fields.map((f) => column(name, f));
    const first = Math.min.apply(null, indexes);
    const width = Math.max.apply(null, indexes) - first + 1;
    return s.getRange(2, first, last - 1, width).getValues().map((row, i) => {
      const obj = { _row: i + 2 };
      fields.forEach((f, j) => { obj[f] = row[indexes[j] - first]; });
      return obj;
    });
  }

  function readRow(name, rowNumber) {
    const values = sheet(name).getRange(rowNumber, 1, 1, columns(name).length).getValues()[0];
    return toObject(name, values, rowNumber);
  }

  function ensureRows(s, lastNeeded) {
    const max = s.getMaxRows();
    if (lastNeeded > max) s.insertRowsAfter(max, lastNeeded - max + 500);
  }

  function append(name, objects) {
    if (!objects.length) return;
    const s = sheet(name);
    const start = s.getLastRow() + 1;
    ensureRows(s, start + objects.length - 1);
    s.getRange(start, 1, objects.length, columns(name).length).setValues(objects.map((o) => toValues(name, o)));
    delete memo[name];
  }

  /** Writes a whole row back; obj._row says which. */
  function writeRow(name, obj) {
    sheet(name).getRange(obj._row, 1, 1, columns(name).length).setValues([toValues(name, obj)]);
    delete memo[name];
  }

  /** Replaces every data row, for small tabs such as Stock. */
  function writeAll(name, objects) {
    const s = sheet(name);
    const width = columns(name).length;
    const oldLast = s.getLastRow();
    if (objects.length) {
      ensureRows(s, objects.length + 1);
      s.getRange(2, 1, objects.length, width).setValues(objects.map((o) => toValues(name, o)));
    }
    if (oldLast > objects.length + 1) s.getRange(objects.length + 2, 1, oldLast - objects.length - 1, width).clearContent();
    delete memo[name];
  }

  /** Replaces one column for rows 2 onward. values[i] goes to row i + 2. */
  function writeColumn(name, field, values) {
    if (!values.length) return;
    sheet(name).getRange(2, column(name, field), values.length, 1).setValues(values.map((v) => [v]));
    delete memo[name];
  }

  function finder(name, field, value) {
    const s = sheet(name);
    const last = s.getLastRow();
    if (last < 2 || value === '' || value === null || value === undefined) return null;
    return s.getRange(2, column(name, field), last - 1, 1)
      .createTextFinder(String(value)).matchEntireCell(true).matchCase(true);
  }

  /** Row number of the first exact match in a column, or null. */
  function findRow(name, field, value) {
    const f = finder(name, field, value);
    const cell = f && f.findNext();
    return cell ? cell.getRow() : null;
  }

  function findRows(name, field, value) {
    const f = finder(name, field, value);
    return f ? f.findAll().map((cell) => cell.getRow()) : [];
  }

  function deleteRows(name, rowNumbers) {
    const s = sheet(name);
    const sorted = rowNumbers.slice().sort((a, b) => b - a);
    let i = 0;
    while (i < sorted.length) {
      // Delete runs of neighbouring rows in one call, bottom first.
      let count = 1;
      while (i + count < sorted.length && sorted[i + count] === sorted[i] - count) count++;
      s.deleteRows(sorted[i] - count + 1, count);
      i += count;
    }
    delete memo[name];
  }

  /**
   * Rows whose time column falls in [from, to). Only for tabs written in time order (Transactions and
   * Visits by recorded_at), so a binary search finds the slice without reading every row.
   */
  function slice(name, field, from, to) {
    const s = sheet(name);
    const last = s.getLastRow();
    if (last < 2) return [];
    const times = s.getRange(2, column(name, field), last - 1, 1).getValues().map((r) => new Date(r[0]).getTime());
    const lowerBound = (t) => {
      let lo = 0;
      let hi = times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < t) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    const start = lowerBound(from.getTime());
    const end = lowerBound(to.getTime());
    if (end <= start) return [];
    return s.getRange(start + 2, 1, end - start, columns(name).length).getValues()
      .map((row, i) => toObject(name, row, start + 2 + i));
  }

  /** Runs fn while holding the script lock, so writes never interleave. */
  function withLock(fn) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new ApiError('BUSY');
    try {
      forget(); // Re-read anything another execution may have changed while we waited.
      const result = fn();
      SpreadsheetApp.flush();
      return result;
    } finally {
      lock.releaseLock();
    }
  }

  function forget() {
    Object.keys(memo).forEach((k) => { delete memo[k]; });
  }

  return {
    spreadsheet, read, readColumns, readRow, append, writeRow, writeAll, writeColumn,
    findRow, findRows, deleteRows, slice, withLock, forget,
  };
})();
