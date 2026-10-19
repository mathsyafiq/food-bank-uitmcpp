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

  function decode(text) {
    try {
      return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch (err) {
      return text;
    }
  }

  /**
   * The student ID in what a scanner typed: the ID itself, or the ID inside a link, which is what the QR code on
   * a student card holds (for example https://…/?id=2023123456). Link parameters named like an ID come first,
   * then other parameters, then the rest of the link, so a timestamp elsewhere in the link is not taken for an ID.
   * Returns '' when there is no ID in the text.
   */
  function fromScan(raw, pattern) {
    var text = String(raw == null ? '' : raw).trim();
    if (isValid(text, pattern)) return normalise(text);
    var re = new RegExp(pattern || DEFAULT_PATTERN);
    var named = [];
    var other = [];
    text.split(/[?#]/).slice(1).join('&').split(/[&;]/).forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at < 0) return;
      var value = decode(pair.slice(at + 1));
      (/id|matri|pelajar|student|nopel|stud/i.test(pair.slice(0, at)) ? named : other).push(value);
    });
    var rest = text.split(/[^A-Za-z0-9]+/);
    var candidates = named.concat(other, rest);
    for (var i = 0; i < candidates.length; i++) {
      if (re.test(normalise(candidates[i]))) return normalise(candidates[i]);
    }
    return '';
  }

  return { DEFAULT_PATTERN: DEFAULT_PATTERN, normalise: normalise, isValid: isValid, mask: mask, fromScan: fromScan };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = StudentId;
