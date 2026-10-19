// How a student's name is shown on screen. Shared by the browser and Node tests.
// Registrar lists are often in capitals ("AHMAD FAIZ BIN RAHMAN"); those are shown as "Ahmad Faiz bin Rahman".
var Names = (function () {
  'use strict';

  var LOWER = ['bin', 'binti', 'bt', 'bte', 'a/l', 'a/p'];

  function display(raw) {
    var name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!name || /[a-z]/.test(name)) return name; // Already in mixed case: shown as written.
    return name.toLowerCase().split(' ').map(function (word, i) {
      if (i > 0 && LOWER.indexOf(word) >= 0) return word;
      return word.replace(/(^|[-(])([a-z])/g, function (match, before, letter) { return before + letter.toUpperCase(); });
    }).join(' ');
  }

  return { display: display };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Names;
