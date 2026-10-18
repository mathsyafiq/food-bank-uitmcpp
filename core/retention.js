// PDPA retention rules (CLAUDE.md section 7). Shared by Apps Script and Node tests.
var Retention = (function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  function time(value) {
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
  }

  function cutoff(now, days) {
    return new Date(now.getTime() - days * DAY_MS);
  }

  /** Indexes of visits older than the retention period that still hold a student key. */
  function visitsToAnonymise(visits, now, days) {
    var limit = cutoff(now, days).getTime();
    var indexes = [];
    visits.forEach(function (visit, i) {
      if (visit.student_key && time(visit.recorded_at) < limit) indexes.push(i);
    });
    return indexes;
  }

  /** Indexes of self-registered students with no visit within the retention period. */
  function studentsToRemove(students, now, days) {
    var limit = cutoff(now, days).getTime();
    var indexes = [];
    students.forEach(function (student, i) {
      if (student.source === 'SELF' && time(student.last_visit_at) < limit) indexes.push(i);
    });
    return indexes;
  }

  return { cutoff: cutoff, visitsToAnonymise: visitsToAnonymise, studentsToRemove: studentsToRemove };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Retention;
