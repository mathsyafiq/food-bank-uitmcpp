// Local simulator: runs the real backend code against an in-memory Sheet with demo data, so the student
// app and the staff pages can be tried without Google. Nothing is saved; restart for fresh data.
//   node tools/local-backend.js   then open http://localhost:8090/?p=P1 and http://localhost:8090/staff
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBackend } = require('../tests/fakes/apps-script.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8090;
const API_DELAY_MS = Number(process.env.API_DELAY_MS) || 0; // Mimics a slow Apps Script, for example right after a deploy.
const STAFF_EMAIL = 'demo-admin@uitm.edu.my';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const app = loadBackend();
const t = app.db.tables;
t.Locations.push(
  { location_id: 'S1', name: 'Stor Pusat (Central Store)', type: 'STORE', active: true },
  { location_id: 'P1', name: 'Pantri 1 (demo)', type: 'PANTRY', active: true },
);
['Beras 5kg', 'Minyak masak 1L', 'Mi segera (5 bungkus)', 'Gula 1kg', 'Sardin tin', 'Roti', 'Milo 400g', 'Ubat gigi'].forEach((name, i) => {
  t.Items.push({ item_id: 'NB-' + String(i + 1).padStart(3, '0'), name, category: i < 7 ? 'Makanan' : 'Kebersihan', unit: '', sort_order: i + 1, active: true, photo_version: '' });
});
t.Barcodes.push({ code: '04006381333931', item_id: 'NB-001' });
t.Faculties.push(
  { faculty_code: 'DEMO1', name_ms: 'Fakulti Demo Satu', name_en: 'Demo Faculty One', active: true },
  { faculty_code: 'OTHER', name_ms: 'Lain-lain', name_en: 'Other', active: true },
);
t.Staff.push({ email: STAFF_EMAIL, name: 'Demo admin', role: 'admin', receives_alerts: true, active: true });
t.Settings.push({ key: 'pwa_url', value: 'http://localhost:' + PORT + '/?p=P1' });

function staffPage() {
  const read = (name) => fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
  const shim = `<script>
    // Stand-in for google.script.run that calls the simulator.
    function runner(ok, fail) {
      return new Proxy({}, { get(_, name) {
        if (name === 'withSuccessHandler') return (fn) => runner(fn, fail);
        if (name === 'withFailureHandler') return (fn) => runner(ok, fn);
        return (...args) => fetch('/run', { method: 'POST', body: JSON.stringify({ name, args }) })
          .then((r) => r.json()).then((res) => (res.ok ? ok && ok(res.result) : fail && fail(new Error(res.message))));
      } });
    }
    window.google = { script: { run: runner() } };
  </script>`;
  return read('backend/ui/staff')
    .replace(/<\?!= include_\('([^']+)'\) \?>/g, (m, file) => (file.endsWith('staff-script') ? shim : '') + read(file))
    .replace('<?!= boot ?>', JSON.stringify({ me: { email: STAFF_EMAIL, name: 'Demo admin', role: 'admin' } }));
}

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api') {
    if (API_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
    const out = app.fn('doPost')({ postData: { contents: await body(req) } });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(out.text);
  }
  if (req.method === 'POST' && url.pathname === '/run') {
    const { name, args } = JSON.parse(await body(req));
    app.user.email = STAFF_EMAIL;
    let reply;
    try {
      if (/_$/.test(name)) throw new Error('Private function'); // Like Apps Script, which hides names ending in "_".
      reply = { ok: true, result: JSON.parse(JSON.stringify(app.fn(name)(...args) ?? null)) };
    } catch (err) {
      reply = { ok: false, message: err.message };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(reply));
  }
  if (url.pathname === '/staff') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    return res.end(staffPage());
  }
  if (url.pathname === '/sw.js') {
    // No offline cache in the simulator, so edits always show on reload. The real sw.js is used on GitHub Pages.
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    return res.end(`self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))));`);
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    return res.end(`window.APP_CONFIG = { apiUrl: '/api', staffUrl: '/staff', version: 'local' };`);
  }
  const isCore = url.pathname.startsWith('/core/');
  const base = path.join(ROOT, isCore ? 'core' : 'web');
  let file = path.normalize(path.join(base, isCore ? url.pathname.slice(5) : url.pathname));
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Simulator on http://localhost:${PORT}/?p=P1 (student) and /staff (staff)`));
