// Admin-only pages: students (for HEP), staff list, locations, faculties, settings, jobs.
// Every look-up or export of student data is written to the AuditLog tab (PDPA accountability).

function adminStudentLookup(studentId) {
  return staffCall_('admin', (me) => {
    const settings = getSettings_();
    const id = StudentId.normalise(studentId);
    if (!StudentId.isValid(id, settings.student_id_pattern)) throw new ApiError('STUDENT_ID_INVALID');
    const key = studentKey_(id);
    audit_(me, 'student_lookup', key.slice(0, 16));
    const row = Db.findRow('Students', 'student_key', key);
    const student = row ? Db.readRow('Students', row) : null;
    const faculties = facultiesByCode_();
    const names = nameMaps_();
    const visits = Db.findRows('Visits', 'student_key', key).map((r) => Db.readRow('Visits', r)).map((v) => ({
      visit_id: v.visit_id,
      occurred_at: v.occurred_at,
      location: names.locations[v.location_id] || v.location_id,
      lines: Db.findRows('Transactions', 'visit_id', v.visit_id).map((t) => Db.readRow('Transactions', t))
        .filter((t) => t.type === 'OUT').map((t) => (names.items[t.item_id] || t.item_id) + ' × ' + -Number(t.quantity)).join('; '),
      flagged: truthy_(v.flagged),
      voided: truthy_(v.voided),
    }));
    return {
      found: !!student,
      student: student && {
        student_id: student.student_id,
        name: student.name,
        faculty: faculties[student.faculty_code] ? faculties[student.faculty_code].name_ms : student.faculty_code,
        source: student.source,
        first_visit_at: student.first_visit_at,
        last_visit_at: student.last_visit_at,
        visit_count: Number(student.visit_count) || 0,
      },
      visits: visits,
    };
  });
}

/** The student list for Student Affairs (HEP) to contact students who need more help. */
function adminStudentsCsv() {
  return staffCall_('admin', (me) => {
    const faculties = facultiesByCode_();
    const students = Db.read('Students');
    audit_(me, 'students_export', students.length + ' students');
    const rows = [['student_id', 'name', 'faculty', 'first_visit', 'last_visit', 'visits']].concat(students.map((s) => [
      s.student_id,
      s.name,
      faculties[s.faculty_code] ? faculties[s.faculty_code].name_ms : s.faculty_code,
      formatDay_(s.first_visit_at),
      formatDay_(s.last_visit_at),
      Number(s.visit_count) || 0,
    ]));
    return { filename: 'foodbank-students-' + formatDay_(new Date()) + '.csv', csv: Csv.stringify(rows) };
  });
}

function adminSaveStaff(form) {
  return staffCall_('admin', (me) => {
    form = form || {};
    const email = String(form.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('EMAIL_INVALID');
    const record = {
      email: email,
      name: safeText_(form.name, 80),
      role: form.role === 'admin' ? 'admin' : 'staff',
      receives_alerts: form.receives_alerts === true,
      active: form.active !== false,
    };
    return Db.withLock(() => {
      const staff = Db.read('Staff');
      const existing = staff.filter((s) => String(s.email).trim().toLowerCase() === email)[0];
      const otherAdmins = staff.filter((s) => String(s.email).trim().toLowerCase() !== email &&
        truthy_(s.active) && String(s.role).toLowerCase() === 'admin').length;
      if ((record.role !== 'admin' || !record.active) && otherAdmins === 0) throw new ApiError('LAST_ADMIN');
      if (existing) Db.writeRow('Staff', Object.assign(record, { _row: existing._row }));
      else Db.append('Staff', [record]);
      audit_(me, 'staff_save', email + ' ' + record.role + (record.active ? '' : ' (inactive)'));
      return { saved: true };
    });
  });
}

function adminSaveLocation(form) {
  return staffCall_('admin', (me) => {
    form = form || {};
    const name = safeText_(form.name, 60);
    if (name.length < 2) throw new ApiError('NAME_INVALID');
    const type = form.type === 'STORE' ? 'STORE' : 'PANTRY';
    return Db.withLock(() => {
      const locations = Db.read('Locations');
      if (form.location_id) {
        const existing = locations.filter((l) => String(l.location_id) === String(form.location_id))[0];
        if (!existing) throw new ApiError('LOCATION_INVALID');
        // The type stays fixed once created: ledger rows already depend on it.
        Db.writeRow('Locations', Object.assign(existing, { name: name, active: form.active !== false }));
        return { location_id: String(existing.location_id) };
      }
      const prefix = type === 'STORE' ? 'S' : 'P';
      let max = 0;
      locations.forEach((l) => {
        const m = new RegExp('^' + prefix + '(\\d+)$').exec(String(l.location_id));
        if (m) max = Math.max(max, Number(m[1]));
      });
      const id = prefix + (max + 1);
      Db.append('Locations', [{ location_id: id, name: name, type: type, active: true }]);
      audit_(me, 'location_add', id + ' ' + name);
      return { location_id: id };
    });
  });
}

function adminSaveFaculty(form) {
  return staffCall_('admin', () => {
    form = form || {};
    const code = String(form.faculty_code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,15}$/.test(code)) throw new ApiError('CODE_INVALID');
    const nameMs = safeText_(form.name_ms, 120);
    if (nameMs.length < 2) throw new ApiError('NAME_INVALID');
    const record = { faculty_code: code, name_ms: nameMs, name_en: safeText_(form.name_en, 120), active: form.active !== false };
    return Db.withLock(() => {
      const row = Db.findRow('Faculties', 'faculty_code', code);
      if (row) Db.writeRow('Faculties', Object.assign(record, { _row: row }));
      else Db.append('Faculties', [record]);
      return { saved: true };
    });
  });
}

function adminSaveSettings(values) {
  return staffCall_('admin', (me) => {
    values = values || {};
    const changes = {};
    Object.keys(values).forEach((key) => {
      const value = String(values[key] == null ? '' : values[key]).trim();
      if (!validSetting_(key, value)) throw new ApiError('SETTING_INVALID');
      changes[key] = value;
    });
    return Db.withLock(() => {
      const rows = Db.read('Settings');
      Object.keys(changes).forEach((key) => {
        const existing = rows.filter((r) => String(r.key).trim() === key)[0];
        if (existing) Db.writeRow('Settings', Object.assign(existing, { value: changes[key] }));
        else Db.append('Settings', [{ key: key, value: changes[key] }]);
      });
      audit_(me, 'settings_save', Object.keys(changes).join(', '));
      return getSettings_();
    });
  });
}

function adminRunStockCheck() {
  return staffCall_('admin', () => ({ mismatches: checkStock_(new Date()) }));
}

function adminInstallTriggers() {
  return staffCall_('admin', () => {
    installTriggers_();
    return { installed: ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()) };
  });
}
