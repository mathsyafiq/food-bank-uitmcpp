// Printable QR posters and barcode labels (CLAUDE.md section 12, deliverable 8). The encoders live in core/ so
// Node tests can read their output back with ZXing; the staff page only draws the modules it gets here.

/** The student app link for one pantry: the pwa_url setting with p=<location_id>, replacing any p already there. */
function pantryLink_(base, locationId) {
  const parts = String(base).split('#')[0].split('?');
  const query = (parts[1] || '').split('&').filter((p) => p && !/^p=/.test(p));
  query.push('p=' + encodeURIComponent(locationId));
  return parts[0] + '?' + query.join('&');
}

/** Admin Setup page: one poster per active pantry, with its QR code as rows of "0" and "1". */
function adminQrPosters() {
  return staffCall_('admin', () => {
    const base = getSettings_().pwa_url;
    return Db.read('Locations')
      .filter((l) => truthy_(l.active) && String(l.type) === 'PANTRY')
      .map((l) => {
        const url = pantryLink_(base, String(l.location_id));
        const qr = Qr.encode(url, 'Q');
        return {
          location_id: String(l.location_id),
          name: String(l.name),
          url: url,
          modules: qr.modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')),
        };
      });
  });
}

/** Items page: the Code 128 bars ("1" = bar) for every item's internal code, {item_id: bars}. */
function staffItemLabels() {
  return staffCall_('staff', () => {
    const labels = {};
    Db.read('Items').forEach((item) => {
      const id = String(item.item_id);
      if (Gtin.internalCode(id) === id) labels[id] = Code128.encode(id);
    });
    return labels;
  });
}
