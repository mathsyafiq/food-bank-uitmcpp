const test = require('node:test');
const assert = require('node:assert/strict');
const Names = require('../core/names.js');

test('names in capitals are shown in title case, with bin, binti, a/l and a/p in lower case', () => {
  assert.equal(Names.display('AHMAD FAIZ BIN RAHMAN'), 'Ahmad Faiz bin Rahman');
  assert.equal(Names.display('NUR AINA BINTI ISMAIL'), 'Nur Aina binti Ismail');
  assert.equal(Names.display('RAJ KUMAR A/L SUBRAMANIAM'), 'Raj Kumar a/l Subramaniam');
  assert.equal(Names.display('MUHAMMAD AL-AMIN'), 'Muhammad Al-Amin');
  assert.equal(Names.display('  LIM   WEI JIE '), 'Lim Wei Jie');
});

test('names already in mixed case are left as written', () => {
  assert.equal(Names.display('Siti Nur Aisyah binti Abu'), 'Siti Nur Aisyah binti Abu');
  assert.equal(Names.display('McDonald'), 'McDonald');
});

test('empty names stay empty', () => {
  assert.equal(Names.display(''), '');
  assert.equal(Names.display(null), '');
});
