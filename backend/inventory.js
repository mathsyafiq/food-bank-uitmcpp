// The stock ledger: saving visits (docs/PLAN.md 5.1) and staff stock work (CLAUDE.md 5.2 to 5.6).
// Transactions are never edited or deleted. Corrections are new ADJUST or VOID rows.

function stockMap_() {
  const map = {};
  Db.read('Stock').forEach((r) => { map[Stock.key(r.item_id, r.location_id)] = Number(r.on_hand) || 0; });
  return map;
}

/** Adds ledger rows to the Stock cache. Call inside Db.withLock. */
function applyStock_(rows, now) {
  const stock = Db.read('Stock').slice();
  const byKey = {};
  stock.forEach((r) => { byKey[Stock.key(r.item_id, r.location_id)] = r; });
  rows.forEach((r) => {
    const key = Stock.key(r.item_id, r.location_id);
    if (!byKey[key]) {
      byKey[key] = { item_id: r.item_id, location_id: r.location_id, on_hand: 0 };
      stock.push(byKey[key]);
    }
    byKey[key].on_hand = (Number(byKey[key].on_hand) || 0) + r.quantity;
    byKey[key].updated_at = now;
  });
  Db.writeAll('Stock', stock);
}

/** Appends ledger rows and updates Stock. Call inside Db.withLock. */
function writeLedger_(rows, common) {
  if (!rows.length) return;
  Db.append('Transactions', rows.map((r) => Object.assign({
    txn_id: Utilities.getUuid(),
    occurred_at: common.recorded_at,
  }, common, r)));
  applyStock_(rows, common.recorded_at);
}

function coreRows_(fn) {
  try {
    return fn();
  } catch (err) {
    if (Object.prototype.hasOwnProperty.call(MESSAGES, err.message)) throw new ApiError(err.message);
    throw err;
  }
}

function requireKnownItems_(rows) {
  const items = itemsById_();
  rows.forEach((r) => { if (!items[r.item_id]) throw new ApiError('ITEM_NOT_FOUND'); });
}

function quantitiesFrom_(form) {
  const quantities = {};
  const raw = (form && form.quantities) || {};
  Object.keys(raw).slice(0, 300).forEach((k) => { quantities[String(k)] = raw[k]; });
  return quantities;
}

// ---- Student visits (public API) ----

function countPublicSubmit_(settings) {
  const cache = CacheService.getScriptCache();
  const key = 'pub:' + Math.floor(Date.now() / 60000);
  const count = (Number(cache.get(key)) || 0) + 1;
  if (count > settings.public_submits_per_minute) throw new ApiError('TOO_MANY_REQUESTS');
  cache.put(key, String(count), 120);
}

/** Saves one visit. Returns 'saved', or 'duplicate' if this visit_id was saved before (idempotent sync). */
function saveVisit_(payload, ctx) {
  const settings = ctx.settings;
  const knownItems = {};
  Object.keys(itemsById_()).forEach((id) => { knownItems[id] = true; });
  const check = Visit.validate(payload, {
    knownItems: knownItems,
    maxLineQty: settings.max_line_qty,
    largeQty: settings.large_qty_threshold,
  });
  if (!check.ok) throw new ApiError(check.errors[0]);
  const student = readStudent_(payload.student, settings);
  const visitId = String(payload.visit_id).toLowerCase();
  const unknownCodes = (Array.isArray(payload.unknown_barcodes) ? payload.unknown_barcodes : [])
    .slice(0, 20).map(Gtin.lookupKey).filter(Boolean);
  const locationId = String(ctx.location.location_id);

  return Db.withLock(() => {
    if (Db.findRow('Visits', 'visit_id', visitId)) return 'duplicate';
    if (!ctx.device) countPublicSubmit_(settings);
    const now = new Date();
    const occurredAt = check.occurredAt > now ? now : check.occurredAt; // A fast device clock never dates a visit in the future.
    const studentResult = recordStudent_(student, settings, occurredAt);
    Db.append('Visits', [{
      visit_id: visitId,
      occurred_at: occurredAt,
      recorded_at: now,
      location_id: locationId,
      student_key: student.key,
      line_count: check.lines.length,
      flagged: check.flagged,
      unverified_student: studentResult.unverified,
      source: ctx.device ? 'PANTRY_DEVICE' : 'PUBLIC',
      device_id: ctx.device ? ctx.device.device_id : '',
      app_version: ctx.app_version,
      voided: false,
    }]);
    writeLedger_(check.lines.map((line) => ({
      type: 'OUT',
      item_id: line.item_id,
      location_id: locationId,
      quantity: -line.qty,
      flag: line.qty >= settings.large_qty_threshold ? 'LARGE' : '',
    })), {
      recorded_at: now,
      occurred_at: occurredAt,
      visit_id: visitId,
      source_device: ctx.device ? ctx.device.device_id : 'PUBLIC',
      app_version: ctx.app_version,
    });
    recordUnknownBarcodes_(unknownCodes, locationId, now);
    return 'saved';
  });
}

/** Public API, pantry devices only: up to 20 queued visits, with a result for each. */
function syncVisits_(payload, ctx) {
  const visits = Array.isArray(payload.visits) ? payload.visits.slice(0, 20) : [];
  const results = [];
  for (let i = 0; i < visits.length; i++) {
    const visitId = visits[i] && visits[i].visit_id;
    try {
      results.push({ visit_id: visitId, status: saveVisit_(visits[i], ctx) });
    } catch (err) {
      const body = errorBody_(err);
      // Busy or unexpected errors stop the batch; unanswered visits stay queued on the device.
      if (body.error.code === 'BUSY' || body.error.code === 'SERVER_ERROR' || body.error.code === 'TOO_MANY_REQUESTS') break;
      results.push({ visit_id: visitId, status: 'rejected', error: body.error.code });
    }
  }
  return { results: results };
}

// ---- Staff stock work ----

function staffReceive(form) {
  return staffCall_('staff', (me) => {
    const location = activeLocation_(form && form.location_id);
    const rows = coreRows_(() => Stock.receiveRows(String(location.location_id), quantitiesFrom_(form)));
    if (!rows.length) throw new ApiError('NOTHING_TO_SAVE');
    requireKnownItems_(rows);
    const deliveryDate = form.delivery_date ? parseDay_(form.delivery_date) : '';
    return Db.withLock(() => {
      const now = new Date();
      const batchId = newId_('IN');
      Db.append('Batches', [{
        batch_id: batchId, type: 'IN', created_at: now, location_id: location.location_id, staff_email: me.email,
        donor_source: safeText_(form.donor_source, 200), delivery_date: deliveryDate, note: safeText_(form.note, 500),
      }]);
      writeLedger_(rows.map((r) => Object.assign({ type: 'IN' }, r)), {
        recorded_at: now, batch_id: batchId, staff_email: me.email, source_device: 'STAFF',
      });
      return { batch_id: batchId, lines: rows.length };
    });
  });
}

function staffTransfer(form) {
  return staffCall_('staff', (me) => {
    const from = activeLocation_(form && form.from_location_id);
    const to = activeLocation_(form.to_location_id);
    const rows = coreRows_(() => Stock.transferRows(String(from.location_id), String(to.location_id), quantitiesFrom_(form)));
    if (!rows.length) throw new ApiError('NOTHING_TO_SAVE');
    requireKnownItems_(rows);
    return Db.withLock(() => {
      const now = new Date();
      const batchId = newId_('TR');
      Db.append('Batches', [{
        batch_id: batchId, type: 'TRANSFER', created_at: now, location_id: from.location_id,
        to_location_id: to.location_id, staff_email: me.email, note: safeText_(form.note, 500),
      }]);
      writeLedger_(rows.map((r) => Object.assign({ type: 'TRANSFER' }, r)), {
        recorded_at: now, batch_id: batchId, staff_email: me.email, source_device: 'STAFF',
      });
      return { batch_id: batchId, items: rows.length / 2 };
    });
  });
}

/** Stock count: the difference is worked out here, inside the lock, from the on-hand at this moment. */
function staffCount(form) {
  return staffCall_('staff', (me) => {
    const location = activeLocation_(form && form.location_id);
    const counts = quantitiesFrom_(form);
    requireKnownItems_(Object.keys(counts).map((id) => ({ item_id: id })));
    return Db.withLock(() => {
      const now = new Date();
      const rows = coreRows_(() => Stock.countRows(stockMap_(), String(location.location_id), counts));
      const batchId = newId_('CT');
      Db.append('Batches', [{
        batch_id: batchId, type: 'COUNT', created_at: now, location_id: location.location_id,
        staff_email: me.email, note: safeText_(form.note, 500),
      }]);
      writeLedger_(rows.map((r) => Object.assign({ type: 'ADJUST', reason: 'stock count' }, r)), {
        recorded_at: now, batch_id: batchId, staff_email: me.email, source_device: 'STAFF',
      });
      return { batch_id: batchId, adjusted: rows.length };
    });
  });
}

const ADJUST_REASONS = ['damaged', 'expired', 'correction', 'other'];

function staffAdjust(form) {
  return staffCall_('staff', (me) => {
    form = form || {};
    const location = activeLocation_(form.location_id);
    const itemId = String(form.item_id || '');
    requireKnownItems_([{ item_id: itemId }]);
    const quantity = wholeNumber_(form.quantity, -100000, 100000);
    if (quantity === 0) throw new ApiError('QTY_INVALID');
    const reason = String(form.reason || '');
    const note = safeText_(form.note, 500);
    if (ADJUST_REASONS.indexOf(reason) < 0 || (reason === 'other' && !note)) throw new ApiError('REASON_REQUIRED');
    return Db.withLock(() => {
      const now = new Date();
      const batchId = newId_('AD');
      Db.append('Batches', [{
        batch_id: batchId, type: 'ADJUST', created_at: now, location_id: location.location_id, staff_email: me.email, note: note,
      }]);
      writeLedger_([{ type: 'ADJUST', item_id: itemId, location_id: String(location.location_id), quantity: quantity, reason: reason }], {
        recorded_at: now, batch_id: batchId, staff_email: me.email, source_device: 'STAFF',
      });
      return { batch_id: batchId };
    });
  });
}

/** A visit and its lines, for the void screen. Shows no student data. */
function staffFindVisit(visitId) {
  return staffCall_('staff', () => {
    const id = String(visitId || '').trim().toLowerCase();
    const row = Db.findRow('Visits', 'visit_id', id);
    if (!row) throw new ApiError('VISIT_NOT_FOUND');
    const visit = Db.readRow('Visits', row);
    const items = itemsById_();
    const lines = Db.findRows('Transactions', 'visit_id', id).map((r) => Db.readRow('Transactions', r))
      .map((t) => ({ type: t.type, item_id: t.item_id, name: items[t.item_id] ? items[t.item_id].name : t.item_id, quantity: t.quantity }));
    return {
      visit_id: id,
      occurred_at: visit.occurred_at,
      recorded_at: visit.recorded_at,
      location_id: visit.location_id,
      flagged: truthy_(visit.flagged),
      voided: truthy_(visit.voided),
      lines: lines,
    };
  });
}

/** Reverses every OUT line of a visit with VOID rows. The original rows stay. */
function staffVoidVisit(form) {
  return staffCall_('staff', (me) => {
    const id = String((form && form.visit_id) || '').trim().toLowerCase();
    const reason = safeText_(form.reason, 300);
    if (!reason) throw new ApiError('REASON_REQUIRED');
    return Db.withLock(() => {
      const row = Db.findRow('Visits', 'visit_id', id);
      if (!row) throw new ApiError('VISIT_NOT_FOUND');
      const visit = Db.readRow('Visits', row);
      if (truthy_(visit.voided)) throw new ApiError('ALREADY_VOIDED');
      const outs = Db.findRows('Transactions', 'visit_id', id).map((r) => Db.readRow('Transactions', r))
        .filter((t) => t.type === 'OUT');
      const now = new Date();
      const batchId = newId_('VD');
      Db.append('Batches', [{
        batch_id: batchId, type: 'VOID', created_at: now, location_id: visit.location_id, staff_email: me.email, note: reason,
      }]);
      writeLedger_(outs.map((t) => ({
        type: 'VOID', item_id: String(t.item_id), location_id: String(t.location_id), quantity: -Number(t.quantity), reason: reason,
      })), { recorded_at: now, batch_id: batchId, visit_id: id, staff_email: me.email, source_device: 'STAFF' });
      visit.voided = true;
      Db.writeRow('Visits', visit);
      return { batch_id: batchId, lines: outs.length };
    });
  });
}
