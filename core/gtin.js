// Barcode rules. Shared by Apps Script, the browser, and Node tests (see docs/PLAN.md section 2).
// GTINs (EAN-8, UPC-A, EAN-13, GTIN-14) are stored as 14 digits so every length of the same code matches.
var Gtin = (function () {
  'use strict';

  var INTERNAL = /^NB-\d{3,}$/;

  /** GS1 mod-10 check digit for the digits before the check digit. */
  function checkDigit(body) {
    var sum = 0;
    for (var i = 0; i < body.length; i++) {
      var digit = body.charCodeAt(body.length - 1 - i) - 48;
      sum += digit * (i % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10;
  }

  /** Returns the 14-digit GTIN for a scanned or typed code, or null if it is not a valid GTIN. */
  function normalise(raw) {
    var code = String(raw == null ? '' : raw).trim();
    if (!/^\d+$/.test(code)) return null;
    if ([8, 12, 13, 14].indexOf(code.length) === -1) return null;
    if (checkDigit(code.slice(0, -1)) !== Number(code.slice(-1))) return null;
    return ('00000000000000' + code).slice(-14);
  }

  /** Internal item codes such as NB-001, printed as labels for items without a barcode. */
  function internalCode(raw) {
    var code = String(raw == null ? '' : raw).trim().toUpperCase();
    return INTERNAL.test(code) ? code : null;
  }

  /**
   * The key used to look up a scanned code: a 14-digit GTIN, an internal code, or, for other
   * numeric formats such as UPC-E, the digits as scanned. Returns null for anything else.
   */
  function lookupKey(raw) {
    var gtin = normalise(raw);
    if (gtin) return gtin;
    var internal = internalCode(raw);
    if (internal) return internal;
    var digits = String(raw == null ? '' : raw).trim();
    return /^\d{6,14}$/.test(digits) ? digits : null;
  }

  return { checkDigit: checkDigit, normalise: normalise, internalCode: internalCode, lookupKey: lookupKey };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Gtin;
