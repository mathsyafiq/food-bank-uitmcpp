# Decisions

Each entry records the decision and why. Newest dates at the bottom.

## 2026-10-18: Answers from the project owner

| # | Decision | Why |
|---|---|---|
| 1 | Students use pantry devices and, when none is available, their own phones. | A pantry device is not always available. |
| 2 | Staff use UiTM Google Workspace accounts, and UiTM's Workspace allows publishing an Apps Script web app to "Anyone". Confirmed by the spike (2026-10-18). | The static PWA can only call Apps Script if this is allowed. |
| 3 | The roster will be requested from the Assistant Registrar. If it is not provided, students self-register. | The roster may not be available. |
| 4 | Expected volume is about 200 visits per day per pantry. | Sizing for Sheets and Apps Script. |
| 5 | The main pantry device is a laptop with a USB scanner, attended by someone. | Laptops cannot scan with their camera reliably; attended means no kiosk lockdown is needed. |
| 6 | Picks are never blocked by stock. Stock may go negative. | The student already holds the item; blocking would only lose the record. |
| 7 | Deliveries go into a central store and are then transferred to pantries. Stock is tracked per location, with a TRANSFER transaction type. | This matches how stock physically moves. |
| 8 | Visit-level student data is kept for 1 year. | PDPA retention. |
| 9 | Staff sign in through staff pages served by Apps Script, restricted to UiTM accounts (option B, was P6). | Google handles the login; no Cloud project or token code. |
| 10 | Without a roster, students self-register with student ID, name, and faculty (from a drop-down). | Chosen by the project owner. The name makes the Students tab identifying, so it stays admin-only. |

## 2026-10-18: Proposals in revision 2

Approved on 2026-10-19 when the owner approved the plan and asked to build it.

| # | Decision | Why |
|---|---|---|
| P1 | Visits refer to students by an HMAC key whose secret is kept only in Apps Script. No ID list on devices; offline only checks the ID format. (Plain IDs are now also kept in the Students tab; see decision 12.) | Student IDs are short and predictable. A salted hash list on a device can be reversed in seconds. |
| P2 | Offline queue only on pantry devices. Students' own phones are online-only. | iOS has no background sync and may clear site storage; a queue on a phone that leaves may never sync. |
| P3 | Retention anonymises old rows (blanks `student_key`) instead of deleting them. | Keeps the append-only ledger and stock totals intact. |
| P4 | Many barcodes per item (Barcodes tab). | Donated items of the same product come in different brands. |
| P5 | Update stock incrementally and check the full sum nightly. A yearly archive comes later (see "Deferred"). | Recomputing from the whole ledger gets slower every day; Sheets caps a spreadsheet at 10 million cells. |
| P7 | Frontend on GitHub Pages from a public repo, with no data, secrets, or third-party scripts. | Free and HTTPS. The deployed code is public on any host anyway. |
| P8 | Large-quantity alerts as a nightly digest, with visit ID only (no student data). | Avoids email noise; the original spec contradicted itself on IDs in emails. |
| P9 | Two timestamps per row (`occurred_at`, `recorded_at`), inactivity reset, masked ID, void visit, BM and English UI, admin and staff roles. | Gaps found in review. |

## 2026-10-19: Owner's answers and build decisions

| # | Decision | Why |
|---|---|---|
| 11 | Self-registration asks for ID, name and faculty on every visit (option 1). "Remember my details on this phone" is offered on students' own phones only. | No screen depends on past visits, so no one can check whether a friend uses the food bank. |
| 12 | The name is collected so the student's name and ID can be matched, and so Student Affairs (HEP) can contact students who need more help. The Students tab therefore keeps the plain student ID, name and faculty, and admins can export it for HEP. Look-ups and exports are logged in AuditLog. | Owner's stated purpose. HEP needs real IDs to contact students. |
| 13 | Item photos are stored in the Sheet (Photos tab), added through the staff app, shrunk in the browser to fit one cell. | No Drive sharing settings involved; works offline once cached. |
| 14 | The code lives in the OneDrive project folder. OneDrive syncs every change continuously (not once), so the folder should be set to "Always keep on this device" and GitHub is the real backup. | Owner's choice. |
| 15 | One Apps Script project, bound to the Sheet, with two deployments: API (Anyone) and Staff (UiTM accounts only). `tools/deploy.js` gives each deployment its own version with the right access setting. | The spike showed each deployment keeps its own access setting. One project means one script lock for all writes. |
| 16 | Pantry device setup codes are 8 characters (not 6 digits). | Too long to guess within 10 minutes through the public API. |
| 17 | No npm packages. The offline queue is tested with an in-memory store instead of `fake-indexeddb`; `clasp` is installed globally. | Nothing to install, and no `node_modules` folder syncing through OneDrive. |
| 18 | Placeholders to confirm: student ID format `^\d{10}$` (10 digits) and default low-stock threshold 5. Both are editable on the staff Setup page. | Not yet specified by the owner. |
| 19 | Barcodes are stored in a `code` column (not `gtin`), because some codes are UPC-E or internal labels rather than GTINs. `appsscript.json` sits at the repo root, as clasp requires. | Accuracy and tooling. |
| 20 | Pantry devices show the thank-you screen as soon as a visit is saved on the device, then send it in the background. | Students never wait for Apps Script. |

## Deferred

- **DailySummary tab and yearly archive** (PLAN 5.6): not needed until the ledger grows. Reports read the ledger by date slice for now. Build before the first year ends.
- **Roster import:** waits for the Assistant Registrar. `student_mode = ROSTER` and the roster check are already in the code; the import screen is not.
- **QR poster and barcode labels** (deliverable 8) and the **data handling policy document** (deliverable 9).
