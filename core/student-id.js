// Student ID rules. Shared by Apps Script, the browser, and Node tests.
// The format pattern lives in Settings (student_id_pattern) so it can change without a code release.
var StudentId = (function () {
  'use strict';

  var DEFAULT_PATTERN = '^\\d{10}$';

  function normalise(raw) {
    return String(raw == null ? '' : raw).replace(/[\s-]/g, '').toUpperCase();
  }

  function isValid(raw, pattern) {
    return new RegExp(pattern || DEFAULT_PATTERN).test(normalise(raw));
  }

  /** Shows only the first 4 and last 2 characters, for example 2023••••89. */
  function mask(raw) {
    var id = normalise(raw);
    if (id.length <= 6) return '••••';
    return id.slice(0, 4) + '•'.repeat(id.length - 6) + id.slice(-2);
  }

  return { DEFAULT_PATTERN: DEFAULT_PATTERN, normalise: normalise, isValid: isValid, mask: mask };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = StudentId;
