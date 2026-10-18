// Staff pages (HtmlService), served by the UiTM-only deployment (docs/PLAN.md 5.3 and 5.9).

function doGet() {
  let me;
  try {
    me = currentStaff_();
  } catch (err) {
    const message = errorBody_(err).error.en;
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px">' +
      '<h1 style="font-size:20px">Food Bank URHP: staff</h1><p>' + escapeHtml_(message) + '</p></div>'
    ).setTitle('Food Bank URHP');
  }
  const page = HtmlService.createTemplateFromFile('backend/ui/staff');
  // JSON inside a <script> tag: escape "<" so no value can close the tag.
  page.boot = JSON.stringify({ me: me }).replace(/</g, '\\u003c');
  return page.evaluate()
    .setTitle('Food Bank URHP: staff')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

/** Everything the staff pages need on load. Admins also get settings and the staff list. */
function staffBootstrap() {
  return staffCall_('staff', (me) => {
    const settings = getSettings_();
    const data = {
      me: me,
      settings: me.role === 'admin' ? settings : {
        default_threshold: settings.default_threshold,
        large_qty_threshold: settings.large_qty_threshold,
        pwa_url: settings.pwa_url,
      },
      item_categories: listSetting_(settings.item_categories),
      item_units: listSetting_(settings.item_units),
      locations: Db.read('Locations').map((l) => ({
        location_id: String(l.location_id), name: String(l.name), type: String(l.type), active: truthy_(l.active),
      })),
      items: sortItems_(Db.read('Items')).map((i) => ({
        item_id: String(i.item_id),
        name: String(i.name),
        category: String(i.category || ''),
        unit: String(i.unit || ''),
        sort_order: i.sort_order === '' ? '' : Number(i.sort_order),
        active: truthy_(i.active),
        photo_version: String(i.photo_version || ''),
      })),
      barcodes: Db.read('Barcodes').map((b) => ({ code: String(b.code), item_id: String(b.item_id) })),
      thresholds: Db.read('Thresholds').map((t) => ({
        item_id: String(t.item_id), location_id: String(t.location_id), threshold: t.threshold, reorder_qty: t.reorder_qty,
      })),
      stock: stockMap_(),
      faculties: Db.read('Faculties').map((f) => ({
        faculty_code: String(f.faculty_code), name_ms: String(f.name_ms), name_en: String(f.name_en), active: truthy_(f.active),
      })),
      unknown_barcodes: Db.read('UnknownBarcodes').map((u) => ({
        code: String(u.code), location_id: String(u.location_id), last_seen: u.last_seen, times_seen: Number(u.times_seen) || 0,
      })),
    };
    if (me.role === 'admin') {
      data.staff = Db.read('Staff').map((s) => ({
        email: String(s.email), name: String(s.name), role: String(s.role), receives_alerts: truthy_(s.receives_alerts), active: truthy_(s.active),
      }));
    }
    return data;
  });
}
