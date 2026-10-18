// Time-driven jobs (docs/PLAN.md 5.6 and 5.7). installTriggers_() sets them up; setup() calls it.

const JOB_HANDLERS = ['hourlyStockAlerts', 'nightlyJobs'];

function installTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => JOB_HANDLERS.indexOf(t.getHandlerFunction()) >= 0)
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('hourlyStockAlerts').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('nightlyJobs').timeBased().atHour(2).everyDays(1).inTimezone(TZ).create();
}

/** Trigger handlers are public functions, so anyone else calling them must be an admin. */
function requireTriggerOrAdmin_(e) {
  const uid = e && e.triggerUid;
  if (uid && ScriptApp.getProjectTriggers().some((t) => t.getUniqueId() === String(uid))) return;
  requireAdmin_();
}

function hourlyStockAlerts(e) {
  requireTriggerOrAdmin_(e);
  return sendStockAlerts_(new Date());
}

function nightlyJobs(e) {
  requireTriggerOrAdmin_(e);
  const now = new Date();
  const report = {
    stock_mismatches: checkStock_(now),
    retention: applyRetention_(now),
    flagged_visits: sendLargeQuantityDigest_(now),
    alert_log_pruned: pruneAlertLog_(now),
  };
  console.log(JSON.stringify(report));
  return report;
}

/** Low and zero stock emails: one per location and type, each alert at most once a day. */
function sendStockAlerts_(now) {
  const settings = getSettings_();
  const today = formatDay_(now);
  const sentToday = {};
  Db.read('AlertLog').forEach((r) => {
    if (dayText_(r.date) === today) sentToday[Alerts.logKey(r.alert_type, r.item_id, r.location_id)] = true;
  });
  const items = {};
  Db.read('Items').forEach((i) => { items[String(i.item_id)] = { active: truthy_(i.active), name: String(i.name) }; });
  const locations = {};
  Db.read('Locations').forEach((l) => { locations[String(l.location_id)] = { active: truthy_(l.active), name: String(l.name), type: String(l.type) }; });
  const reorder = {};
  Db.read('Thresholds').forEach((t) => { reorder[Stock.key(t.item_id, t.location_id)] = t.reorder_qty; });

  const alerts = Alerts.due({
    stock: Db.read('Stock').map((r) => ({ item_id: String(r.item_id), location_id: String(r.location_id), on_hand: Number(r.on_hand) || 0 })),
    items: items,
    locations: locations,
    thresholds: thresholdMap_(),
    defaultThreshold: settings.default_threshold,
    sentToday: sentToday,
  });
  const recipients = alertRecipients_();
  if (!alerts.length || !recipients.length) return 0;

  const groups = {};
  alerts.forEach((a) => { (groups[a.location_id + '|' + a.type] = groups[a.location_id + '|' + a.type] || []).push(a); });
  let sent = 0;
  Object.keys(groups).forEach((groupKey) => {
    const group = groups[groupKey];
    const location = locations[group[0].location_id];
    const zero = group[0].type === 'ZERO';
    const advice = location.type === 'STORE'
      ? 'Central Store stock is low: arrange donations or reorder.'
      : 'Pantry stock is low: move stock from the Central Store.';
    const subject = (zero ? '[URGENT] Out of stock at ' : 'Low stock at ') + location.name + ': ' + group.length + ' item(s)';
    const html = '<p><b>' + escapeHtml_(location.name) + '</b>. ' + escapeHtml_(advice) + '</p>' + htmlTable_(
      ['Item', 'On hand', 'Threshold', 'Reorder qty'],
      group.map((a) => [items[a.item_id].name, a.on_hand, a.threshold, reorder[Stock.key(a.item_id, a.location_id)] || ''])
    );
    sendMail_(recipients, subject, html);
    Db.append('AlertLog', group.map((a) => ({ date: today, location_id: a.location_id, item_id: a.item_id, alert_type: a.type, sent_at: now })));
    sent += group.length;
  });
  return sent;
}

/** Nightly: Stock must equal archived totals plus the ledger. Runs inside the lock so no visit lands mid-check. */
function checkStock_(now) {
  return Db.withLock(() => {
    const ledger = Db.readColumns('Transactions', ['location_id', 'item_id', 'quantity']).map((r) => ({
      item_id: String(r.item_id), location_id: String(r.location_id), quantity: Number(r.quantity) || 0,
    }));
    const archived = {};
    Db.read('ArchiveTotals').forEach((r) => { archived[Stock.key(r.item_id, r.location_id)] = Number(r.archived_sum) || 0; });
    const problems = Stock.mismatches(Stock.apply(archived, ledger), stockMap_());
    if (problems.length) {
      sendMail_(adminRecipients_(), 'Stock check found ' + problems.length + ' mismatch(es)',
        '<p>The cached stock does not match the ledger. Check for direct edits to the Stock tab. Checked ' +
        escapeHtml_(formatTime_(now)) + '.</p>' +
        htmlTable_(['Item', 'Location', 'Ledger says', 'Stock tab says'], problems.map((p) => [p.item_id, p.location_id, p.expected, p.cached])));
    }
    return problems.length;
  });
}

/** PDPA retention: blank student keys on old visits and remove self-registered students not seen for a year. */
function applyRetention_(now) {
  const days = getSettings_().retention_days;
  return Db.withLock(() => {
    const visits = Db.readColumns('Visits', ['recorded_at', 'student_key']);
    const old = Retention.visitsToAnonymise(visits, now, days);
    if (old.length) {
      const keys = visits.map((v) => v.student_key);
      old.forEach((i) => { keys[i] = ''; });
      Db.writeColumn('Visits', 'student_key', keys);
    }
    const students = Db.read('Students');
    const gone = Retention.studentsToRemove(students, now, days).map((i) => students[i]._row);
    if (gone.length) Db.deleteRows('Students', gone);
    return { visits_anonymised: old.length, students_removed: gone.length };
  });
}

/** One email per location listing yesterday's visits with a line of 10 or more. No student data. */
function sendLargeQuantityDigest_(now) {
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const flagged = Db.slice('Visits', 'recorded_at', from, now).filter((v) => truthy_(v.flagged) && !truthy_(v.voided));
  if (!flagged.length) return 0;
  const names = nameMaps_();
  const lines = {};
  Db.slice('Transactions', 'recorded_at', from, now).forEach((t) => {
    if (t.flag === 'LARGE') (lines[t.visit_id] = lines[t.visit_id] || []).push((names.items[t.item_id] || t.item_id) + ' × ' + -Number(t.quantity));
  });
  const byLocation = {};
  flagged.forEach((v) => { (byLocation[v.location_id] = byLocation[v.location_id] || []).push(v); });
  const recipients = alertRecipients_();
  Object.keys(byLocation).forEach((locationId) => {
    const visits = byLocation[locationId];
    const location = names.locations[locationId] || locationId;
    sendMail_(recipients, 'Large quantities to review at ' + location + ': ' + visits.length + ' visit(s)',
      '<p>These visits at <b>' + escapeHtml_(location) + '</b> had 10 or more of one item. They were not blocked. ' +
      'Review them in the staff app (Reports), and void any that were mistakes.</p>' +
      htmlTable_(['Visit ID', 'Time', 'Large lines'], visits.map((v) => [v.visit_id, formatTime_(v.occurred_at), (lines[v.visit_id] || []).join('; ')])));
  });
  return flagged.length;
}

function pruneAlertLog_(now) {
  const cutoff = formatDay_(new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000));
  return Db.withLock(() => {
    const old = Db.read('AlertLog').filter((r) => dayText_(r.date) < cutoff).map((r) => r._row);
    if (old.length) Db.deleteRows('AlertLog', old);
    return old.length;
  });
}
