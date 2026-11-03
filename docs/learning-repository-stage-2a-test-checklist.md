# Checklist pengujian manual — Repositori Pembelajaran Tahap 2A

Lakukan hanya pada salinan spreadsheet uji dan akun uji. Jangan gunakan data siswa nyata.

## Migrasi
- [ ] Pastikan migrasi fondasi versioning `BUNDLE_VERSIONING_V1` telah berstatus `completed` pada `SchemaMigrations`.
- [ ] Jalankan `migrateLearningRepositoryV1_()` dari editor Apps Script hanya setelah prasyarat di atas terpenuhi.
- [ ] Pastikan `SchemaMigrations` mencatat `LEARNING_REPOSITORY_V1` dengan status `completed`; endpoint repositori harus menolak akses jika catatan ini belum ada.
- [ ] Pastikan sheet `LearningIndicators` dan `AdminAuditLog` dibuat dengan header sesuai spesifikasi.
- [ ] Pastikan header `LearningObjectives` lama tetap ada; header yang kurang ditambahkan di kanan.
- [ ] Jalankan migrasi sekali lagi; hasil harus menyatakan `alreadyApplied: true`.
- [ ] Pastikan baris lama pada `LearningObjectives` tidak berubah dan tidak ada sheet/row siswa yang dihapus.

## Admin CRUD
- [ ] Admin membuat TP; periksa ID, kode uppercase, timestamps, dan audit CREATE.
- [ ] Admin membuat TP kedua dengan kode sama dan mapel sama; harus ditolak.
- [ ] Kode TP sama pada mapel berbeda boleh dibuat.
- [ ] Admin mengubah TP; audit UPDATE memuat before/after.
- [ ] Admin menonaktifkan TP; data tetap ada dan tidak muncul di daftar aktif.

## Indikator
- [ ] Admin membuat indikator pada TP aktif.
- [ ] Indikator dengan kode sama dalam TP sama harus ditolak.
- [ ] Kode sama pada TP berbeda boleh dibuat.
- [ ] TP tidak aktif tidak boleh menerima indikator baru.
- [ ] Admin mengubah dan menonaktifkan indikator; audit tercatat.
- [ ] Daftar aktif hanya mengembalikan indikator aktif dari TP aktif.

## Otorisasi
- [ ] Admin dapat memakai seluruh endpoint Admin.
- [ ] Guru ditolak untuk semua endpoint CRUD/list-admin, termasuk pemanggilan API langsung.
- [ ] Guru dapat membaca TP/indikator aktif.
- [ ] Siswa ditolak untuk endpoint repositori, termasuk endpoint baca aktif.
- [ ] Tanpa sesi valid, seluruh endpoint privat ditolak.

## Regresi dan integritas
- [ ] Data Bundel Soal, versi Bundel, Asesmen, Attempts, dan Files tidak berubah.
- [ ] Snapshot versi Bundel lama tetap identik setelah TP/indikator master diedit.
- [ ] Dua penulisan bersamaan tidak menghasilkan kode duplikat.
- [ ] Uji kegagalan audit setelah perubahan dan verifikasi prosedur rekonsiliasi manual.
- [ ] Jalankan pemeriksaan sintaks dan uji integrasi pada Apps Script test deployment sebelum merge/deploy.
