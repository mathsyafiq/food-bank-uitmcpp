const test = require('node:test');
const assert = require('node:assert/strict');
const Gtin = require('../core/gtin.js');

test('check digits match published examples for each length', () => {
  assert.equal(Gtin.checkDigit('400638133393'), 1); // EAN-13 4006381333931
  assert.equal(Gtin.checkDigit('03600029145'), 2); // UPC-A 036000291452
  assert.equal(Gtin.checkDigit('9638507'), 4); // EAN-8 96385074
});

test('every GTIN length normalises to 14 digits', () => {
  assert.equal(Gtin.normalise('4006381333931'), '04006381333931');
  assert.equal(Gtin.normalise('036000291452'), '00036000291452');
  assert.equal(Gtin.normalise('96385074'), '00000096385074');
  assert.equal(Gtin.normalise('00036000291452'), '00036000291452');
});

test('UPC-A and the same code read as EAN-13 match', () => {
  assert.equal(Gtin.normalise('036000291452'), Gtin.normalise('0036000291452'));
});

test('scanner whitespace is ignored', () => {
  assert.equal(Gtin.normalise('  4006381333931\n'), '04006381333931');
});

test('invalid codes are rejected', () => {
  assert.equal(Gtin.normalise('4006381333932'), null); // wrong check digit
  assert.equal(Gtin.normalise('40063813339'), null); // 11 digits
  assert.equal(Gtin.normalise('ABC123'), null);
  assert.equal(Gtin.normalise(''), null);
  assert.equal(Gtin.normalise(null), null);
});

test('internal codes are recognised and upper-cased', () => {
  assert.equal(Gtin.internalCode('nb-001'), 'NB-001');
  assert.equal(Gtin.internalCode('NB-0042'), 'NB-0042');
  assert.equal(Gtin.internalCode('NB-1'), null);
  assert.equal(Gtin.internalCode('XX-001'), null);
});

test('lookup key prefers GTIN, then internal code, then raw digits', () => {
  assert.equal(Gtin.lookupKey('4006381333931'), '04006381333931');
  assert.equal(Gtin.lookupKey('nb-001'), 'NB-001');
  assert.equal(Gtin.lookupKey('04252614'), '04252614'); // UPC-E: not a valid EAN-8, kept as scanned
  assert.equal(Gtin.lookupKey('hello'), null);
  assert.equal(Gtin.lookupKey('12345'), null);
});
