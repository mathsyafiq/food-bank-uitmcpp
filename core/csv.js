// CSV export for staff reports. Shared by Apps Script and Node tests.
var Csv = (function () {
  'use strict';

  function cell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    var text = value instanceof Date ? value.toISOString() : String(value);
    // Stop spreadsheet apps from running a cell as a formula when the file is opened.
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  /** rows: array of arrays, header row first. */
  function stringify(rows) {
    return rows.map(function (row) { return row.map(cell).join(','); }).join('\r\n');
  }

  return { cell: cell, stringify: stringify };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Csv;
