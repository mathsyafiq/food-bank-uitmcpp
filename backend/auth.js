// Staff sign-in checks (docs/PLAN.md 5.3) and pantry device keys (5.4).
//
// Security rule: google.script.run can call ANY top-level function whose name does not end in "_",
// from any page this script serves, including the access-denied page on the public deployment.
// So every such function must go through staffCall_() or check the caller itself.

function currentStaff_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) throw new ApiError('NOT_SIGNED_IN');
  const row = Db.read('Staff').filter((s) => String(s.email).trim().toLowerCase() === email && truthy_(s.active))[0];
  if (!row) throw new ApiError('NOT_STAFF');
  return {
    email: email,
    name: String(row.name || ''),
    role: String(row.role).trim().toLowerCase() === 'admin' ? 'admin' : 'staff',
  };
}

function requireStaff_() {
  return currentStaff_();
}

function requireAdmin_() {
  const me = currentStaff_();
  if (me.role !== 'admin') throw new ApiError('ADMIN_ONLY');
  return me;
}

/** Wraps every function the staff pages call: checks the role, returns plain data, and gives friendly errors. */
function staffCall_(role, fn) {
  try {
    const me = role === 'admin' ? requireAdmin_() : requireStaff_();
    return plain_(fn(me));
  } catch (err) {
    throw new Error(errorBody_(err).error.en);
  }
}

function audit_(me, action, detail) {
  Db.append('AuditLog', [{ at: new Date(), staff_email: me.email, action: action, detail: safeText_(detail, 300) }]);
}

// ---- Pantry devices ----

const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // No I, L, O, 0 or 1.

function newSetupCode_() {
  const hex = randomHex_(32);
  let code = '';
  for (let i = 0; i < 8; i++) code += SETUP_CODE_ALPHABET[parseInt(hex.substr(i * 4, 4), 16) % SETUP_CODE_ALPHABET.length];
  return code;
}

/** Staff page: a one-time code, valid 10 minutes, that turns a phone or laptop into a pantry device. */
function staffCreateDeviceCode(form) {
  return staffCall_('staff', (me) => {
    const location = activeLocation_(form && form.location_id, 'PANTRY');
    const label = safeText_(form.label, 60) || 'Pantry device';
    const code = newSetupCode_();
    CacheService.getScriptCache().put(
      'setup:' + code,
      JSON.stringify({ location_id: String(location.location_id), label: label, created_by: me.email }),
      600
    );
    return { code: code.slice(0, 4) + '-' + code.slice(4), minutes: 10, location_name: String(location.name) };
  });
}

/** Public API: the device sends the code and gets its own key. The server keeps only a hash of the key. */
function redeemSetupCode_(payload) {
  const code = String(payload.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) throw new ApiError('SETUP_CODE_INVALID');
  return Db.withLock(() => {
    const cache = CacheService.getScriptCache();
    const raw = cache.get('setup:' + code);
    if (!raw) throw new ApiError('SETUP_CODE_INVALID');
    cache.remove('setup:' + code);
    const info = JSON.parse(raw);
    const location = activeLocation_(info.location_id, 'PANTRY');
    const key = randomHex_(64);
    const now = new Date();
    const device = {
      device_id: Utilities.getUuid(),
      label: info.label,
      location_id: info.location_id,
      key_hash: sha256Hex_(key),
      created_by: info.created_by,
      created_at: now,
      last_seen: now,
      revoked: false,
    };
    Db.append('Devices', [device]);
    return {
      device_id: device.device_id,
      device_key: key,
      label: device.label,
      location_id: device.location_id,
      location_name: String(location.name),
    };
  });
}

/** Checks the device id and key sent with a request. Throws DEVICE_REVOKED if they do not match. */
function deviceFromRequest_(device) {
  const id = String((device && device.id) || '');
  const key = String((device && device.key) || '');
  const row = Db.read('Devices').filter((d) => String(d.device_id) === id)[0];
  if (!row || !key || truthy_(row.revoked) || sha256Hex_(key) !== String(row.key_hash)) throw new ApiError('DEVICE_REVOKED');
  const seen = asDate_(row.last_seen);
  if (!seen || Date.now() - seen.getTime() > 10 * 60 * 1000) {
    row.last_seen = new Date();
    Db.writeRow('Devices', row);
  }
  return { device_id: id, location_id: String(row.location_id), label: String(row.label) };
}

function staffListDevices() {
  return staffCall_('staff', () => Db.read('Devices').map((d) => ({
    device_id: String(d.device_id),
    label: String(d.label),
    location_id: String(d.location_id),
    created_by: String(d.created_by),
    created_at: d.created_at,
    last_seen: d.last_seen,
    revoked: truthy_(d.revoked),
  })));
}

function staffRevokeDevice(deviceId) {
  return staffCall_('staff', (me) => Db.withLock(() => {
    const row = Db.findRow('Devices', 'device_id', String(deviceId || ''));
    if (!row) throw new ApiError('BAD_REQUEST');
    const device = Db.readRow('Devices', row);
    device.revoked = true;
    Db.writeRow('Devices', device);
    audit_(me, 'device_revoke', device.label + ' (' + device.device_id + ')');
    return { revoked: true };
  }));
}
