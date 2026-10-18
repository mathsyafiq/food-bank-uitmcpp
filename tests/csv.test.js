const test = require('node:test');
const assert = require('node:assert/strict');
const Csv = require('../core/csv.js');

test('cells with commas, quotes or new lines are quoted', () => {
  assert.equal(Csv.stringify([['a,b', 'say "hi"', 'two\nlines', 'plain']]), '"a,b","say ""hi""","two\nlines",plain');
});

test('text that looks like a formula is neutralised; numbers are left alone', () => {
  assert.equal(Csv.cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(Csv.cell('@SUM'), "'@SUM");
  assert.equal(Csv.cell(-3), '-3');
});

test('empty values become empty cells and rows are joined with CRLF', () => {
  assert.equal(Csv.stringify([['h1', 'h2'], [null, undefined]]), 'h1,h2\r\n,');
});
