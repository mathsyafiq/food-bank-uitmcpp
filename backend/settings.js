// Settings tab values with their defaults. Admins change them on the staff Settings page.
const DEFAULT_SETTINGS = {
  // SELF: students give ID, name and faculty on every visit (docs/PLAN.md 5.2, option 1).
  // ROSTER: the ID must be on the roster imported from the Assistant Registrar.
  student_mode: 'SELF',
  student_id_pattern: '^\\d{10}$',
  retention_days: 365,
  large_qty_threshold: 10,
  default_threshold: 5,
  max_line_qty: 999,
  inactivity_seconds: 60,
  thanks_seconds: 5,
  public_submits_per_minute: 60,
  pwa_url: '',
  staff_url: '',
  // Choices for the Items drop-downs, separated by commas. Admins edit them on the staff Setup page.
  item_categories: 'Makanan, Minuman, Kebersihan diri, Lain-lain',
  item_units: 'pek, bungkus, botol, tin, kotak, kg, unit',
};

/** "a, b, c" -> ["a", "b", "c"], trimmed, without blanks or repeats. */
function listSetting_(value) {
  const items = String(value == null ? '' : value).split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return items.filter((s, i) => items.indexOf(s) === i);
}

const SETTING_LIMITS = {
  retention_days: [30, 3650],
  large_qty_threshold: [1, 999],
  default_threshold: [0, 100000],
  max_line_qty: [1, 100000],
  inactivity_seconds: [15, 600],
  thanks_seconds: [2, 60],
  public_submits_per_minute: [5, 1000],
};

function validSetting_(key, value) {
  if (!(key in DEFAULT_SETTINGS)) return false;
  if (key in SETTING_LIMITS) {
    const n = Number(value);
    return value !== '' && Number.isInteger(n) && n >= SETTING_LIMITS[key][0] && n <= SETTING_LIMITS[key][1];
  }
  if (key === 'student_mode') return value === 'SELF' || value === 'ROSTER';
  if (key === 'student_id_pattern') {
    try {
      new RegExp(value);
      return String(value).length > 0 && String(value).length <= 100;
    } catch (err) {
      return false;
    }
  }
  if (key === 'pwa_url' || key === 'staff_url') return value === '' || /^https:\/\/\S+$/.test(value);
  if (key === 'item_categories' || key === 'item_units') {
    const items = listSetting_(value);
    return items.length >= 1 && items.length <= 40 && items.every((s) => s.length <= 30 && !/^[=+\-@]/.test(s));
  }
  return true;
}

function getSettings_() {
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  Db.read('Settings').forEach((row) => {
    const key = String(row.key).trim();
    const value = String(row.value).trim();
    if (value === '' || !validSetting_(key, value)) return;
    settings[key] = typeof DEFAULT_SETTINGS[key] === 'number' ? Number(value) : value;
  });
  if (typeof OLD_PWA_URLS === 'object' && OLD_PWA_URLS.some((old) => settings.pwa_url.indexOf(old) === 0)) {
    settings.pwa_url = '';
  }
  if (typeof APP_URLS === 'object') {
    settings.pwa_url = settings.pwa_url || APP_URLS.pwa;
    settings.staff_url = settings.staff_url || APP_URLS.staff;
  }
  return settings;
}
