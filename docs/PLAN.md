# Plan: Food Bank Inventory and POS System

Deliverable 1 · 2026-10-18 · **Awaiting approval. No code is written until you approve.**

This plan builds on `CLAUDE.md` and assumes the proposals in `docs/DECISIONS.md` (P1 to P9) are accepted. Approving this plan approves them. Decisions still needed are in section 9.

## 1. Architecture

```text
 Pantry laptop / pantry phone / student phone
   PWA on GitHub Pages (plain JavaScript)
            │  HTTPS POST, JSON sent as text/plain
            ▼
 Apps Script "API" deployment ─────────┐   access: Anyone
                                       ▼
                               Google Sheet (database)
                                       ▲
 Apps Script "Staff" deployment ───────┘   access: UiTM accounts only
            ▲                               (staff open it in a browser)
            │
 Time triggers: hourly alerts, nightly jobs ──► MailApp emails
```

- **PWA (`web/`)**: the student pick flow, pantry device setup, the sync status screen, and the offline queue. No staff features.
- **One Apps Script project** (`backend/` and `core/`), bound to the Sheet and owned by the UiTM institutional account, with two web app deployments:
  - **API**: `doPost` only. Runs as the owner, open to anyone. Handles the actions in section 4.
  - **Staff**: `doGet` serves the staff pages (HtmlService). Runs as the owner, open only to UiTM accounts. `doGet` refuses anyone not in the Staff tab, so the public deployment can't be used to open staff pages.
  - If Apps Script won't keep different access settings for two deployments of one project (checked in step 0), we use two projects pushed from the same repo.
- **Google Sheet**: tabs from CLAUDE.md §6, with the changes in section 3.
- **Triggers**: an hourly low-stock check and a nightly job at 02:00 Malaysia time.

## 2. File Structure

```text
food-bank/
├── CLAUDE.md
├── README.md                    setup guide (deliverable 7)
├── package.json                 dev tools only: @google/clasp, fake-indexeddb
├── .clasp.json, .claspignore    push backend/ and core/ to Apps Script
├── .github/workflows/pages.yml  publish web/ and core/ to GitHub Pages
├── core/                        shared logic; runs in Apps Script, the browser, and Node
│   ├── gtin.js                  normalise to 14 digits, check digit
│   ├── student-id.js            normalise, format check
│   ├── visit.js                 validate a visit, large-quantity flag
│   ├── stock.js                 apply changes, stock-count differences, sum check
│   ├── alerts.js                which alerts are due
│   └── retention.js             which rows to anonymise
├── backend/                     Apps Script only
│   ├── appsscript.json          time zone Asia/Kuala_Lumpur
│   ├── api.js                   doPost router and public actions
│   ├── staff.js                 doGet and staff server functions
│   ├── auth.js                  staff checks, device keys
│   ├── db.js                    Sheet reads, batched writes, locking
│   ├── jobs.js                  hourly and nightly triggers
│   ├── mail.js                  alert emails
│   ├── setup.js                 creates tabs, headers, text formats, protections
│   └── ui/                      staff page templates
├── web/                         the PWA
│   ├── index.html, manifest.webmanifest, sw.js
│   ├── app.js                   screens, state, inactivity reset
│   ├── screens/                 id, details, basket, thanks, setup, sync
│   ├── lib/                     api.js, queue.js (IndexedDB), scanner.js, i18n.js
│   ├── i18n/                    ms.json, en.json
│   └── vendor/zxing/            barcode library, copied in (no CDN)
├── tests/                       node --test
└── docs/                        DECISIONS.md, PLAN.md, TEST-CHECKLIST.md, DATA-POLICY.md
```

No build step. Each `core/` file defines one global object and also sets `module.exports` when Node loads it. Apps Script and the browser (through a `<script>` tag) use the global; tests `require` it. Core files only call each other inside functions, never at load time, so Apps Script's file order doesn't matter.

## 3. Data Model Changes

These go into CLAUDE.md §6 once approved.

- **New Visits tab**, one row per visit: visit_id, occurred_at, recorded_at, location_id, student_key, line_count, flagged, unverified_student, source (PANTRY_DEVICE or PUBLIC), device_id.
  - `student_key` moves here from Transactions. The ledger then holds no student data, and retention only touches this tab.
  - Duplicate checks, visit counts, flagged visits, voids, and student history use this tab (about 100,000 rows a year) instead of the ledger (about 300,000).
- **New Devices tab:** device_id, label, location_id, key_hash, created_by, created_at, last_seen, revoked.
- **Students:** student_key, source (ROSTER or SELF), name, faculty_code, consent_at, first_visit_at, last_visit_at.
- **New Photos tab** (only with photo option 1, section 5.8): item_id, photo_version, data.
- **Settings:** add `student_mode` (ROSTER or SELF).

Sizing at 200 visits per pantry per day, 2 pantries, about 250 open days a year: about 4.2 million cells in Transactions and 1 million in Visits each year. The spreadsheet limit is 10 million, so the yearly archive keeps the live file around half full.

## 4. Public API

Every request is a POST with `Content-Type: text/plain` and a JSON body: `{action, pantry_id, device, app_version, payload}`. `device` is `{id, key}` on pantry devices and `null` on student phones. Every reply is `{ok: true, data}` or `{ok: false, error: {code, ms, en}}`, with a plain-language message in BM and English.

| Action | Who can call it | What it does |
|---|---|---|
| `catalog` | anyone | Active items, barcodes, pantry name, faculties, provisional stock, and a version number. Replies "unchanged" if the device already has the current version. |
| `checkStudent` | anyone | Roster mode: is this ID on the roster? Not used with self-registration option 1 (section 5.2). |
| `submitVisit` | anyone | One visit: visit_id, occurred_at, student ID, details (self-registration), lines, and any unknown barcodes seen. All or nothing. |
| `syncVisits` | pantry devices | Up to 20 queued visits, with a result for each. |
| `redeemSetupCode` | anyone with a code | Turns a one-time code from the staff pages into a device key. |

A visit costs at most 2 calls (`checkStudent`, `submitVisit`). `catalog` runs when the app opens and is cached.

The server checks every request: payload shape and size, pantry exists and is active, items exist and are active, quantities are whole numbers above zero, ID format, and the device key (if sent) is valid and not revoked. Public submissions are capped across the whole system (for example 60 a minute, far above real traffic) to slow down scripted spam.

## 5. Key Designs

### 5.1 Saving a visit
1. Validate the payload (`core/visit.js`) before taking the lock.
2. Take the script lock (wait up to 20 seconds).
3. If the visit_id is already in Visits (TextFinder on that column), reply success without writing anything.
4. Write the Visits row and the OUT rows, each in one batched write.
5. Read the Stock tab (about 90 rows), apply the changes, and write it back.
6. Release the lock. Time inside the lock should be well under a second.

An offline visit whose ID fails the roster check on sync is still saved, because the items have already left, and is marked `unverified_student` for staff.

### 5.2 Student identification (decision needed)
**Roster mode:** ID, then `checkStudent`, then the basket. A "valid" reply only reveals that someone is enrolled.

**Self-registration mode** has two options:
- **Option 1: details on every visit (Recommended).** Everyone sees the same screens: ID, then name and faculty, then the basket. The server never says whether an ID is known, so no one can check whether a friend uses the food bank. On their own phone, a student can tick "Remember my details on this phone" so it's one tap next time. On the pantry laptop they type their name each visit, about 10 seconds; a 3-item pick still fits in 30 seconds.
- **Option 2: register once.** Name and faculty on the first visit only, so returning students are faster. But anyone with the QR link can type any ID and see whether that student has registered.

Either way, the server keeps the latest name and faculty in Students, and the name is never shown back on screen.

### 5.3 Staff sign-in (option B)
- Every staff server function starts with a role check. It reads the signed-in email from `Session.getActiveUser()`, looks it up in the Staff tab (cached for 5 minutes), and refuses if the email is missing, inactive, or has the wrong role.
- `staff_email` on every record comes from that check, never from the page.
- This needs the Sheet and script to be owned by a @uitm.edu.my account, because Apps Script only reveals the email of users in the owner's domain.

### 5.4 Pantry device setup
1. On the staff page "Devices", staff choose a pantry and a label. The page shows a 6-digit code, valid for 10 minutes.
2. On the device, staff open the PWA's setup screen and enter the code.
3. The server stores a hash of a new random key; the device keeps the key in IndexedDB.

Revoking a device on the staff page turns it back into a public device.

### 5.5 Offline queue (pantry devices only)
- Every visit is written to the IndexedDB queue first, then sent. A closed page or a flat battery never loses a visit.
- The thank-you screen appears as soon as the visit is queued, so pantry devices never make a student wait for Apps Script.
- Sending happens when the app opens, when the browser comes back online, after each visit, and every 60 seconds while anything is pending. Oldest first, 20 at a time. Sent visits are deleted from the device.
- Visits the server rejects stay on the device marked "needs staff" and show on the sync screen.
- Student phones skip the queue. If sending fails they see "No connection. Please use the pantry device."

### 5.6 Stock checks and archive
- Stock changes are applied during each save (5.1).
- The nightly job:
  - Builds yesterday's DailySummary.
  - Runs `verifyStock()`: reads only the item, location, and quantity columns of the ledger, adds ArchiveTotals, compares with Stock, and emails admins about any difference.
  - Runs retention: blanks `student_key` on Visits older than 365 days and removes self-registered Students not seen for 365 days.
  - Sends the large-quantity digest.
- Yearly, an admin runs the archive in a quiet week: Transactions and Visits older than 12 months move to an archive spreadsheet, and ArchiveTotals is updated.

### 5.7 Alerts
Every hour, compare on-hand with the threshold for each active item at each location. Send one email per location listing items that are newly low, skipping any already alerted today (AlertLog). Zero and negative stock go in a separate, urgent email.

### 5.8 Barcodes and photos
- Pantry laptop: on the basket screen, a hidden input keeps focus and collects the USB scanner's input. On the ID screen, input goes to the ID field.
- Phones: the browser's built-in barcode reader where it exists (Android Chrome), the bundled ZXing library otherwise (iPhone Safari).
- Every barcode is normalised to 14 digits when saved and when scanned.
- Photos:
  - **Option 1 (Recommended): stored in the Sheet.** Staff pick a photo on the staff page; the browser shrinks it to about 240 pixels (around 15 KB) and saves it in the Photos tab. The PWA gets it with the catalogue and keeps it for offline use. This avoids Google Drive sharing settings, which UiTM may restrict.
  - **Option 2: image files in the repo.** Simplest code, but only the developer can add or change photos.

### 5.9 Staff pages
One page with tabs: Receive, Transfer, Count, Adjust, Void visit, Items and barcodes, Unknown barcodes, Reports, Devices. Admin only: Staff, Roster import, Settings, Student history. Bulk screens use the "every item with a quantity box" layout from CLAUDE.md §5.2.

## 6. Testing
- `core/` unit tests with `node --test`, covering the list in CLAUDE.md §11.
- Backend Sheet access goes through a small interface, so tests can swap in an in-memory fake. That covers saving a visit, duplicate visits, and stock updates without a real Sheet.
- Offline queue tests with `fake-indexeddb`.
- A test Sheet filled with a year of fake data (300,000 rows) to measure real speed before launch.
- `docs/TEST-CHECKLIST.md` for manual runs on the laptop with the USB scanner, iPhone Safari, and Android Chrome.

## 7. Build Order

Each step ends with a short demo and a summary of what changed. I stop for your OK before the next step.

0. **Spike (about half a day).** Check what everything else depends on:
   - UiTM's Workspace lets the API deploy as "Anyone".
   - One project can have two deployments with different access settings (otherwise, two projects).
   - A page on GitHub Pages can POST to Apps Script and read the reply.
   - Apps Script response time from a phone on campus Wi-Fi and on mobile data.
   - TextFinder on a 100,000-row Visits tab stays under half a second.
   - Whether staff pages can use a phone camera and download CSV files from inside Google's page frame. If not, staff scan with the laptop's USB scanner, and CSV exports are saved to Drive with a link.
1. Repo and tooling: git, `package.json`, clasp, the Pages workflow, an empty test suite.
2. `core/` logic and its tests.
3. Backend: `setup.js` (creates the Sheet), Sheet access, API actions, staff checks. **Deliverable 2.**
4. Student pick flow, online only. **Deliverable 3.**
5. Staff pages. **Deliverable 4.**
6. Alerts and nightly jobs. **Deliverable 5.**
7. Offline mode. **Deliverable 6.**
8. README, QR posters, barcode labels, data handling policy. **Deliverables 7 to 9.**

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| UiTM later blocks "Anyone" web apps | The PWA can't reach the backend | Step 0 confirms it works now. Fallback: serve the student flow from Apps Script too, losing offline mode. |
| The owner account is closed | The system stops | Use an institutional account; README covers handover. |
| Someone hand-edits the Sheet | Stock or ledger corrupted | Protected tabs; the nightly check catches drift. |
| Fake visits sent to the public API | Wrong stock figures | Server validation, the rate cap, the PUBLIC source flag, void visit. |
| Apps Script is slow on a bad day | Slower picks | At most 2 calls per visit; pantry devices don't wait for the server. |

## 9. Open Questions

1. **Self-registration:** option 1 (details on every visit, recommended) or option 2 (register once)? See 5.2.
2. **Name:** what is it used for? PDPA requires the privacy notice to state the purpose, for example contacting students or reporting to HEP.
3. **Roster:** if the Assistant Registrar's roster includes names and faculties, should we import them too?
4. **Photos:** option 1 (stored in the Sheet, recommended) or option 2 (files in the repo)? See 5.8.
5. **Default threshold** for new items: one number for all items, adjustable per location? What number?
6. **Deliveries:** do they ever go straight to a pantry, skipping the Central Store?
7. **Plain student IDs:** does anyone need lists of them, for example for HEP reports? If not, none are stored.
8. **Large-quantity alerts:** a nightly digest instead of one email per visit? (P8)
9. **Typo guard:** should a line above some limit (for example 99) need staff confirmation? It would catch a typo like 1000, but it's a business rule, so it's your call.
10. **Code location:** I recommend a folder outside OneDrive (for example `~/Projects/food-bank`) with GitHub as the backup, because OneDrive syncing can corrupt git's files. The docs can stay here.
