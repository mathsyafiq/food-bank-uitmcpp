const test = require('node:test');
const assert = require('node:assert/strict');
const StudentId = require('../core/student-id.js');

test('spaces and dashes are removed', () => {
  assert.equal(StudentId.normalise(' 2023-123 456 '), '2023123456');
});

test('default format is 10 digits', () => {
  assert.equal(StudentId.isValid('2023123456'), true);
  assert.equal(StudentId.isValid('202312345'), false);
  assert.equal(StudentId.isValid('20231234567'), false);
  assert.equal(StudentId.isValid('2023A23456'), false);
});

test('a custom pattern from Settings is used when given', () => {
  assert.equal(StudentId.isValid('AB12345', '^[A-Z]{2}\\d{5}$'), true);
  assert.equal(StudentId.isValid('2023123456', '^[A-Z]{2}\\d{5}$'), false);
});

test('masking hides the middle of the ID', () => {
  assert.equal(StudentId.mask('2023123489'), '2023••••89');
  assert.equal(StudentId.mask('123'), '••••');
});

test('a scanned student card QR link gives just the student ID', () => {
  assert.equal(StudentId.fromScan('2023123456'), '2023123456');
  assert.equal(StudentId.fromScan(' 2023-123-456 '), '2023123456');
  assert.equal(StudentId.fromScan('https://example.uitm.edu.my/verify?id=2023123456'), '2023123456');
  assert.equal(StudentId.fromScan('https://example.uitm.edu.my/card/2023123456'), '2023123456');
  assert.equal(StudentId.fromScan('https://example.uitm.edu.my/v.php?t=1729312345&nopelajar=2023123456'), '2023123456');
  assert.equal(StudentId.fromScan('https://example.uitm.edu.my/s?matric%5Fno=2023123456&lang=ms'), '2023123456');
  assert.equal(StudentId.fromScan('https://example.uitm.edu.my/verify?token=abc'), '');
  assert.equal(StudentId.fromScan(''), '');
  assert.equal(StudentId.fromScan('https://x.test/AB12345/view', '^[A-Z]{2}\\d{5}$'), 'AB12345');
});
