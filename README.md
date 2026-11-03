# Rumble Assessment

Aplikasi asesmen digital untuk guru dan siswa. Frontend: index.html. Backend: Code.gs (Google Apps Script).

## Status
Fondasi awal / preview. Belum siap untuk asesmen resmi atau data siswa nyata. Branch `feature/bundle-versioning-foundation` menambahkan fondasi versioning Bundel Soal dan migrasi eksplisit; perubahan ini belum diuji pada Apps Script runtime dan belum boleh diterapkan ke spreadsheet produksi. Editor SOLO Tax lengkap, penilaian, finalisasi, dan keamanan produksi masih dalam tahap pengembangan.

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
Operasi CRUD tidak lagi menjalankan `setupDatabase()` secara otomatis. Migrasi versioning dilakukan secara eksplisit melalui `migrateDatabaseV1_()` dan dicatat pada `SchemaMigrations`. Sheet `BundleVersions` menyimpan snapshot versi yang tidak boleh ditimpa; Asesmen baru yang dibuat dari bundel menyimpan `bundleId` dan `bundleVersionId`. Penghapusan Bundel/Asesmen pada backend versi ini diubah menjadi pengarsipan. SOLO Tax belum dapat dibuat melalui editor pada tahap fondasi ini.\n\nBackend ini kerangka awal, bukan sistem autentikasi produksi. Jangan mengandalkan pilihan peran frontend sebagai kontrol akses. Sebelum memakai data siswa nyata, tambahkan autentikasi terverifikasi dan pemeriksaan izin server di setiap aksi. Jangan membuka spreadsheet/foto jawaban untuk publik, jangan mengirim kunci jawaban ke browser siswa, serta tambahkan validasi jadwal, pencegahan percobaan ganda, audit dan pencadangan.

## API
POST JSON, contoh: {"action":"health","payload":{}}.
Aksi: health, createAssessment, listAssessments, getAssessment, submitAttempt, listAttempts, gradeAttempt, logEvent, listStudents, saveUser, uploadAnswerImage. Untuk menerima jawaban, status asesmen pada sheet Assessments harus diubah menjadi published. Fitur publikasi dan kontrol akses perlu dikembangkan sebelum produksi.

## Anti-kecurangan
Timer dan pencatatan perpindahan tab membantu pengawasan, tetapi browser tidak dapat menjamin siswa tidak menggunakan perangkat lain atau AI. Penguncian lebih kuat memerlukan perangkat sekolah terkelola atau solusi ujian khusus.
