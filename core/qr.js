// QR code encoder (ISO/IEC 18004) for the pantry posters. Shared by Apps Script and Node tests.
// Byte mode only, versions 1 to 40, all four error correction levels, mask chosen by the standard penalty score.
var Qr = (function () {
  'use strict';

  var LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
  var FORMAT_BITS = [1, 0, 3, 2]; // L, M, Q, H as written in the format information.

  // Error correction codewords per block, and number of blocks, indexed [level][version]. Index 0 is unused.
  var ECC_PER_BLOCK = [
    [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  var BLOCKS = [
    [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  // ---- Reed-Solomon over GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 ----

  var EXP = [];
  var LOG = [];
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function multiply(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  /** Generator polynomial (x - a^0)(x - a^1)...(x - a^(degree-1)), highest power first. */
  function generator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = [];
      for (var k = 0; k <= poly.length; k++) next.push(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= multiply(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /** The error correction codewords for one block of data codewords. */
  function errorCorrection(data, degree) {
    var gen = generator(degree);
    var rem = [];
    for (var i = 0; i < degree; i++) rem.push(0);
    data.forEach(function (byte) {
      var factor = byte ^ rem.shift();
      rem.push(0);
      for (var j = 0; j < degree; j++) rem[j] ^= multiply(gen[j + 1], factor);
    });
    return rem;
  }

  // ---- Sizes and capacity ----

  function sizeOf(version) {
    return version * 4 + 17;
  }

  /** Modules left for data and error correction once the function patterns are drawn. */
  function rawModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var align = Math.floor(version / 7) + 2;
      result -= (25 * align - 10) * align - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function dataCodewords(version, level) {
    var l = LEVELS[level];
    return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[l][version] * BLOCKS[l][version];
  }

  function alignmentPositions(version) {
    if (version === 1) return [];
    var count = Math.floor(version / 7) + 2;
    var step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    var positions = [6];
    for (var pos = sizeOf(version) - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
    return positions;
  }

  /** 15-bit format information: level and mask, BCH(15,5) protected, XOR-masked. */
  function formatBits(level, mask) {
    var data = (FORMAT_BITS[LEVELS[level]] << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  /** 18-bit version information for versions 7 and up, BCH(18,6) protected. */
  function versionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (version << 12) | rem;
  }

  // ---- Data ----

  function utf8(text) {
    var escaped = encodeURIComponent(text);
    var bytes = [];
    for (var i = 0; i < escaped.length; i++) {
      if (escaped[i] === '%') {
        bytes.push(parseInt(escaped.substr(i + 1, 2), 16));
        i += 2;
      } else {
        bytes.push(escaped.charCodeAt(i));
      }
    }
    return bytes;
  }

  /** Mode indicator, character count, data, terminator and padding, as data codewords. */
  function dataStream(bytes, version, level) {
    var bits = [];
    var push = function (value, length) {
      for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    var capacity = dataCodewords(version, level) * 8;
    push(4, 4); // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }
    return codewords;
  }

  /** Splits the data into blocks, adds error correction to each, and interleaves them. */
  function interleave(data, version, level) {
    var l = LEVELS[level];
    var blockCount = BLOCKS[l][version];
    var eccLength = ECC_PER_BLOCK[l][version];
    var total = Math.floor(rawModules(version) / 8);
    var shortBlocks = blockCount - (total % blockCount);
    var shortLength = Math.floor(total / blockCount) - eccLength;
    var blocks = [];
    var eccs = [];
    for (var i = 0, offset = 0; i < blockCount; i++) {
      var length = shortLength + (i < shortBlocks ? 0 : 1);
      blocks.push(data.slice(offset, offset + length));
      eccs.push(errorCorrection(blocks[i], eccLength));
      offset += length;
    }
    var out = [];
    for (var col = 0; col <= shortLength; col++) {
      blocks.forEach(function (block) { if (col < block.length) out.push(block[col]); });
    }
    for (var e = 0; e < eccLength; e++) {
      eccs.forEach(function (ecc) { out.push(ecc[e]); });
    }
    return out;
  }

  // ---- Matrix ----

  function Matrix(version) {
    this.size = sizeOf(version);
    this.dark = [];
    this.fixed = [];
    for (var y = 0; y < this.size; y++) {
      this.dark.push([]);
      this.fixed.push([]);
      for (var x = 0; x < this.size; x++) {
        this.dark[y].push(false);
        this.fixed[y].push(false);
      }
    }
  }

  Matrix.prototype.set = function (x, y, dark) {
    this.dark[y][x] = dark;
    this.fixed[y][x] = true;
  };

  function drawFunctionPatterns(m, version) {
    var size = m.size;
    for (var i = 0; i < size; i++) {
      m.set(6, i, i % 2 === 0);
      m.set(i, 6, i % 2 === 0);
    }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var x = c[0] + dx;
          var y = c[1] + dy;
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) m.set(x, y, dist !== 2 && dist !== 4);
        }
      }
    });
    var align = alignmentPositions(version);
    var last = align.length - 1;
    align.forEach(function (ay, i) {
      align.forEach(function (ax, j) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // finder corners
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) m.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });
    drawFormat(m, 'L', 0); // reserves the area; the real bits are drawn once the mask is chosen
    if (version >= 7) {
      var bits = versionBits(version);
      for (var b = 0; b < 18; b++) {
        var bit = ((bits >>> b) & 1) === 1;
        var a = size - 11 + (b % 3);
        var c = Math.floor(b / 3);
        m.set(a, c, bit);
        m.set(c, a, bit);
      }
    }
  }

  function drawFormat(m, level, mask) {
    var bits = formatBits(level, mask);
    var bit = function (i) { return ((bits >>> i) & 1) === 1; };
    var size = m.size;
    for (var i = 0; i <= 5; i++) m.set(8, i, bit(i));
    m.set(8, 7, bit(6));
    m.set(8, 8, bit(7));
    m.set(7, 8, bit(8));
    for (var j = 9; j < 15; j++) m.set(14 - j, 8, bit(j));
    for (var k = 0; k < 8; k++) m.set(size - 1 - k, 8, bit(k));
    for (var n = 8; n < 15; n++) m.set(8, size - 15 + n, bit(n));
    m.set(8, size - 8, true); // the dark module
  }

  /** Places the codewords in the two-column zigzag from the bottom right, skipping function patterns. */
  function drawCodewords(m, codewords) {
    var size = m.size;
    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing pattern
      var upward = ((right + 1) & 2) === 0;
      for (var vert = 0; vert < size; vert++) {
        var y = upward ? size - 1 - vert : vert;
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          if (!m.fixed[y][x] && i < codewords.length * 8) {
            m.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; },
  ];

  function applyMask(m, mask) {
    for (var y = 0; y < m.size; y++) {
      for (var x = 0; x < m.size; x++) {
        if (!m.fixed[y][x] && MASKS[mask](x, y)) m.dark[y][x] = !m.dark[y][x];
      }
    }
  }

  /** The standard penalty score: long runs, 2x2 blocks, finder-like patterns, and dark/light balance. */
  function penalty(dark) {
    var size = dark.length;
    var lines = [];
    for (var y = 0; y < size; y++) {
      var row = '';
      var col = '';
      for (var x = 0; x < size; x++) {
        row += dark[y][x] ? '1' : '0';
        col += dark[x][y] ? '1' : '0';
      }
      lines.push(row, col);
    }
    var score = 0;
    lines.forEach(function (line) {
      (line.match(/0{5,}|1{5,}/g) || []).forEach(function (run) { score += run.length - 2; });
      // Dark-light-dark-dark-dark-light-dark with 4 light modules before or after it. The quiet zone is light.
      var padded = '0000' + line + '0000';
      for (var at = padded.indexOf('1011101'); at >= 0; at = padded.indexOf('1011101', at + 1)) {
        if (padded.substr(at - 4, 4) === '0000' || padded.substr(at + 7, 4) === '0000') score += 40;
      }
    });
    var darkCount = 0;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (dark[r][c]) darkCount++;
        if (r < size - 1 && c < size - 1 && dark[r][c] === dark[r][c + 1] && dark[r][c] === dark[r + 1][c] && dark[r][c] === dark[r + 1][c + 1]) score += 3;
      }
    }
    var total = size * size;
    score += 10 * Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
    return score;
  }

  /**
   * Encodes text as the smallest QR code at the given error correction level (default M), raising the level
   * when the same version has room. Returns {version, level, mask, size, modules}, where modules[y][x] is true
   * for dark. Draw it with a light quiet zone of 4 modules on every side. Tests may pass a mask (0 to 7).
   */
  function encode(text, minLevel, forceMask) {
    var bytes = utf8(String(text));
    var order = ['L', 'M', 'Q', 'H'];
    var level = minLevel || 'M';
    if (!(level in LEVELS)) throw new Error('Unknown QR error correction level: ' + level);
    var bitsNeeded = function (version) { return 4 + (version < 10 ? 8 : 16) + bytes.length * 8; };
    var version = 1;
    while (version <= 40 && bitsNeeded(version) > dataCodewords(version, level) * 8) version++;
    if (version > 40) throw new Error('Text too long for a QR code.');
    for (var i = order.indexOf(level) + 1; i < order.length; i++) {
      if (bitsNeeded(version) <= dataCodewords(version, order[i]) * 8) level = order[i];
    }

    var codewords = interleave(dataStream(bytes, version, level), version, level);
    var m = new Matrix(version);
    drawFunctionPatterns(m, version);
    drawCodewords(m, codewords);
    var best = -1;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      if (forceMask !== undefined && mask !== forceMask) continue;
      applyMask(m, mask);
      drawFormat(m, level, mask);
      var score = penalty(m.dark);
      if (score < bestScore) {
        best = mask;
        bestScore = score;
      }
      applyMask(m, mask); // XOR again to undo
    }
    applyMask(m, best);
    drawFormat(m, level, best);
    return { version: version, level: level, mask: best, size: m.size, modules: m.dark };
  }

  return {
    encode: encode,
    dataCodewords: dataCodewords,
    errorCorrection: errorCorrection,
    formatBits: formatBits,
    versionBits: versionBits,
    alignmentPositions: alignmentPositions,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Qr;
