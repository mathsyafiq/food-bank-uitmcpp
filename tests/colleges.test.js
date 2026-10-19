const test = require('node:test');
const assert = require('node:assert/strict');
const Colleges = require('../core/colleges.js');

test('the eight choices are the residential colleges and NR', () => {
  assert.deepEqual(Colleges.LIST.map((c) => c.code), ['Nilam', 'Zamrud', 'Kristal A', 'Kristal B', 'Baiduri', 'Delima', 'Intan', 'NR']);
});

test('namelist spellings match the same college', () => {
  assert.equal(Colleges.match('NILAM'), 'Nilam');
  assert.equal(Colleges.match('Kolej Kediaman Zamrud'), 'Zamrud');
  assert.equal(Colleges.match('KK KRISTAL-A'), 'Kristal A');
  assert.equal(Colleges.match('kristal b'), 'Kristal B');
  assert.equal(Colleges.match('KRISTALB'), 'Kristal B');
  assert.equal(Colleges.match(' Intan '), 'Intan');
  assert.equal(Colleges.match('NR'), 'NR');
  assert.equal(Colleges.match('Non-Resident'), 'NR');
  assert.equal(Colleges.match('BUKAN RESIDEN'), 'NR');
});

test('anything else is not a college', () => {
  assert.equal(Colleges.match(''), '');
  assert.equal(Colleges.match('Kristal'), '');
  assert.equal(Colleges.match('Mutiara'), '');
  assert.equal(Colleges.match(null), '');
});

test('labels for screens', () => {
  assert.equal(Colleges.label('NR', 'en'), 'NR (Non-resident)');
  assert.equal(Colleges.label('NR', 'ms'), 'NR (Bukan residen)');
  assert.equal(Colleges.label('Delima', 'en'), 'Delima');
  assert.equal(Colleges.label('Something old', 'en'), 'Something old');
});
