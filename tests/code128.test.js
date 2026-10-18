const test = require('node:test');
const assert = require('node:assert/strict');
const Code128 = require('../core/code128.js');
const Gtin = require('../core/gtin.js');
const { readCode128 } = require('./support/zxing.js');

const width = (pattern) => pattern.split('').reduce((sum, w) => sum + Number(w), 0);

test('the pattern table has 107 distinct symbols of 11 modules, and a 13-module Stop', () => {
  assert.equal(Code128.PATTERNS.length, 107);
  assert.equal(new Set(Code128.PATTERNS).size, 107);
  Code128.PATTERNS.slice(0, 106).forEach((p, i) => assert.equal(width(p), 11, 'symbol ' + i));
  assert.equal(width(Code128.PATTERNS[106]), 13);
});

test('NB-001 has the expected symbols and check value', () => {
  // Start B, N B - 0 0 1, check (104 + 46 + 2*34 + 3*13 + 4*16 + 5*16 + 6*17) % 103 = 91, Stop.
  assert.deepEqual(Code128.values('NB-001'), [104, 46, 34, 13, 16, 16, 17, 91, 106]);
  const bars = Code128.encode('NB-001');
  assert.equal(bars.length, 101);
  assert.equal(bars.slice(0, 11), '11010010000'); // Start B
  assert.equal(bars.slice(-13), '1100011101011'); // Stop
});

test('labels read back as the internal code the student app looks up', () => {
  for (const code of ['NB-001', 'NB-042', 'NB-999', 'NB-1234']) {
    for (const scale of [1, 2, 3]) {
      const read = readCode128(Code128.encode(code), scale);
      assert.equal(read, code);
      assert.equal(Gtin.lookupKey(read), code);
    }
  }
});

test('every printable ASCII character encodes and reads back', () => {
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  assert.equal(readCode128(Code128.encode(ascii)), ascii);
});

test('empty or non-ASCII text is refused', () => {
  assert.throws(() => Code128.encode(''), /printable ASCII/);
  assert.throws(() => Code128.encode('Beras ½'), /printable ASCII/);
  assert.throws(() => Code128.encode('NB-001\n'), /printable ASCII/);
});
