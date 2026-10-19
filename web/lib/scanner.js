// Camera barcode scanning on phones. Uses the browser's BarcodeDetector where it exists (Android Chrome)
// and the bundled ZXing library otherwise (iPhone Safari). Loaded only when a student opens the camera.

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const ZXING_SRC = 'vendor/zxing-0.21.3.min.js';
let zxingPromise = null;

export function cameraAvailable() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * True if this device has a camera to scan with. Phones and tablets are assumed to have one, because some
 * browsers list no cameras until permission is given. A laptop or desktop must actually list one.
 */
export async function hasCamera() {
  if (!cameraAvailable()) return false;
  if (!matchMedia('(pointer: fine)').matches) return true;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch (err) {
    return false;
  }
}

function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ZXING_SRC;
      script.onload = () => resolve(window.ZXing);
      script.onerror = () => {
        zxingPromise = null;
        reject(new Error('Barcode library failed to load'));
      };
      document.head.append(script);
    });
  }
  return zxingPromise;
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return null;
    const detector = new window.BarcodeDetector({ formats });
    return async (video) => {
      const codes = await detector.detect(video);
      return codes.length ? codes[0].rawValue : null;
    };
  } catch (err) {
    return null;
  }
}

async function zxingDetector() {
  const ZX = await loadZxing();
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
    ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128,
  ]);
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, 960 / video.videoWidth); // Smaller frames decode faster on phones.
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      luminance[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    }
    try {
      const source = new ZX.RGBLuminanceSource(luminance, canvas.width, canvas.height);
      return reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(source))).getText();
    } catch (err) {
      return null; // No barcode in this frame.
    } finally {
      reader.reset();
    }
  };
}

export class Scanner {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.running = false;
    this.last = { code: '', at: 0 };
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.detect = (await nativeDetector()) || (await zxingDetector());
    this.running = true;
    this.loop();
  }

  async loop() {
    if (!this.running) return;
    try {
      const code = await this.detect(this.video);
      // Holding the same barcode in view counts once; scan it again after 2 seconds to add another.
      if (code && (code !== this.last.code || Date.now() - this.last.at > 2000)) {
        this.last = { code, at: Date.now() };
        if (navigator.vibrate) navigator.vibrate(60);
        this.onCode(code);
      } else if (code) {
        this.last.at = Date.now();
      }
    } catch (err) {
      // A frame that fails to read is skipped.
    }
    if (this.running) this.timer = setTimeout(() => this.loop(), 250);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
