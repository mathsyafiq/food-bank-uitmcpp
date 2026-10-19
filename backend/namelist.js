// Importing the student namelist from a Google Sheet in Drive (CLAUDE.md section 7, decisions 32 and 37).
// Only the student ID, name and college are kept. Columns such as IC numbers, phone numbers or addresses
// are never offered in the preview and can never be imported.

const NAMELIST_NEVER = /\bic\b|\bkp\b|kad\s*pengenalan|mykad|nric|passport|pasport|\btel|phone|e-?mel|email|alamat|address/i;
const NAMELIST_COLLEGE = /kolej|college|residensi|asrama/i;
const NAMELIST_PROGRAM = /program|kursus|course/i; // Recognised only so "Nama Program" is not taken for the name.
const NAMELIST_NAME = /nama|name/i;
const NAMELIST_ID = /pelajar|matrik|matric|student|^\s*(no\.?\s*)?id\s*$/i;

/** What a header names: 'college', 'program', 'name', 'id', 'never' (personal data we must not take) or null. */
function classifyHeader_(header) {
  const text = String(header == null ? '' : header).trim();
  if (!text) return null;
  if (NAMELIST_NEVER.test(text)) return 'never';
  if (NAMELIST_COLLEGE.test(text)) return 'college'; // Before name, so "Nama Kolej" is a college.
  if (NAMELIST_PROGRAM.test(text)) return 'program'; // Before name, so "Nama Program" is a programme.
  if (NAMELIST_NAME.test(text)) return 'name'; // Before id, so "Nama Pelajar" is a name.
  if (NAMELIST_ID.test(text)) return 'id';
  return null;
}

/** The spreadsheet ID from a Sheets link or a bare ID. */
function sheetIdFrom_(link) {
  const text = String(link || '').trim();
  const match = /\/d\/([A-Za-z0-9_-]{20,})/.exec(text) || /^([A-Za-z0-9_-]{20,})$/.exec(text);
  if (!match) throw new ApiError('NAMELIST_LINK_INVALID');
  return match[1];
}

function openNamelist_(link, tabName) {
  const id = sheetIdFrom_(link);
  if (id === PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')) throw new ApiError('NAMELIST_LINK_INVALID');
  let book;
  try {
    book = SpreadsheetApp.openById(id);
  } catch (err) {
    throw new ApiError('NAMELIST_NOT_FOUND');
  }
  const sheets = book.getSheets();
  const sheet = tabName ? book.getSheetByName(String(tabName)) : sheets[0];
  if (!sheet) throw new ApiError('NAMELIST_NOT_FOUND');
  return {
    id: id,
    name: book.getName(),
    tabs: sheets.map((s) => s.getName()),
    tab: sheet.getName(),
    // Display values keep IDs exactly as shown (no 2.02E+09, no lost leading zeros).
    values: sheet.getDataRange().getDisplayValues(),
  };
}

/**
 * Finds the header row (the row in the first 15 with the most recognised headers) and the ID, name and
 * college columns. Without an ID header, picks the column whose values look most like student IDs.
 */
function guessNamelistColumns_(values, pattern, headerRowOverride) {
  let best = { row: 0, score: -1, columns: {} };
  const candidates = headerRowOverride != null ? [headerRowOverride] : values.slice(0, 15).map((r, i) => i);
  candidates.forEach((r) => {
    const columns = {};
    let score = 0;
    (values[r] || []).forEach((cell, c) => {
      const kind = classifyHeader_(cell);
      if (kind && kind !== 'never' && columns[kind] === undefined) {
        columns[kind] = c;
        score++;
      }
    });
    if (score > best.score) best = { row: r, score: score, columns: columns };
  });
  if (best.columns.id === undefined) {
    const headers = values[best.row] || [];
    const sample = values.slice(best.row + 1, best.row + 51);
    let bestCol = -1;
    let bestHits = 0;
    headers.forEach((h, c) => {
      if (classifyHeader_(h) === 'never' || c === best.columns.name || c === best.columns.college || c === best.columns.program) return;
      const hits = sample.filter((row) => StudentId.isValid(row[c], pattern)).length;
      if (hits > bestHits) {
        bestHits = hits;
        bestCol = c;
      }
    });
    if (bestCol >= 0 && bestHits >= Math.max(1, sample.length / 2)) best.columns.id = bestCol;
  }
  return { header_row: best.row, columns: best.columns };
}

/** Admin: what the namelist looks like, so the admin can confirm the columns before importing. */
function adminPreviewNamelist(form) {
  return staffCall_('admin', () => {
    form = form || {};
    const settings = getSettings_();
    const src = openNamelist_(form.link, form.tab);
    const override = form.header_row ? wholeNumber_(form.header_row, 1, 50, 'BAD_REQUEST') - 1 : null;
    const guess = guessNamelistColumns_(src.values, settings.student_id_pattern, override);
    const headers = (src.values[guess.header_row] || []).map(String);
    const allowed = headers.map((h) => classifyHeader_(h) !== 'never');
    const rows = src.values.slice(guess.header_row + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
    return {
      file_name: src.name,
      sheet_id: src.id,
      tabs: src.tabs,
      tab: src.tab,
      header_row: guess.header_row + 1,
      headers: headers.map((h, i) => ({ index: i, label: h || 'Column ' + (i + 1), allowed: allowed[i] })),
      // Programme is recognised only to keep it out of the name column; it is never imported.
      columns: { id: guess.columns.id, name: guess.columns.name, college: guess.columns.college },
      // Three rows to check the columns against. Columns we must not take are blanked out.
      sample: rows.slice(0, 3).map((r) => headers.map((h, i) => (allowed[i] ? String(r[i] || '') : '—'))),
      total_rows: rows.length,
    };
  });
}

/** Admin: imports ID, name and college for everyone on the namelist and switches the student check to ROSTER. */
function adminImportNamelist(form) {
  return staffCall_('admin', (me) => {
    form = form || {};
    const settings = getSettings_();
    const src = openNamelist_(form.link, form.tab);
    const headerRow = wholeNumber_(form.header_row, 1, 50, 'BAD_REQUEST') - 1;
    const headers = src.values[headerRow] || [];
    const column = (value, required) => {
      if (value === '' || value == null) {
        if (required) throw new ApiError('NAMELIST_COLUMNS');
        return -1;
      }
      const index = wholeNumber_(value, 0, Math.max(0, headers.length - 1), 'NAMELIST_COLUMNS');
      if (classifyHeader_(headers[index]) === 'never') throw new ApiError('NAMELIST_COLUMNS');
      return index;
    };
    const idCol = column(form.id_col, true);
    const nameCol = column(form.name_col, true);
    const collegeCol = column(form.college_col, false);
    if (idCol === nameCol || idCol === collegeCol || nameCol === collegeCol) throw new ApiError('NAMELIST_COLUMNS');

    const seen = {};
    const people = [];
    let invalid = 0;
    let duplicates = 0;
    const otherColleges = {}; // Values that are none of ours: kept as written and listed for the admin.
    src.values.slice(headerRow + 1).forEach((row) => {
      const rawId = String(row[idCol] || '').trim();
      if (!rawId && !String(row[nameCol] || '').trim()) return; // Blank row.
      const id = StudentId.normalise(rawId);
      if (!StudentId.isValid(id, settings.student_id_pattern)) return invalid++;
      if (seen[id]) return duplicates++;
      seen[id] = true;
      const written = collegeCol >= 0 ? safeText_(row[collegeCol], 60) : '';
      const college = Colleges.match(written);
      if (written && !college) otherColleges[written] = (otherColleges[written] || 0) + 1;
      people.push({ id: id, name: safeText_(row[nameCol], 120), college: college || written });
    });
    if (!people.length) throw new ApiError('NAMELIST_EMPTY');

    Db.ensureHeaders('Students');
    return Db.withLock(() => {
      const existing = Db.read('Students');
      const byKey = {};
      existing.forEach((s) => { byKey[String(s.student_key)] = s; });
      const onList = {};
      const rows = people.map((p) => {
        const key = studentKey_(p.id);
        onList[key] = true;
        // Keep visit history for students already known; take name and college from the namelist.
        return Object.assign({ faculty_code: '', consent_at: '', first_visit_at: '', last_visit_at: '', visit_count: 0 },
          byKey[key] || {}, { student_key: key, student_id: p.id, name: p.name, program: '', college: p.college, source: 'ROSTER' });
      });
      let removed = 0;
      let keptAsSelf = 0;
      existing.forEach((s) => {
        if (onList[String(s.student_key)]) return;
        if (s.source !== 'ROSTER') return rows.push(s);
        // Off the new namelist: drop entries with no visits; keep visitors (retention removes them after a year).
        if (Number(s.visit_count) > 0) {
          keptAsSelf++;
          rows.push(Object.assign({}, s, { source: 'SELF' }));
        } else {
          removed++;
        }
      });
      Db.writeAll('Students', rows);
      writeSetting_('student_mode', 'ROSTER');
      writeSetting_('namelist_id', src.id);
      audit_(me, 'namelist_import', people.length + ' students from "' + src.name + '" (' + src.tab + ')');
      return {
        imported: people.length, invalid: invalid, duplicates: duplicates, removed: removed, kept_as_self: keptAsSelf, file_name: src.name,
        other_colleges: Object.keys(otherColleges).map((name) => ({ name: name, students: otherColleges[name] })),
      };
    });
  });
}
