// Student identification and records (CLAUDE.md section 7, docs/DECISIONS.md 11, 12 and 32 to 35).
// Visits refer to a student by student_key, an HMAC of the ID whose secret lives only in Script Properties.
// The Students tab also holds the plain ID, name and faculty or programme so Student Affairs (HEP) can contact
// students who need more help. Only the owner and admins can open the spreadsheet.
//
// SELF mode: every student gives their name and faculty. ROSTER mode: students on the imported namelist give
// only their ID (the namelist supplies name and programme); anyone not on it gives their name and faculty.

function studentKey_(normalisedId) {
  const secret = PropertiesService.getScriptProperties().getProperty('STUDENT_HMAC_KEY');
  if (!secret) throw new Error('STUDENT_HMAC_KEY missing. Run setup() from the Apps Script editor.');
  return hmacHex_(normalisedId, secret);
}

/** The namelist record for a student key, or null if the student is not on the namelist. */
function rosterRow_(key) {
  const row = Db.findRow('Students', 'student_key', key);
  if (!row) return null;
  const student = Db.readRow('Students', row);
  return student.source === 'ROSTER' ? student : null;
}

/**
 * Checks the student part of a visit before anything is written. A queued offline visit always carries typed
 * details, because the device cannot look anyone up; if the ID turns out to be on the namelist, the namelist wins.
 */
function readStudent_(raw, settings) {
  raw = raw || {};
  const id = StudentId.normalise(raw.id);
  if (!StudentId.isValid(id, settings.student_id_pattern)) throw new ApiError('STUDENT_ID_INVALID');
  const student = { id: id, key: studentKey_(id) };
  if (settings.student_mode === 'ROSTER' && rosterRow_(student.key)) {
    if (raw.consent !== true) throw new ApiError('CONSENT_REQUIRED');
    return student;
  }
  const name = safeText_(raw.name, 100);
  if (name.replace(/^'/, '').length < 2) throw new ApiError('NAME_REQUIRED');
  const faculty = String(raw.faculty_code || '').trim();
  // Any faculty in the tab is accepted, even one deactivated after an offline visit was queued.
  if (!facultiesByCode_()[faculty]) throw new ApiError('FACULTY_REQUIRED');
  if (raw.consent !== true) throw new ApiError('CONSENT_REQUIRED');
  student.name = name;
  student.faculty_code = faculty;
  return student;
}

/**
 * Updates the Students tab for a visit. Call inside Db.withLock.
 * Returns {unverified: true} in ROSTER mode when the student is not on the namelist ("not on namelist" in reports).
 */
function recordStudent_(student, settings, visitTime) {
  const row = Db.findRow('Students', 'student_key', student.key);
  const existing = row ? Db.readRow('Students', row) : null;
  const onRoster = !!existing && existing.source === 'ROSTER';

  if (existing) {
    const last = asDate_(existing.last_visit_at);
    existing.last_visit_at = last && last > visitTime ? last : visitTime;
    existing.first_visit_at = existing.first_visit_at || visitTime;
    existing.visit_count = (Number(existing.visit_count) || 0) + 1;
    existing.consent_at = visitTime;
    if (!onRoster && student.name) { // The namelist keeps its own name and programme.
      existing.student_id = student.id;
      existing.name = student.name;
      existing.faculty_code = student.faculty_code;
    }
    Db.writeRow('Students', existing);
  } else {
    Db.append('Students', [{
      student_key: student.key,
      student_id: student.id,
      name: student.name,
      faculty_code: student.faculty_code,
      source: 'SELF',
      consent_at: visitTime,
      first_visit_at: visitTime,
      last_visit_at: visitTime,
      visit_count: 1,
    }]);
  }
  return { unverified: settings.student_mode === 'ROSTER' && !onRoster };
}

/** Slows anyone scripting through IDs on the public link to collect names (decision 33). Pantry devices are exempt. */
function countPublicLookup_(settings) {
  const cache = CacheService.getScriptCache();
  const key = 'lookup:' + Math.floor(Date.now() / 60000);
  const count = (Number(cache.get(key)) || 0) + 1;
  if (count > settings.public_lookups_per_minute) throw new ApiError('TOO_MANY_REQUESTS');
  cache.put(key, String(count), 120);
}

/**
 * Public API. SELF mode never looks anything up. ROSTER mode returns the name and programme from the namelist,
 * so the student only has to confirm "this is me"; {found: false} sends them to the details form.
 */
function checkStudent_(payload, ctx) {
  if (ctx.settings.student_mode !== 'ROSTER') return { mode: 'SELF' };
  const id = StudentId.normalise(payload.id);
  if (!StudentId.isValid(id, ctx.settings.student_id_pattern)) throw new ApiError('STUDENT_ID_INVALID');
  if (!ctx.device) countPublicLookup_(ctx.settings);
  const student = rosterRow_(studentKey_(id));
  if (!student) return { mode: 'ROSTER', found: false };
  return { mode: 'ROSTER', found: true, name: String(student.name || ''), program: String(student.program || '') };
}

function facultiesByCode_() {
  const map = {};
  Db.read('Faculties').forEach((f) => { map[String(f.faculty_code)] = f; });
  return map;
}
