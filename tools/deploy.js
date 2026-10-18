// Pushes the backend and points both web app deployments at new versions (docs/PLAN.md section 1).
// The API deployment must allow "Anyone" and the staff deployment only UiTM accounts. Apps Script reads that
// from appsscript.json inside the version a deployment uses, so each deployment gets its own version.
//   npm run deploy
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'appsscript.json');
const ids = JSON.parse(fs.readFileSync(path.join(__dirname, 'deploy-ids.json'), 'utf8'));
const clasp = (...args) => execFileSync('clasp', args, { cwd: ROOT, encoding: 'utf8' });
const original = fs.readFileSync(MANIFEST, 'utf8');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

function release(label, access, deploymentId) {
  const manifest = JSON.parse(original);
  manifest.webapp.access = access;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  clasp('push', '--force');
  const version = /Created version (\d+)/.exec(clasp('create-version', label + ' ' + stamp));
  if (!version) throw new Error('Could not read the new version number from clasp.');
  clasp('update-deployment', deploymentId, '-V', version[1], '-d', label);
  console.log(label + ': version ' + version[1] + ' (' + access + ')');
}

try {
  release('API', 'ANYONE_ANONYMOUS', ids.api);
  release('Staff', 'DOMAIN', ids.staff);
} finally {
  fs.writeFileSync(MANIFEST, original);
  clasp('push', '--force');
}
