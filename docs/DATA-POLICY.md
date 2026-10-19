# Dasar Pengendalian Data · Data Handling Policy

Food Bank UiTMCPP · Versi 1 · 19 Oktober 2026 · **Draf.** Perkara bertanda **(sahkan)** perlu disahkan oleh pejabat undang-undang atau bahagian ICT UiTM. Senarai penuh di bahagian akhir.

Version 1 · 19 October 2026 · **Draft.** Items marked **(to confirm)** need confirmation from UiTM's legal office or ICT division. The full list is at the end.

Bahasa Melayu dahulu, diikuti English. · Bahasa Melayu first, then English.

---

## Bahagian A: Bahasa Melayu

### 1. Skop

Dasar ini meliputi data peribadi dalam Food Bank UiTMCPP, sistem inventori dan daftar keluar layan diri bank makanan UiTM: aplikasi pelajar, aplikasi staf dan Google Sheet (hamparan) di belakangnya. Ia terpakai kepada pemilik akaun sistem, admin dan staf. Pengawal data ialah UiTM melalui unit yang mengurus bank makanan **(sahkan: nama unit dan pegawai yang bertanggungjawab)**.

### 2. Data yang dikumpul

Daripada pelajar, pada setiap lawatan:
- ID pelajar, nama penuh dan fakulti (dipilih daripada senarai);
- persetujuan (kotak tanda) dan masanya;
- barang dan kuantiti yang diambil, dengan masa dan pantri.

Sistem juga menyimpan tarikh lawatan pertama dan terakhir serta bilangan lawatan setiap pelajar. Kami **tidak** mengumpul nombor kad pengenalan, nombor telefon, e-mel, alamat, gambar pelajar atau lokasi.

Daripada staf: e-mel UiTM, nama, peranan, dan tindakan yang dibuat (terimaan, pindahan, kiraan stok, pelarasan, pembatalan lawatan, carian pelajar).

### 3. Tujuan

- Menyimpan rekod yang tepat tentang barang yang keluar dari bank makanan, dan memadankan nama pelajar dengan ID mereka.
- Membolehkan Bahagian Hal Ehwal Pelajar (HEP) menghubungi pelajar yang mungkin memerlukan bantuan lanjut.

Data tidak digunakan untuk tujuan lain. Tiada had lawatan atau kuantiti, jadi tiada pelajar ditolak berdasarkan data ini. Sebarang tujuan baharu memerlukan notis baharu kepada pelajar terlebih dahulu.

### 4. Tempat data disimpan

- **Google Sheet dan projek Apps Script** milik akaun Google Workspace institusi UiTM, bukan akaun peribadi. Google mungkin menyimpan data di luar Malaysia **(sahkan dengan ICT bahawa perjanjian Google Workspace UiTM meliputi perkara ini)**.
- **Tab Students:** ID pelajar, nama, fakulti, masa persetujuan, tarikh lawatan dan bilangan lawatan.
- **Tab Visits:** setiap lawatan dikaitkan dengan pelajar hanya melalui kod berkunci (HMAC-SHA256). Kuncinya disimpan dalam tetapan projek Apps Script (Script Properties), tidak dalam Sheet, aplikasi atau repositori kod.
- **Lejar stok (Transactions) dan e-mel amaran:** tiada data pelajar.
- **Peranti pantri** (komputer riba dan telefon pantri) menyimpan lawatan hanya sehingga ia dihantar, kemudian memadamnya. Lawatan yang ditolak oleh pelayan kekal pada peranti, bertanda "Needs staff", sehingga staf menghantar semula atau membuangnya di skrin Sync peranti itu. Peranti tidak pernah menyimpan senarai pelajar.
- **Telefon pelajar sendiri** tidak menyimpan apa-apa selepas lawatan, kecuali jika pelajar menanda "Ingat butiran saya pada telefon ini". ID, nama dan fakulti kemudian kekal dalam pelayar telefon itu sehingga pelajar menekan "Bukan anda? Padam butiran tersimpan" atau membuang tanda tersebut.
- **Repositori kod di GitHub** adalah awam dan tidak mengandungi data pelajar.

### 5. Siapa boleh melihat data

| Siapa | Apa yang boleh dilihat |
|---|---|
| Pemilik (akaun institusi) | Semua, termasuk hamparan. Satu-satunya akaun yang boleh menyunting tab Students, Visits, Transactions dan AuditLog secara terus. |
| Admin (peranan admin dalam tab Staff) | Dalam aplikasi staf: carian pelajar mengikut ID, eksport untuk HEP, senarai staf dan tetapan. |
| Staf (peranan staff) | Stok, terimaan, pindahan, kiraan, pelarasan, pembatalan, barang dan laporan. Tiada ID, nama atau fakulti pelajar. Staf tidak membuka hamparan. |
| Pelajar | Skrin mereka sendiri sahaja. ID dipaparkan bertopeng (contoh 2023••••89). |
| Penerima e-mel | Amaran stok dan ringkasan kuantiti besar, tanpa data pelajar. |

Membuka tab Students terus dalam hamparan tidak direkodkan dalam AuditLog **(sahkan sama ada admin perlu akses kepada hamparan)**. Apabila staf atau admin bertukar tugas, admin membuang tanda "Active" mereka dalam tab Staff; akses tamat serta-merta.

### 6. Tempoh simpanan

Setiap malam pada jam 2 pagi, tugas berjadual (`nightlyJobs` dalam `backend/jobs.js`):
- membuang pautan pelajar (`student_key`) daripada lawatan yang berusia lebih 365 hari. Rekod lawatan dan barang kekal tanpa sebarang pautan kepada pelajar, untuk sejarah stok;
- memadam pelajar daftar sendiri yang lawatan terakhirnya lebih 365 hari lalu (ID, nama dan fakulti dibuang dari tab Students).

Tempoh ini ialah tetapan `retention_days` (lalai 365). Hanya admin boleh mengubahnya, dan setiap perubahan direkodkan dalam AuditLog. Jika senarai pelajar (roster) diimport kelak, ia diganti pada setiap import.

Tidak diliputi oleh tugas malam:
- salinan di luar sistem (eksport HEP, muat turun CSV): lihat bahagian 8;
- sejarah versi hamparan (File > Version history), yang menyimpan versi lama termasuk baris yang telah dipadam, untuk sesiapa yang ada akses sunting **(sahkan dengan ICT cara mengendalikannya, contohnya hadkan akses sunting kepada pemilik)**;
- AuditLog, yang disimpan tanpa tarikh tamat **(sahkan tempohnya)**.

### 7. Log audit

Tab AuditLog merekodkan masa dan e-mel staf bagi setiap carian pelajar (sebahagian pendek kod berkunci, bukan ID), setiap eksport HEP (dengan bilangan pelajar), perubahan senarai staf dan tetapan, lokasi dan barang baharu, dan peranti yang dibatalkan. Hanya pemilik boleh menyuntingnya. Seorang admin menyemaknya setiap bulan **(sahkan siapa dan kekerapannya)**.

### 8. Eksport untuk HEP

- Hanya admin boleh mengeksport, dari halaman Students dalam aplikasi staf. Fail mengandungi ID pelajar, nama, fakulti, tarikh lawatan pertama dan terakhir, dan bilangan lawatan bagi pelajar yang datang dalam setahun lepas. Setiap eksport direkodkan dalam AuditLog.
- Hantar hanya kepada pegawai HEP yang dinamakan melalui saluran UiTM (e-mel UiTM atau perkongsian Google Drive UiTM), bukan WhatsApp, e-mel peribadi atau pemacu USB.
- Padam salinan anda (folder Downloads dan tong sampah) selepas menghantar.
- HEP menyimpan dan memadam fail mengikut peraturannya sendiri **(sahkan tempoh simpanan dengan HEP)**.
- Laporan CSV lain (stok, transaksi, lawatan) tidak mengandungi data pelajar.

### 9. Hak pelajar

Pelajar boleh meminta untuk melihat, membetulkan atau memadam data mereka dengan menghubungi bank makanan **(sahkan alamat e-mel untuk dihubungi)**.
- **Membetulkan:** butiran digantikan dengan apa yang pelajar masukkan pada lawatan seterusnya.
- **Memadam:** pemilik memadam baris pelajar dalam tab Students dan mengosongkan `student_key` pada lawatan mereka. Belum ada butang untuk ini.

### 10. Keselamatan

- Aplikasi staf memerlukan log masuk Google UiTM, dan hanya orang yang aktif dalam tab Staff boleh masuk, mengikut peranan masing-masing.
- API awam menyemak setiap permintaan. Kunci rahsia hanya ada dalam Script Properties. Tab sejarah dan data peribadi dilindungi.
- Tiada data pelajar dalam URL, e-mel, log atau repositori kod awam.
- Peranti pantri didaftarkan dengan kod sekali guna. Batalkan peranti yang hilang dengan segera di halaman Devices.

### 11. Jika data bocor

Contoh: eksport dihantar kepada orang yang salah, peranti pantri yang hilang dengan lawatan belum dihantar, hamparan dikongsi terlalu luas, atau kunci rahsia terdedah.

1. **Bendung (hari yang sama).** Batalkan perkongsian fail atau buang tanda "Active" orang itu dalam tab Staff. Batalkan peranti yang hilang. Minta penerima memadam salinan yang salah dan mengesahkannya melalui e-mel.
2. **Rekod.** Apa yang berlaku, bila, data apa, berapa ramai pelajar, dan siapa yang tahu. Semak AuditLog dan aktiviti Google Drive.
3. **Lapor dalam masa 24 jam** kepada pegawai bertanggungjawab bank makanan, serta bahagian ICT dan pejabat undang-undang UiTM **(sahkan nama dan saluran)**.
4. **Maklumkan.** Pindaan Akta Perlindungan Data Peribadi (PDPA) pada 2024 menambah kewajipan memaklumkan Pesuruhjaya Perlindungan Data Peribadi (dalam 72 jam mengikut garis panduan Pesuruhjaya) dan, bagi kebocoran yang serius, pelajar yang terjejas. Pejabat undang-undang UiTM menentukan sama ada ini terpakai dan siapa yang memaklumkan **(sahkan)**.
5. **Jika kunci rahsia mungkin terdedah,** maklumkan pembangun sistem: kunci baharu perlu ditetapkan dan rekod sedia ada dikunci semula. Belum ada butang untuk ini.
6. **Baiki punca** dan kemas kini dasar ini.

---

## Part B: English

### 1. Scope

This policy covers personal data in Food Bank UiTMCPP, UiTM's food bank inventory and self-service checkout system: the student app, the staff app and the Google Sheet behind them. It applies to the owner of the system account, admins and staff. The data controller is UiTM, through the unit that runs the food bank **(to confirm: the unit's name and the responsible officer)**.

### 2. What we collect

From students, at every visit:
- student ID, full name and faculty (chosen from a list);
- consent (a tick box) and when it was given;
- the items and quantities taken, with the time and the pantry.

The system also keeps each student's first and last visit dates and number of visits. We do **not** collect IC numbers, phone numbers, email, addresses, photos of students or location.

From staff: UiTM email, name, role, and the actions each person takes (deliveries, transfers, stock counts, adjustments, voided visits, student look-ups).

### 3. Why

- To keep accurate records of what leaves the food bank, and to match a student's name with their ID.
- So Student Affairs (HEP) can contact students who may need more help.

The data is not used for anything else. There are no visit or quantity limits, so no student is refused because of it. Any new purpose needs a new notice to students first.

### 4. Where it is kept

- **Google Sheet and Apps Script project** owned by a UiTM institutional Google Workspace account, not a personal one. Google may store the data outside Malaysia **(to confirm with ICT that UiTM's Google Workspace agreement covers this)**.
- **Students tab:** student ID, name, faculty, consent time, visit dates and visit count.
- **Visits tab:** each visit is linked to a student only by a keyed code (HMAC-SHA256). The key is kept in the Apps Script project's settings (Script Properties), never in the Sheet, the apps or the code repository.
- **Stock ledger (Transactions) and email alerts:** no student data.
- **Pantry devices** (the pantry laptop and pantry phones) hold a visit only until it is sent, then delete it. A visit the server rejects stays on the device, marked "Needs staff", until staff resend or discard it on that device's Sync screen. Devices never hold a list of students.
- **Students' own phones** keep nothing after the visit, unless the student ticks "Remember my details on this phone". Their ID, name and faculty then stay in that phone's browser until they tap "Not you? Clear saved details" or untick the box.
- **The code repository on GitHub** is public and holds no student data.

### 5. Who can see it

| Who | What they can see |
|---|---|
| Owner (institutional account) | Everything, including the spreadsheet. The only account that can edit the Students, Visits, Transactions and AuditLog tabs directly. |
| Admins (role admin on the Staff tab) | In the staff app: student look-up by ID, the HEP export, the staff list and settings. |
| Staff (role staff) | Stock, deliveries, transfers, counts, adjustments, voids, items and reports. No student IDs, names or faculties. Staff never open the spreadsheet. |
| Students | Only their own screen. The ID is shown masked (for example 2023••••89). |
| Email recipients | Stock alerts and the large-quantity digest, which hold no student data. |

Opening the Students tab directly in the spreadsheet is not recorded in AuditLog **(to confirm whether admins need access to the spreadsheet at all)**. When staff or admins change roles, an admin unticks "Active" for them on the Staff tab; their access ends at once.

### 6. How long it is kept

Every night at 2 a.m., a scheduled job (`nightlyJobs` in `backend/jobs.js`):
- removes the student link (`student_key`) from visits more than 365 days old. The visit and item records stay, with no link to any student, for stock history;
- deletes self-registered students whose last visit was more than 365 days ago (ID, name and faculty are removed from the Students tab).

The period is the `retention_days` setting (default 365). Only admins can change it, and each change is recorded in AuditLog. If a roster is ever imported, it is replaced at each import.

Not covered by the nightly job:
- copies outside the system (HEP exports, CSV downloads): see section 8;
- the spreadsheet's version history (File > Version history), which keeps older versions, including deleted rows, for anyone with edit access **(to confirm with ICT how to handle this, for example by limiting edit access to the owner)**;
- AuditLog, which is kept with no end date **(to confirm a period)**.

### 7. Audit log

The AuditLog tab records the time and staff email for each student look-up (a short part of the keyed code, not the ID), each HEP export (with the number of students), changes to the staff list and settings, new locations and items, and revoked devices. Only the owner can edit it. An admin reviews it monthly **(to confirm who, and how often)**.

### 8. Exports for HEP

- Only admins can export, from the Students page of the staff app. The file lists student ID, name, faculty, first and last visit dates and number of visits for students seen in the last year. Every export is recorded in AuditLog.
- Send it only to the named HEP officer through UiTM channels (UiTM email or a UiTM Google Drive share), never by WhatsApp, personal email or USB drive.
- Delete your copy (Downloads folder and trash) after sending.
- HEP keeps and deletes the file under its own rules **(to confirm the retention period with HEP)**.
- The other CSV reports (stock, transactions, visits) hold no student data.

### 9. Students' rights

Students can ask to see, correct or delete their data by contacting the food bank **(to confirm a contact email)**.
- **Correct:** their details are replaced by what they enter at their next visit.
- **Delete:** the owner deletes the student's row in the Students tab and blanks `student_key` on their visits. There is no button for this yet.

### 10. Security

- The staff app needs a UiTM Google sign-in, and only people who are active on the Staff tab can enter, each limited to their role.
- The public API checks every request. The secret key exists only in Script Properties. History and personal-data tabs are protected.
- No student data in URLs, emails, logs or the public code repository.
- Pantry devices are set up with a one-time code. Revoke a lost device at once on the Devices page.

### 11. If data leaks

For example: an export sent to the wrong person, a lost pantry device holding unsent visits, the spreadsheet shared too widely, or the secret key exposed.

1. **Contain it (the same day).** Unshare the file, or untick "Active" for the person on the Staff tab. Revoke a lost device. Ask anyone who received a wrong copy to delete it and confirm by email.
2. **Record it.** What happened, when, which data, how many students, and who knows. Check AuditLog and Google Drive activity.
3. **Report within 24 hours** to the food bank's responsible officer and to UiTM's ICT division and legal office **(to confirm names and channels)**.
4. **Notify.** The 2024 amendment to the Personal Data Protection Act (PDPA) added duties to notify the Personal Data Protection Commissioner (within 72 hours under the Commissioner's guideline) and, for serious breaches, the affected students. UiTM's legal office decides whether this applies and who notifies **(to confirm)**.
5. **If the secret key may be exposed,** tell the system developer: a new key has to be set and existing records re-keyed. There is no button for this yet.
6. **Fix the cause** and update this policy.

---

## Perkara untuk disahkan · Items to confirm

| # | Bahasa Melayu | English | Siapa · Who |
|---|---|---|---|
| 1 | Sama ada PDPA 2010 terpakai kepada UiTM (badan berkanun) dan sistem ini. Dasar data UiTM sendiri tetap terpakai. | Whether PDPA 2010 applies to UiTM (a statutory body) and to this system. UiTM's own data policy applies either way. | Undang-undang · Legal |
| 2 | Pengawal data: unit dan pegawai yang bertanggungjawab, dan e-mel untuk pelajar menghubungi. | Data controller: the responsible unit and officer, and a contact email for students. | Pemilik · Owner |
| 3 | Google menyimpan data di luar Malaysia di bawah perjanjian Google Workspace UiTM. | Google storing data outside Malaysia under UiTM's Google Workspace agreement. | ICT |
| 4 | Sejarah versi hamparan menyimpan data yang telah dipadam. | The spreadsheet's version history keeps deleted data. | ICT |
| 5 | Sama ada admin perlu akses kepada hamparan (paparan terus tidak direkodkan dalam AuditLog). | Whether admins need access to the spreadsheet (direct views are not recorded in AuditLog). | Pemilik · Owner |
| 6 | Tempoh simpanan AuditLog, serta siapa yang menyemaknya dan kekerapannya. | AuditLog retention period, and who reviews it and how often. | Pemilik, ICT · Owner, ICT |
| 7 | Tempoh simpanan HEP bagi senarai yang dieksport, dan saluran yang diluluskan untuk menghantarnya. | HEP's retention period for exported lists, and the approved channel for sending them. | HEP |
| 8 | Pelajar bawah 18 tahun (sesetengah pelajar diploma atau pra-diploma): PDPA memerlukan persetujuan ibu bapa atau penjaga bagi kanak-kanak. | Students under 18 (some diploma or pre-diploma students): the PDPA requires a parent's or guardian's consent for minors. | Undang-undang · Legal |
| 9 | Apa yang berlaku jika pelajar tidak bersetuju (aplikasi tidak boleh merekod lawatan tanpa persetujuan). | What happens when a student does not consent (the app cannot record a visit without consent). | Pemilik, Undang-undang · Owner, Legal |
| 10 | Saluran laporan kebocoran kepada ICT dan undang-undang UiTM, dan sama ada kewajipan pemakluman PDPA terpakai. | Breach reporting channels at UiTM ICT and legal, and whether the PDPA notification duty applies. | Undang-undang, ICT · Legal, ICT |
| 11 | Versi bahasa mana yang diguna pakai jika kedua-duanya berbeza. | Which language version prevails if the two differ. | Undang-undang · Legal |
