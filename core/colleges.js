// Residential colleges, and NR for students who do not live in one (docs/DECISIONS.md 37).
// Shared by Apps Script, the browser, and Node tests. Students choose from this list, and the college column
// of an imported namelist is matched to it, so both give the same names.
var Colleges = (function () {
  'use strict';

  var NR = 'NR';
  var LIST = [
    { code: 'Nilam', ms: 'Nilam', en: 'Nilam' },
    { code: 'Zamrud', ms: 'Zamrud', en: 'Zamrud' },
    { code: 'Kristal A', ms: 'Kristal A', en: 'Kristal A' },
    { code: 'Kristal B', ms: 'Kristal B', en: 'Kristal B' },
    { code: 'Baiduri', ms: 'Baiduri', en: 'Baiduri' },
    { code: 'Delima', ms: 'Delima', en: 'Delima' },
    { code: 'Intan', ms: 'Intan', en: 'Intan' },
    { code: NR, ms: 'NR (Bukan residen)', en: 'NR (Non-resident)' },
  ];

  var squash = function (text) {
    return String(text == null ? '' : text).toUpperCase().replace(/[^A-Z0-9]+/g, '');
  };

  /**
   * The college in a namelist cell or a form, as its code ("Kristal A"), or '' if it is not one of ours.
   * Accepts the forms registrar lists use: "KOLEJ KEDIAMAN NILAM", "KK Kristal-A", "kristal a", "Bukan residen".
   */
  function match(raw) {
    var words = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    if (!words) return '';
    if (/^(NR|NON ?RESIDENTS?|NON ?RESIDEN|BUKAN RESIDEN|LUAR KAMPUS)$/.test(words)) return NR;
    var core = squash(words.replace(/\b(KOLEJ|KEDIAMAN|KK|RESIDENSI|ASRAMA)\b/g, ' '));
    for (var i = 0; i < LIST.length; i++) {
      if (squash(LIST[i].code) === core) return LIST[i].code;
    }
    return '';
  }

  /** "Kristal A" or "NR (Non-resident)" for screens and exports. */
  function label(code, lang) {
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].code === code) return lang === 'ms' ? LIST[i].ms : LIST[i].en;
    }
    return String(code == null ? '' : code);
  }

  return { NR: NR, LIST: LIST, match: match, label: label };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Colleges;
