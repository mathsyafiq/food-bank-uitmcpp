const test = require('node:test');
const assert = require('node:assert/strict');
const Qr = require('../core/qr.js');
const { readQr, zxingQr } = require('./support/zxing.js');

const LEVELS = ['L', 'M', 'Q', 'H'];
const countBytes = (version) => (version < 10 ? 2 : 3); // byte-mode header: 4-bit mode and 8- or 16-bit count
const filler = (length, seed) => Array.from({ length }, (_, i) => String.fromCharCode(97 + ((i * 7 + seed) % 26))).join('');

test('Reed-Solomon matches the published HELLO WORLD 1-M example', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(Qr.errorCorrection(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('format and version information match the standard tables', () => {
  assert.equal(Qr.formatBits('L', 0).toString(2).padStart(15, '0'), '111011111000100');
  assert.equal(Qr.formatBits('M', 0).toString(2).padStart(15, '0'), '101010000010010');
  assert.equal(Qr.formatBits('Q', 0).toString(2).padStart(15, '0'), '011010101011111');
  assert.equal(Qr.formatBits('H', 0).toString(2).padStart(15, '0'), '001011010001001');
  assert.equal(Qr.formatBits('M', 5).toString(2).padStart(15, '0'), '100000011001110');
  assert.equal(Qr.versionBits(7), 0x07c94);
  assert.equal(Qr.versionBits(40), 0x28c69);
});

test('capacity and alignment positions match the standard tables', () => {
  assert.deepEqual(LEVELS.map((l) => Qr.dataCodewords(1, l)), [19, 16, 13, 9]);
  assert.deepEqual(LEVELS.map((l) => Qr.dataCodewords(10, l)), [274, 216, 154, 122]);
  assert.deepEqual(LEVELS.map((l) => Qr.dataCodewords(40, l)), [2956, 2334, 1666, 1276]);
  assert.deepEqual(Qr.alignmentPositions(1), []);
  assert.deepEqual(Qr.alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(Qr.alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
});

test('every version and level matches ZXing\'s encoder module for module, including the mask', () => {
  for (const level of LEVELS) {
    for (let version = 1; version <= 40; version++) {
      // One byte under capacity: ZXing-JS moves up a version at exact capacity.
      const text = filler(Qr.dataCodewords(version, level) - countBytes(version) - 1, version);
      const ours = Qr.encode(text, level);
      const theirs = zxingQr(text, level);
      assert.equal(ours.version, version, level + version);
      assert.equal(ours.mask, theirs.mask, 'mask ' + level + version);
      assert.deepEqual(ours.modules, theirs.modules, 'modules ' + level + version);
    }
  }
});

test('a symbol filled to exact capacity at every version and level reads back', () => {
  for (const level of LEVELS) {
    for (let version = 1; version <= 40; version++) {
      const text = filler(Qr.dataCodewords(version, level) - countBytes(version), version);
      const qr = Qr.encode(text, level);
      assert.equal(qr.version, version);
      assert.deepEqual(readQr(qr.modules, { pure: true, scale: 1 }), { text, level });
    }
  }
});

test('the poster link is a small, sturdy code that a camera scanner finds at any print size', () => {
  const url = 'https://mathsyafiq.github.io/food-bank-uitmcpp/?p=P1';
  const qr = Qr.encode(url, 'Q');
  assert.equal(qr.version, 5);
  assert.equal(qr.size, 37);
  // From 2 pixels per module: at 1 pixel ZXing's finder search fails on some codes, even ZXing's own encoding of
  // this exact link. A printed poster is about 2.4 mm per module, which a phone camera sees as dozens of pixels.
  for (let scale = 2; scale <= 10; scale++) assert.deepEqual(readQr(qr.modules, { scale }), { text: url, level: 'Q' });
});

test('the level is raised when the same version has room, and UTF-8 text survives', () => {
  assert.equal(Qr.encode('P1', 'M').level, 'H');
  const text = 'Pantri 1 · Ambil apa yang anda perlukan';
  assert.equal(readQr(Qr.encode(text).modules, { pure: true }).text, text);
});

test('text too long for any QR code is refused', () => {
  assert.throws(() => Qr.encode('x'.repeat(3000), 'L'), /too long/);
  assert.throws(() => Qr.encode('x', 'Z'), /level/);
});
