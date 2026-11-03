# Rancangan Integrasi SOLO Tax — Tahap Desain

## Status
Dokumen rancangan; belum mengaktifkan klasifikasi SOLO Tax pada editor produksi dan belum mengubah rubrik soal yang sudah ada.

## Prinsip
1. SOLO Tax menjadi mode/klasifikasi bundel yang eksplisit, bukan sekadar label tampilan.
2. Setiap soal SOLO Tax harus terhubung ke tujuan pembelajaran aktif dan, bila ditentukan, indikator aktif yang berada di bawah TP tersebut.
3. Level SOLO Tax menjelaskan kualitas struktur pemahaman jawaban, bukan tingkat kesulitan soal.
4. Rubrik dan level disimpan sebagai bagian dari snapshot versi bundel. Perubahan rubrik menghasilkan versi baru dan tidak mengubah asesmen historis.
5. Soal Reguler tetap menggunakan alur dan rubrik saat ini; fitur SOLO Tax tidak boleh mengubah perilaku Reguler.
6. Penilaian otomatis hanya dilakukan jika tipe soal dan kunci/rubrik memang mendukungnya. Jawaban uraian tetap memerlukan penilaian guru kecuali rubrik analitik yang tervalidasi tersedia.

## Model level
Urutan level yang digunakan:
- **Prestructural** — jawaban belum menunjukkan pemahaman relevan terhadap konsep yang ditanyakan.
- **Unistructural** — jawaban menggunakan satu aspek/konsep yang relevan.
- **Multistructural** — jawaban menggunakan beberapa aspek relevan, tetapi belum menghubungkannya.
- **Relational** — jawaban mengintegrasikan beberapa aspek menjadi penjelasan yang koheren.
- **Extended Abstract** — jawaban menggeneralisasi, membuat abstraksi, atau menerapkan hubungan konsep pada situasi baru.

Deskripsi di atas adalah definisi kerja. Guru perlu dapat mengedit deskriptor sesuai mata pelajaran dan tujuan pembelajaran tanpa mengubah nama/urutan level baku.

## Struktur data yang disarankan
- `SoloTaxRubrics`: rubricId, objectiveId, indicatorId (opsional), subject, title, version, active, createdAt, updatedAt.
- `SoloTaxRubricLevels`: levelId, rubricId, levelCode, levelOrder, descriptor, scoreValue, active.
- Snapshot soal/bundel: classification, objectiveId, indicatorId, rubricId, rubricVersion, dan deskriptor level yang dipakai.
- Snapshot asesmen menyimpan versi bundel/rubrik yang dipakai saat asesmen dibuat. Jangan mengambil deskriptor terkini untuk menilai asesmen lama.

## Aturan validasi
- Lima level baku harus tersedia satu kali masing-masing dan urutannya konsisten.
- Skor tiap level harus numerik dan urut; skema skor dapat dikonfigurasi sekolah, tetapi tidak boleh ambigu.
- Rubrik harus terkait dengan TP aktif; indikator jika diisi harus aktif dan milik TP tersebut.
- Saat guru memilih SOLO Tax, editor wajib meminta rubrik yang aktif dan menampilkan deskriptor sebelum soal dapat disimpan.
- Perubahan TP atau indikator yang dinonaktifkan tidak boleh menghapus referensi historis yang sudah tersimpan dalam snapshot.

## Alur UI yang direncanakan
1. Administrator membuat dan mengelola rubrik SOLO Tax untuk TP/indikator.
2. Guru memilih klasifikasi SOLO Tax pada bundel.
3. Guru memilih TP, indikator (opsional), lalu rubrik aktif.
4. Editor menampilkan lima level dan deskriptor. Guru menyusun stimulus, pertanyaan, dan bukti jawaban yang sesuai.
5. Sistem memvalidasi kelengkapan rubrik dan menyimpan semuanya ke snapshot versi bundel.
6. Saat asesmen dibuat, sistem mengikat asesmen ke versi bundel dan versi rubrik tersebut.
7. Guru menilai jawaban dengan deskriptor yang sama dengan yang dipakai ketika asesmen diterbitkan.

## Tahapan implementasi berikutnya
- Tambahkan tabel rubrik dan level beserta migrasi eksplisit terpisah.
- Bangun CRUD rubrik untuk Administrator dengan audit log.
- Bangun pemilih rubrik dan panel deskriptor pada editor Guru.
- Tambahkan validasi server dan snapshot versioning.
- Uji regresi Reguler, versi bundel, asesmen historis, serta penilaian pada spreadsheet salinan sebelum mengaktifkan SOLO Tax.

## Batasan saat ini
Editor SOLO Tax, CRUD rubrik, penyimpanan level, dan penilaian berbasis SOLO Tax belum diimplementasikan. Dropdown SOLO Tax tetap dinonaktifkan sampai seluruh alur di atas siap dan diuji.
