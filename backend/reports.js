// Staff reports and CSV export (CLAUDE.md section 5.8). Transactions and Visits are read by date slice.

const REPORT_ROW_LIMIT = 3000;

function nameMaps_() {
  const items = {};
  Db.read('Items').forEach((i) => { items[String(i.item_id)] = String(i.name); });
  const locations = {};
  Db.read('Locations').forEach((l) => { locations[String(l.location_id)] = String(l.name); });
  return { items: items, locations: locations };
}

function stockReport_() {
  const settings = getSettings_();
  const locations = Db.read('Locations').filter((l) => truthy_(l.active));
  const stock = stockMap_();
  const thresholds = thresholdMap_();
  const rows = sortItems_(Db.read('Items').filter((i) => truthy_(i.active))).map((item) => ({
    item_id: String(item.item_id),
    name: String(item.name),
    category: String(item.category || ''),
    cells: locations.map((loc) => {
      const key = Stock.key(item.item_id, loc.location_id);
      return {
        on_hand: stock[key] || 0,
        stocked: key in stock,
        threshold: key in thresholds ? thresholds[key] : settings.default_threshold,
      };
    }),
  }));
  return {
    locations: locations.map((l) => ({ location_id: String(l.location_id), name: String(l.name), type: String(l.type) })),
    rows: rows,
  };
}

function transactionsReport_(filters) {
  const range = dayRange_(filters.from, filters.to);
  const names = nameMaps_();
  const rows = Db.slice('Transactions', 'recorded_at', range.from, range.to)
    .filter((t) => (!filters.location_id || String(t.location_id) === filters.location_id) &&
      (!filters.item_id || String(t.item_id) === filters.item_id) &&
      (!filters.type || t.type === filters.type))
    .map((t) => ({
      occurred_at: t.occurred_at,
      recorded_at: t.recorded_at,
      location: names.locations[t.location_id] || t.location_id,
      type: t.type,
      item_id: t.item_id,
      item: names.items[t.item_id] || t.item_id,
      quantity: Number(t.quantity),
      visit_id: t.visit_id,
      batch_id: t.batch_id,
      staff_email: t.staff_email,
      reason: t.reason,
      flag: t.flag,
    }));
  return rows;
}

function visitsReport_(filters) {
  const range = dayRange_(filters.from, filters.to);
  const names = nameMaps_();
  const visits = Db.slice('Visits', 'recorded_at', range.from, range.to)
    .filter((v) => (!filters.location_id || String(v.location_id) === filters.location_id) &&
      (!filters.flagged_only || truthy_(v.flagged)));
  // Large lines for flagged visits, from the same slice of the ledger.
  const large = {};
  if (visits.some((v) => truthy_(v.flagged))) {
    Db.slice('Transactions', 'recorded_at', range.from, range.to).forEach((t) => {
      if (t.flag !== 'LARGE') return;
      (large[t.visit_id] = large[t.visit_id] || []).push((names.items[t.item_id] || t.item_id) + ' × ' + -Number(t.quantity));
    });
  }
  return visits.map((v) => ({
    visit_id: v.visit_id,
    occurred_at: v.occurred_at,
    recorded_at: v.recorded_at,
    location: names.locations[v.location_id] || v.location_id,
    lines: Number(v.line_count),
    flagged: truthy_(v.flagged),
    large_lines: (large[v.visit_id] || []).join('; '),
    unverified_student: truthy_(v.unverified_student),
    source: v.source,
    voided: truthy_(v.voided),
  }));
}

function limited_(rows) {
  return { total: rows.length, rows: rows.slice(-REPORT_ROW_LIMIT), limited: rows.length > REPORT_ROW_LIMIT };
}

function staffStockReport() {
  return staffCall_('staff', () => stockReport_());
}

function staffTransactionsReport(filters) {
  return staffCall_('staff', () => limited_(transactionsReport_(filters || {})));
}

function staffVisitsReport(filters) {
  return staffCall_('staff', () => limited_(visitsReport_(filters || {})));
}

/** CSV text for a report: 'stock', 'transactions' or 'visits'. Times are Malaysia time. */
function staffReportCsv(kind, filters) {
  return staffCall_('staff', () => {
    filters = filters || {};
    let rows;
    if (kind === 'stock') {
      const report = stockReport_();
      rows = [['item_id', 'item', 'category'].concat(report.locations.map((l) => l.name))];
      report.rows.forEach((r) => rows.push([r.item_id, r.name, r.category].concat(r.cells.map((c) => c.on_hand))));
    } else if (kind === 'transactions') {
      const data = transactionsReport_(filters);
      const fields = ['occurred_at', 'recorded_at', 'location', 'type', 'item_id', 'item', 'quantity', 'visit_id', 'batch_id', 'staff_email', 'reason', 'flag'];
      rows = [fields].concat(data.map((r) => fields.map((f) => (r[f] instanceof Date ? formatTime_(r[f]) : r[f]))));
    } else if (kind === 'visits') {
      const data = visitsReport_(filters);
      const fields = ['visit_id', 'occurred_at', 'recorded_at', 'location', 'lines', 'flagged', 'large_lines', 'unverified_student', 'source', 'voided'];
      rows = [fields].concat(data.map((r) => fields.map((f) => (r[f] instanceof Date ? formatTime_(r[f]) : r[f]))));
    } else {
      throw new ApiError('BAD_REQUEST');
    }
    return { filename: 'foodbank-' + kind + '-' + formatDay_(new Date()) + '.csv', csv: Csv.stringify(rows) };
  });
}

// ---- Dashboard (docs/DECISIONS.md 36) ----

/** Days, weeks or months for the visits chart, so a long range never draws hundreds of bars. */
function dashboardBuckets_(from, to) {
  const days = [];
  for (let t = from.getTime(); t < to.getTime(); t += 24 * 60 * 60 * 1000) days.push(formatDay_(new Date(t)));
  const unit = days.length > 186 ? 'month' : days.length > 62 ? 'week' : 'day';
  const keyOf = (day) => {
    if (unit === 'day') return day;
    if (unit === 'month') return day.slice(0, 7);
    // Weeks start on Monday.
    const date = Utilities.parseDate(day, TZ, 'yyyy-MM-dd');
    const weekday = Number(Utilities.formatDate(date, TZ, 'u')); // 1 = Monday
    return formatDay_(new Date(date.getTime() - (weekday - 1) * 24 * 60 * 60 * 1000));
  };
  const keys = [];
  days.forEach((d) => { if (keys.indexOf(keyOf(d)) < 0) keys.push(keyOf(d)); });
  return { unit: unit, keys: keys, keyOf: keyOf, days: days.length };
}

/** Figures for the Reports dashboard: totals, visits over time, top items, stock to act on. No student data. */
function dashboard_(filters) {
  const range = dayRange_(filters.from, filters.to);
  const locationId = String(filters.location_id || '');
  const names = nameMaps_();
  const settings = getSettings_();
  const inLocation = (r) => !locationId || String(r.location_id) === locationId;
  const visits = Db.slice('Visits', 'recorded_at', range.from, range.to).filter((v) => !truthy_(v.voided) && inLocation(v));
  const txns = Db.slice('Transactions', 'recorded_at', range.from, range.to).filter(inLocation);

  const buckets = dashboardBuckets_(range.from, range.to);
  const perBucket = {};
  buckets.keys.forEach((k) => { perBucket[k] = 0; });
  const students = {};
  const byLocation = {};
  visits.forEach((v) => {
    const key = buckets.keyOf(formatDay_(v.occurred_at));
    if (key in perBucket) perBucket[key]++;
    if (v.student_key) students[v.student_key] = true;
    byLocation[v.location_id] = (byLocation[v.location_id] || 0) + 1;
  });

  const given = {};
  let itemsOut = 0;
  let received = 0;
  txns.forEach((t) => {
    const qty = Number(t.quantity) || 0;
    if (t.type === 'OUT' || t.type === 'VOID') { // A void cancels the OUT it reverses.
      given[t.item_id] = (given[t.item_id] || 0) - qty;
      itemsOut -= qty;
    } else if (t.type === 'IN') {
      received += qty;
    }
  });
  const items = Object.keys(given).filter((id) => given[id] > 0)
    .map((id) => ({ item_id: id, name: names.items[id] || id, quantity: given[id] }))
    .sort((a, b) => b.quantity - a.quantity);
  const top = items.slice(0, 8);
  const rest = items.slice(8).reduce((sum, i) => sum + i.quantity, 0);
  if (rest > 0) top.push({ item_id: '', name: 'Other items', quantity: rest });

  const stock = stockReport_();
  const lowStock = [];
  stock.rows.forEach((row) => {
    row.cells.forEach((cell, i) => {
      const loc = stock.locations[i];
      if (!cell.stocked || (locationId && loc.location_id !== locationId) || cell.on_hand > cell.threshold) return;
      lowStock.push({ item: row.name, location: loc.name, on_hand: cell.on_hand, threshold: cell.threshold, status: cell.on_hand <= 0 ? 'out' : 'low' });
    });
  });
  lowStock.sort((a, b) => a.on_hand - b.on_hand);

  const flagged = visits.filter((v) => truthy_(v.flagged));
  return {
    from: filters.from,
    to: filters.to,
    location: locationId ? names.locations[locationId] || locationId : 'All locations',
    student_mode: settings.student_mode,
    kpis: {
      visits: visits.length,
      students: Object.keys(students).length,
      items_out: itemsOut,
      received: received,
      flagged: flagged.length,
      not_on_namelist: visits.filter((v) => truthy_(v.unverified_student)).length,
    },
    visits_over_time: { unit: buckets.unit, points: buckets.keys.map((k) => ({ key: k, visits: perBucket[k] })) },
    by_location: Object.keys(byLocation).map((id) => ({ name: names.locations[id] || id, visits: byLocation[id] }))
      .sort((a, b) => b.visits - a.visits),
    top_items: top,
    low_stock: lowStock,
    flagged_visits: flagged.slice(-10).reverse().map((v) => ({
      visit_id: v.visit_id, occurred_at: v.occurred_at, location: names.locations[v.location_id] || v.location_id, lines: Number(v.line_count),
    })),
    generated_at: new Date(),
  };
}

function staffDashboard(filters) {
  return staffCall_('staff', () => dashboard_(filters || {}));
}

/** The Carbon stylesheet for the Reports page, sent only when that page is first opened. */
function staffCarbonStyles() {
  return staffCall_('staff', () => HtmlService.createHtmlOutputFromFile('backend/ui/staff-carbon').getContent());
}
