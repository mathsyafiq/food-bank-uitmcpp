// Student identification and records (CLAUDE.md section 7, docs/PLAN.md 5.2).
// Visits refer to a student by student_key, an HMAC of the ID whose secret lives only in Script Properties.
// The Students tab also holds the plain ID, name and faculty so Student Affairs (HEP) can contact
// students who need more help. Only the owner and admins can open the spreadsheet.

function studentKey_(normalisedId) {
  const secret = PropertiesService.getScriptProperties().getProperty('STUDENT_HMAC_KEY');
  if (!secret) throw new Error('STUDENT_HMAC_KEY missing. Run setup() from the Apps Script editor.');
  return hmacHex_(normalisedId, secret);
}

/** Checks the student part of a visit before anything is written. */
function readStudent_(raw, settings) {
  raw = raw || {};
  const id = StudentId.normalise(raw.id);
  if (!StudentId.isValid(id, settings.student_id_pattern)) throw new ApiError('STUDENT_ID_INVALID');
  const student = { id: id, key: studentKey_(id) };
  if (settings.student_mode === 'SELF') {
    const name = safeText_(raw.name, 100);
    if (name.replace(/^'/, '').length < 2) throw new ApiError('NAME_REQUIRED');
    const faculty = String(raw.faculty_code || '').trim();
    // Any faculty in the tab is accepted, even one deactivated after an offline visit was queued.
    if (!facultiesByCode_()[faculty]) throw new ApiError('FACULTY_REQUIRED');
    if (raw.consent !== true) throw new ApiError('CONSENT_REQUIRED');
    student.name = name;
    student.faculty_code = faculty;
  }
  return student;
}

/**
 * Updates the Students tab for a visit. Call inside Db.withLock.
 * Returns {unverified: true} when roster mode is on and the ID is not on the roster (offline visits only;
 * online visits are checked first by checkStudent_).
 */
function recordStudent_(student, settings, visitTime) {
  const row = Db.findRow('Students', 'student_key', student.key);
  const existing = row ? Db.readRow('Students', row) : null;
  if (settings.student_mode === 'ROSTER' && (!existing || existing.source !== 'ROSTER')) return { unverified: true };

  if (existing) {
    const last = asDate_(existing.last_visit_at);
    existing.last_visit_at = last && last > visitTime ? last : visitTime;
    existing.first_visit_at = existing.first_visit_at || visitTime;
    existing.visit_count = (Number(existing.visit_count) || 0) + 1;
    if (student.name) {
      existing.student_id = student.id;
      existing.name = student.name;
      existing.faculty_code = student.faculty_code;
      existing.consent_at = visitTime;
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
  return { unverified: false };
}

/**
 * Public API. In SELF mode it never looks anything up, so no one can learn whether a friend has visited
 * (docs/PLAN.md 5.2). In ROSTER mode it only says whether the ID is on the roster.
 */
function checkStudent_(payload, ctx) {
  if (ctx.settings.student_mode !== 'ROSTER') return { mode: 'SELF' };
  const id = StudentId.normalise(payload.id);
  if (!StudentId.isValid(id, ctx.settings.student_id_pattern)) throw new ApiError('STUDENT_ID_INVALID');
  const row = Db.findRow('Students', 'student_key', studentKey_(id));
  if (!row || Db.readRow('Students', row).source !== 'ROSTER') throw new ApiError('NOT_ON_ROSTER');
  return { mode: 'ROSTER', valid: true };
}

function facultiesByCode_() {
  const map = {};
  Db.read('Faculties').forEach((f) => { map[String(f.faculty_code)] = f; });
  return map;
}
