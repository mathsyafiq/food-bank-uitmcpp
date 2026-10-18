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
