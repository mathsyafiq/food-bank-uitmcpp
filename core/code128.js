// Code 128 encoder for the internal item labels (NB-001 and so on). Shared by Apps Script and Node tests.
// Uses code set B, which covers every printable ASCII character.
var Code128 = (function () {
  'use strict';

  // Bar and space widths for symbol values 0 to 106, starting with a bar. 103 to 105 are Start A, B, C; 106 is Stop.
  var PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
  ];
  var START_B = 104;
  var STOP = 106;

  /** Symbol values: Start B, one per character, the mod-103 check value, and Stop. */
  function values(text) {
    text = String(text == null ? '' : text);
    if (!/^[\x20-\x7e]+$/.test(text)) throw new Error('A Code 128 label needs printable ASCII text.');
    var out = [START_B];
    var sum = START_B;
    for (var i = 0; i < text.length; i++) {
      var value = text.charCodeAt(i) - 32;
      out.push(value);
      sum += value * (i + 1);
    }
    out.push(sum % 103, STOP);
    return out;
  }

  /** The barcode as a string of modules, "1" for bar and "0" for space. Add a quiet zone of 10 modules each side. */
  function encode(text) {
    return values(text).map(function (value) {
      var widths = PATTERNS[value];
      var modules = '';
      for (var i = 0; i < widths.length; i++) modules += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
      return modules;
    }).join('');
  }

  return { PATTERNS: PATTERNS, values: values, encode: encode };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Code128;
