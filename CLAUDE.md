# CLAUDE.md: Food Bank Inventory and POS System

Revision 2 (2026-10-18). What changed from revision 1, and why, is in `docs/DECISIONS.md`. Items marked **(to confirm)** still need approval.

## 1. Purpose

Build a simple inventory and point-of-sale system for a university food bank. Students pick items and the system records each take. Staff receive donations into a central store, move stock to the pantries, and get low-stock email alerts. The system must keep working during short internet outages.

Current scale:
- 20 to 30 SKUs.
- 1 central store and 2 pantries (1 now, 1 coming soon).
- About 7,000 students.
- About 200 visits per day per pantry (about 400 a day with both), about 3 items per visit.

## 2. Working Rules for Claude Code

- **Plan first, code second.** Before writing any code, produce a short plan covering architecture, file structure, data model, and auth approach. Wait for my approval.
- **Ask, don't assume.** If a requirement is unclear, list the question and stop. Do not invent business rules.
- **Keep it simple.** Prefer fewer dependencies and plain JavaScript. No frameworks unless the plan justifies them.
- **Small, testable steps.** Build and test one part at a time. Show me what changed after each step.
- **Document decisions** in `docs/DECISIONS.md` as they are made.
- **Never commit data.** No roster files, exports, or real student IDs in the repo, including test fixtures.

## 3. Chosen Stack (confirm in plan, do not change without asking)

- **Backend:** Google Apps Script web app, bound to a Google Sheet. Both are owned by a UiTM institutional (shared) account, not a personal one, so they survive staff turnover.
  - The PWA calls a JSON API (`doPost`) deployed as "Anyone".
  - Requests use `Content-Type: text/plain`, because Apps Script does not answer CORS preflight.
  - Apps Script cannot read request headers, so any key or token goes in the request body.
- **Database:** Google Sheets, tabs in section 6. No formulas on large tabs. The script computes everything.
- **Frontend:** Progressive Web App in plain JavaScript (ES modules, no build step), with a service worker and IndexedDB for offline use. Hosted on GitHub Pages from a public repo **(to confirm)**. All libraries are copied into the repo: no CDNs, no analytics, no third-party requests.
- **Scanner:**
  - Pantry laptop: USB barcode scanner acting as a keyboard (types the code and presses Enter).
  - Phones: camera scanning. Use the browser's `BarcodeDetector` where available (Android Chrome) and a bundled ZXing build where not (iPhone Safari).
- **Email:** Apps Script `MailApp`.
- **Dev tooling:** `clasp` to push Apps Script code from the repo, `node --test` for unit tests, `fake-indexeddb` for queue tests.

## 4. Users, Devices and Access

### Devices
- **Pantry laptop:** the main device. Attended by staff or a volunteer, with a USB scanner.
- **Pantry phones:** pantry-owned phones used by staff or volunteers.
- **Students' own phones:** used when no pantry device is available. Reached by scanning the QR poster.

Pantry devices (laptop and pantry phones) are set up once by staff, using a device key issued from the staff pages. The key ties the device to one pantry, turns on offline mode (section 9), and can be revoked. Any device without a key is treated as a student phone. The QR poster URL carries the pantry ID (for example `?p=P1`), which is not personal data.

### Students
- **No sign-in.** Students never log in with Google or any account.
- Identify by typing their student ID. The RHB mySiswa card likely has no barcode, so typing is the main path; scanning works if a card has one.
- Validation depends on the roster (section 7):
  - **Namelist imported** (the college namelist, a Google Sheet imported on the staff Setup page): the student keys in only their ID and confirms the name and programme shown. IDs not on the namelist give their name and faculty instead (decisions 32 to 35).
  - **No roster:** the student gives their student ID, name, and faculty (chosen from a list), and consents. Whether this is asked once or on every visit is decided in the plan (section 7).
- No per-student quantity limit and no visit limit.

### Staff
- Sign in with UiTM Google Workspace accounts.
- Access only for emails in the Staff tab with `active = TRUE`.
- Roles:
  - `admin`: everything, plus the staff list, roster import, settings, and student visit history.
  - `staff`: receive, transfer, count, adjust, void, items, and reports without student data.

### Staff authentication (decided 2026-10-18: option B)

Constraint: a page on GitHub Pages can only call an Apps Script web app deployed as "Anyone". A deployment restricted to uitm.edu.my redirects to a Google login page, and the browser cannot follow that redirect from another site.

- **A. Google Sign-In in the PWA.** The PWA gets a Google ID token and sends it in the request body. Apps Script verifies it: audience, `hd = uitm.edu.my`, and email in the Staff tab. One app for everything. Needs an OAuth client in a Google Cloud project under UiTM's Workspace. Tokens last about 1 hour.
- **B. Staff pages served by Apps Script (HtmlService),** deployed separately and restricted to uitm.edu.my. Google handles the login and `Session.getActiveUser()` gives the email. No extra setup. Staff use a different URL, and staff pages have no offline mode (they do not need one).
- **C. Shared staff PIN.** Simple, but `staff_email` would be whatever someone typed, so there is no real audit trail. Not recommended.

**Decided: B.** The PWA keeps the student flow, pantry device setup, and the sync status screen. None of these need a staff login.

## 5. Core Flows

### 5.1 Student Pick (POS style)
1. Screen shows a short privacy notice in BM and English (section 7) and the prompt "Masukkan ID pelajar / Enter your student ID."
2. The ID is checked (section 4). If it is not valid, show a clear message and stop. Without a roster, a new ID goes to the registration and consent screen first.
3. After the check, show the ID masked (for example `2023••••89`), never in full.
4. Student adds items to a basket in one of two ways:
   - **Scan:** scan a barcode. Look up the item and add 1 to the basket. Scanning again adds 1 more.
   - **Tap:** choose from a grid of item photos and names. Covers items without barcodes.
5. Basket shows each line with name and quantity, with +/- controls and remove.
6. If any single line is 10 or more, show a visible notice and flag the visit for staff review. Do not block.
7. Never block because stock shows zero or less. Stock may go negative.
8. Student confirms. The device sends the whole visit as one request with a `visit_id` (UUID). The server writes one OUT row per line, all or nothing.
9. Show a thank-you screen (without the ID), then reset automatically after a few seconds.
10. After 60 seconds of inactivity at any step, discard the basket and return to the start.
11. Unknown barcode: show "Item not recognised, please select from the list", open the tap grid, and log the barcode for staff (5.7).

### 5.2 Staff Receive Delivery (into the Central Store)
1. Staff opens "Receive delivery".
2. One screen lists all active items with a quantity field beside each.
3. Staff enters received quantities. Zero or blank rows are skipped.
4. Optional fields: donor or source, delivery date, note.
5. Submit writes one IN batch into the Central Store **(to confirm: do deliveries ever go straight to a pantry?)**.

### 5.3 Staff Transfer to a Pantry
1. Staff opens "Transfer" and picks the from-location (default: Central Store) and the to-location.
2. Same list layout as Receive delivery.
3. Submit writes one TRANSFER batch. For each item: a negative row at the from-location and a positive row at the to-location. Total stock across all locations does not change.

### 5.4 Staff Stock Count
- Per location. Same layout as Receive delivery. Staff enters the counted quantity for each item.
- Blank means "not counted" and is skipped. Zero means "counted, none left".
- The server computes the difference from the current on-hand at submit time, inside the lock, and writes ADJUST rows with reason "stock count".
- Sync all pantry devices before counting. The count screen reminds staff to do this.

### 5.5 Staff Manual Adjustment
- Single item at one location, signed quantity change, and a required reason (for example damaged, expired, correction).

### 5.6 Void a Visit
- Staff enters a visit ID (from the large-quantity digest or a report) and a reason.
- The system writes VOID rows that reverse each OUT line of that visit. The original rows stay.

### 5.7 Item Management (staff)
- Add, edit, and deactivate items. Fields are in section 6.
- An item can have many barcodes (different brands of the same product). Items without a barcode get an internal ID such as `NB-001`; the tap grid still works.
- Unknown barcodes scanned anywhere are listed for staff. Staff link each one to an existing item or create a new item.
- Print barcode labels (Code 128) for `NB-` items so the laptop can scan everything.
- Photos: where they are stored is decided in the plan **(to confirm)**. The service worker caches them for offline use.

### 5.8 Reports (staff)
- Current stock by item and location.
- Transactions by date range, by location, and by item.
- Flagged visits (10 or more of one item).
- Visit history per student ID, admin only. The admin types the ID; the server hashes it and looks it up.
- CSV export for each report.

## 6. Data Model (Google Sheets)

Use separate tabs. Never overwrite history. ID and barcode columns are plain-text format; otherwise Sheets drops leading zeros and shows long numbers as `9.55E+12`.

- **Locations:** location_id, name, type (STORE or PANTRY), active
- **Items:** item_id, name, category, unit, photo_url, sort_order, active
- **Barcodes:** gtin (normalised to 14 digits, text), item_id, added_by, added_at
- **UnknownBarcodes:** gtin, location_id, first_seen, last_seen, times_seen
- **Thresholds:** item_id, location_id, threshold, reorder_qty. When missing, use `default_threshold` from Settings **(to confirm)**.
- **Transactions** (append-only ledger): txn_id (UUID), occurred_at (device time), recorded_at (server time), location_id, type (OUT, IN, TRANSFER, ADJUST, VOID), item_id, quantity (signed), visit_id, batch_id, student_key (OUT only; blanked after retention), staff_email, reason, flag, source_device, app_version
- **Batches:** batch_id, type (IN, TRANSFER, COUNT, ADJUST, VOID), created_at, location_id, to_location_id, staff_email, donor_source, delivery_date, note
- **Stock:** item_id, location_id, on_hand, updated_at. A cache, updated on every write.
- **DailySummary:** date, location_id, item_id, type, total_qty, visit_count. Built nightly. Reports over long date ranges read this instead of the ledger.
- **ArchiveTotals:** item_id, location_id, archived_sum, archived_through
- **Students:** student_key, source (ROSTER or SELF), name and faculty_code (self-registration only), consent_at, last_visit_at. No free-text notes.
- **Faculties:** faculty_code, name_ms, name_en, active. Feeds the faculty drop-down.
- **Staff:** email, role (admin or staff), receives_alerts, active
- **Settings:** key, value. For example timezone `Asia/Kuala_Lumpur`, retention_days 365, large_qty_threshold 10, default_threshold.
- **AlertLog:** date, location_id, item_id, alert_type

`sync_status` exists only in the device's IndexedDB queue. Every row on the server is synced by definition.

Rules:
- Stock on hand must always equal `archived_sum` plus the sum of live transactions, per item and location. `verifyStock()` checks this nightly and emails admins on any mismatch.
- Writes update `Stock` incrementally (`on_hand += quantity`). Never recompute from the whole ledger on a write.
- Transactions are never edited or deleted. Corrections are new ADJUST or VOID rows. The only exception is the retention job, which blanks `student_key` (section 7).
- All writes happen inside `LockService` and use batched `setValues`.
- The server ignores a `visit_id` it has already stored (idempotency), found with TextFinder on the visit_id column.
- Yearly archive: move ledger rows older than 12 months into a separate archive spreadsheet (with `student_key` removed) and add their totals to ArchiveTotals. Archived, never deleted.
- Tabs are protected. Staff use the app; only admins edit the Sheet directly.

## 7. Student Data and Privacy

### Roster
- Requested from the Assistant Registrar. If provided, an admin imports the CSV through an admin-only function. Only `student_key` values are stored, and the admin deletes the CSV afterwards. Re-import each intake; it replaces the ROSTER entries.
- If not provided, students self-register with their student ID, name, and faculty (from the Faculties list), and give consent. Nothing else is collected (no IC or phone number).
- The name is kept only in the admin-only Students tab and never appears in transactions or emails. After an ID is entered, the student's name and programme are shown on every device, by the owner's decision (33): anyone who knows a student's ID can see them. Look-ups from students' own phones are limited per minute.
- Self-registration cannot prove an ID is real. That is accepted, because there are no limits.

### Storing IDs
- `student_key` = HMAC-SHA256 of the normalised student ID, using a secret key stored only in Apps Script Script Properties. The key is never in the Sheet, the frontend, or the repo.
- Plain student IDs are not stored on the server **(to confirm: no one needs lists of plain IDs)**.
- Devices hold no list of IDs and no key. Offline, a pantry device only checks the ID format; the server checks the ID on sync and flags unknown IDs for staff.
- A queued offline visit holds the plain ID only until it syncs; then the entry is deleted. Queues exist only on pantry devices.
- On students' own phones, nothing about the student is kept after the visit ends.

### The ID check must not reveal who uses the food bank
- With the namelist, entering an ID shows that student's name and programme (accepted by the owner, decision 33).
- With self-registration, "already registered" means "has used the food bank", which is sensitive. The check must not let someone type a friend's ID and find out whether they have visited. Options and a recommendation are in `docs/PLAN.md` §5.2 **(open)**.

### Retention
- Visit-level student data is kept for 1 year. A nightly job blanks `student_key` on OUT rows older than 365 days. The rows stay, so stock totals and the audit trail are unaffected.
- Self-registered students with no visit in 365 days are removed from the Students tab **(to confirm)**.

### PDPA
- The ID screen shows a short privacy notice in BM and English (PDPA requires notices in both languages). Consent is recorded at first registration.
- Any tab holding student data is staff-only. Student visit history is admin-only.
- Deliver a short data handling policy document (section 12).
- No student IDs in URLs, the browser console, analytics, email alerts, or logs.
- PDPA mainly covers commercial transactions. Confirm with UiTM's legal or ICT office whether it applies, and follow UiTM's own data policy either way.

## 8. Alerts

- **Low stock:** email when `on_hand <= threshold` for an active item at a location. A pantry alert means "move stock from the Central Store"; a Central Store alert means "seek donations or reorder". At most once per day per item per location, tracked in AlertLog.
- **Zero or negative stock:** a separate, more urgent email, with the same once-per-day rule.
- **Large quantity:** one daily digest of visits with a line of 10 or more units of one item **(to confirm: digest instead of one email each)**. Shows visit ID, location, item, quantity, and a link to the report. No student ID or student key.
- **Stock check mismatch:** email admins when `verifyStock()` finds a difference.
- Recipients: Staff rows with `receives_alerts = TRUE`.
- Triggers: an hourly low-stock check, and nightly jobs for the daily summary, stock check, retention, and large-quantity digest.
- Each email names the location it refers to.

## 9. Offline Mode (backup only)

Purpose: keep the pantry laptop and pantry phones working during short connection loss. Not a primary mode.

- Offline queueing runs only on pantry devices (section 4).
- Students' own phones are online-only. They usually have mobile data. A queue on a phone that leaves the pantry may never sync: iOS has no background sync, and Safari can clear a site's storage after 7 days without a visit. When offline, a student phone shows "No connection. Please use the pantry device."
- The service worker caches the app shell, item list, and photos.
- Pending visits are stored in IndexedDB, one entry per visit: visit_id, occurred_at, location_id, student ID, lines, `sync_status = pending`.
- Show a clear "Offline mode" banner while disconnected. Stock shown while offline is marked provisional.
- Sync pending visits in order when the connection returns and every time the app opens. The server ignores visit IDs it already has.
- The pending queue survives closing the page and restarting the device.
- A sync status screen shows unsent visits (time and item count, no IDs).

## 10. Non-Functional Requirements

- A 3-item student pick takes under 30 seconds on a phone. At most 2 server calls per visit (ID check and submit); the item list is cached on the device.
- Works on iPhone Safari (iOS 16+), Android Chrome, and Chrome or Edge on the pantry laptop.
- Mobile-first layout with large tap targets. On the laptop, keep the input focused so the USB scanner always works.
- All student-facing text in BM and English.
- Accessible: sufficient contrast, readable text, screen-reader labels on buttons.
- No student data in URLs. No third-party scripts or requests.
- Errors are shown in plain language. No raw stack traces to users.
- The server validates everything it receives (ID format, item IDs, quantities, location, device key), because the API is public.

## 11. Testing

Business logic (stock math, GTIN rules, ID format, HMAC, idempotency, retention, alert rules) lives in plain JavaScript files that run in both Apps Script and Node, so it can be tested locally with `node --test`.

- Stock: on-hand equals archived totals plus the ledger sum, and incremental updates match a full recompute.
- Transfers leave the total across all locations unchanged.
- Idempotent sync: the same visit_id sent twice is counted once.
- Offline queue survives a simulated reload (fake-indexeddb).
- GTIN: EAN-13, UPC-A, and EAN-8 all normalise to 14 digits; a bad check digit is rejected.
- Retention: rows older than 365 days lose `student_key`, and stock does not change.
- A manual test checklist for the pantry laptop with USB scanner, iPhone Safari, and Android Chrome.

## 12. Deliverables (in order)

1. Plan document (architecture, data model, auth recommendation, open questions). **Stop for approval.**
2. Apps Script backend with the Sheets data model, plus tests.
3. Student pick flow (online only).
4. Staff pages: items and barcodes, receive delivery, transfer, stock count, adjustment, void visit, reports.
5. Alerts and triggers (hourly and nightly jobs).
6. Offline mode for pantry devices.
7. Setup guide (`README.md`): create the Sheet under the institutional account, deploy the web app, set the HMAC key, import the roster (if any), add locations and the first items, set up the pantry laptop and pantry phones, and print the QR poster.
8. Printable QR poster for each pantry, and barcode labels for `NB-` items.
9. Short data handling policy document.

## 13. Open Questions

Answered on 2026-10-18 (see `docs/DECISIONS.md`): who uses phones, Google Workspace, roster source, visit volume (per pantry), pantry device, negative stock, central store, retention period, staff authentication (option B), self-registration details (student ID, name, faculty).

Still open: the list lives in `docs/PLAN.md` §9, so there is only one copy to keep current.
