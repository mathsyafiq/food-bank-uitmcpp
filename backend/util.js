// Small helpers shared by the backend files.
const TZ = 'Asia/Kuala_Lumpur';

function truthy_(value) {
  return value === true || /^(true|yes|y|1)$/i.test(String(value == null ? '' : value).trim());
}

function bytesToHex_(bytes) {
  return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
}

function hmacHex_(text, key) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(String(text), key, Utilities.Charset.UTF_8));
}

/** Random hex from Apps Script's random UUIDs. */
function randomHex_(length) {
  let hex = '';
  while (hex.length < length) hex += Utilities.getUuid().replace(/-/g, '');
  return hex.slice(0, length);
}

/** Trims and limits free text, and stops Sheets from treating it as a formula. */
function safeText_(value, max) {
  let text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 200);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text;
}

function wholeNumber_(value, min, max, errorCode) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(errorCode || 'QTY_INVALID');
  }
  return n;
}

function asDate_(value) {
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatTime_(value) {
  const date = asDate_(value);
  return value === '' || !date ? '' : Utilities.formatDate(date, TZ, 'yyyy-MM-dd HH:mm');
}

function formatDay_(value) {
  const date = asDate_(value);
  return value === '' || !date ? '' : Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
}

/** A yyyy-MM-dd text cell, even if Sheets turned it into a date. */
function dayText_(value) {
  return value instanceof Date ? formatDay_(value) : String(value == null ? '' : value);
}

function parseDay_(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ''))) throw new ApiError('DATE_INVALID');
  return Utilities.parseDate(text, TZ, 'yyyy-MM-dd');
}

/** [from, to) for a report: from the start of the first day to the end of the last day. */
function dayRange_(fromText, toText) {
  const from = parseDay_(fromText);
  const to = new Date(parseDay_(toText).getTime() + 24 * 60 * 60 * 1000);
  if (to <= from || to - from > 400 * 24 * 60 * 60 * 1000) throw new ApiError('DATE_INVALID');
  return { from, to };
}

/** Copies a value for google.script.run, which cannot return Date objects. Dates become local time text. */
function plain_(value) {
  if (value instanceof Date) return formatTime_(value);
  if (Array.isArray(value)) return value.map(plain_);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => { out[k] = plain_(value[k]); });
    return out;
  }
  return value;
}

/** Readable ID for batches, for example IN-20261018-143005-7F3A. */
function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '-' + randomHex_(4).toUpperCase();
}
