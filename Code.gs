/**
 * Rumble Assessment — Google Apps Script backend
 *
 * Setup:
 * 1. Isi ID spreadsheet dan folder Drive pada CONFIG.
 * 2. Jalankan setupDatabase() satu kali.
 * 3. Deploy sebagai Web App untuk mengaktifkan endpoint.
 *
 * Catatan keamanan:
 * Backend ini masih fondasi awal. Tambahkan autentikasi terverifikasi dan
 * pemeriksaan izin server sebelum digunakan dengan data siswa sungguhan.
 */

const CONFIG = {
  SPREADSHEET_ID: '1PtFTRSFWjjoOkYzph7Elf6fziqMdwIqTi4p0HGsdlps',
  DRIVE_FOLDER_ID: '1_iKxvdIpBvbJp8r1cENloQroXMkMr9C8',
  APP_NAME: 'Rumble Assessment'
};

const TABLES = {
  Users: [
    'userId', 'name', 'email', 'role', 'className', 'active', 'createdAt',
    'username', 'nisn', 'passwordSalt', 'passwordHash'
  ],
  Assessments: [
    'assessmentId', 'title', 'subject', 'className', 'duration',
    'startAt', 'endAt', 'passageText', 'passageImageUrl', 'status', 'createdBy', 'createdAt', 'updatedAt',
    'bundleId', 'bundleVersionId', 'bundleVersionNumber', 'classification', 'archivedAt', 'archivedBy'
  ],
  QuestionBundles: ['bundleId','title','subject','description','tpCode','passageText','passageImageUrl','passagesJson','questionsJson','status','createdBy','createdAt','updatedAt','visibility','classification','latestVersionId','latestVersionNumber','archivedAt','archivedBy'],
  BundleVersions: ['versionId','bundleId','versionNumber','snapshotJson','createdBy','createdAt','changeNote'],
  SchemaMigrations: ['migrationId','version','appliedAt','appliedBy','status','detailsJson'],
  LearningObjectives: ['objectiveId','tpCode','title','subject','description','createdBy','createdAt','updatedAt','active'],
  Questions: [
    'questionId', 'assessmentId', 'order', 'type', 'text', 'points',
    'optionsJson', 'answerJson', 'rubric', 'pairsJson', 'imageUrl', 'optionImagesJson', 'subquestionsJson', 'subquestionImagesJson', 'rubricLevelsJson', 'passageText', 'passageImageUrl',
    'sourceBundleVersionId', 'sourceQuestionKey'
  ],
  Attempts: [
    'attemptId', 'assessmentId', 'studentId', 'startedAt', 'submittedAt',
    'status', 'score', 'maxScore', 'focusLossCount', 'answersJson',
    'teacherFeedback', 'questionScoresJson'
  ],
  Events: [
    'eventId', 'attemptId', 'studentId', 'eventType', 'eventAt', 'detailsJson'
  ],
  Files: [
    'fileId', 'attemptId', 'studentId', 'questionId', 'driveFileId', 'fileUrl', 'createdAt'
  ]
};

/**
 * Menyajikan antarmuka HTML yang sumber utamanya tetap index.html di GitHub.
 * Cache singkat mengurangi permintaan berulang ke raw.githubusercontent.com.
 */
function doGet() {
  const html = getFrontendHtml_();
  return HtmlService.createHtmlOutput(html)
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Mengambil HTML terkini dari repositori GitHub.
 * Perubahan GitHub dapat memerlukan hingga 5 menit untuk melewati cache.
 */
function getFrontendHtml_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'rumble_frontend_html_v7';
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = 'https://raw.githubusercontent.com/sg-mathuniverse/rumble-assessment/feature/bundle-versioning-foundation/index.html';
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true
  });
  const status = response.getResponseCode();

  if (status !== 200) {
    throw new Error('Gagal mengambil index.html dari GitHub (HTTP ' + status + ').');
  }

  const html = response.getContentText();
  if (!html || html.indexOf('id="app"') === -1) {
    throw new Error('File index.html dari GitHub kosong atau formatnya tidak sesuai.');
  }

  // index.html melebihi batas ukuran satu item CacheService, jadi jangan simpan HTML utuh di cache.
  return html;
}

/**
 * Jembatan frontend untuk google.script.run.
 * Semua operasi data diproses di server, bukan melalui fetch lintas domain.
 *
 * PENTING: deployment yang dibatasi domain saja belum merupakan otorisasi
 * per-peran. Tambahkan pemeriksaan izin guru/siswa sebelum memakai data nyata.
 */
function clientApi(action, payload) {
  try {
    const result = routeAction_(String(action || ''), payload || {});
    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      error: String(error && error.message ? error.message : error)
    };
  }
}

/**
 * Endpoint POST lama dipertahankan sementara agar integrasi lama tidak langsung
 * hilang selama transisi. Frontend baru menggunakan clientApi melalui HTML Service.
 */
function doPost(e) {
  try {
    const body = JSON.parse(
      e && e.postData && e.postData.contents
        ? e.postData.contents
        : '{}'
    );

    const result = routeAction_(
      String(body.action || ''),
      body.payload || {}
    );

    return outputJson_({ ok: true, data: result });
  } catch (error) {
    return outputJson_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

/**
 * Mengarahkan permintaan ke fungsi yang sesuai.
 */
function routeAction_(action, payload) {
  const publicActions = {
    health: true,
    getCurrentUser: true
  };
  if (action === 'health') {
    return { app: CONFIG.APP_NAME, time: new Date().toISOString() };
  }
  if (action === 'getCurrentUser') return getCurrentUser_(payload.sessionToken || '');
  if (action === 'studentLogin') return studentLogin_(payload);
  if (action === 'studentLogout') return studentLogout_(payload.sessionToken || '');

  // Identitas siswa internal diverifikasi melalui token server; guru/admin tetap memakai Google sekolah.
  const auth = getCurrentUser_(payload.sessionToken || '');
  if (!auth || !auth.authenticated || !auth.user) {
    throw new Error('Akses ditolak. Masuk menggunakan akun Google sekolah yang terdaftar dan aktif.');
  }
  const user = auth.user;
  const trusted = Object.assign({}, payload || {}, {
    currentUser: user,
    studentId: user.role === 'student' ? String(user.userId || '') : String(payload.studentId || ''),
    createdBy: user.email
  });
  const adminOnly = ['adminListStudents','adminImportStudents','adminResetStudentPassword','adminSetStudentActive','adminListLearningObjectives','adminSaveLearningObjective','adminSetLearningObjectiveActive','adminListLearningIndicators','adminSaveLearningIndicator','adminSetLearningIndicatorActive'];
  if (['listAvailableLearningObjectives','listAvailableLearningIndicators'].indexOf(action) >= 0 && user.role !== 'admin' && user.role !== 'teacher') {\n    throw new Error('Repositori pembelajaran hanya dapat diakses oleh Admin dan Guru.');\n  }\n  if (adminOnly.indexOf(action) >= 0 && user.role !== 'admin') {
    throw new Error('Fitur ini hanya dapat digunakan oleh administrator sekolah.');
  }
  const teacherOnly = [
    'createAssessment','deleteAssessment','saveQuestionBundle','listQuestionBundles',
    'getQuestionBundle','deleteQuestionBundle','updateAssessment','uploadAssessmentImage','deleteAssessmentImage',
    'publishAssessment','gradeAttempt','listStudents','listMonitoring','getTeacherSummary'
  ];
  const studentOnly = ['submitAttempt','logEvent','uploadAnswerImage','startAttempt','saveAttempt'];
  const shared = ['listAssessments','getAssessment','getAssessmentImage','listAttempts'];
  if (teacherOnly.indexOf(action) >= 0 && user.role !== 'teacher') {
    throw new Error('Fitur ini hanya dapat digunakan oleh akun guru terverifikasi.');
  }
  if (studentOnly.indexOf(action) >= 0 && user.role !== 'student') {
    throw new Error('Fitur ini hanya dapat digunakan oleh akun siswa terverifikasi.');
  }
  if (shared.indexOf(action) >= 0 && user.role !== 'teacher' && user.role !== 'student') {
    throw new Error('Peran akun tidak diizinkan.');
  }
  if (action === 'saveUser') {
    throw new Error('Pendaftaran pengguna dinonaktifkan melalui antarmuka. Minta administrator mengelola sheet Users.');
  }

  const actions = {
    createAssessment: function () { return createAssessment_(trusted); },
    deleteAssessment: function () { assertAssessmentOwner_(payload.id || payload.assessmentId, user); return deleteAssessment_(trusted); },
    deleteQuestionBundle: function () { assertQuestionBundleOwner_(payload.id || payload.bundleId, user); return deleteQuestionBundle_(trusted); },
    saveQuestionBundle: function () {
      const bundleId = payload.bundleId || payload.id;
      if (bundleId) assertQuestionBundleOwner_(bundleId, user);
      return saveQuestionBundle_(trusted);
    },
    listQuestionBundles: function () { return listQuestionBundles_(trusted); },
    getQuestionBundle: function () { return getQuestionBundle_(trusted); },
    updateAssessment: function () { assertAssessmentOwner_(payload.id || payload.assessmentId, user); return updateAssessment_(trusted); },
    uploadAssessmentImage: function () { return uploadAssessmentImage_(trusted); },
    deleteAssessmentImage: function () { return deleteAssessmentImage_(trusted); },
    listAssessments: function () { return listAssessments_(trusted); },
    getAssessment: function () { return getAssessment_(Object.assign({}, trusted, { includeAnswers: user.role === 'teacher' && payload.includeAnswers === true })); },
    getAssessmentImage: function () { return getAssessmentImage_(trusted); },
    publishAssessment: function () { assertAssessmentOwner_(payload.id || payload.assessmentId, user); return publishAssessment_(trusted); },
    startAttempt: function () { return startAttempt_(trusted); },
    saveAttempt: function () { return saveAttempt_(trusted); },
    submitAttempt: function () { return submitAttempt_(trusted); },
    listAttempts: function () {
      if (user.role === 'student') {
        trusted.studentId = String(user.userId || '');
        delete trusted.assessmentId;
        return listAttempts_(trusted);
      }
      return listAttempts_(trusted).filter(function (attempt) {
        const assessment = listRows_('Assessments').find(function (item) {
          return String(item.assessmentId) === String(attempt.assessmentId);
        });
        return assessment && assessment.createdBy &&
          String(assessment.createdBy).trim().toLowerCase() === String(user.email).trim().toLowerCase();
      });
    },
    gradeAttempt: function () {
      const attemptId = requiredText_(trusted.attemptId, 'ID pengerjaan', 100);
      const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
      if (!attempt) throw new Error('Pengerjaan tidak ditemukan.');
      assertAssessmentOwner_(attempt.assessmentId, user);
      return gradeAttempt_(trusted);
    },
    logEvent: function () {
      const attemptId = requiredText_(trusted.attemptId, 'ID pengerjaan', 100);
      const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
      if (!attempt || String(attempt.studentId) !== String(user.userId) || String(attempt.status) !== 'in_progress') {
        throw new Error('Sesi aktif tidak ditemukan untuk akun ini.');
      }
      const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === String(attempt.assessmentId); });
      assertStudentAssessmentIdentity_(assessment, user);
      return logEvent_(Object.assign({}, trusted, { attemptId: attemptId }));
    },
    listMonitoring: function () { return listMonitoring_(trusted); },
    getTeacherSummary: function () { return getTeacherSummary_(trusted); },
    adminListStudents: function () { return adminListStudents_(); },
    adminImportStudents: function () { return adminImportStudents_(trusted); },
    adminResetStudentPassword: function () { return adminResetStudentPassword_(trusted); },
    adminSetStudentActive: function () { return adminSetStudentActive_(trusted); },
    adminListLearningObjectives: function () { return adminListLearningObjectives_(); },
    adminSaveLearningObjective: function () { return adminSaveLearningObjective_(trusted); },
    adminSetLearningObjectiveActive: function () { return adminSetLearningObjectiveActive_(trusted); },
    adminListLearningIndicators: function () { return adminListLearningIndicators_(trusted); },
    adminSaveLearningIndicator: function () { return adminSaveLearningIndicator_(trusted); },
    adminSetLearningIndicatorActive: function () { return adminSetLearningIndicatorActive_(trusted); },
    listAvailableLearningObjectives: function () { return listAvailableLearningObjectives_(); },
    listAvailableLearningIndicators: function () { return listAvailableLearningIndicators_(trusted); },
    listStudents: function () {
      return listRows_('Users').filter(function (item) {
        return String(item.role).toLowerCase() === 'student' &&
          (item.active === true || String(item.active).toLowerCase() === 'true' || String(item.active) === '1');
      }).map(function (item) {
        return { userId: item.userId, name: item.name, email: item.email, className: item.className, active: item.active };
      });
    },
    uploadAnswerImage: function () {
      const attemptId = requiredText_(trusted.attemptId, 'ID pengerjaan', 100);
      const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
      if (!attempt || String(attempt.studentId) !== String(user.userId) || String(attempt.status) !== 'in_progress') throw new Error('Sesi pengerjaan tidak ditemukan atau sudah berakhir.');
      const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === String(attempt.assessmentId); });
      assertStudentAssessmentIdentity_(assessment, user);
      const started = new Date(attempt.startedAt).getTime(), durationMs = Number(assessment.duration) * 60000;
      if (!isFinite(started) || !isFinite(durationMs) || Date.now() > started + durationMs) throw new Error('Waktu pengerjaan sudah habis. Foto tidak dapat diunggah.');
      const questionId = requiredText_(trusted.questionId, 'ID soal', 120);
      const question = listRows_('Questions').find(function (item) { return String(item.questionId) === questionId && String(item.assessmentId) === String(assessment.assessmentId); });
      if (!question || String(question.type) !== 'essay') throw new Error('Soal uraian tidak ditemukan untuk sesi ini.');
      return uploadAnswerImage_(Object.assign({}, trusted, { assessmentId: assessment.assessmentId, teacherEmail: assessment.createdBy || '' }));
    }
  };
  if (!actions[action]) throw new Error('Unknown action: ' + action);
  return actions[action]();
}

/** Guru hanya boleh mengubah asesmen yang dibuat oleh akun tersebut.
 * Asesmen lama tanpa createdBy tetap bisa dikelola setelah peninjauan manual.
 */
function assertAssessmentOwner_(assessmentId, user) {
  const id = requiredText_(assessmentId, 'ID asesmen', 100);
  const assessment = listRows_('Assessments').find(function (item) {
    return String(item.assessmentId) === id;
  });
  if (!assessment) throw new Error('Asesmen tidak ditemukan.');
  if (!assessment.createdBy || String(assessment.createdBy).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
    throw new Error('Akses ditolak. Asesmen lama tanpa pemilik terverifikasi perlu dimigrasikan oleh administrator.');
  }
  return assessment;
}

function assertQuestionBundleOwner_(bundleId, user) {
  const id = requiredText_(bundleId, 'ID bundel', 100);
  const bundle = listRows_('QuestionBundles').find(function (item) {
    return String(item.bundleId) === id;
  });
  if (!bundle) throw new Error('Bundel soal tidak ditemukan.');
  if (!bundle.createdBy || String(bundle.createdBy).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
    throw new Error('Akses ditolak. Bundel lama tanpa pemilik terverifikasi perlu dimigrasikan oleh administrator.');
  }
  return bundle;
}

function assessmentIsAvailableNow_(assessment, now) {
  const current = now instanceof Date ? now.getTime() : new Date().getTime();
  const start = assessment.startAt ? new Date(assessment.startAt).getTime() : NaN;
  const end = assessment.endAt ? new Date(assessment.endAt).getTime() : NaN;
  if (assessment.startAt && (!isFinite(start) || current < start)) return false;
  if (assessment.endAt && (!isFinite(end) || current > end)) return false;
  return true;
}

function assertStudentAssessmentIdentity_(assessment, user) {
  if (!assessment || String(assessment.status).toLowerCase() !== 'published') {
    throw new Error('Asesmen tidak tersedia.');
  }
  const studentClass = String(user.className || '').trim().toLowerCase();
  const assessmentClass = String(assessment.className || '').trim().toLowerCase();
  if (!studentClass || !assessmentClass || studentClass !== assessmentClass) {
    throw new Error('Asesmen ini tidak ditujukan untuk kelas akunmu.');
  }
}

function assertStudentAssessmentAccess_(assessment, user) {
  assertStudentAssessmentIdentity_(assessment, user);
  if (!assessmentIsAvailableNow_(assessment)) {
    throw new Error('Asesmen belum dimulai atau waktu pengerjaannya sudah berakhir.');
  }
}

/**
 * Membuat tab dan header database yang dibutuhkan aplikasi.
 * Aman dijalankan kembali: tab yang sudah memiliki data tidak direset.
 */
function setupDatabase() {
  const spreadsheet = getSpreadsheet_();

  Object.keys(TABLES).forEach(function (tableName) {
    let sheet = spreadsheet.getSheetByName(tableName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(tableName);
    }

    const requiredHeaders = TABLES[tableName];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, requiredHeaders.length)
        .setFontWeight('bold')
        .setBackground('#142d4e')
        .setFontColor('#ffffff');
      sheet.autoResizeColumns(1, requiredHeaders.length);
    } else {
      const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      requiredHeaders.forEach(function (header) {
        if (existingHeaders.indexOf(header) === -1) {
          sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
          existingHeaders.push(header);
        }
      });
    }
  });

  return 'Sheets siap: ' + Object.keys(TABLES).join(', ');
}

/**
 * Mengambil spreadsheet utama.
 */
function getSpreadsheet_() {
  if (!CONFIG.SPREADSHEET_ID) {
    throw new Error('Isi CONFIG.SPREADSHEET_ID terlebih dahulu.');
  }

  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/**
 * Mengambil tab berdasarkan nama.
 */
function getSheet_(tableName) {
  const sheet = getSpreadsheet_().getSheetByName(tableName);

  if (!sheet) {
    throw new Error(
      'Sheet "' + tableName + '" belum ada. Jalankan setupDatabase().'
    );
  }

  return sheet;
}

/**
 * Membuat respons JSON untuk endpoint Apps Script.
 */
function outputJson_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Membaca seluruh baris menjadi array objek.
 */
function listRows_(tableName) {
  const values = getSheet_(tableName).getDataRange().getValues();

  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map(String);

  return values.slice(1)
    .filter(function (row) {
      return row.some(function (cell) {
        return cell !== '';
      });
    })
    .map(function (row) {
      const item = {};

      headers.forEach(function (header, index) {
        const value = row[index];
        item[header] = value instanceof Date
          ? value.toISOString()
          : value;
      });

      return item;
    });
}

/**
 * Menambahkan objek sebagai baris baru sesuai urutan header.
 */
function appendRow_(tableName, data) {
  const sheet = getSheet_(tableName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(function (header) {
    return data[header] === undefined ? '' : data[header];
  }));
}

/**
 * Membuat ID unik dengan awalan tertentu.
 */
function makeId_(prefix) {
  return prefix + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

/**
 * Menghasilkan waktu saat ini dalam format ISO.
 */
function currentTimestamp_() {
  return new Date().toISOString();
}

/**
 * Memastikan nilai wajib tersedia dan tidak melebihi panjang maksimal.
 */
function requiredText_(value, label, maxLength) {
  const text = String(value || '').trim();

  if (!text) {
    throw new Error(label + ' wajib diisi.');
  }

  if (text.length > (maxLength || 500)) {
    throw new Error(label + ' terlalu panjang.');
  }

  return text;
}

/**
 * Membaca JSON dengan nilai fallback bila kosong atau tidak valid.
 */
function parseJson_(value, fallback) {
  try {
    if (typeof value === 'string') {
      return JSON.parse(value || 'null');
    }

    return value == null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

/**
 * Membuat asesmen baru dan menyimpan soal-soalnya.
 */

/**
 * Bank soal: satu bundel dapat digunakan untuk membuat banyak asesmen.
 * Soal disimpan sebagai JSON agar semua tipe soal dan aset tetap terjaga.
 */
function saveQuestionBundle_(payload) {
  assertBundleVersioningReady_();
  const title = requiredText_(payload.title, 'Judul bundel', 180);
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!questions.length || questions.length > 200) throw new Error('Jumlah soal bundel harus antara 1 dan 200.');
  questions.forEach(function (q, i) {
    const type = String(q.type || 'multiple_choice'), points = Number(q.points);
    if (['multiple_choice','true_false','true_false_multi','multi_select','matching','essay'].indexOf(type) < 0) throw new Error('Tipe soal tidak valid pada soal nomor ' + (i + 1));
    if (!isFinite(points) || points < 0 || points > 1000) throw new Error('Bobot nilai tidak valid pada soal nomor ' + (i + 1));
  });
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const bundleId = String(payload.bundleId || payload.id || makeId_('BND'));
    const sheet = getSheet_('QuestionBundles'), values = sheet.getDataRange().getValues(), headers = values[0].map(String);
    const idCol = headers.indexOf('bundleId');
    let rowNumber = -1, existing = null;
    for (let i=1;i<values.length;i++) if (String(values[i][idCol])===bundleId) { rowNumber=i+1; existing=listRows_('QuestionBundles').find(function(b){return String(b.bundleId)===bundleId;}); break; }
    if (existing && String(existing.status).toLowerCase()==='archived') throw new Error('Bundel yang sudah diarsipkan tidak dapat diubah.');
    const classification=String(payload.classification || (existing && existing.classification) || 'REGULER').trim().toUpperCase();
    if (['REGULER','SOLO_TAX'].indexOf(classification)<0) throw new Error('Klasifikasi bundel harus REGULER atau SOLO_TAX.');
    if (classification === 'SOLO_TAX') throw new Error('Pembuatan Bundel SOLO Tax belum diaktifkan. Gunakan editor SOLO Tax setelah tahap pengembangan berikutnya selesai.');
    const now=currentTimestamp_();
    const snapshot={schemaVersion:1,bundleId:bundleId,classification:classification,title:title,subject:String(payload.subject||''),description:String(payload.description||''),tpCode:String(payload.tpCode||'').trim().toUpperCase(),passageText:String(payload.passageText||''),passageImageUrl:String(payload.passageImageUrl||''),passages:Array.isArray(payload.passages)?payload.passages:[],questions:questions};
    validateBundleSnapshot_(snapshot);
    const snapshotJson=JSON.stringify(snapshot);
    let latest=null;
    if(existing && existing.latestVersionId){
      const prior=listRows_('BundleVersions').find(function(v){return String(v.versionId)===String(existing.latestVersionId);});
      if(prior && String(prior.snapshotJson)===snapshotJson) latest={versionId:prior.versionId,versionNumber:Number(prior.versionNumber)};
    }
    if(!latest) latest=createBundleVersion_(bundleId,snapshot,String(payload.changeNote||(existing?'Perubahan isi bundel':'Versi awal')),String(payload.createdBy||(existing&&existing.createdBy)||''));
    const record={bundleId:bundleId,title:title,subject:snapshot.subject,description:snapshot.description,tpCode:snapshot.tpCode,passageText:snapshot.passageText,passageImageUrl:snapshot.passageImageUrl,passagesJson:JSON.stringify(snapshot.passages),questionsJson:JSON.stringify(questions),status:'ready',classification:classification,latestVersionId:String(latest.versionId),latestVersionNumber:Number(latest.versionNumber),visibility:String(payload.visibility||(existing&&existing.visibility)||'shared')==='private'?'private':'shared',createdBy:String(payload.createdBy||(existing&&existing.createdBy)||''),createdAt:existing?String(existing.createdAt||now):now,updatedAt:now,archivedAt:'',archivedBy:''};
    if(rowNumber>0) headers.forEach(function(h,col){if(Object.prototype.hasOwnProperty.call(record,h))sheet.getRange(rowNumber,col+1).setValue(record[h]);});
    else appendRow_('QuestionBundles',record);
    return {bundleId:bundleId,title:title,questionCount:questions.length,status:'ready',classification:classification,versionId:String(latest.versionId),versionNumber:Number(latest.versionNumber)};
  } finally {lock.releaseLock();}
}

function listQuestionBundles_(payload) {
  assertBundleVersioningReady_();
  const user=payload.currentUser;
  if(!user||user.role!=='teacher')throw new Error('Akun guru terverifikasi diperlukan.');
  return listRows_('QuestionBundles').filter(function(bundle){
    const owned=bundle.createdBy&&String(bundle.createdBy).trim().toLowerCase()===String(user.email).trim().toLowerCase();
    const shared=String(bundle.visibility||'shared').toLowerCase()==='shared';
    const statusMatches=payload.status?String(bundle.status)===String(payload.status):String(bundle.status).toLowerCase()!=='archived';
    return (owned||shared)&&statusMatches;
  }).map(function(bundle){
    const item=Object.assign({},bundle);
    item.questionCount=parseJson_(bundle.questionsJson,[]).length;
    item.isOwner=!!bundle.createdBy&&String(bundle.createdBy).trim().toLowerCase()===String(user.email).trim().toLowerCase();
    item.visibility=String(bundle.visibility||'shared').toLowerCase();
    item.classification=String(bundle.classification||'REGULER').toUpperCase();
    item.latestVersionNumber=Number(bundle.latestVersionNumber)||0;
    delete item.questionsJson;delete item.passagesJson;delete item.createdBy;
    return item;
  });
}
/**
 * Mengubah URL Drive menjadi ID file tanpa mengunduhnya dari browser.
 */
function assessmentImageFileId_(url) {
  const value = String(url || '');
  const match = value.match(/[?&]id=([^&]+)/) || value.match(/\/d\/([^/?]+)/);
  if (!match || !match[1]) return '';
  try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
}

/**
 * Memeriksa apakah suatu gambar benar-benar dirujuk oleh konten yang boleh
 * diakses pengguna. Siswa hanya dapat mengambil gambar dari asesmen kelasnya
 * yang sedang memiliki sesi pengerjaan aktif.
 */
function userCanReadAssessmentImage_(fileId, user) {
  if (!user || (user.role !== 'teacher' && user.role !== 'student')) return false;
  const assessments = listRows_('Assessments');
  const questions = listRows_('Questions');
  const bundles = listRows_('QuestionBundles');

  function contains(url) { return assessmentImageFileId_(url) === fileId; }
  function questionUsesImage(q) {
    if (collectQuestionImageUrls_([{
      imageUrl: q.imageUrl,
      passageImageUrl: q.passageImageUrl,
      optionImages: parseJson_(q.optionImagesJson, []),
      subquestionImages: parseJson_(q.subquestionImagesJson, []),
      pairs: parseJson_(q.pairsJson, [])
    }]).some(contains)) return true;
    return false;
  }

  if (user.role === 'teacher') {
    const ownedIds = {};
    assessments.forEach(function (a) {
      if (String(a.createdBy || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase()) {
        if (contains(a.passageImageUrl)) return;
        ownedIds[String(a.assessmentId)] = true;
      }
    });
    for (let i = 0; i < assessments.length; i++) {
      const a = assessments[i];
      if (String(a.createdBy || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase() && contains(a.passageImageUrl)) return true;
    }
    if (questions.some(function (q) { return !!ownedIds[String(q.assessmentId)] && questionUsesImage(q); })) return true;
    return bundles.some(function (b) {
      const owner = String(b.createdBy || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase();
      const shared = String(b.visibility || 'shared').toLowerCase() === 'shared';
      if (!owner && !shared) return false;
      const qs = parseJson_(b.questionsJson, []);
      const passages = parseJson_(b.passagesJson, []);
      return collectQuestionImageUrls_(qs).some(contains) ||
        contains(b.passageImageUrl) || passages.some(function (p) { return p && contains(p.imageUrl); });
    });
  }

  for (let i = 0; i < assessments.length; i++) {
    const a = assessments[i];
    if (String(a.status).toLowerCase() !== 'published' ||
        String(a.className || '').trim().toLowerCase() !== String(user.className || '').trim().toLowerCase()) continue;
    const activeAttempt = listRows_('Attempts').some(function (attempt) {
      return String(attempt.assessmentId) === String(a.assessmentId) &&
        String(attempt.studentId) === String(user.userId) &&
        String(attempt.status) === 'in_progress';
    });
    if (!activeAttempt) continue;
    if (contains(a.passageImageUrl)) return true;
    if (questions.some(function (q) { return String(q.assessmentId) === String(a.assessmentId) && questionUsesImage(q); })) return true;
  }
  return false;
}

/**
 * Mengirim gambar sebagai data URL melalui sesi Apps Script yang terautentikasi.
 * Tidak memerlukan izin Anyone with the link pada file Drive.
 */
function getAssessmentImage_(payload) {
  const user = payload.currentUser;
  const fileId = requiredText_(payload.fileId, 'ID gambar', 200);
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  let inAssessmentImageFolder = false;
  while (parents.hasNext()) {
    if (folderHasNameInsideRoot_(parents.next(), CONFIG.DRIVE_FOLDER_ID, '01 - Gambar Asesmen', 0)) {
      inAssessmentImageFolder = true;
      break;
    }
  }
  if (!inAssessmentImageFolder) throw new Error('File bukan gambar dari folder asesmen Rumble.');
  const expectedOwner = 'Rumble Assessment owner: ' + String(user && user.email || '').trim().toLowerCase();
  const isNewImageOwnedByTeacher = user && user.role === 'teacher' &&
    String(file.getDescription() || '') === expectedOwner;
  if (!userCanReadAssessmentImage_(fileId, user) && !isNewImageOwnedByTeacher) {
    throw new Error('Akses gambar ditolak atau gambar tidak terhubung dengan asesmen yang dapat diakses.');
  }
  // Jika versi sebelumnya pernah membuat tautan publik, cabut saat file pertama
  // kali disajikan melalui jalur terautentikasi ini.
  if (file.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK) {
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); }
    catch (sharingError) { throw new Error('Akses tautan lama belum dapat dicabut. Minta pemilik Drive memeriksa izin file.'); }
  }
  const blob = file.getBlob();
  const mimeType = String(blob.getContentType() || file.getMimeType() || '').toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(mimeType) < 0) {
    throw new Error('Format file bukan gambar yang didukung.');
  }
  const bytes = blob.getBytes();
  if (!bytes || bytes.length > 4 * 1024 * 1024) {
    throw new Error('Ukuran gambar melebihi batas pengiriman 4 MB.');
  }
  return {
    fileId: fileId,
    mimeType: mimeType,
    dataUrl: 'data:' + mimeType + ';base64,' + Utilities.base64Encode(bytes)
  };
}

function getQuestionBundle_(payload) {
  assertBundleVersioningReady_();
  const bundleId=requiredText_(payload.bundleId||payload.id,'ID bundel',100);
  const bundle=listRows_('QuestionBundles').find(function(item){return String(item.bundleId)===bundleId;});
  if(!bundle)throw new Error('Bundel soal tidak ditemukan.');
  const user=payload.currentUser;
  if(!user||user.role!=='teacher')throw new Error('Akun guru terverifikasi diperlukan.');
  const isOwner=!!bundle.createdBy&&String(bundle.createdBy).trim().toLowerCase()===String(user.email).trim().toLowerCase();
  const isShared=String(bundle.visibility||'shared').toLowerCase()==='shared';
  if(!isOwner&&!isShared)throw new Error('Akses ditolak. Bundel ini hanya dapat dibuka oleh pembuatnya.');
  let version=null;
  if(payload.versionId||payload.versionNumber!==undefined)version=getBundleVersion_({versionId:payload.versionId,bundleId:bundleId,versionNumber:payload.versionNumber});
  else if(bundle.latestVersionId)version=getBundleVersion_({versionId:bundle.latestVersionId});
  const snapshot=version?version.snapshot:bundleSnapshotFromRecord_(bundle,bundle.classification||'REGULER');
  return {bundle:{bundleId:bundle.bundleId,title:snapshot.title,subject:snapshot.subject,description:snapshot.description,tpCode:String(snapshot.tpCode||''),passageText:snapshot.passageText,passageImageUrl:snapshot.passageImageUrl,passages:snapshot.passages||[],status:bundle.status,visibility:String(bundle.visibility||'shared').toLowerCase(),isOwner:isOwner,classification:String(snapshot.classification||bundle.classification||'REGULER'),versionId:version?version.versionId:String(bundle.latestVersionId||''),versionNumber:version?version.versionNumber:Number(bundle.latestVersionNumber||0)},questions:snapshot.questions||[]};
}
function createAssessment_(payload) {
  const title=requiredText_(payload.title,'Judul',180);
  let questions=Array.isArray(payload.questions)?payload.questions:[];
  if(questions.length<1||questions.length>200)throw new Error('Jumlah soal harus antara 1 dan 200.');
  const sourceBundleId=String(payload.sourceBundleId||payload.bundleId||'').trim();
  let sourceVersion=null;
  if(sourceBundleId){
    assertBundleVersioningReady_();
    const bundle=listRows_('QuestionBundles').find(function(b){return String(b.bundleId)===sourceBundleId;});
    if(!bundle||String(bundle.status).toLowerCase()==='archived')throw new Error('Bundel sumber tidak tersedia.');
    const user=payload.currentUser,owner=bundle.createdBy&&String(bundle.createdBy).trim().toLowerCase()===String(user&&user.email||'').trim().toLowerCase(),shared=String(bundle.visibility||'shared').toLowerCase()==='shared';
    if(!owner&&!shared)throw new Error('Akses ke Bundel Soal sumber ditolak.');
    if(!bundle.latestVersionId)throw new Error('Bundel sumber belum memiliki versi. Jalankan migrasi versioning terlebih dahulu.');
    sourceVersion=getBundleVersion_({versionId:bundle.latestVersionId});
    questions=sourceVersion.snapshot.questions;
  }
  if(!questions.length||questions.length>200)throw new Error('Versi Bundel Soal harus memiliki 1 sampai 200 soal.');
  questions.forEach(function(question,index){
    const type=String(question.type||'multiple_choice'),points=Number(question.points);
    if(['multiple_choice','true_false','true_false_multi','multi_select','matching','essay'].indexOf(type)<0)throw new Error('Tipe soal tidak valid pada soal nomor '+(index+1));
    if(!isFinite(points)||points<0||points>1000)throw new Error('Bobot soal tidak valid pada soal nomor '+(index+1));
  });
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    if(sourceBundleId){
      const current=listRows_('QuestionBundles').find(function(b){return String(b.bundleId)===sourceBundleId;});
      if(!current||String(current.latestVersionId)!==String(sourceVersion.versionId))throw new Error('Versi Bundel Soal berubah saat Asesmen dibuat. Silakan ulangi proses.');
    }
    const assessmentId=makeId_('ASM'),timestamp=currentTimestamp_(),classification=sourceVersion?String(sourceVersion.snapshot.classification||'REGULER'):'REGULER';
    appendRow_('Assessments',{assessmentId:assessmentId,title:title,subject:String(sourceVersion?sourceVersion.snapshot.subject:(payload.subject||'')),className:String(payload.className||''),duration:Math.max(1,Math.min(300,Number(payload.duration)||60)),startAt:String(payload.startAt||''),endAt:String(payload.endAt||''),passageText:String(sourceVersion?sourceVersion.snapshot.passageText:(payload.passageText||'')),passageImageUrl:String(sourceVersion?sourceVersion.snapshot.passageImageUrl:(payload.passageImageUrl||'')),status:'draft',createdBy:String(payload.createdBy||''),createdAt:timestamp,updatedAt:timestamp,bundleId:sourceBundleId,bundleVersionId:sourceVersion?sourceVersion.versionId:'',bundleVersionNumber:sourceVersion?sourceVersion.versionNumber:'',classification:classification,archivedAt:'',archivedBy:''});
    questions.forEach(function(question,index){
      const type=String(question.type||'multiple_choice'),points=Number(question.points);
      appendRow_('Questions',{questionId:makeId_('Q'),assessmentId:assessmentId,order:index+1,type:type,text:String(question.text||''),points:points,optionsJson:JSON.stringify(question.options||[]),answerJson:JSON.stringify(question.answer===undefined?null:question.answer),rubric:String(question.rubric||''),pairsJson:JSON.stringify(question.pairs||''),imageUrl:String(question.imageUrl||''),optionImagesJson:JSON.stringify(question.optionImages||[]),subquestionsJson:JSON.stringify(question.subquestions||[]),subquestionImagesJson:JSON.stringify(question.subquestionImages||[]),rubricLevelsJson:JSON.stringify(question.rubricLevels||[]),passageText:String(question.passageText||''),passageImageUrl:String(question.passageImageUrl||''),sourceBundleVersionId:sourceVersion?sourceVersion.versionId:'',sourceQuestionKey:sourceVersion?String(question.questionId||question.id||('Q-'+(index+1))):''});
    });
    return {id:assessmentId,title:title,status:'draft',questionCount:questions.length,bundleId:sourceBundleId,bundleVersionId:sourceVersion?sourceVersion.versionId:'',bundleVersionNumber:sourceVersion?sourceVersion.versionNumber:'',classification:classification};
  }finally{lock.releaseLock();}
}

/**
 * Mengambil daftar asesmen, dengan filter opsional.
 */
function getOrCreateChildFolder_(parentFolder, folderName) {
  const matches = parentFolder.getFoldersByName(folderName);
  return matches.hasNext() ? matches.next() : parentFolder.createFolder(folderName);
}

/**
 * Mengambil URL gambar yang tersimpan pada struktur soal/bacaan.
 */
function collectQuestionImageUrls_(questions) {
  const urls = [];
  (questions || []).forEach(function (q) {
    if (!q) return;
    urls.push(q.imageUrl, q.passageImageUrl);
    (Array.isArray(q.optionImages) ? q.optionImages : []).forEach(function (url) { urls.push(url); });
    (Array.isArray(q.subquestionImages) ? q.subquestionImages : []).forEach(function (url) { urls.push(url); });
    (Array.isArray(q.pairs) ? q.pairs : []).forEach(function (pair) {
      if (pair) urls.push(pair.leftImageUrl, pair.rightImageUrl);
    });
  });
  return urls.filter(function (url) { return !!String(url || '').trim(); });
}

/**
 * Mengunggah gambar asesmen ke subfolder berdasarkan jenis gambar.
 * Siswa memakai login internal tanpa akun Google, sehingga gambar harus
 * dapat dibaca melalui tautan Drive oleh pemegang URL.
 */
function uploadAssessmentImage_(payload) {
  if (!CONFIG.DRIVE_FOLDER_ID) throw new Error('Folder Drive belum dikonfigurasi.');
  const mimeType = String(payload.mimeType || 'image/jpeg');
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(mimeType) === -1) {
    throw new Error('Format gambar harus JPG, PNG, WebP, atau GIF.');
  }
  const base64 = String(payload.base64 || '');
  if (!base64 || base64.length > 6 * 1024 * 1024) {
    throw new Error('Gambar kosong atau terlalu besar (maksimal sekitar 4 MB).');
  }

  const rawKind = String(payload.kind || 'question').toLowerCase();
  // Alias dari editor bundel dan tipe soal agar seluruh gambar masuk ke folder yang sesuai.
  const kindAliases = {
    librarypassage: 'passage', questionpassage: 'passage',
    matchingleft: 'matchingleft', matchingright: 'matchingright', statement: 'statement'
  };
  const kind = kindAliases[rawKind] || rawKind;
  const subfolderNames = {
    passage: 'Bacaan', question: 'Soal', option: 'Opsi Jawaban',
    statement: 'Pernyataan Benar Salah', matchingleft: 'Menjodohkan - Kolom Kiri',
    matchingright: 'Menjodohkan - Kolom Kanan'
  };
  if (!subfolderNames[kind]) throw new Error('Jenis gambar tidak valid: ' + rawKind);

  const safeName = String(payload.fileName || 'gambar-soal.jpg')
    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
  const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const assessmentImages = getOrCreateChildFolder_(root, '01 - Gambar Asesmen');
  const kindFolder = getOrCreateChildFolder_(assessmentImages, subfolderNames[kind]);
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, safeName);
  const file = kindFolder.createFile(blob);
  const currentUser = payload.currentUser;
  if (currentUser && currentUser.email) {
    file.setDescription('Rumble Assessment owner: ' + String(currentUser.email).trim().toLowerCase());
  }

  // File tetap privat di Drive. Frontend memuatnya melalui endpoint gambar
  // terautentikasi sehingga tidak perlu akses Anyone with the link.
  return {
    url: file.getUrl(),
    imageUrl: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600',
    fileId: file.getId(),
    name: file.getName(),
    folder: '01 - Gambar Asesmen/' + subfolderNames[kind],
    linkSharingEnabled: false,
    warning: ''
  };
}


/**
 * Memindahkan file gambar asesmen ke sampah Drive.
 * Hanya file di dalam folder aplikasi yang boleh dihapus melalui endpoint ini.
 */
function folderIsInsideRoot_(folder, rootId, depth) {
  if (folder.getId() === rootId) return true;
  if ((depth || 0) >= 20) return false;
  const parents = folder.getParents();
  while (parents.hasNext()) {
    if (folderIsInsideRoot_(parents.next(), rootId, (depth || 0) + 1)) return true;
  }
  return false;
}

function folderHasNameInsideRoot_(folder, rootId, targetName, depth) {
  if ((depth || 0) >= 20 || folder.getId() === rootId) return false;
  if (folder.getName() === targetName && folderIsInsideRoot_(folder, rootId, 0)) return true;
  const parents = folder.getParents();
  while (parents.hasNext()) {
    if (folderHasNameInsideRoot_(parents.next(), rootId, targetName, (depth || 0) + 1)) return true;
  }
  return false;
}

function objectReferencesAssessmentImage_(value, fileId, depth) {
  if ((depth || 0) > 20 || value === null || value === undefined) return false;
  if (typeof value === 'string') return assessmentImageFileId_(value) === String(fileId);
  if (Array.isArray(value)) return value.some(function (item) { return objectReferencesAssessmentImage_(item, fileId, (depth || 0) + 1); });
  if (typeof value === 'object') return Object.keys(value).some(function (key) { return objectReferencesAssessmentImage_(value[key], fileId, (depth || 0) + 1); });
  return false;
}

/** Cegah penghapusan file yang masih dirujuk versi bundel atau Asesmen historis. */
function isAssessmentImageReferenced_(fileId) {
  const id = String(fileId);
  if (listRows_('QuestionBundles').some(function (bundle) {
    return assessmentImageFileId_(bundle.passageImageUrl) === id ||
      objectReferencesAssessmentImage_(parseJson_(bundle.passagesJson, []), id, 0) ||
      objectReferencesAssessmentImage_(parseJson_(bundle.questionsJson, []), id, 0);
  })) return true;
  if (listRows_('BundleVersions').some(function (version) {
    return objectReferencesAssessmentImage_(parseJson_(version.snapshotJson, null), id, 0);
  })) return true;
  if (listRows_('Assessments').some(function (assessment) {
    return assessmentImageFileId_(assessment.passageImageUrl) === id;
  })) return true;
  if (listRows_('Questions').some(function (question) {
    return [question.imageUrl, question.passageImageUrl].some(function (url) { return assessmentImageFileId_(url) === id; }) ||
      objectReferencesAssessmentImage_(parseJson_(question.optionImagesJson, []), id, 0) ||
      objectReferencesAssessmentImage_(parseJson_(question.subquestionImagesJson, []), id, 0) ||
      objectReferencesAssessmentImage_(parseJson_(question.pairsJson, []), id, 0);
  })) return true;
  return false;
}

function deleteAssessmentImage_(payload) {
  const fileId = requiredText_(payload.fileId, 'ID gambar', 200);
  const rootId = CONFIG.DRIVE_FOLDER_ID;
  if (!rootId) throw new Error('Folder Drive belum dikonfigurasi.');
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  let found = false;
  let inAssessmentImageFolder = false;
  while (parents.hasNext()) {
    const parent = parents.next();
    if (folderIsInsideRoot_(parent, rootId, 0)) found = true;
    if (folderHasNameInsideRoot_(parent, rootId, '01 - Gambar Asesmen', 0)) inAssessmentImageFolder = true;
  }
  if (!found || !inAssessmentImageFolder) {
    throw new Error('Hanya gambar asesmen di folder gambar aplikasi yang dapat dihapus.');
  }
  if (isAssessmentImageReferenced_(fileId)) {
    throw new Error('Gambar masih digunakan oleh Bundel Soal, versi historis, atau Asesmen. Gambar tidak dihapus.');
  }
  const user = payload.currentUser;
  const expectedDescription = 'Rumble Assessment owner: ' + String(user && user.email || '').trim().toLowerCase();
  if (!user || user.role !== 'teacher' || String(file.getDescription() || '') !== expectedDescription) {
    throw new Error('Gambar tidak memiliki pemilik terverifikasi untuk akun guru ini. Minta administrator memigrasikan atau unggah ulang gambar lama.');
  }
  file.setTrashed(true);
  return { fileId: fileId, deleted: true };
}

function updateAssessment_(payload) {
  const assessmentId = requiredText_(payload.id || payload.assessmentId, 'ID asesmen', 100);
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!questions.length || questions.length > 200) throw new Error('Jumlah soal harus antara 1 dan 200.');
  const assessmentSheet = getSheet_('Assessments');
  const aValues = assessmentSheet.getDataRange().getValues();
  const aHeaders = aValues[0].map(String);
  const idCol = aHeaders.indexOf('assessmentId');
  let rowNumber = -1;
  for (let i = 1; i < aValues.length; i++) if (String(aValues[i][idCol]) === assessmentId) { rowNumber = i + 1; break; }
  if (rowNumber < 0) throw new Error('Asesmen tidak ditemukan.');
  const currentAssessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
  if (currentAssessment && String(currentAssessment.status).toLowerCase() === 'archived') throw new Error('Asesmen yang diarsipkan tidak dapat diedit.');
  const statusCol = aHeaders.indexOf('status');
  if (statusCol >= 0 && String(aValues[rowNumber - 1][statusCol]) === 'published') {
    throw new Error('Asesmen yang sudah dipublikasikan tidak dapat diedit. Buat salinan/draft baru agar hasil siswa sebelumnya tetap aman.');
  }
  const updates = {
    title: requiredText_(payload.title, 'Judul', 180),
    subject: String(payload.subject || ''),
    className: String(payload.className || ''),
    duration: Math.max(1, Math.min(300, Number(payload.duration) || 60)),
    startAt: String(payload.startAt || ''),
    endAt: String(payload.endAt || ''),
    passageText: String(payload.passageText || ''),
    passageImageUrl: String(payload.passageImageUrl || ''),
    updatedAt: currentTimestamp_()
  };
  Object.keys(updates).forEach(function (key) {
    const col = aHeaders.indexOf(key);
    if (col >= 0) assessmentSheet.getRange(rowNumber, col + 1).setValue(updates[key]);
  });
  if (!currentAssessment || !currentAssessment.bundleVersionId) {
    const qSheet = getSheet_('Questions');
    const qValues = qSheet.getDataRange().getValues();
    const qHeaders = qValues[0].map(String);
    const qAssessmentCol = qHeaders.indexOf('assessmentId');
    for (let i = qValues.length - 1; i >= 1; i--) {
      if (String(qValues[i][qAssessmentCol]) === assessmentId) qSheet.deleteRow(i + 1);
    }
    questions.forEach(function (question, index) {
      const type = String(question.type || 'multiple_choice');
      const points = Number(question.points);
      const allowedTypes = ['multiple_choice','true_false','true_false_multi','multi_select','matching','essay'];
      if (allowedTypes.indexOf(type) === -1) throw new Error('Tipe soal tidak valid pada soal nomor ' + (index + 1));
      if (!isFinite(points) || points < 0 || points > 1000) throw new Error('Bobot soal tidak valid pada soal nomor ' + (index + 1));
      appendRow_('Questions', {
        questionId: makeId_('Q'), assessmentId: assessmentId, order: index + 1, type: type,
        text: String(question.text || ''), points: points,
        optionsJson: JSON.stringify(question.options || []),
        answerJson: JSON.stringify(question.answer === undefined ? null : question.answer),
        rubric: String(question.rubric || ''), pairsJson: JSON.stringify(question.pairs || ''),
        imageUrl: String(question.imageUrl || ''),
        optionImagesJson: JSON.stringify(question.optionImages || []),
        subquestionsJson: JSON.stringify(question.subquestions || []),
        subquestionImagesJson: JSON.stringify(question.subquestionImages || []),
        rubricLevelsJson: JSON.stringify(question.rubricLevels || []),
        passageText: String(question.passageText || ''),
        passageImageUrl: String(question.passageImageUrl || '')
      });
    });
  
  }
  return { id: assessmentId, title: updates.title, status: 'draft', questionCount: questions.length };
}

/**
 * Menghapus asesmen draft dan soal-soalnya. Asesmen terpublikasi dilindungi.
 */
function deleteAssessment_(payload) {
  const id=requiredText_(payload.id||payload.assessmentId,'ID asesmen',100);
  const assessment=listRows_('Assessments').find(function(a){return String(a.assessmentId)===id;});
  if(!assessment)throw new Error('Asesmen tidak ditemukan.');
  if(String(assessment.status).toLowerCase()==='archived')return {assessmentId:id,archived:true,alreadyArchived:true};
  const now=currentTimestamp_();
  updateRowByKey_('Assessments','assessmentId',id,{status:'archived',archivedAt:now,archivedBy:String(payload.currentUser&&payload.currentUser.email||''),updatedAt:now});
  return {assessmentId:id,archived:true,deleted:false};
}

function deleteQuestionBundle_(payload) {
  const id=requiredText_(payload.id||payload.bundleId,'ID bundel',100);
  const bundle=listRows_('QuestionBundles').find(function(b){return String(b.bundleId)===id;});
  if(!bundle)throw new Error('Bundel soal tidak ditemukan.');
  if(String(bundle.status).toLowerCase()==='archived')return {bundleId:id,archived:true,alreadyArchived:true};
  const now=currentTimestamp_();
  updateRowByKey_('QuestionBundles','bundleId',id,{status:'archived',archivedAt:now,archivedBy:String(payload.currentUser&&payload.currentUser.email||''),updatedAt:now});
  return {bundleId:id,archived:true,deleted:false};
}

function listAssessments_(payload) {
  const questions = listRows_('Questions');
  const user = payload.currentUser;
  return listRows_('Assessments')
    .filter(function (assessment) {
      if (!user) return false;
      if (user.role === 'student') {
        const studentAttempt = listRows_('Attempts').find(function (attempt) {
          return String(attempt.assessmentId) === String(assessment.assessmentId) && String(attempt.studentId) === String(user.userId);
        });
        if (studentAttempt && String(studentAttempt.status) !== 'in_progress') {
          try { assertStudentAssessmentIdentity_(assessment, user); } catch (error) { return false; }
        } else {
          try { if (studentAttempt && String(studentAttempt.status) === 'in_progress') assertStudentAssessmentIdentity_(assessment, user); else assertStudentAssessmentAccess_(assessment, user); } catch (error) { return false; }
        }
      } else if (user.role === 'teacher' &&
          (!assessment.createdBy || String(assessment.createdBy).trim().toLowerCase() !== String(user.email).trim().toLowerCase())) {
        return false;
      }
      const matchesStatus = payload.status ? String(assessment.status) === String(payload.status) : String(assessment.status).toLowerCase() !== 'archived';
      const matchesClass = user.role === 'student' ||
        (!payload.className || String(assessment.className) === String(payload.className));
      return matchesStatus && matchesClass;
    })
    .map(function (assessment) {
      const item = Object.assign({}, assessment);
      item.questionCount = questions.filter(function (question) { return question.assessmentId === assessment.assessmentId; }).length;
      item.classification = String(assessment.classification || 'REGULER').toUpperCase();
      item.bundleVersionNumber = Number(assessment.bundleVersionNumber) || 0;
      if (user.role === 'student') {
        const studentAttempt = listRows_('Attempts').find(function (attempt) {
          return String(attempt.assessmentId) === String(assessment.assessmentId) && String(attempt.studentId) === String(user.userId);
        });
        item.attemptStatus = studentAttempt ? String(studentAttempt.status) : '';
      }
      delete item.createdBy;
      return item;
    });
}

/**
 * Mengambil detail asesmen beserta soal tanpa mengirim kunci jawaban.
 * Kunci jawaban hanya digunakan di sisi server saat penilaian.
 */
function getAssessment_(payload) {
  const assessmentId = requiredText_(
    payload.id || payload.assessmentId,
    'ID asesmen',
    100
  );

  const assessment = listRows_('Assessments').find(function (item) {
    return item.assessmentId === assessmentId;
  });

  if (!assessment) {
    throw new Error('Asesmen tidak ditemukan.');
  }
  const user = payload.currentUser;
  if (!user) throw new Error('Identitas akun tidak tersedia.');
  if (user.role === 'student') {
    const studentAttempt = listRows_('Attempts').find(function (attempt) {
      return String(attempt.assessmentId) === assessmentId && String(attempt.studentId) === String(user.userId);
    });
    if (studentAttempt && String(studentAttempt.status) !== 'in_progress') throw new Error('Asesmen ini sudah pernah dikerjakan.');
    if (studentAttempt && String(studentAttempt.status) === 'in_progress') assertStudentAssessmentIdentity_(assessment, user);
    else assertStudentAssessmentAccess_(assessment, user);
  }
  else if (user.role === 'teacher' &&
      (!assessment.createdBy || String(assessment.createdBy).trim().toLowerCase() !== String(user.email).trim().toLowerCase())) {
    throw new Error('Akses ditolak. Asesmen lama tanpa pemilik terverifikasi perlu dimigrasikan oleh administrator.');
  }

  const questions = listRows_('Questions')
    .filter(function (question) {
      return question.assessmentId === assessmentId;
    })
    .sort(function (a, b) {
      return Number(a.order) - Number(b.order);
    })
    .map(function (question) {
      return {
        id: question.questionId,
        answer: payload.includeAnswers ? parseJson_(question.answerJson, null) : undefined,
        order: Number(question.order),
        type: question.type,
        text: question.text,
        points: Number(question.points),
        options: parseJson_(question.optionsJson, []),
        rubric: question.rubric,
        pairs: parseJson_(question.pairsJson, ''),
        imageUrl: question.imageUrl,
        optionImages: parseJson_(question.optionImagesJson, []),
        subquestions: parseJson_(question.subquestionsJson, []),
        subquestionImages: parseJson_(question.subquestionImagesJson, []),
        rubricLevels: parseJson_(question.rubricLevelsJson, []),
        passageText: String(question.passageText || ''),
        passageImageUrl: String(question.passageImageUrl || '')
      };
    });

  const safeAssessment = Object.assign({}, assessment);
  delete safeAssessment.createdBy;
  return {
    assessment: safeAssessment,
    questions: questions
  };
}

/**
 * Mengubah status asesmen menjadi published agar tersedia untuk mode siswa.
 * Tambahkan otorisasi berbasis identitas guru sebelum penggunaan produksi.
 */
function publishAssessment_(payload) {
  const assessmentId = requiredText_(
    payload.id || payload.assessmentId,
    'ID asesmen',
    100
  );
  const sheet = getSheet_('Assessments');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Asesmen tidak ditemukan.');
  const headers = values[0].map(String);
  const idCol = headers.indexOf('assessmentId');
  const statusCol = headers.indexOf('status');
  const updatedCol = headers.indexOf('updatedAt');
  if (idCol < 0 || statusCol < 0) throw new Error('Kolom database asesmen tidak lengkap.');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === assessmentId) {
      const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
      if (assessment && (!assessment.title || !assessment.className || !assessment.duration)) {
        throw new Error('Judul, kelas, dan durasi wajib diisi sebelum dipublikasikan.');
      }
      if (assessment && assessment.startAt && !isFinite(new Date(assessment.startAt).getTime())) throw new Error('Waktu mulai asesmen tidak valid.');
      if (assessment && assessment.endAt && !isFinite(new Date(assessment.endAt).getTime())) throw new Error('Waktu selesai asesmen tidak valid.');
      if (assessment && assessment.startAt && assessment.endAt && new Date(assessment.endAt).getTime() <= new Date(assessment.startAt).getTime()) throw new Error('Waktu selesai harus setelah waktu mulai.');
      sheet.getRange(i + 1, statusCol + 1).setValue('published');
      if (updatedCol >= 0) sheet.getRange(i + 1, updatedCol + 1).setValue(currentTimestamp_());
      return { id: assessmentId, status: 'published' };
    }
  }
  throw new Error('Asesmen tidak ditemukan.');
}

/**
 * Menerima jawaban dan menghitung nilai otomatis untuk tipe objektif.
 * Esai dan menjodohkan diberi status needs_review untuk pemeriksaan guru.
 */
/**
 * Membuat atau melanjutkan sesi pengerjaan siswa yang tervalidasi.
 */
function startAttempt_(payload) {
  const assessmentId = requiredText_(payload.assessmentId, 'ID asesmen', 100);
  const user = payload.currentUser;
  if (!user || user.role !== 'student' || !user.userId) throw new Error('Akun siswa terverifikasi diperlukan.');
  const studentId = String(user.userId);
  const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
  const previousAttempt = listRows_('Attempts').find(function (attempt) {
    return String(attempt.assessmentId) === assessmentId && String(attempt.studentId) === studentId;
  });
  if (previousAttempt && String(previousAttempt.status) === 'in_progress') assertStudentAssessmentIdentity_(assessment, user);
  else assertStudentAssessmentAccess_(assessment, user);
  const duration = Number(assessment.duration);
  if (!isFinite(duration) || duration < 1) throw new Error('Durasi asesmen tidak valid.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const previous = listRows_('Attempts').find(function (attempt) {
      return String(attempt.assessmentId) === assessmentId && String(attempt.studentId) === studentId;
    });
    if (previous) {
      if (String(previous.status) !== 'in_progress') throw new Error('Jawaban untuk asesmen ini sudah pernah dikirim.');
      const started = new Date(previous.startedAt).getTime();
      if (!isFinite(started)) throw new Error('Waktu mulai sesi tidak valid. Hubungi guru.');
      const expired = Date.now() > started + duration * 60000 + 30000;
      return { attemptId: String(previous.attemptId), startedAt: previous.startedAt, status: 'in_progress', duration: duration, resumed: true, expired: expired, answers: parseJson_(previous.answersJson, {}) };
    }
    const attemptId = makeId_('ATT'), startedAt = currentTimestamp_();
    const questions = listRows_('Questions').filter(function (question) { return String(question.assessmentId) === assessmentId; });
    const maxScore = questions.reduce(function (sum, question) { return sum + (Number(question.points) || 0); }, 0);
    appendRow_('Attempts', {
      attemptId: attemptId, assessmentId: assessmentId, studentId: studentId,
      startedAt: startedAt, submittedAt: '', status: 'in_progress', score: 0,
      maxScore: maxScore, focusLossCount: 0, answersJson: '{}', teacherFeedback: ''
    });
    return { attemptId: attemptId, startedAt: startedAt, status: 'in_progress', duration: duration, resumed: false, answers: {} };
  } finally { lock.releaseLock(); }
}

function mergeUploadedAnswerPhotos_(attemptId, answers, existingAnswers) {
  const next = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const previous = existingAnswers && typeof existingAnswers === 'object' && !Array.isArray(existingAnswers) ? existingAnswers : {};
  Object.keys(previous).forEach(function (questionId) {
    const oldAnswer = previous[questionId];
    if (!oldAnswer || typeof oldAnswer !== 'object' || !Array.isArray(oldAnswer.photos)) return;
    const current = next[questionId] && typeof next[questionId] === 'object' ? next[questionId] : {};
    current.photos = Array.isArray(current.photos) ? current.photos : [];
    oldAnswer.photos.forEach(function (photo) {
      if (photo && photo.fileId && !current.photos.some(function (item) { return String(item.fileId) === String(photo.fileId); })) current.photos.push(photo);
    });
    next[questionId] = current;
  });
  listRows_('Files').filter(function (file) { return String(file.attemptId) === String(attemptId) && file.questionId; }).forEach(function (file) {
    const current = next[file.questionId] && typeof next[file.questionId] === 'object' ? next[file.questionId] : {};
    current.photos = Array.isArray(current.photos) ? current.photos : [];
    if (!current.photos.some(function (photo) { return String(photo.fileId) === String(file.fileId); })) {
      current.photos.push({
        fileId: file.fileId, url: file.fileUrl,
        imageUrl: file.driveFileId ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.driveFileId) + '&sz=w1200' : file.fileUrl,
        name: 'Foto jawaban'
      });
    }
    next[file.questionId] = current;
  });
  return next;
}

function saveAttempt_(payload) {
  const assessmentId = requiredText_(payload.assessmentId, 'ID asesmen', 100);
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const user = payload.currentUser;
  if (!user || user.role !== 'student' || !user.userId) throw new Error('Akun siswa terverifikasi diperlukan.');
  const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
  assertStudentAssessmentIdentity_(assessment, user);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const attemptsSheet = getSheet_('Attempts'), values = attemptsSheet.getDataRange().getValues();
    if (values.length < 2) throw new Error('Sesi pengerjaan tidak ditemukan.');
    const headers = values[0].map(String), idCol = headers.indexOf('attemptId'), assessmentCol = headers.indexOf('assessmentId'), studentCol = headers.indexOf('studentId');
    let rowNumber = -1, row = null;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === attemptId && String(values[i][assessmentCol]) === assessmentId && String(values[i][studentCol]) === String(user.userId)) { rowNumber = i + 1; row = values[i]; break; }
    }
    if (rowNumber < 0) throw new Error('Sesi pengerjaan tidak ditemukan atau bukan milik akun ini.');
    const col = function (name) { const index = headers.indexOf(name); if (index < 0) throw new Error('Kolom '+name+' tidak ditemukan.'); return index; };
    if (String(row[col('status')]) !== 'in_progress') throw new Error('Sesi ini sudah dikirim dan tidak dapat diubah.');
    const started = new Date(row[col('startedAt')]).getTime(), durationMs = Number(assessment.duration) * 60000;
    if (!isFinite(started) || !isFinite(durationMs) || durationMs <= 0 || Date.now() > started + durationMs + 30000) throw new Error('Waktu pengerjaan sudah habis.');
    const incomingAnswers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers) ? payload.answers : {};
    const answers = mergeUploadedAnswerPhotos_(attemptId, incomingAnswers, parseJson_(row[col('answersJson')], {}));
    attemptsSheet.getRange(rowNumber, col('answersJson') + 1).setValue(JSON.stringify(answers));
    return { saved: true, savedAt: currentTimestamp_() };
  } finally { lock.releaseLock(); }
}

function submitAttempt_(payload) {
  const assessmentId = requiredText_(payload.assessmentId, 'ID asesmen', 100);
  const user = payload.currentUser;
  if (!user || user.role !== 'student' || !user.userId) throw new Error('Akun siswa terverifikasi diperlukan.');
  const studentId = String(user.userId);

  const assessment = listRows_('Assessments').find(function (item) {
    return item.assessmentId === assessmentId;
  });
  const existingAttempt = listRows_('Attempts').find(function (attempt) {
    return String(attempt.assessmentId) === assessmentId && String(attempt.studentId) === studentId;
  });
  if (existingAttempt && String(existingAttempt.status) === 'in_progress') {
    assertStudentAssessmentIdentity_(assessment, user);
  } else {
    assertStudentAssessmentAccess_(assessment, user);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const previous = listRows_('Attempts').find(function (attempt) {
      return String(attempt.assessmentId) === assessmentId && String(attempt.studentId) === studentId;
    });
    if (previous && String(previous.status) !== 'in_progress') throw new Error('Jawaban untuk asesmen ini sudah pernah dikirim.');
    if (previous && previous.startedAt) {
      const started = new Date(previous.startedAt).getTime();
      const durationMs = Number(assessment.duration) * 60000;
      if (!isFinite(started) || !isFinite(durationMs) || durationMs <= 0) throw new Error('Waktu sesi pengerjaan tidak valid.');
      const remainingMs = started + durationMs - Date.now();
      if (remainingMs > 8 * 60000) throw new Error('Pengumpulan jawaban hanya dapat dilakukan pada 8 menit terakhir. Silakan periksa jawaban kembali.');
      if (remainingMs < -30000 && payload.autoSubmitOnExpiry !== true) throw new Error('Waktu pengerjaan sudah habis. Jawaban tidak dapat dikirim terlambat.');
    }
  const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
  const questions = listRows_('Questions').filter(function (question) {
    return question.assessmentId === assessmentId;
  });

  let score = 0;
  let maxScore = 0;
  let needsReview = false;

  questions.forEach(function (question) {
    const points = Number(question.points) || 0;
    const correctAnswer = parseJson_(question.answerJson, null);
    const studentAnswer = answers[question.questionId];

    maxScore += points;

    if (question.type === 'essay') {
      needsReview = true;
      return;
    }

    if (question.type === 'matching') {
      const pairs = parseJson_(question.pairsJson, []);
      const submitted = studentAnswer && typeof studentAnswer === 'object' ? studentAnswer : {};
      if (pairs.length > 0) {
        const perPair = points / pairs.length;
        pairs.forEach(function (pair, index) {
          if (submitted[String(index)] !== undefined && String(submitted[String(index)]) === String(index)) score += perPair;
        });
      }
      return;
    }

    if (question.type === 'true_false_multi') {
      const expected = Array.isArray(correctAnswer) ? correctAnswer : [];
      const submitted = studentAnswer && typeof studentAnswer === 'object' ? studentAnswer : {};
      const count = expected.length;
      if (count > 0) {
        const perStatement = points / count;
        expected.forEach(function (key, index) {
          if (submitted[String(index)] !== undefined && String(submitted[String(index)]) === String(key)) score += perStatement;
        });
      }
      return;
    }

    if (question.type === 'multi_select') {
      const expected = (Array.isArray(correctAnswer) ? correctAnswer : [])
        .map(String)
        .sort()
        .join(',');

      const submitted = (Array.isArray(studentAnswer) ? studentAnswer : [])
        .map(String)
        .sort()
        .join(',');

      if (expected && expected === submitted) {
        score += points;
      }

      return;
    }

    if (String(correctAnswer) === String(studentAnswer)) {
      score += points;
    }
  });

  // Sesi aktif boleh dikirim setelah jam jadwal berakhir selama durasi pengerjaan belum habis.
  // Identitas, kelas, status asesmen, dan batas durasi tetap divalidasi di sisi server.
  if (previous && String(previous.status) === 'in_progress') {
    assertStudentAssessmentIdentity_(assessment, user);
  } else {
    assertStudentAssessmentAccess_(assessment, user);
  }
  const attemptId = previous ? String(previous.attemptId) : makeId_('ATT');
  const existingAnswers = previous ? parseJson_(previous.answersJson, {}) : {};
  // mergeUploadedAnswerPhotos_ mengembalikan objek jawaban yang sama (mutasi in-place).
  // Jangan mengosongkan objek answers sebelum disimpan karena itu menghapus seluruh jawaban siswa.
  const finalAnswers = mergeUploadedAnswerPhotos_(attemptId, answers, existingAnswers);
  const attemptsSheet = getSheet_('Attempts');
  const attemptValues = attemptsSheet.getDataRange().getValues();
  const attemptHeaders = attemptValues[0].map(String);
  const col = function (name) { return attemptHeaders.indexOf(name); };
  const existingIndex = previous ? attemptValues.findIndex(function (row, index) {
    return index > 0 && String(row[col('attemptId')]) === attemptId;
  }) : -1;
  const submittedAt = currentTimestamp_(), finalStatus = needsReview ? 'needs_review' : 'graded';
  if (existingIndex > 0) {
    const rowNumber = existingIndex + 1;
    attemptsSheet.getRange(rowNumber, col('submittedAt') + 1).setValue(submittedAt);
    attemptsSheet.getRange(rowNumber, col('status') + 1).setValue(finalStatus);
    attemptsSheet.getRange(rowNumber, col('score') + 1).setValue(score);
    attemptsSheet.getRange(rowNumber, col('maxScore') + 1).setValue(maxScore);
    attemptsSheet.getRange(rowNumber, col('focusLossCount') + 1).setValue(Math.max(0, Number(payload.focusLossCount) || 0));
    attemptsSheet.getRange(rowNumber, col('answersJson') + 1).setValue(JSON.stringify(finalAnswers));
  } else {
    appendRow_('Attempts', {
      attemptId: attemptId, assessmentId: assessmentId, studentId: studentId,
      startedAt: currentTimestamp_(), submittedAt: submittedAt, status: finalStatus,
      score: score, maxScore: maxScore,
      focusLossCount: Math.max(0, Number(payload.focusLossCount) || 0),
      answersJson: JSON.stringify(finalAnswers), teacherFeedback: ''
    });
  }

  return {
    attemptId: attemptId,
    status: finalStatus,
    score: score,
    maxScore: maxScore
  };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Mengambil hasil pengerjaan dengan filter opsional.
 */
function listAttempts_(payload) {
  const allQuestions = listRows_('Questions');
  const assessments = listRows_('Assessments');
  const uploadedFiles = listRows_('Files');
  return listRows_('Attempts')
    .filter(function (attempt) {
      const matchesAssessment = !payload.assessmentId || attempt.assessmentId === payload.assessmentId;
      const matchesStudent = !payload.studentId || attempt.studentId === payload.studentId;
      return matchesAssessment && matchesStudent && String(attempt.status) !== 'in_progress';
    })
    .map(function (attempt) {
      const details = allQuestions
        .filter(function (question) { return question.assessmentId === attempt.assessmentId; })
        .sort(function (a, b) { return Number(a.order) - Number(b.order); })
        .map(function (question) {
          return {
            id: question.questionId,
            order: Number(question.order),
            type: question.type,
            text: question.text,
            points: Number(question.points) || 0,
            rubric: question.rubric,
            rubricLevels: parseJson_(question.rubricLevelsJson, []),
            subquestions: parseJson_(question.subquestionsJson, []),
            options: parseJson_(question.optionsJson, []),
            pairs: parseJson_(question.pairsJson, []),
            answer: payload.currentUser && payload.currentUser.role === 'teacher' ? parseJson_(question.answerJson, null) : undefined,
            imageUrl: question.imageUrl,
            optionImages: parseJson_(question.optionImagesJson, [])
          };
        });
      const assessment = assessments.find(function (item) { return item.assessmentId === attempt.assessmentId; });
      const viewer = payload.currentUser;
      if (viewer && viewer.role === 'teacher' && assessment && String(assessment.createdBy || '').trim().toLowerCase() === String(viewer.email || '').trim().toLowerCase()) {
        uploadedFiles.filter(function (file) { return String(file.attemptId) === String(attempt.attemptId) && file.driveFileId; }).forEach(function (file) {
          try {
            const answerFile = DriveApp.getFileById(String(file.driveFileId));
            const viewerEmail = String(viewer.email || '').trim().toLowerCase();
            // Akses yang sudah ada dipertahankan; izin baru dibuat tanpa email notifikasi.
            if (viewerEmail && answerFile.getAccess(viewerEmail) === null) {
              Drive.Permissions.create(
                { role: 'reader', type: 'user', emailAddress: viewerEmail },
                answerFile.getId(),
                { sendNotificationEmail: false }
              );
            }
          } catch (shareError) {
            Logger.log('Akses foto untuk guru belum dapat diberikan tanpa notifikasi: ' + shareError.message);
          }
        });
      }
      return Object.assign({}, attempt, {
        assessmentTitle: assessment ? assessment.title : attempt.assessmentId,
        assessmentDate: assessment ? String(assessment.startAt || assessment.createdAt || '') : '',
        assessmentStartAt: assessment ? String(assessment.startAt || '') : '',
        subject: assessment ? String(assessment.subject || '') : '',
        className: assessment ? String(assessment.className || '') : '',
        answers: (function () {
          const answers = parseJson_(attempt.answersJson, {});
          details.forEach(function (question) {
            const saved = answers[question.id] && typeof answers[question.id] === 'object' ? answers[question.id] : {};
            const savedPhotos = Array.isArray(saved.photos) ? saved.photos : [];
            uploadedFiles.filter(function (file) {
              return String(file.attemptId) === String(attempt.attemptId) &&
                String(file.studentId) === String(attempt.studentId) &&
                String(file.questionId || '') === String(question.id);
            }).forEach(function (file) {
              if (!savedPhotos.some(function (photo) { return String(photo.fileId) === String(file.fileId); })) {
                savedPhotos.push({ fileId: file.fileId, url: file.fileUrl, imageUrl: file.driveFileId ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.driveFileId) + '&sz=w1200' : file.fileUrl, name: 'Foto jawaban' });
              }
            });
            if (savedPhotos.length) { saved.photos = savedPhotos; answers[question.id] = saved; }
          });
          return answers;
        })(),
        questionScores: parseJson_(attempt.questionScoresJson, {}),
        questionDetails: details
      });
    });
}

/**
 * Menyimpan nilai akhir dan umpan balik dari guru.
 */
function gradeAttempt_(payload) {
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const questionScores = payload.questionScores && typeof payload.questionScores === 'object' ? payload.questionScores : null;
  let score = Number(payload.score);
  let maxScore = Number(payload.maxScore);
  if (questionScores) {
    const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
    if (!attempt) throw new Error('Pengerjaan tidak ditemukan.');
    const questions = listRows_('Questions').filter(function (q) { return String(q.assessmentId) === String(attempt.assessmentId); });
    if (!questions.length) throw new Error('Soal asesmen tidak ditemukan.');
    score = 0; maxScore = 0;
    questions.forEach(function (q) {
      const maximum = Number(q.points) || 0;
      const value = Number(questionScores[q.questionId]);
      if (!Object.prototype.hasOwnProperty.call(questionScores, q.questionId) || !isFinite(value) || value < 0 || value > maximum) {
        throw new Error('Skor soal nomor ' + q.order + ' tidak valid. Nilai harus antara 0 dan ' + maximum + '.');
      }
      score += value; maxScore += maximum;
    });
  }
  if (!isFinite(score) || !isFinite(maxScore) || score < 0 || maxScore < score) throw new Error('Nilai tidak valid.');
  const sheet = getSheet_('Attempts');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);

  const columnIndex = function (name) {
    return headers.indexOf(name);
  };

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (
      String(values[rowIndex][columnIndex('attemptId')]) === attemptId
    ) {
      sheet.getRange(rowIndex + 1, columnIndex('score') + 1).setValue(score);
      sheet.getRange(rowIndex + 1, columnIndex('maxScore') + 1)
        .setValue(maxScore);
      sheet.getRange(rowIndex + 1, columnIndex('status') + 1)
        .setValue('graded');
      sheet.getRange(rowIndex + 1, columnIndex('teacherFeedback') + 1)
        .setValue(String(payload.feedback || ''));
      if (payload.questionScores && typeof payload.questionScores === 'object') {
        sheet.getRange(rowIndex + 1, columnIndex('questionScoresJson') + 1)
          .setValue(JSON.stringify(payload.questionScores));
      }

      return {
        attemptId: attemptId,
        score: score,
        maxScore: maxScore,
        status: 'graded'
      };
    }
  }

  throw new Error('Pengerjaan tidak ditemukan.');
}

/**
 * Mencatat event keamanan dari sesi siswa yang telah diverifikasi oleh routeAction_.
 * Hanya event yang dikenal yang disimpan; waktu selalu dibuat di server.
 */
function logEvent_(payload) {
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const studentId = requiredText_(payload.studentId, 'ID siswa', 120);
  const allowedTypes = ['exam_started','page_hidden','page_visible','window_blur','window_focus','fullscreen_exit','page_reload','exam_submit_attempted'];
  const eventType = requiredText_(payload.eventType, 'Jenis kejadian', 80);
  if (allowedTypes.indexOf(eventType) < 0) throw new Error('Jenis event keamanan tidak dikenal.');

  const attemptSheet = getSheet_('Attempts');
  const values = attemptSheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Sesi pengerjaan tidak ditemukan.');
  const headers = values[0].map(String);
  const col = function (name) {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error('Kolom ' + name + ' tidak ditemukan pada Attempts.');
    return index;
  };
  let rowNumber = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][col('attemptId')]) === attemptId &&
        String(values[i][col('studentId')]) === studentId &&
        String(values[i][col('status')]) === 'in_progress') {
      rowNumber = i + 1;
      break;
    }
  }
  if (rowNumber < 0) throw new Error('Sesi aktif tidak ditemukan.');

  const cache = CacheService.getScriptCache();
  const throttleKey = 'rumble_sec_' + attemptId + '_' + eventType;
  if (cache.get(throttleKey)) return { logged: false, throttled: true };
  cache.put(throttleKey, '1', 3);

  const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
  const safeDetails = {
    platform: String(details.platform || '').slice(0, 20),
    visibilityState: String(details.visibilityState || '').slice(0, 20)
  };
  const now = currentTimestamp_();
  appendRow_('Events', {
    eventId: makeId_('EVT'),
    attemptId: attemptId,
    studentId: studentId,
    eventType: eventType,
    eventAt: now,
    detailsJson: JSON.stringify(safeDetails)
  });

  // Satu kehilangan visibilitas dihitung satu kali per transisi hidden.
  if (eventType === 'page_hidden') {
    const focusCol = headers.indexOf('focusLossCount');
    if (focusCol >= 0) {
      const current = Number(values[rowNumber - 1][focusCol]) || 0;
      attemptSheet.getRange(rowNumber, focusCol + 1).setValue(current + 1);
    }
  }
  return { logged: true, eventAt: now };
}

/**
 * Data pemantauan hanya berisi sesi pada asesmen milik guru yang sedang login.
 * Tidak mengirim isi jawaban, kunci jawaban, atau alamat email siswa.
 */
function getTeacherSummary_(payload) {
  const teacher = payload.currentUser;
  if (!teacher || teacher.role !== 'teacher') throw new Error('Fitur ringkasan hanya untuk guru.');
  const email = String(teacher.email || '').trim().toLowerCase();
  const assessments = listRows_('Assessments').filter(function (assessment) {
    return String(assessment.createdBy || '').trim().toLowerCase() === email;
  });
  const owned = {};
  assessments.forEach(function (assessment) { owned[String(assessment.assessmentId)] = assessment; });
  const users = listRows_('Users').filter(function (user) {
    const active = user.active === true || String(user.active).toLowerCase() === 'true' || String(user.active) === '1';
    return String(user.role).toLowerCase() === 'student' && active;
  });
  const attempts = listRows_('Attempts').filter(function (attempt) {
    return !!owned[String(attempt.assessmentId)];
  });
  const attemptById = {};
  const studentStats = {};
  attempts.forEach(function (attempt) {
    const id = String(attempt.attemptId);
    attemptById[id] = attempt;
    const assessment = owned[String(attempt.assessmentId)] || {};
    const studentId = String(attempt.studentId);
    if (!studentStats[studentId]) studentStats[studentId] = { className: String(assessment.className || ''), scoreTotal: 0, gradedCount: 0, reviewSessionCount: 0 };
    if (String(attempt.status) === 'graded' && Number(attempt.maxScore) > 0) {
      studentStats[studentId].scoreTotal += (Number(attempt.score) || 0) / Number(attempt.maxScore) * 100;
      studentStats[studentId].gradedCount++;
    }
  });
  const eventCounts = {};
  listRows_('Events').forEach(function (event) {
    const attemptId = String(event.attemptId);
    if (!attemptById[attemptId]) return;
    if (!eventCounts[attemptId]) eventCounts[attemptId] = { fullscreen: 0, reload: 0, blur: 0, hidden: 0 };
    const counts = eventCounts[attemptId];
    if (String(event.eventType) === 'fullscreen_exit') counts.fullscreen++;
    if (String(event.eventType) === 'page_reload') counts.reload++;
    if (String(event.eventType) === 'window_blur') counts.blur++;
    if (String(event.eventType) === 'page_hidden') counts.hidden++;
  });
  attempts.forEach(function (attempt) {
    const counts = eventCounts[String(attempt.attemptId)] || { fullscreen: 0, reload: 0, blur: 0, hidden: 0 };
    counts.hidden = Math.max(counts.hidden, Number(attempt.focusLossCount) || 0);
    if (counts.fullscreen > 3 || counts.reload > 3 || counts.blur > 3 || counts.hidden > 3) {
      const stats = studentStats[String(attempt.studentId)];
      if (stats) stats.reviewSessionCount++;
    }
  });
  return users.map(function (user) {
    const stats = studentStats[String(user.userId)] || { className: String(user.className || ''), scoreTotal: 0, gradedCount: 0, reviewSessionCount: 0 };
    const count = Number(stats.gradedCount) || 0;
    return {
      studentName: String(user.name || 'Siswa'),
      className: String(user.className || stats.className || 'Kelas belum diatur'),
      averageScore: count ? Math.round(stats.scoreTotal / count) : null,
      gradedAssessmentCount: count,
      reviewSessionCount: Number(stats.reviewSessionCount) || 0
    };
  });
}

function listMonitoring_(payload) {
  const teacher = payload.currentUser;
  if (!teacher || teacher.role !== 'teacher') throw new Error('Fitur pemantauan hanya untuk guru.');
  const assessments = listRows_('Assessments').filter(function (assessment) {
    return String(assessment.createdBy || '').trim().toLowerCase() === String(teacher.email || '').trim().toLowerCase();
  });
  const owned = {};
  assessments.forEach(function (assessment) { owned[String(assessment.assessmentId)] = assessment; });
  const users = listRows_('Users');
  const events = listRows_('Events');
  const questions = listRows_('Questions');
  const rows = listRows_('Attempts').filter(function (attempt) {
    return !!owned[String(attempt.assessmentId)];
  }).map(function (attempt) {
    const assessment = owned[String(attempt.assessmentId)];
    const student = users.find(function (item) {
      return String(item.userId) === String(attempt.studentId);
    }) || {};
    const attemptEvents = events.filter(function (event) {
      return String(event.attemptId) === String(attempt.attemptId);
    }).sort(function (a, b) {
      return new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime();
    });
    const countEvent = function (type) {
      return attemptEvents.filter(function (event) { return String(event.eventType) === type; }).length;
    };
    const answers = parseJson_(attempt.answersJson, {});
    const answeredCount = Object.keys(answers && typeof answers === 'object' ? answers : {}).filter(function (key) {
      const value = answers[key];
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value).some(function (part) {
        const item = value[part];
        return Array.isArray(item) ? item.length > 0 : item !== null && item !== undefined && String(item).trim() !== '';
      });
      return value !== null && value !== undefined && String(value).trim() !== '';
    }).length;
    const latestEvent = attemptEvents.length ? attemptEvents[0] : null;
    const pageHiddenCount = Math.max(Number(attempt.focusLossCount) || 0, countEvent('page_hidden'));
    return {
      attemptId: String(attempt.attemptId),
      assessmentId: String(attempt.assessmentId),
      assessmentTitle: String(assessment.title || 'Asesmen'),
      assessmentSubject: String(assessment.subject || 'Umum'),
      assessmentStartAt: assessment.startAt || '',
      assessmentEndAt: assessment.endAt || '',
      assessmentCreatedAt: assessment.createdAt || '',
      className: String(assessment.className || ''),
      studentName: String(student.name || 'Siswa'),
      studentId: String(attempt.studentId),
      status: String(attempt.status || ''),
      startedAt: attempt.startedAt || '',
      submittedAt: attempt.submittedAt || '',
      fullscreenExitCount: countEvent('fullscreen_exit'),
      pageReloadCount: countEvent('page_reload'),
      windowBlurCount: countEvent('window_blur'),
      pageHiddenCount: pageHiddenCount,
      focusLossCount: pageHiddenCount,
      answeredCount: answeredCount,
      questionCount: questions.filter(function (question) {
        return String(question.assessmentId) === String(attempt.assessmentId);
      }).length,
      lastActivityAt: latestEvent ? latestEvent.eventAt : (attempt.submittedAt || attempt.startedAt || ''),
      lastEventType: latestEvent ? String(latestEvent.eventType || '') : '',
      recentEvents: attemptEvents.slice(0, 100).map(function (event) {
        return {
          eventType: String(event.eventType || ''),
          eventAt: event.eventAt || '',
          details: parseJson_(event.detailsJson, {})
        };
      })
    };
  });
  rows.sort(function (a, b) {
    const aActive = a.status === 'in_progress' ? 1 : 0;
    const bActive = b.status === 'in_progress' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });
  return rows;
}
function getCurrentUser_(sessionToken) {
  const suppliedToken = String(sessionToken || '').trim();
  const sessionUser = resolveStudentSession_(suppliedToken);
  if (sessionUser) return { authenticated: true, email: '', user: sessionUser, authType: 'student_password' };
  if (suppliedToken) return { authenticated: false, email: '', user: null, reason: 'session_expired' };

  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) return { authenticated: false, email: '', user: null, reason: 'email_unavailable' };
  const user = listRows_('Users').find(function (item) { return String(item.email || '').trim().toLowerCase() === email; });
  if (!user) return { authenticated: false, email: email, user: null, reason: 'not_registered' };
  const active = user.active === true || String(user.active).toLowerCase() === 'true' || String(user.active) === '1';
  if (!active) return { authenticated: false, email: email, user: null, reason: 'inactive' };
  const role = String(user.role || '').trim().toLowerCase();
  if (['teacher', 'student', 'admin'].indexOf(role) === -1) return { authenticated: false, email: email, user: null, reason: 'invalid_role' };
  return { authenticated: true, email: email, user: { userId: user.userId, name: user.name, email: email, role: role, className: user.className || '' }, authType: 'google' };
}

function ensureUserAuthColumns_() {
  const sheet = getSheet_('Users');
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  ['username','nisn','passwordSalt','passwordHash'].forEach(function (header) {
    if (headers.indexOf(header) < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      headers.push(header);
    }
  });
}

function passwordDigest_(password, salt) {
  let value = String(salt) + '|' + String(password);
  for (let i = 0; i < 250; i++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
    value = bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  }
  return value;
}

function generateStudentPassword_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
}

function makeStudentSession_(user) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const keyBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  const key = 'ra_student_session_' + keyBytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  const safeUser = { userId: String(user.userId), name: String(user.name || ''), email: '', role: 'student', className: String(user.className || '') };
  CacheService.getScriptCache().put(key, JSON.stringify(safeUser), 21600);
  return token;
}

function resolveStudentSession_(token) {
  token = String(token || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  const key = 'ra_student_session_' + bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  const cached = CacheService.getScriptCache().get(key);
  if (!cached) return null;
  let session;
  try { session = JSON.parse(cached); } catch (error) { return null; }
  const current = listRows_('Users').find(function (item) { return String(item.userId) === String(session.userId); });
  if (!current || String(current.role).toLowerCase() !== 'student' ||
      !(current.active === true || String(current.active).toLowerCase() === 'true' || String(current.active) === '1')) {
    CacheService.getScriptCache().remove(key);
    return null;
  }
  return { userId: String(current.userId), name: String(current.name || ''), email: '', role: 'student', className: String(current.className || '') };
}

function studentLogin_(payload) {
  ensureUserAuthColumns_();
  const username = requiredText_(payload.username, 'NIS / username', 80).toLowerCase();
  const password = requiredText_(payload.password, 'Kata sandi', 100);
  const failKeyBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, username, Utilities.Charset.UTF_8);
  const failKey = 'ra_login_fail_' + failKeyBytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  const cache = CacheService.getScriptCache();
  const failures = Number(cache.get(failKey) || 0);
  if (failures >= 8) throw new Error('Terlalu banyak percobaan masuk. Silakan tunggu 10 menit lalu coba lagi.');

  const user = listRows_('Users').find(function (item) {
    return String(item.username || '').trim().toLowerCase() === username && String(item.role || '').toLowerCase() === 'student';
  });
  const active = user && (user.active === true || String(user.active).toLowerCase() === 'true' || String(user.active) === '1');
  const valid = !!(user && active && user.passwordSalt && user.passwordHash &&
    passwordDigest_(password, user.passwordSalt) === String(user.passwordHash));
  if (!valid) {
    cache.put(failKey, String(failures + 1), 600);
    throw new Error('NIS atau kata sandi tidak sesuai, atau akun belum aktif.');
  }
  cache.remove(failKey);
  return { token: makeStudentSession_(user), user: { userId: String(user.userId), name: String(user.name || ''), role: 'student', className: String(user.className || '') } };
}

function studentLogout_(token) {
  token = String(token || '').trim();
  if (/^[a-f0-9]{64}$/i.test(token)) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
    const key = 'ra_student_session_' + bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    CacheService.getScriptCache().remove(key);
  }
  return { loggedOut: true };
}

function updateUserAuthFields_(userId, fields) {
  const sheet = getSheet_('Users');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Pengguna tidak ditemukan.');
  const headers = values[0].map(String);
  const idCol = headers.indexOf('userId');
  const rowIndex = values.findIndex(function (row, index) { return index > 0 && String(row[idCol]) === String(userId); });
  if (rowIndex < 1) throw new Error('Pengguna tidak ditemukan.');
  Object.keys(fields).forEach(function (key) {
    const col = headers.indexOf(key);
    if (col < 0) throw new Error('Kolom ' + key + ' tidak tersedia.');
    sheet.getRange(rowIndex + 1, col + 1).setValue(fields[key]);
  });
}

function adminListStudents_() {
  ensureUserAuthColumns_();
  return listRows_('Users').filter(function (item) {
    return String(item.role || '').toLowerCase() === 'student';
  }).map(function (item) {
    return { userId: String(item.userId || ''), name: String(item.name || ''), username: String(item.username || ''), nisn: String(item.nisn || ''), className: String(item.className || ''), active: item.active === true || String(item.active).toLowerCase() === 'true' || String(item.active) === '1' };
  });
}

function adminImportStudents_(payload) {
  ensureUserAuthColumns_();
  const records = Array.isArray(payload.students) ? payload.students : [];
  if (!records.length || records.length > 100) throw new Error('Impor dibatasi maksimal 100 siswa per proses agar pembuatan akun tetap stabil.');
  const existing = listRows_('Users');
  const seen = {};
  const credentials = [], skipped = [];
  records.forEach(function (record, index) {
    const username = requiredText_(record.nis, 'NIS pada baris ' + (index + 1), 80).toLowerCase();
    const name = requiredText_(record.name, 'Nama pada baris ' + (index + 1), 120);
    const className = requiredText_(record.className, 'Kelas pada baris ' + (index + 1), 80);
    const nisn = String(record.nisn || '').trim().slice(0, 40);
    if (seen[username]) { skipped.push({ username: username, reason: 'Duplikat dalam file' }); return; }
    seen[username] = true;
    if (existing.some(function (item) { return String(item.username || '').trim().toLowerCase() === username; })) {
      skipped.push({ username: username, reason: 'NIS sudah terdaftar' }); return;
    }
    const password = generateStudentPassword_();
    const salt = Utilities.getUuid().replace(/-/g, '');
    const userId = makeId_('USR');
    appendRow_('Users', {
      userId: userId, name: name, email: '', role: 'student', className: className,
      active: true, createdAt: currentTimestamp_(), username: username, nisn: nisn,
      passwordSalt: salt, passwordHash: passwordDigest_(password, salt)
    });
    credentials.push({ userId: userId, name: name, username: username, className: className, password: password });
  });
  return { created: credentials.length, skipped: skipped, credentials: credentials };
}

function adminResetStudentPassword_(payload) {
  ensureUserAuthColumns_();
  const userId = requiredText_(payload.userId, 'ID siswa', 100);
  const user = listRows_('Users').find(function (item) { return String(item.userId) === userId && String(item.role).toLowerCase() === 'student'; });
  if (!user) throw new Error('Akun siswa tidak ditemukan.');
  const password = generateStudentPassword_(), salt = Utilities.getUuid().replace(/-/g, '');
  updateUserAuthFields_(userId, { passwordSalt: salt, passwordHash: passwordDigest_(password, salt) });
  return { userId: userId, name: String(user.name || ''), username: String(user.username || ''), password: password };
}

function adminSetStudentActive_(payload) {
  const userId = requiredText_(payload.userId, 'ID siswa', 100);
  const active = payload.active === true;
  const user = listRows_('Users').find(function (item) { return String(item.userId) === userId && String(item.role).toLowerCase() === 'student'; });
  if (!user) throw new Error('Akun siswa tidak ditemukan.');
  updateUserAuthFields_(userId, { active: active });
  return { userId: userId, active: active };
}

function saveUser_(payload) {
  const email = requiredText_(payload.email, 'Email', 254).toLowerCase();
  const role = String(payload.role || 'student');

  if (['teacher', 'student'].indexOf(role) === -1) {
    throw new Error('Peran tidak valid.');
  }

  const existingUser = listRows_('Users').some(function (user) {
    return String(user.email).toLowerCase() === email;
  });

  if (existingUser) {
    throw new Error('Email sudah terdaftar.');
  }

  const userId = makeId_('USR');

  appendRow_('Users', {
    userId: userId,
    name: requiredText_(payload.name, 'Nama', 120),
    email: email,
    role: role,
    className: String(payload.className || ''),
    active: true,
    createdAt: currentTimestamp_()
  });

  return {
    userId: userId,
    email: email,
    role: role
  };
}

/**
 * Menyimpan foto jawaban ke folder Drive yang sudah dikonfigurasi.
 * Payload base64 dibatasi agar tidak menerima file terlalu besar.
 */
function uploadAnswerImage_(payload) {
  if (!CONFIG.DRIVE_FOLDER_ID) throw new Error('Folder Drive jawaban belum dikonfigurasi.');
  const mimeType = String(payload.mimeType || 'image/jpeg').toLowerCase();
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimeTypes.indexOf(mimeType) === -1) throw new Error('Format gambar harus JPG, PNG, atau WebP.');
  const base64 = String(payload.base64 || '');
  if (!base64 || base64.length > 8 * 1024 * 1024) throw new Error('Gambar kosong atau terlalu besar.');
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const studentId = requiredText_(payload.studentId, 'ID siswa', 120);
  const questionId = requiredText_(payload.questionId, 'ID soal', 120);
  const assessmentId = requiredText_(payload.assessmentId, 'ID asesmen', 100);
  const user = payload.currentUser || {};
  if (user.role !== 'student' || String(user.userId || '') !== studentId) throw new Error('Identitas siswa tidak sesuai dengan sesi login.');
  const attemptSheet = getSheet_('Attempts');
  const attemptValues = attemptSheet.getDataRange().getValues();
  if (!attemptValues.length) throw new Error('Data pengerjaan belum tersedia.');
  const headers = attemptValues[0].map(String);
  const col = function (name) { const index = headers.indexOf(name); if (index < 0) throw new Error('Kolom ' + name + ' tidak ditemukan pada Attempts.'); return index; };
  let rowIndex = -1, attemptRow = null;
  for (let i = 1; i < attemptValues.length; i++) {
    if (String(attemptValues[i][col('attemptId')]) === attemptId &&
        String(attemptValues[i][col('studentId')]) === studentId &&
        String(attemptValues[i][col('assessmentId')]) === assessmentId) {
      rowIndex = i; attemptRow = attemptValues[i]; break;
    }
  }
  if (rowIndex < 0) throw new Error('Sesi pengerjaan tidak ditemukan untuk akun siswa ini.');
  if (String(attemptRow[col('status')]) !== 'in_progress') throw new Error('Foto hanya dapat diunggah selama asesmen masih dikerjakan.');
  const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
  if (!assessment) throw new Error('Asesmen tidak ditemukan.');
  const question = listRows_('Questions').find(function (item) {
    return String(item.assessmentId) === assessmentId && String(item.questionId) === questionId;
  });
  if (!question) throw new Error('Soal tujuan unggahan tidak ditemukan pada asesmen ini.');
  const fileName = (String(payload.fileName || 'jawaban.jpg').split(/[\\/]/).pop() || 'jawaban.jpg').slice(0, 150);
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let file = null;
  try {
    const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    const answerRoot = getOrCreateChildFolder_(root, '02 - Jawaban Siswa');
    const assessmentFolder = getOrCreateChildFolder_(answerRoot, assessmentId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100));
    const attemptFolder = getOrCreateChildFolder_(assessmentFolder, attemptId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100));
    file = attemptFolder.createFile(blob);
    const teacherEmail = String(assessment.createdBy || '').trim().toLowerCase();
    [String(user.email || '').trim().toLowerCase(), teacherEmail].filter(function (email, index, all) {
      return email && all.indexOf(email) === index;
    }).forEach(function (email) {
      try {
        // Pertahankan akses viewer tanpa mengirim email notifikasi berbagi dari Google Drive.
        if (file.getAccess(email) === null) {
          Drive.Permissions.create(
            { role: 'reader', type: 'user', emailAddress: email },
            file.getId(),
            { sendNotificationEmail: false }
          );
        }
      } catch (shareError) {
        Logger.log('Akses foto jawaban tidak dapat diberikan tanpa notifikasi ke ' + email + ': ' + shareError.message);
      }
    });
    const fileId = makeId_('FILE');
    const imageUrl = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) + '&sz=w1200';
    appendRow_('Files', { fileId: fileId, attemptId: attemptId, studentId: studentId, questionId: questionId, driveFileId: file.getId(), fileUrl: file.getUrl(), createdAt: currentTimestamp_() });
    const answersCol = col('answersJson');
    const answers = parseJson_(attemptRow[answersCol], {});
    const answer = answers[questionId] && typeof answers[questionId] === 'object' && !Array.isArray(answers[questionId])
      ? answers[questionId] : { text: typeof answers[questionId] === 'string' ? answers[questionId] : '' };
    answer.photos = Array.isArray(answer.photos) ? answer.photos : [];
    answer.photos.push({ fileId: fileId, url: file.getUrl(), imageUrl: imageUrl, name: file.getName() });
    answers[questionId] = answer;
    attemptSheet.getRange(rowIndex + 1, answersCol + 1).setValue(JSON.stringify(answers));
    SpreadsheetApp.flush();
    return { fileId: fileId, name: file.getName(), url: file.getUrl(), imageUrl: imageUrl, folder: '02 - Jawaban Siswa/' + assessmentId + '/' + attemptId };
  } catch (error) {
    if (file) { try { file.setTrashed(true); } catch (trashError) { Logger.log('File unggahan gagal dibersihkan: ' + trashError.message); } }
    throw error;
  } finally { lock.releaseLock(); }
}



/** Explicit database migration and immutable BundleVersions helpers. */
function migrateDatabaseV1_() {
  setupDatabase();
  const migrationId='BUNDLE_VERSIONING_V1';
  if(listRows_('SchemaMigrations').some(function(r){return String(r.migrationId)===migrationId&&String(r.status)==='completed';}))return {success:true,alreadyApplied:true,migrationId:migrationId};
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const bundles=listRows_('QuestionBundles');let created=0,reused=0;
    bundles.forEach(function(bundle){
      const id=requiredText_(bundle.bundleId,'ID bundel',100),classification=String(bundle.classification||'REGULER').toUpperCase();
      if(['REGULER','SOLO_TAX'].indexOf(classification)<0)throw new Error('Klasifikasi bundel '+id+' tidak valid; migrasi dihentikan.');
      let versions=listRows_('BundleVersions').filter(function(v){return String(v.bundleId)===id;}).sort(function(a,b){return Number(a.versionNumber)-Number(b.versionNumber);});
      let latest=versions.length?versions[versions.length-1]:null;
      if(!latest){latest=createBundleVersion_(id,bundleSnapshotFromRecord_(bundle,classification),'Migrasi versi awal',String(bundle.createdBy||''));created++;}
      else reused++;
      updateRowByKey_('QuestionBundles','bundleId',id,{classification:classification,latestVersionId:String(latest.versionId),latestVersionNumber:Number(latest.versionNumber),archivedAt:String(bundle.archivedAt||''),archivedBy:String(bundle.archivedBy||'')});
    });
    appendRow_('SchemaMigrations',{migrationId:migrationId,version:1,appliedAt:currentTimestamp_(),appliedBy:'Apps Script editor',status:'completed',detailsJson:JSON.stringify({bundles:bundles.length,createdVersions:created,reusedVersions:reused})});
    return {success:true,migrationId:migrationId,bundles:bundles.length,createdVersions:created,reusedVersions:reused};
  }finally{lock.releaseLock();}
}
function updateRowByKey_(tableName,keyHeader,keyValue,fields){
  const sheet=getSheet_(tableName),values=sheet.getDataRange().getValues(),headers=values[0].map(String),keyCol=headers.indexOf(keyHeader);
  if(keyCol<0)throw new Error('Kolom '+keyHeader+' tidak tersedia pada '+tableName+'.');
  let row=-1;for(let i=1;i<values.length;i++)if(String(values[i][keyCol])===String(keyValue)){row=i+1;break;}
  if(row<0)throw new Error('Data '+tableName+' tidak ditemukan: '+keyValue);
  Object.keys(fields).forEach(function(k){const c=headers.indexOf(k);if(c<0)throw new Error('Kolom '+k+' tidak tersedia pada '+tableName+'.');sheet.getRange(row,c+1).setValue(fields[k]);});
}
function bundleSnapshotFromRecord_(bundle,classification){
  return {schemaVersion:1,bundleId:String(bundle.bundleId),classification:String(classification||'REGULER').toUpperCase(),title:String(bundle.title||''),subject:String(bundle.subject||''),description:String(bundle.description||''),tpCode:String(bundle.tpCode||''),passageText:String(bundle.passageText||''),passageImageUrl:String(bundle.passageImageUrl||''),passages:parseJson_(bundle.passagesJson,[]),questions:parseJson_(bundle.questionsJson,[])};
}
function validateBundleSnapshot_(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new Error('Snapshot bundel tidak valid.');
  requiredText_(snapshot.bundleId,'ID bundel',100);
  if(['REGULER','SOLO_TAX'].indexOf(String(snapshot.classification||'').toUpperCase())<0)throw new Error('Klasifikasi bundel tidak valid.');
  if(!Array.isArray(snapshot.questions)||snapshot.questions.length<1||snapshot.questions.length>200)throw new Error('Snapshot harus memiliki 1 sampai 200 soal.');
  snapshot.questions.forEach(function(q,i){const type=String(q&&q.type||'multiple_choice'),points=Number(q&&q.points);if(['multiple_choice','true_false','true_false_multi','multi_select','matching','essay'].indexOf(type)<0)throw new Error('Tipe soal snapshot tidak valid pada nomor '+(i+1));if(!isFinite(points)||points<0||points>1000)throw new Error('Bobot soal snapshot tidak valid pada nomor '+(i+1));});
  return true;
}
/** Caller must hold ScriptLock while updating the parent bundle's latest-version pointer. */
function createBundleVersion_(bundleId,snapshot,changeNote,createdBy){
  const id=requiredText_(bundleId,'ID bundel',100),copy=JSON.parse(JSON.stringify(snapshot));copy.bundleId=id;validateBundleSnapshot_(copy);
  const versions=listRows_('BundleVersions').filter(function(v){return String(v.bundleId)===id;}),number=versions.reduce(function(m,v){return Math.max(m,Number(v.versionNumber)||0);},0)+1,versionId=makeId_('BVER');
  appendRow_('BundleVersions',{versionId:versionId,bundleId:id,versionNumber:number,snapshotJson:JSON.stringify(copy),createdBy:String(createdBy||''),createdAt:currentTimestamp_(),changeNote:String(changeNote||'').slice(0,500)});
  return {versionId:versionId,bundleId:id,versionNumber:number,snapshot:copy};
}
function getBundleVersion_(payload){
  const id=String(payload.versionId||'').trim(),bundleId=String(payload.bundleId||'').trim(),number=payload.versionNumber===undefined?null:Number(payload.versionNumber);
  const row=listRows_('BundleVersions').find(function(v){return id?String(v.versionId)===id:String(v.bundleId)===bundleId&&Number(v.versionNumber)===number;});
  if(!row)throw new Error('Versi Bundel Soal tidak ditemukan.');
  const snapshot=parseJson_(row.snapshotJson,null);validateBundleSnapshot_(snapshot);
  return {versionId:String(row.versionId),bundleId:String(row.bundleId),versionNumber:Number(row.versionNumber),createdBy:String(row.createdBy||''),createdAt:String(row.createdAt||''),changeNote:String(row.changeNote||''),snapshot:snapshot};
}
function assertBundleVersioningReady_(){
  if(!listRows_('SchemaMigrations').some(function(r){return String(r.migrationId)==='BUNDLE_VERSIONING_V1'&&String(r.status)==='completed';}))throw new Error('Fondasi versioning belum dimigrasikan. Administrator harus menjalankan migrateDatabaseV1_() terlebih dahulu.');
}

/* -------------------------------------------------------------------------
 * Repositori Pembelajaran — CRUD TP dan indikator (LEARNING_REPOSITORY_V1)
 * Migrasi terpisah dari setupDatabase() agar tidak mengubah tabel lain.
 * ------------------------------------------------------------------------- */
const LEARNING_REPOSITORY_TABLES_ = {
  LearningObjectives: ['objectiveId','tpCode','title','subject','description','createdBy','createdAt','updatedAt','active'],
  LearningIndicators: ['indicatorId','objectiveId','indicatorCode','description','active','createdAt','updatedAt'],
  AdminAuditLog: ['logId','actorUserId','actorEmail','action','entityType','entityId','beforeJson','afterJson','createdAt']
};

function migrateLearningRepositoryV1_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const migrationId = 'LEARNING_REPOSITORY_V1';
    const migrationSheet = getSpreadsheet_().getSheetByName('SchemaMigrations');
    if (!migrationSheet) throw new Error('Sheet SchemaMigrations belum tersedia. Selesaikan migrasi fondasi versioning terlebih dahulu.');
    if (listRows_('SchemaMigrations').some(function (r) {
      return String(r.migrationId) === migrationId && String(r.status) === 'completed';
    })) return { success: true, alreadyApplied: true, migrationId: migrationId };

    const changes = {};
    Object.keys(LEARNING_REPOSITORY_TABLES_).forEach(function (tableName) {
      const spreadsheet = getSpreadsheet_();
      let sheet = spreadsheet.getSheetByName(tableName);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(tableName);
        const headers = LEARNING_REPOSITORY_TABLES_[tableName];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setFrozenRows(1);
        changes[tableName] = { created: true, addedHeaders: [] };
        return;
      }
      if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
        const headers = LEARNING_REPOSITORY_TABLES_[tableName];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setFrozenRows(1);
        changes[tableName] = { created: false, addedHeaders: headers.slice() };
        return;
      }
      const current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      const added = [];
      LEARNING_REPOSITORY_TABLES_[tableName].forEach(function (header) {
        if (current.indexOf(header) < 0) {
          sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
          current.push(header);
          added.push(header);
        }
      });
      changes[tableName] = { created: false, addedHeaders: added };
    });
    appendRow_('SchemaMigrations', {
      migrationId: migrationId, version: 1, appliedAt: currentTimestamp_(),
      appliedBy: Session.getActiveUser().getEmail() || 'Apps Script editor',
      status: 'completed', detailsJson: JSON.stringify(changes)
    });
    return { success: true, migrationId: migrationId, changes: changes };
  } finally {
    lock.releaseLock();
  }
}

function learningRepositoryAssertReady_() {
  Object.keys(LEARNING_REPOSITORY_TABLES_).forEach(function (name) {
    const sheet = getSpreadsheet_().getSheetByName(name);
    if (!sheet) throw new Error('Repositori Pembelajaran belum dimigrasikan. Jalankan migrateLearningRepositoryV1_() secara eksplisit.');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    LEARNING_REPOSITORY_TABLES_[name].forEach(function (h) {
      if (headers.indexOf(h) < 0) throw new Error('Kolom ' + h + ' belum tersedia pada ' + name + '. Jalankan migrasi repositori.');
    });
  });
}
function learningActive_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}
function learningAudit_(user, action, entityType, entityId, beforeValue, afterValue) {
  appendRow_('AdminAuditLog', {
    logId: makeId_('AUD'), actorUserId: String(user.userId || ''),
    actorEmail: String(user.email || ''), action: action, entityType: entityType,
    entityId: String(entityId), beforeJson: beforeValue == null ? '' : JSON.stringify(beforeValue),
    afterJson: afterValue == null ? '' : JSON.stringify(afterValue), createdAt: currentTimestamp_()
  });
}
function learningObjectivePublic_(row) {
  return {
    objectiveId: String(row.objectiveId || ''), tpCode: String(row.tpCode || ''),
    title: String(row.title || ''), subject: String(row.subject || ''),
    description: String(row.description || ''), active: learningActive_(row.active),
    createdAt: String(row.createdAt || ''), updatedAt: String(row.updatedAt || '')
  };
}
function learningIndicatorPublic_(row) {
  return {
    indicatorId: String(row.indicatorId || ''), objectiveId: String(row.objectiveId || ''),
    indicatorCode: String(row.indicatorCode || ''), description: String(row.description || ''),
    active: learningActive_(row.active), createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || '')
  };
}
function adminListLearningObjectives_() {
  learningRepositoryAssertReady_();
  return listRows_('LearningObjectives').map(learningObjectivePublic_);
}
function listAvailableLearningObjectives_() {
  learningRepositoryAssertReady_();
  return listRows_('LearningObjectives').filter(function (r) { return learningActive_(r.active); }).map(learningObjectivePublic_);
}
function adminSaveLearningObjective_(payload) {
  learningRepositoryAssertReady_();
  const code = requiredText_(payload.tpCode, 'Kode TP', 60).toUpperCase();
  const title = requiredText_(payload.title, 'Judul TP', 240);
  const subject = requiredText_(payload.subject, 'Mata pelajaran', 120);
  const description = String(payload.description || '').trim();
  if (description.length > 3000) throw new Error('Deskripsi TP terlalu panjang.');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const rows = listRows_('LearningObjectives');
    const id = String(payload.objectiveId || '').trim();
    const before = id ? rows.find(function (r) { return String(r.objectiveId) === id; }) : null;
    if (id && !before) throw new Error('TP tidak ditemukan.');
    const duplicate = rows.some(function (r) {
      return String(r.objectiveId) !== id &&
        String(r.tpCode).trim().toUpperCase() === code &&
        String(r.subject).trim().toLowerCase() === subject.toLowerCase();
    });
    if (duplicate) throw new Error('Kode TP sudah digunakan pada mata pelajaran tersebut.');
    const now = currentTimestamp_();
    const after = {
      objectiveId: id || makeId_('TP'), tpCode: code, title: title, subject: subject,
      description: description, createdBy: before ? String(before.createdBy || '') : String(payload.currentUser.email || ''),
      createdAt: before ? String(before.createdAt || now) : now, updatedAt: now,
      active: before ? learningActive_(before.active) : true
    };
    if (before) updateRowByKey_('LearningObjectives', 'objectiveId', id, after);
    else appendRow_('LearningObjectives', after);
    learningAudit_(payload.currentUser, before ? 'UPDATE' : 'CREATE', 'LearningObjective', after.objectiveId, before || null, after);
    return learningObjectivePublic_(after);
  } finally { lock.releaseLock(); }
}
function adminSetLearningObjectiveActive_(payload) {
  learningRepositoryAssertReady_();
  const id = requiredText_(payload.objectiveId, 'ID TP', 100);
  if (typeof payload.active !== 'boolean') throw new Error('Status aktif harus berupa boolean.');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const before = listRows_('LearningObjectives').find(function (r) { return String(r.objectiveId) === id; });
    if (!before) throw new Error('TP tidak ditemukan.');
    const after = Object.assign({}, before, { active: payload.active, updatedAt: currentTimestamp_() });
    updateRowByKey_('LearningObjectives', 'objectiveId', id, after);
    learningAudit_(payload.currentUser, payload.active ? 'ACTIVATE' : 'DEACTIVATE', 'LearningObjective', id, before, after);
    return learningObjectivePublic_(after);
  } finally { lock.releaseLock(); }
}
function adminListLearningIndicators_(payload) {
  learningRepositoryAssertReady_();
  const objectiveId = String(payload.objectiveId || '').trim();
  return listRows_('LearningIndicators').filter(function (r) {
    return !objectiveId || String(r.objectiveId) === objectiveId;
  }).map(learningIndicatorPublic_);
}
function listAvailableLearningIndicators_(payload) {
  learningRepositoryAssertReady_();
  const objectiveId = requiredText_(payload.objectiveId, 'ID TP', 100);
  const objective = listRows_('LearningObjectives').find(function (r) {
    return String(r.objectiveId) === objectiveId && learningActive_(r.active);
  });
  if (!objective) return [];
  return listRows_('LearningIndicators').filter(function (r) {
    return String(r.objectiveId) === objectiveId && learningActive_(r.active);
  }).map(learningIndicatorPublic_);
}
function adminSaveLearningIndicator_(payload) {
  learningRepositoryAssertReady_();
  const objectiveId = requiredText_(payload.objectiveId, 'TP', 100);
  const code = requiredText_(payload.indicatorCode, 'Kode indikator', 80).toUpperCase();
  const description = requiredText_(payload.description, 'Deskripsi indikator', 2000);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const objective = listRows_('LearningObjectives').find(function (r) {
      return String(r.objectiveId) === objectiveId && learningActive_(r.active);
    });
    if (!objective) throw new Error('Indikator harus terhubung ke TP yang aktif.');
    const rows = listRows_('LearningIndicators');
    const id = String(payload.indicatorId || '').trim();
    const before = id ? rows.find(function (r) { return String(r.indicatorId) === id; }) : null;
    if (id && !before) throw new Error('Indikator tidak ditemukan.');
    const duplicate = rows.some(function (r) {
      return String(r.indicatorId) !== id && String(r.objectiveId) === objectiveId &&
        String(r.indicatorCode).trim().toUpperCase() === code;
    });
    if (duplicate) throw new Error('Kode indikator sudah digunakan pada TP tersebut.');
    const now = currentTimestamp_();
    const after = {
      indicatorId: id || makeId_('IND'), objectiveId: objectiveId, indicatorCode: code,
      description: description, active: before ? learningActive_(before.active) : true,
      createdAt: before ? String(before.createdAt || now) : now, updatedAt: now
    };
    if (before) updateRowByKey_('LearningIndicators', 'indicatorId', id, after);
    else appendRow_('LearningIndicators', after);
    learningAudit_(payload.currentUser, before ? 'UPDATE' : 'CREATE', 'LearningIndicator', after.indicatorId, before || null, after);
    return learningIndicatorPublic_(after);
  } finally { lock.releaseLock(); }
}
function adminSetLearningIndicatorActive_(payload) {
  learningRepositoryAssertReady_();
  const id = requiredText_(payload.indicatorId, 'ID indikator', 100);
  if (typeof payload.active !== 'boolean') throw new Error('Status aktif harus berupa boolean.');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const before = listRows_('LearningIndicators').find(function (r) { return String(r.indicatorId) === id; });
    if (!before) throw new Error('Indikator tidak ditemukan.');
    const after = Object.assign({}, before, { active: payload.active, updatedAt: currentTimestamp_() });
    updateRowByKey_('LearningIndicators', 'indicatorId', id, after);
    learningAudit_(payload.currentUser, payload.active ? 'ACTIVATE' : 'DEACTIVATE', 'LearningIndicator', id, before, after);
    return learningIndicatorPublic_(after);
  } finally { lock.releaseLock(); }
}
