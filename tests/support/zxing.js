// Reads our QR codes and Code 128 labels back with the bundled ZXing library (web/vendor), an independent
// implementation, so the tests check what a scanner would see.
const ZXing = require('../../web/vendor/zxing-0.21.3.min.js');

function luminance(width, height, isDark) {
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (isDark(x, y)) pixels[y * width + x] = 0;
  }
  return new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(pixels, width, height)));
}

/**
 * Decodes modules[y][x] drawn at `scale` pixels per module with a 4-module quiet zone.
 * `pure` skips ZXing's finder-pattern search, which struggles with large, perfectly sharp synthetic images.
 */
function readQr(modules, options) {
  const scale = (options && options.scale) || 3;
  const quiet = 4;
  const width = (modules.length + quiet * 2) * scale;
  const bitmap = luminance(width, width, (x, y) => {
    const mx = Math.floor(x / scale) - quiet;
    const my = Math.floor(y / scale) - quiet;
    return my >= 0 && my < modules.length && mx >= 0 && mx < modules.length && modules[my][mx];
  });
  const hints = new Map();
  if (options && options.pure) hints.set(ZXing.DecodeHintType.PURE_BARCODE, true);
  const result = new ZXing.QRCodeReader().decode(bitmap, hints);
  return { text: result.getText(), level: String(result.getResultMetadata().get(ZXing.ResultMetadataType.ERROR_CORRECTION_LEVEL)) };
}

/** ZXing's own QR encoder output at the given level, as modules[y][x]. */
function zxingQr(text, level) {
  const qr = ZXing.QRCodeEncoder.encode(text, ZXing.QRCodeDecoderErrorCorrectionLevel[level], new Map());
  const matrix = qr.getMatrix();
  const modules = [];
  for (let y = 0; y < matrix.getHeight(); y++) {
    const row = [];
    for (let x = 0; x < matrix.getWidth(); x++) row.push(matrix.get(x, y) === 1);
    modules.push(row);
  }
  return { version: qr.getVersion().getVersionNumber(), mask: qr.getMaskPattern(), modules };
}

/** Decodes a Code 128 module string ("1" = bar) drawn with a 10-module quiet zone. */
function readCode128(bars, scale) {
  const padded = '0'.repeat(10) + bars + '0'.repeat(10);
  const s = scale || 2;
  const bitmap = luminance(padded.length * s, 20, (x) => padded[Math.floor(x / s)] === '1');
  return new ZXing.Code128Reader().decode(bitmap).getText();
}

module.exports = { readQr, zxingQr, readCode128 };
