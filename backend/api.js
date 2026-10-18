// Public JSON API for the PWA (docs/PLAN.md section 4). Deployed as "Anyone": every input is checked here.
// Requests are POSTed as text/plain, because Apps Script does not answer CORS preflight requests.

function doPost(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return jsonOut_(errorBody_(new ApiError('BAD_REQUEST')));
  }
  try {
    return jsonOut_({ ok: true, data: handlePublic_(request || {}) });
  } catch (err) {
    return jsonOut_(errorBody_(err));
  }
}

function jsonOut_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function handlePublic_(request) {
  const action = String(request.action || '');
  const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
  if (action === 'ping') return { time: new Date().toISOString() };
  if (action === 'redeemSetupCode') return redeemSetupCode_(payload);
  if (action === 'photos') return { photos: photosFor_(payload.item_ids) };

  const ctx = requestContext_(request);
  if (action === 'catalog') return catalogFor_(payload, ctx);
  if (action === 'checkStudent') return checkStudent_(payload, ctx);
  if (action === 'submitVisit') return { status: saveVisit_(payload, ctx) };
  if (action === 'syncVisits') {
    if (!ctx.device) throw new ApiError('DEVICE_REQUIRED');
    return syncVisits_(payload, ctx);
  }
  throw new ApiError('UNKNOWN_ACTION');
}

/** Settings, the pantry device (if any), and the pantry this request is for. */
function requestContext_(request) {
  const settings = getSettings_();
  const device = request.device ? deviceFromRequest_(request.device) : null;
  const locationId = device ? device.location_id : String(request.pantry_id || '');
  const location = locationsById_()[locationId];
  if (!location || !truthy_(location.active) || location.type !== 'PANTRY') throw new ApiError('PANTRY_UNKNOWN');
  return {
    settings: settings,
    device: device,
    location: location,
    app_version: safeText_(request.app_version, 20),
  };
}
