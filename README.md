# Rumble Assessment

Aplikasi asesmen digital untuk guru dan siswa. Frontend: index.html. Backend: Code.gs (Google Apps Script).

## Status
Fondasi awal / preview. Belum siap untuk asesmen resmi atau data siswa nyata. Branch `feature/bundle-versioning-foundation` menjadi fondasi versioning Bundel Soal; branch `feature/learning-repository-backend` menambahkan repositori TP/indikator dan integrasinya. Pemeriksaan CI statis tersedia, tetapi runtime Google Apps Script dan migrasi pada spreadsheet salinan belum diverifikasi. Jangan terapkan ke spreadsheet produksi. Editor SOLO Tax lengkap, penilaian, finalisasi, dan hardening keamanan produksi masih dalam tahap pengembangan.

## Arsitektur
- Frontend HTML/CSS/JavaScript statis, dapat dipublikasikan melalui GitHub Pages.
- Backend Google Apps Script Web App.
- Database Google Sheets.
- File jawaban opsional disimpan di Google Drive.

## Setup backend
1. Buat spreadsheet Google khusus aplikasi ini.
2. Salin ID spreadsheet dari URL (bagian di antara /d/ dan /edit).
3. Buka https://script.google.com/ dan buat project.
4. Salin Code.gs dari repositori ke editor Apps Script.
5. Isi CONFIG.SPREADSHEET_ID. Jika akan menyimpan foto, buat folder Drive dan isi CONFIG.DRIVE_FOLDER_ID.
6. Untuk instalasi baru atau salinan spreadsheet uji, jalankan `migrateDatabaseV1_()` dari editor Apps Script. Fungsi ini membuat sheet/header yang diperlukan dan membuat versi awal untuk Bundel Soal yang sudah ada. Jalankan hanya pada spreadsheet uji terlebih dahulu; jangan jalankan pada database produksi sebelum hasil migrasi ditinjau. Fungsi `setupDatabase()` tetap tersedia untuk inisialisasi skema manual.
7. Deploy → New deployment → Web app. Pilih akses sesuai kebijakan sekolah.
8. Salin URL berakhiran /exec, lalu masukkan pada menu Pengaturan frontend.

## GitHub Pages
Buka Settings → Pages, pilih branch main dan folder /(root), lalu simpan. Setelah situs terbit, masukkan URL Apps Script di menu Pengaturan.

## Catatan integrasi dan keamanan
Browser mungkin membatasi permintaan lintas-origin/redirect Apps Script. Gunakan tombol Uji koneksi; bila diblokir CORS, opsi paling stabil adalah menyajikan frontend dari Apps Script atau menambahkan API yang mendukung CORS.
Operasi CRUD tidak lagi menjalankan `setupDatabase()` secara otomatis. Migrasi versioning dilakukan secara eksplisit melalui `migrateDatabaseV1_()` dan dicatat pada `SchemaMigrations`. Sheet `BundleVersions` menyimpan snapshot versi yang tidak boleh ditimpa; Asesmen baru yang dibuat dari bundel menyimpan `bundleId` dan `bundleVersionId`. Penghapusan Bundel/Asesmen pada backend versi ini diubah menjadi pengarsipan. SOLO Tax belum dapat dibuat melalui editor pada tahap fondasi ini.

Backend menerapkan autentikasi sesi dan pemeriksaan peran di server untuk aksi yang telah didaftarkan. Hal ini belum berarti aplikasi siap produksi. Sebelum memakai data siswa nyata, lakukan pengujian runtime dan integrasi, tinjau konfigurasi deployment serta izin spreadsheet/Drive, dan pastikan validasi jadwal, pencegahan percobaan ganda, audit, pencadangan, serta prosedur pemulihan telah diuji. Jangan membuka spreadsheet/foto jawaban untuk publik atau mengirim kunci jawaban ke browser siswa.

## API
POST JSON, contoh: {"action":"health","payload":{}}.
Aksi: health, createAssessment, listAssessments, getAssessment, submitAttempt, listAttempts, gradeAttempt, logEvent, listStudents, saveUser, uploadAnswerImage. Untuk menerima jawaban, status asesmen pada sheet Assessments harus diubah menjadi published. Fitur publikasi dan kontrol akses perlu dikembangkan sebelum produksi.

## Anti-kecurangan
Timer dan pencatatan perpindahan tab membantu pengawasan, tetapi browser tidak dapat menjamin siswa tidak menggunakan perangkat lain atau AI. Penguncian lebih kuat memerlukan perangkat sekolah terkelola atau solusi ujian khusus.


## Repositori Pembelajaran (Tahap 2A)

Branch `feature/learning-repository-backend` menambahkan backend Admin untuk mengelola TP dan indikator:
- `LearningObjectives` tetap menjadi master TP bersama.
- `LearningIndicators` menyimpan indikator yang terhubung ke satu TP.
- `AdminAuditLog` mencatat aktor, aksi, serta kondisi sebelum/sesudah perubahan. Intent ditulis sebagai `PENDING_*` sebelum perubahan master; Admin dapat memeriksa dan merekonsiliasi entri tertunda melalui UI.
- Endpoint baca aktif tersedia untuk Admin/Guru; seluruh CRUD dan daftar lengkap hanya untuk Admin.
- Data dinonaktifkan secara soft-delete; tidak ada penghapusan permanen.

### Migrasi repositori

Setelah meninjau kode dan mencadangkan spreadsheet uji, pastikan migrasi fondasi `BUNDLE_VERSIONING_V1` telah berstatus `completed`. Fungsi `migrateLearningRepositoryV1_()` kini memeriksa prasyarat tersebut sebelum mengubah sheet apa pun. Jika prasyarat belum terpenuhi, migrasi repositori akan dihentikan. Setelah lolos, fungsi membuat sheet yang belum ada, menambahkan header yang kurang tanpa menghapus baris, lalu mencatat `LEARNING_REPOSITORY_V1` pada `SchemaMigrations`. Migrasi ini terpisah dari `setupDatabase()` dan `migrateDatabaseV1_()`; jalankan secara manual hanya pada spreadsheet uji yang telah dicadangkan. Migrasi ini BELUM dijalankan pada spreadsheet mana pun oleh proses pengembangan.

### API backend Tahap 2A

Admin:
- `adminListLearningObjectives`, `adminSaveLearningObjective`, `adminSetLearningObjectiveActive`
- `adminListLearningIndicators`, `adminSaveLearningIndicator`, `adminSetLearningIndicatorActive`
- `adminListPendingLearningAudits`, `adminReconcileLearningAudit` (rekonsiliasi khusus Admin; keputusan dicatat sebagai audit baru dan retry memakai keputusan yang sudah tercatat)

Admin/Guru:
- `listAvailableLearningObjectives`
- `listAvailableLearningIndicators` (memerlukan `objectiveId`)

Semua aksi memerlukan sesi terautentikasi. Otorisasi dilakukan di server, bukan berdasarkan peran yang dikirim browser. Penulisan memakai ScriptLock. Kode TP unik per mata pelajaran; kode indikator unik dalam satu TP aktif. Snapshot Bundel/Asesmen yang telah tersimpan tidak disentuh oleh CRUD master ini.

### Batasan dan validasi

Google Sheets tidak menyediakan transaksi multi-sheet. Jika penulisan entitas atau penutupan audit gagal, status `PENDING_*` dapat memerlukan pemeriksaan Admin. UI rekonsiliasi menyimpan keputusan sebagai entri audit terpisah, kemudian menutup status awal; retry setelah keputusan tercatat menggunakan keputusan yang sama untuk menghindari entri rekonsiliasi duplikat. Keputusan `applied`/`not_applied`/`manual` adalah catatan hasil pemeriksaan Admin, bukan verifikasi otomatis terhadap isi sheet. Periksa kondisi entitas secara manual sebelum memilih keputusan. Audit log tidak dapat dianggap sebagai tamper-proof terhadap pemilik spreadsheet. Uji integrasi dan runtime Apps Script tetap wajib dilakukan pada salinan spreadsheet sebelum deployment. Pemeriksaan CI yang berstatus berhasil hanya mencakup guard statis dan simulasi terisolasi Node.js; itu bukan bukti bahwa SpreadsheetApp, LockService, sesi, izin, atau UI berjalan benar di Apps Script.


### Repositori TP dan indikator
- Administrator mengelola tujuan pembelajaran dan indikator melalui halaman **TP & Indikator**.
- Guru dapat menghubungkan bundel soal ke TP dan indikator aktif. Referensi disimpan pada snapshot versi bundel.
- Pemilihan referensi bersifat opsional untuk menjaga kompatibilitas bundel Reguler lama.
- Rancangan tahap SOLO Tax tersedia pada `docs/solo-tax-integration-design.md`; editor dan rubrik SOLO Tax belum diaktifkan.


## Gerbang kesiapan sebelum disalin atau diterapkan

Status branch ini tetap **belum siap disalin ke sistem aktif**. Sebelum perubahan digunakan:
1. Jalankan pemeriksaan CI terbaru dan tinjau hasilnya.
2. Buat salinan spreadsheet tanpa data siswa nyata serta project/deployment Apps Script uji yang terisolasi.
3. Cadangkan salinan uji, lalu jalankan migrasi fondasi versioning dan migrasi repositori sesuai urutan pada checklist.
4. Selesaikan seluruh skenario migrasi, Admin/Guru/Siswa, audit tertunda, CRUD, snapshot, pembuatan asesmen, dan regresi.
5. Tinjau izin spreadsheet/Drive dan konfigurasi deployment bersama administrator sekolah.
6. Catat hasil uji dan keputusan rilis sebelum PR diubah dari Draft.

Tidak ada migrasi spreadsheet atau deployment produksi yang dilakukan selama pengembangan branch ini.

## Runbook lingkungan uji terisolasi SOLO Tax

**Jangan gunakan spreadsheet produksi, salinan yang masih berisi data siswa, atau folder Drive produksi.** Buat sumber daya kosong yang benar-benar terpisah.

1. Buat spreadsheet kosong khusus uji dan folder Drive kosong khusus uji. Jangan menyalin baris data pengguna dari sistem aktif.
2. Buat project Google Apps Script baru khusus uji. Salin `Code.gs` dari branch integrasi ini.
3. Sebelum menjalankan fungsi apa pun atau membuat deployment, ganti `CONFIG.SPREADSHEET_ID` dan `CONFIG.DRIVE_FOLDER_ID` pada project uji dengan ID sumber daya uji yang baru dibuat. Verifikasi kedua ID tersebut secara manual dari URL Google. Jangan mengubah ID produksi pada repository.
4. Jalankan `migrateDatabaseV1_()` satu kali. Fungsi ini memanggil `setupDatabase()`, membuat sheet dasar yang belum ada/menambah header yang kurang, lalu mencatat `BUNDLE_VERSIONING_V1`. Periksa hasil eksekusi dan baris migrasi pada `SchemaMigrations`.
5. Setelah fondasi versioning berstatus `completed`, jalankan `migrateLearningRepositoryV1_()`. Pastikan `LEARNING_REPOSITORY_V1` tercatat `completed` dan sheet `LearningObjectives`, `LearningIndicators`, serta `AdminAuditLog` tersedia.
6. Buat akun pengujian saja: satu Admin dan satu Guru dengan email sekolah penguji, serta satu akun Siswa sintetis. Jangan memakai NIS, kata sandi, nama, atau jawaban siswa sungguhan.
7. Deploy hanya sebagai Web App uji. Batasi akses ke akun penguji. Pastikan URL deployment uji tidak dibagikan sebagai aplikasi resmi.
8. AI Penilaian harus tetap nonaktif pada awal pengujian. Uji alur manual terlebih dahulu. Pengujian AI hanya memakai jawaban sintetis, prompt yang sudah ditinjau, API key khusus uji di Script Properties, dan batas token rendah. Jangan mengirim foto jawaban ke AI.

### Skenario uji minimum

- **Migrasi:** kedua migrasi berhasil pada spreadsheet kosong; jalankan ulang untuk memeriksa idempotensi; pastikan tidak ada sheet atau header yang hilang/duplikat.
- **Admin:** buat, ubah, nonaktifkan TP dan indikator; periksa audit tertunda dan rekonsiliasi; pastikan akun Guru tidak dapat menjalankan aksi Admin.
- **Guru:** buat asesmen SOLO Tax berbentuk uraian saja, dengan subsoal, rubrik, panduan jawaban, dan indikator TP; pastikan soal Reguler lama tetap dapat dibuat dan dibaca.
- **Siswa:** login memakai akun sintetis, mengirim jawaban teks, menyimpan jawaban, dan mengirim lampiran foto uji; pastikan foto tidak dikirim ke AI.
- **Penilaian:** uji skor dan alasan per soal, jawaban kosong, jawaban foto saja, serta pemeriksaan manual Guru. Dominant level AI harus tidak tersedia jika ada soal yang memerlukan pemeriksaan deterministik/manual.
- **Verifikasi indikator:** uji persentase 0, 69, 70, 85, 86, dan 100; kategori harus mengikuti aturan `<70%` Belum Tercapai, `70–85%` Tercapai, dan `>85%` Melampaui. Periksa rata-rata TP dengan bobot indikator sama.
- **Level dominan:** verifikasi rekomendasi AI oleh Guru; perubahan level harus meminta alasan; verifikasi lama harus ditolak setelah analisis AI baru atau perubahan bukti yang membuatnya kedaluwarsa.
- **Otorisasi dan regresi:** uji kepemilikan asesmen, pembatasan peran, login NIS/kata sandi, asesmen Reguler, penilaian Reguler, dan snapshot bundel.

Catat hasil, bukti, dan versi commit yang diuji. CI statis yang lulus bukan pengganti pengujian runtime Apps Script, Spreadsheet, Drive, autentikasi, dan UI. Jangan ubah PR dari Draft, merge, atau deploy produksi sampai seluruh skenario yang relevan lulus dan ditinjau.
