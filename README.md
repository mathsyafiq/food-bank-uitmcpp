# Food Bank UiTMCPP

Inventory and self-service checkout for the UiTM food bank. Students record what they take; staff receive donations into a central store, move stock to the pantries, and get low-stock emails. Pantry devices keep working through short internet outages.

| Part | Where | Who |
|---|---|---|
| Student app (PWA) | https://mathsyafiq.github.io/food-bank-uitmcpp/ | Students, on the pantry laptop, pantry phones or their own phones |
| Staff app | [Staff web app](https://script.google.com/macros/s/AKfycbyDrHlZgISTgVhhI35MW-KOwnAXkks10Wj-9AZJ77ahIYO5EViH4ahiR2IYZ6nBTcsj/exec) (UiTM sign-in) | People listed in the Staff tab |
| Database | Google Sheet "Food Bank URHP – Database" in the Drive folder "Food Bank URHP" | Owner and admins only |

Design and decisions: [CLAUDE.md](CLAUDE.md), [docs/PLAN.md](docs/PLAN.md), [docs/DECISIONS.md](docs/DECISIONS.md). Data handling: [docs/DATA-POLICY.md](docs/DATA-POLICY.md).

## First-time setup

1. **Authorise the backend (owner, once).** Open the spreadsheet, then Extensions > Apps Script. Open `backend/setup`, choose `setup` in the function menu, click Run, and allow the permissions. This creates the tabs, adds you as the first admin, and schedules the hourly and nightly jobs. It is safe to run again.
2. **Open the staff app** (link above) with your UiTM account.
3. **Setup tab (admins):**
   - Rename the locations if needed. Setup creates `S1` Stor Pusat (Central Store) and `P1` Pantri 1. Add Pantri 2 when it opens.
   - Add the faculties students choose from (code, BM name, English name). "Lain-lain / Other" is there to start.
   - Check the settings, especially **Student ID format** (default: 10 digits).
   - **Student namelist:** paste the link of the namelist Google Sheet, press **Preview**, check the student ID, name and programme columns, then **Import and use the namelist**. Students then key in only their ID and see their name and programme; anyone not on the list types their details. Import again each semester. Only ID, name and programme are kept (never IC numbers).
4. **Staff tab (admins):** add each staff member's UiTM email. Tick "Receives stock alert emails" for anyone who should get alerts.
5. **Items tab:** add each item with a photo, link its barcodes (scan them with the USB scanner), and set low-stock thresholds per location. Items without a barcode can be tapped on screen, or labelled with their internal code (NB-001 and so on): **Print barcode labels** on the Items tab prints a sheet of 24 labels per A4 page.
6. **Receive tab:** record the first delivery into the Central Store, then use **Transfer** to move stock to Pantri 1.
7. **Pantry laptop:** open the student app link, scroll down, tap "Pantry device setup", and enter the code from the staff app's **Devices** tab. Do the same for any pantry-owned phone.
8. **QR posters (admins):** Setup > Print > **QR posters** prints one A4 poster per active pantry for students' own phones. Each code links to the student app for that pantry, for example `https://mathsyafiq.github.io/food-bank-uitmcpp/?p=P1`. When printing posters or labels, choose A4, scale 100% (Actual size), and turn off headers and footers.

## Everyday use

- **Students:** enter their student ID, name and faculty (every visit), tick consent, then scan or tap items and press Done. A line of 10 or more is allowed but flagged for staff.
- **Staff:** Receive (deliveries into the store), Transfer (store to pantry), Count (stock count; sync pantry devices first), Adjust (damaged, expired, correction), Void visit (undo a mistaken visit), Reports (with CSV export).
- **Emails:** hourly low-stock and out-of-stock alerts per location (each at most once a day), plus a nightly digest of large-quantity visits. Emails never contain student data.
- **Nightly at 2am:** stock check (emails admins if the Stock tab and the ledger disagree), PDPA retention (student links on visits older than a year are removed, and students not seen for a year are deleted), large-quantity digest.

## Privacy (PDPA)

- Student IDs, names and faculties are kept only in the Students tab, which only the owner and admins can open. Staff use the staff app and never need the spreadsheet.
- Visits and the stock ledger refer to students only by a keyed hash. The key lives in the script's properties, never in the Sheet, the app or this repo.
- Admins can export the student list for Student Affairs (HEP). Every look-up and export is logged in the AuditLog tab.
- Never commit rosters, exports or real student IDs to this repo (it is public).
- The full policy, including retention, HEP exports and what to do if data leaks, is in [docs/DATA-POLICY.md](docs/DATA-POLICY.md). It is a draft until UiTM's legal office and ICT division confirm the items it lists.

## For developers

```
core/      shared logic (Apps Script, browser and Node), with tests in tests/
backend/   Apps Script: API (doPost), staff pages (doGet + ui/), jobs, setup
web/       the student PWA, published to GitHub Pages with core/
tools/     local servers and the deploy script
```

- Tests: `npm test` (Node 22 or later, no packages to install).
- Simulator: `node tools/local-backend.js`, then open http://localhost:8090/?p=P1 (student) and http://localhost:8090/staff. It runs the real backend code on demo data in memory.
- Deploy the backend: `npm run deploy` (needs `clasp`, signed in as the owner). This updates both web app deployments: the API deployment open to anyone, the staff deployment limited to UiTM accounts.
- Deploy the student app: push to `main`. GitHub Actions runs the tests and publishes `web/` and `core/` to Pages. Bump `version` in `web/config.js` and `VERSION` in `web/sw.js` when releasing.
- The code lives in OneDrive. OneDrive syncs every change, so keep this folder set to "Always keep on this device", and treat GitHub as the backup.
