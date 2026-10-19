// Errors shown to people, each with a plain-language message in BM and English (CLAUDE.md section 10).
// Staff pages show the English text; the student app shows both.
const MESSAGES = {
  BAD_REQUEST: ['Permintaan tidak sah.', 'The request was not valid.'],
  UNKNOWN_ACTION: ['Permintaan tidak dikenali.', 'Unknown request.'],
  SERVER_ERROR: ['Maaf, berlaku ralat. Sila cuba lagi.', 'Sorry, something went wrong. Please try again.'],
  BUSY: ['Sistem sibuk. Sila cuba lagi sebentar.', 'The system is busy. Please try again in a moment.'],
  TOO_MANY_REQUESTS: ['Terlalu banyak permintaan. Sila cuba lagi sebentar.', 'Too many requests. Please try again shortly.'],

  PANTRY_UNKNOWN: ['Pantri tidak dikenali. Sila imbas poster QR di pantri.', 'Pantry not recognised. Please scan the QR poster at the pantry.'],
  DEVICE_REQUIRED: ['Hanya peranti pantri boleh berbuat demikian.', 'Only a pantry device can do that.'],
  DEVICE_REVOKED: ['Peranti ini tidak lagi berdaftar. Sila hubungi staf.', 'This device is no longer set up. Please ask staff.'],
  SETUP_CODE_INVALID: ['Kod salah atau telah tamat tempoh.', 'That code is wrong or has expired.'],

  STUDENT_ID_INVALID: ['ID pelajar tidak sah. Sila semak dan cuba lagi.', 'That student ID is not valid. Please check it and try again.'],
  NAMELIST_LINK_INVALID: ['Pautan senarai nama tidak sah.', 'Paste the link of a Google Sheet (not the food bank database).'],
  NAMELIST_NOT_FOUND: ['Senarai nama tidak dapat dibuka.', 'Could not open that Google Sheet or tab. Check the link and that the owner account can open it.'],
  NAMELIST_COLUMNS: ['Lajur tidak sah.', 'Choose different columns for the student ID and the name.'],
  NAMELIST_EMPTY: ['Tiada ID pelajar yang sah.', 'No valid student IDs found in that column. Check the column and the Student ID format setting.'],
  NOT_ON_ROSTER: ['ID pelajar tidak ditemui. Sila minta bantuan staf.', 'Student ID not found. Please ask staff for help.'],
  NAME_REQUIRED: ['Sila masukkan nama penuh anda.', 'Please enter your full name.'],
  COLLEGE_REQUIRED: ['Sila pilih kolej anda.', 'Please choose your college.'],
  CONSENT_REQUIRED: ['Sila tandakan kotak persetujuan untuk meneruskan.', 'Please tick the consent box to continue.'],

  VISIT_MISSING: ['Permintaan tidak sah.', 'The request was not valid.'],
  VISIT_ID_INVALID: ['Permintaan tidak sah.', 'The request was not valid.'],
  TIME_INVALID: ['Masa pada peranti tidak sah.', 'The time on this device is not valid.'],
  BASKET_EMPTY: ['Bakul anda kosong.', 'Your basket is empty.'],
  BASKET_TOO_LARGE: ['Terlalu banyak barang dalam satu bakul.', 'Too many lines in one basket.'],
  ITEM_UNKNOWN: ['Ada barang yang tidak dikenali. Sila muat semula halaman.', 'An item was not recognised. Please reload the page.'],
  QTY_INVALID: ['Kuantiti tidak sah.', 'A quantity is not valid.'],

  NOT_SIGNED_IN: ['Sila log masuk dengan akaun UiTM.', 'Please sign in with your UiTM account.'],
  NOT_STAFF: ['Akaun ini tiada akses staf.', 'This account does not have staff access. Ask an admin to add you.'],
  ADMIN_ONLY: ['Hanya admin boleh berbuat demikian.', 'Only an admin can do that.'],
  NOTHING_TO_SAVE: ['Tiada kuantiti dimasukkan.', 'Enter at least one quantity.'],
  LOCATION_INVALID: ['Lokasi tidak sah.', 'Choose a valid, active location.'],
  SAME_LOCATION: ['Lokasi asal dan destinasi sama.', 'The from and to locations must be different.'],
  ITEM_NOT_FOUND: ['Barang tidak ditemui.', 'Item not found.'],
  NAME_INVALID: ['Nama tidak sah.', 'Enter a name of at least 2 characters.'],
  CHOICE_INVALID: ['Pilihan tidak sah.', 'Choose the category and unit from the lists. Admins can change the lists on the Setup page.'],
  BARCODE_INVALID: ['Kod bar tidak sah.', 'That barcode is not valid. Scan it again or check the digits.'],
  BARCODE_TAKEN: ['Kod bar sudah dipautkan kepada barang lain.', 'That barcode is already linked to another item.'],
  PHOTO_INVALID: ['Gambar tidak sah atau terlalu besar.', 'The photo is not valid or too large.'],
  REASON_REQUIRED: ['Sila nyatakan sebab.', 'Choose a reason (and add a note for "other").'],
  VISIT_NOT_FOUND: ['Lawatan tidak ditemui.', 'Visit not found. Check the visit ID.'],
  ALREADY_VOIDED: ['Lawatan ini sudah dibatalkan.', 'That visit has already been voided.'],
  EMAIL_INVALID: ['E-mel tidak sah.', 'Enter a valid email address.'],
  LAST_ADMIN: ['Mesti ada sekurang-kurangnya seorang admin.', 'There must be at least one active admin.'],
  SETTING_INVALID: ['Tetapan tidak sah.', 'One of the settings is not valid.'],
  CODE_INVALID: ['Kod tidak sah.', 'Use 2 to 15 letters, numbers or dashes for the code.'],
  DATE_INVALID: ['Tarikh tidak sah.', 'Enter a valid date range (at most 400 days).'],
  COUNT_INVALID: ['Kiraan tidak sah.', 'Counts must be whole numbers of zero or more.'],
};

class ApiError extends Error {
  constructor(code) {
    const known = Object.prototype.hasOwnProperty.call(MESSAGES, code);
    const text = known ? MESSAGES[code] : MESSAGES.SERVER_ERROR;
    super(text[1]);
    this.name = 'ApiError';
    this.code = known ? code : 'SERVER_ERROR';
    this.ms = text[0];
  }
}

/** Turns any error into the reply body. Unexpected errors are logged without request data. */
function errorBody_(err) {
  let apiError = err;
  if (!err || err.name !== 'ApiError') {
    const message = String((err && err.message) || err);
    if (Object.prototype.hasOwnProperty.call(MESSAGES, message)) {
      apiError = new ApiError(message); // An error code thrown by a core/ module.
    } else if (/lock|timed out/i.test(message)) {
      apiError = new ApiError('BUSY');
    } else {
      console.error(err && err.stack ? err.stack : message);
      apiError = new ApiError('SERVER_ERROR');
    }
  }
  return { ok: false, error: { code: apiError.code, ms: apiError.ms, en: apiError.message } };
}
