// Items, barcodes, photos, thresholds and locations (CLAUDE.md section 5.7).

function itemsById_() {
  const map = {};
  Db.read('Items').forEach((item) => { map[String(item.item_id)] = item; });
  return map;
}

function locationsById_() {
  const map = {};
  Db.read('Locations').forEach((loc) => { map[String(loc.location_id)] = loc; });
  return map;
}

/** An active location, optionally of one type (STORE or PANTRY). */
function activeLocation_(locationId, type) {
  const location = locationsById_()[String(locationId || '')];
  if (!location || !truthy_(location.active) || (type && location.type !== type)) throw new ApiError('LOCATION_INVALID');
  return location;
}

/** {"item_id|location_id": threshold} for pairs with their own threshold. */
function thresholdMap_() {
  const map = {};
  Db.read('Thresholds').forEach((t) => {
    if (t.threshold !== '') map[Stock.key(t.item_id, t.location_id)] = Number(t.threshold);
  });
  return map;
}

function sortItems_(items) {
  return items.slice().sort((a, b) =>
    (Number(a.sort_order) || 999) - (Number(b.sort_order) || 999) || String(a.name).localeCompare(String(b.name)));
}

/** Everything the student app needs to show the pick screen. Holds no student data. */
function buildCatalog_(settings) {
  const items = sortItems_(Db.read('Items').filter((i) => truthy_(i.active))).map((i) => ({
    item_id: String(i.item_id),
    name: String(i.name),
    category: String(i.category || ''),
    unit: String(i.unit || ''),
    photo_version: String(i.photo_version || ''),
  }));
  const active = {};
  items.forEach((i) => { active[i.item_id] = true; });
  const barcodes = {};
  Db.read('Barcodes').forEach((b) => {
    if (active[String(b.item_id)]) barcodes[String(b.code)] = String(b.item_id);
  });
  return {
    items: items,
    barcodes: barcodes,
    settings: {
      student_mode: settings.student_mode,
      student_id_pattern: settings.student_id_pattern,
      large_qty_threshold: settings.large_qty_threshold,
      max_line_qty: settings.max_line_qty,
      max_items_per_visit: settings.max_items_per_visit,
      inactivity_seconds: settings.inactivity_seconds,
      thanks_seconds: settings.thanks_seconds,
    },
  };
}

/** Public API: the catalogue, or {unchanged} if the device already has this version. */
function catalogFor_(payload, ctx) {
  const catalog = buildCatalog_(ctx.settings);
  catalog.location = { location_id: String(ctx.location.location_id), name: String(ctx.location.name) };
  catalog.device = ctx.device ? { device_id: ctx.device.device_id, label: ctx.device.label } : null;
  catalog.version = sha256Hex_(JSON.stringify(catalog)).slice(0, 16);
  if (payload.version && payload.version === catalog.version) return { unchanged: true, version: catalog.version };
  return catalog;
}

/** Public API and staff pages: photos for the given items, {item_id: {version, data}}. */
function photosFor_(itemIds) {
  const wanted = {};
  (Array.isArray(itemIds) ? itemIds : []).slice(0, 60).forEach((id) => { wanted[String(id)] = true; });
  const photos = {};
  Db.read('Photos').forEach((p) => {
    if (wanted[String(p.item_id)] && p.data) photos[String(p.item_id)] = { version: String(p.photo_version), data: String(p.data) };
  });
  return photos;
}

// ---- Staff pages ----

function staffPhotos(itemIds) {
  return staffCall_('staff', () => photosFor_(itemIds));
}

function nextItemId_() {
  let max = 0;
  Db.read('Items').forEach((item) => {
    const match = /^NB-(\d+)$/.exec(String(item.item_id));
    if (match) max = Math.max(max, Number(match[1]));
  });
  return 'NB-' + String(max + 1).padStart(3, '0');
}

/** A category or unit must come from its list. Blank is fine, and so is the item's old value after a list changes. */
function checkChoice_(value, listText, current) {
  if (value === '' || value === String(current == null ? '' : current)) return;
  if (listSetting_(listText).indexOf(value) < 0) throw new ApiError('CHOICE_INVALID');
}

function staffSaveItem(form) {
  return staffCall_('staff', (me) => {
    form = form || {};
    const name = safeText_(form.name, 80);
    if (name.replace(/^'/, '').length < 2) throw new ApiError('NAME_INVALID');
    const fields = {
      name: name,
      category: safeText_(form.category, 40),
      unit: safeText_(form.unit, 30),
      sort_order: form.sort_order === '' || form.sort_order == null ? '' : wholeNumber_(form.sort_order, 0, 9999, 'BAD_REQUEST'),
      active: form.active !== false,
    };
    const settings = getSettings_();
    return Db.withLock(() => {
      const now = new Date();
      if (form.item_id) {
        const row = Db.findRow('Items', 'item_id', String(form.item_id));
        if (!row) throw new ApiError('ITEM_NOT_FOUND');
        const current = Db.readRow('Items', row);
        checkChoice_(fields.category, settings.item_categories, current.category);
        checkChoice_(fields.unit, settings.item_units, current.unit);
        const item = Object.assign(current, fields, { updated_at: now });
        Db.writeRow('Items', item);
        return { item_id: String(item.item_id) };
      }
      checkChoice_(fields.category, settings.item_categories, '');
      checkChoice_(fields.unit, settings.item_units, '');
      const item = Object.assign({ item_id: nextItemId_(), photo_version: '', created_at: now, updated_at: now }, fields);
      Db.append('Items', [item]);
      audit_(me, 'item_add', item.item_id + ' ' + name);
      return { item_id: item.item_id };
    });
  });
}

const PHOTO_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const PHOTO_MAX_CHARS = 48000; // A Sheets cell holds 50,000 characters.

function staffSetItemPhoto(itemId, dataUrl) {
  return staffCall_('staff', () => {
    if (typeof dataUrl !== 'string' || dataUrl.length > PHOTO_MAX_CHARS || !PHOTO_PATTERN.test(dataUrl)) {
      throw new ApiError('PHOTO_INVALID');
    }
    return Db.withLock(() => {
      const row = Db.findRow('Items', 'item_id', String(itemId));
      if (!row) throw new ApiError('ITEM_NOT_FOUND');
      const version = randomHex_(8);
      const photoRow = Db.findRow('Photos', 'item_id', String(itemId));
      const photo = { item_id: String(itemId), photo_version: version, data: dataUrl };
      if (photoRow) Db.writeRow('Photos', Object.assign(photo, { _row: photoRow }));
      else Db.append('Photos', [photo]);
      const item = Db.readRow('Items', row);
      item.photo_version = version;
      item.updated_at = new Date();
      Db.writeRow('Items', item);
      return { photo_version: version };
    });
  });
}

function staffRemoveItemPhoto(itemId) {
  return staffCall_('staff', () => Db.withLock(() => {
    const row = Db.findRow('Items', 'item_id', String(itemId));
    if (!row) throw new ApiError('ITEM_NOT_FOUND');
    const photoRows = Db.findRows('Photos', 'item_id', String(itemId));
    if (photoRows.length) Db.deleteRows('Photos', photoRows);
    const item = Db.readRow('Items', row);
    item.photo_version = '';
    item.updated_at = new Date();
    Db.writeRow('Items', item);
    return { removed: true };
  }));
}

function staffLinkBarcode(code, itemId) {
  return staffCall_('staff', (me) => {
    const key = Gtin.lookupKey(code);
    // Internal codes (NB-001) already scan as their item, so they never need a link.
    if (!key || Gtin.internalCode(key)) throw new ApiError('BARCODE_INVALID');
    return Db.withLock(() => {
      if (!Db.findRow('Items', 'item_id', String(itemId))) throw new ApiError('ITEM_NOT_FOUND');
      const existing = Db.findRow('Barcodes', 'code', key);
      if (existing) {
        if (String(Db.readRow('Barcodes', existing).item_id) === String(itemId)) return { code: key };
        throw new ApiError('BARCODE_TAKEN');
      }
      Db.append('Barcodes', [{ code: key, item_id: String(itemId), added_by: me.email, added_at: new Date() }]);
      const unknown = Db.findRows('UnknownBarcodes', 'code', key);
      if (unknown.length) Db.deleteRows('UnknownBarcodes', unknown);
      return { code: key };
    });
  });
}

function staffUnlinkBarcode(code) {
  return staffCall_('staff', () => Db.withLock(() => {
    const rows = Db.findRows('Barcodes', 'code', String(code || ''));
    if (rows.length) Db.deleteRows('Barcodes', rows);
    return { removed: rows.length };
  }));
}

function staffDismissUnknownBarcode(code) {
  return staffCall_('staff', () => Db.withLock(() => {
    const rows = Db.findRows('UnknownBarcodes', 'code', String(code || ''));
    if (rows.length) Db.deleteRows('UnknownBarcodes', rows);
    return { removed: rows.length };
  }));
}

/** Records barcodes students scanned that matched nothing, for staff to link. Call inside Db.withLock. */
function recordUnknownBarcodes_(codes, locationId, now) {
  if (!codes.length) return;
  const known = {};
  Db.read('Barcodes').forEach((b) => { known[String(b.code)] = true; });
  Db.read('Items').forEach((i) => { known[String(i.item_id)] = true; });
  codes.filter((c, i) => codes.indexOf(c) === i && !known[c]).forEach((code) => {
    const row = Db.findRow('UnknownBarcodes', 'code', code);
    if (row) {
      const entry = Db.readRow('UnknownBarcodes', row);
      entry.last_seen = now;
      entry.times_seen = (Number(entry.times_seen) || 0) + 1;
      Db.writeRow('UnknownBarcodes', entry);
    } else {
      Db.append('UnknownBarcodes', [{ code: code, location_id: locationId, first_seen: now, last_seen: now, times_seen: 1 }]);
    }
  });
}

/** Sets or clears (blank threshold) the threshold for one item at one location. */
function staffSetThreshold(form) {
  return staffCall_('staff', () => {
    form = form || {};
    const itemId = String(form.item_id || '');
    const location = activeLocation_(form.location_id);
    const clear = form.threshold === '' || form.threshold == null;
    const threshold = clear ? '' : wholeNumber_(form.threshold, 0, 100000, 'BAD_REQUEST');
    const reorder = form.reorder_qty === '' || form.reorder_qty == null ? '' : wholeNumber_(form.reorder_qty, 0, 100000, 'BAD_REQUEST');
    return Db.withLock(() => {
      if (!Db.findRow('Items', 'item_id', itemId)) throw new ApiError('ITEM_NOT_FOUND');
      const existing = Db.read('Thresholds').filter((t) =>
        String(t.item_id) === itemId && String(t.location_id) === String(location.location_id))[0];
      if (clear && reorder === '') {
        if (existing) Db.deleteRows('Thresholds', [existing._row]);
        return { cleared: true };
      }
      const record = { item_id: itemId, location_id: String(location.location_id), threshold: threshold, reorder_qty: reorder };
      if (existing) Db.writeRow('Thresholds', Object.assign(record, { _row: existing._row }));
      else Db.append('Thresholds', [record]);
      return { saved: true };
    });
  });
}
