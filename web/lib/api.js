// Calls the Apps Script API (docs/PLAN.md section 4). Sent as text/plain so the browser skips the
// CORS preflight request that Apps Script cannot answer.

export class ApiFailure extends Error {
  constructor(code, ms, en, network) {
    super(en);
    this.code = code;
    this.ms = ms;
    this.network = network;
  }
}

const NO_CONNECTION = ['Tiada sambungan internet.', 'No internet connection.'];

export async function api(action, payload, options) {
  const { device, pantryId, timeoutMs = 25000 } = options || {};
  const body = JSON.stringify({
    action,
    payload: payload || {},
    pantry_id: pantryId || '',
    device: device ? { id: device.device_id, key: device.device_key } : null,
    app_version: window.APP_CONFIG.version,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(window.APP_CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiFailure('NETWORK', NO_CONNECTION[0], NO_CONNECTION[1], true);
  } finally {
    clearTimeout(timer);
  }
  let json;
  try {
    json = await response.json();
  } catch (err) {
    // Google sometimes answers with an HTML error page; treat it like a lost connection and retry later.
    throw new ApiFailure('NETWORK', NO_CONNECTION[0], NO_CONNECTION[1], true);
  }
  if (!json.ok) throw new ApiFailure(json.error.code, json.error.ms, json.error.en, false);
  return json.data;
}
