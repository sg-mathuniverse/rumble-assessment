/**
 * Rumble Assessment — Google Apps Script backend
 *
 * Setup:
 * 1. Isi ID spreadsheet dan folder Drive pada CONFIG.
 * 2. Pada spreadsheet uji, jalankan migrasi yang sesuai secara eksplisit:
 *    migrateDatabaseV1_() untuk fondasi versioning, lalu
 *    migrateLearningRepositoryV1_() untuk repositori pembelajaran.
 * 3. Tinjau hasil migrasi dan uji alur aplikasi sebelum deployment.
 *
 * Catatan keamanan:
 * Backend menerapkan autentikasi sesi dan pemeriksaan peran di server untuk
 * aksi yang telah didaftarkan. Implementasi ini belum dinyatakan siap produksi:
 * pengujian runtime/integrasi, peninjauan konfigurasi deployment, dan kontrol
 * operasional sekolah tetap wajib sebelum memakai data siswa sungguhan.
 */

const CONFIG = {
  SPREADSHEET_ID: '1PtFTRSFWjjoOkYzph7Elf6fziqMdwIqTi4p0HGsdlps',
  DRIVE_FOLDER_ID: '1_iKxvdIpBvbJp8r1cENloQroXMkMr9C8',
  APP_NAME: 'Rumble Assessment'
};

// Script Properties keys for the TokenPortal AI integration.
const RUMBLE_AI_SETTINGS_KEY_ = 'RUMBLE_AI_SETTINGS';
const RUMBLE_AI_API_KEY_ = 'RUMBLE_AI_API_KEY';
const RUMBLE_AI_ENDPOINT_ = 'https://tokenportal.id/v1';

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
  QuestionBundles: ['bundleId','title','subject','className','description','tpCode','passageText','passageImageUrl','passagesJson','questionsJson','status','createdBy','createdAt','updatedAt','visibility','classification','latestVersionId','latestVersionNumber','archivedAt','archivedBy'],
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
  return HtmlService.createHtmlOutputFromFile('index')
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

  const url = 'https://raw.githubusercontent.com/sg-mathuniverse/rumble-assessment/81f5c5dbe6a0870af91d3ce534b3318936c5cec0/index.html';
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
 * Otorisasi sesi dan pemeriksaan peran dilakukan di routeAction_() pada
 * server untuk setiap aksi terdaftar. Tetap lakukan pengujian runtime/integrasi
 * dan tinjau konfigurasi deployment sebelum memakai data siswa sungguhan.
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
  const adminOnly = ['adminListStudents','adminImportStudents','adminResetStudentPassword','adminSetStudentActive','adminListLearningClassOptions','adminListLearningSubjectOptions','adminListLearningObjectives','adminSaveLearningObjective','adminSetLearningObjectiveActive','adminListLearningIndicators','adminSaveLearningIndicator','adminSetLearningIndicatorActive','adminListPendingLearningAudits','adminReconcileLearningAudit','adminGetAiSettings','adminSaveAiSettings','adminTestAiConnection','adminListAiModels','adminListAiUsage','adminListAiPrompts','adminSaveAiPrompt','adminTestAiPrompt','adminActivateAiPrompt'];
  if (['listAvailableLearningObjectives','listAvailableLearningIndicators','listAvailableLearningClassOptions','listAvailableLearningSubjectOptions'].indexOf(action) >= 0 && user.role !== 'admin' && user.role !== 'teacher') {
    throw new Error('Repositori pembelajaran hanya dapat diakses oleh Admin dan Guru.');
  }
  if (adminOnly.indexOf(action) >= 0 && user.role !== 'admin') {
    throw new Error('Fitur ini hanya dapat digunakan oleh administrator sekolah.');
  }
  const teacherOnly = [
    'createAssessment','deleteAssessment','requestSoloAiAssessment','requestSoloClassReflection','saveSoloDominantVerification','saveQuestionBundle','saveQuestionBundleDraft','listQuestionBundleDrafts','getQuestionBundleDraft','deleteQuestionBundleDraft','listQuestionBundles',
    'getQuestionBundle','deleteQuestionBundle','updateAssessment','uploadAssessmentImage','deleteAssessmentImage',
    'publishAssessment','gradeAttempt','saveSoloIndicatorVerification','listStudents','listMonitoring','getTeacherSummary'
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
    saveQuestionBundleDraft: function () { return saveQuestionBundleDraft_(trusted); },
    listQuestionBundleDrafts: function () { return listQuestionBundleDrafts_(trusted); },
    getQuestionBundleDraft: function () { return getQuestionBundleDraft_(trusted); },
    deleteQuestionBundleDraft: function () { return deleteQuestionBundleDraft_(trusted); },
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
        return listAttempts_(trusted).filter(function (attempt) {
          const assessment = listRows_('Assessments').find(function (item) {
            return String(item.assessmentId) === String(attempt.assessmentId);
          });
          if (!assessment || String(assessment.classification || '').toUpperCase() !== 'SOLO_TAX') return true;
          // SOLO Tax result is visible to the student only after an explicit release event.
          return listRows_('Events').some(function (event) {
            return String(event.attemptId) === String(attempt.attemptId) &&
              String(event.eventType) === 'SOLO_RESULT_RELEASED';
          });
        });
      }
      return listAttempts_(trusted).filter(function (attempt) {
        const assessment = listRows_('Assessments').find(function (item) {
          return String(item.assessmentId) === String(attempt.assessmentId);
        });
        return assessment && assessment.createdBy &&
          String(assessment.createdBy).trim().toLowerCase() === String(user.email).trim().toLowerCase();
      });
    },
    requestSoloClassReflection: function () {
      const assessmentId = requiredText_(trusted.assessmentId, 'ID asesmen', 100);
      assertAssessmentOwner_(assessmentId, user);
      return requestSoloClassReflection_(trusted);
    },
    requestSoloAiAssessment: function () {
      const attemptId = requiredText_(trusted.attemptId, 'ID pengerjaan', 100);
      const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
      if (!attempt) throw new Error('Pengerjaan tidak ditemukan.');
      assertAssessmentOwner_(attempt.assessmentId, user);
      return requestSoloAiAssessment_(trusted);
    },
    gradeAttempt: function () {
      const attemptId = requiredText_(trusted.attemptId, 'ID pengerjaan', 100);
      const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
      if (!attempt) throw new Error('Pengerjaan tidak ditemukan.');
      assertAssessmentOwner_(attempt.assessmentId, user);
      return gradeAttempt_(trusted);
    },
    saveSoloIndicatorVerification: function () {
      const attemptId = requiredText_(trusted.attemptId, 'ID pengerjaan', 100);
      const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
      if (!attempt) throw new Error('Pengerjaan tidak ditemukan.');
      assertAssessmentOwner_(attempt.assessmentId, user);
      return saveSoloIndicatorVerification_(trusted);
    },
    saveSoloDominantVerification: function () {
      const attemptId = requiredText_(trusted.attemptId, 'ID pengerjaan', 100);
      const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
      if (!attempt) throw new Error('Pengerjaan tidak ditemukan.');
      assertAssessmentOwner_(attempt.assessmentId, user);
      return saveSoloDominantVerification_(trusted);
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
    adminListPendingLearningAudits: function () { return adminListPendingLearningAudits_(); },
    adminReconcileLearningAudit: function () { return adminReconcileLearningAudit_(payload, user); },
    adminGetAiSettings: function () { return adminGetAiSettings_(); },
    adminSaveAiSettings: function () { return adminSaveAiSettings_(trusted); },
    adminTestAiConnection: function () { return adminTestAiConnection_(trusted); },
    adminListAiModels: function () { return adminListAiModels_(); },
    adminListAiUsage: function () { return adminListAiUsage_(); },
    adminListAiPrompts: function () { return adminListAiPrompts_(); },
    adminSaveAiPrompt: function () { return adminSaveAiPrompt_(trusted); },
    adminTestAiPrompt: function () { return adminTestAiPrompt_(trusted); },
    adminActivateAiPrompt: function () { return adminActivateAiPrompt_(trusted); },
    adminListLearningClassOptions: function () { return adminListLearningClassOptions_(); },
    adminListLearningSubjectOptions: function () { return adminListLearningSubjectOptions_(); },
    adminListLearningObjectives: function () { return adminListLearningObjectives_(); },
    adminSaveLearningObjective: function () { return adminSaveLearningObjective_(trusted); },
    adminSetLearningObjectiveActive: function () { return adminSetLearningObjectiveActive_(trusted); },
    adminListLearningIndicators: function () { return adminListLearningIndicators_(trusted); },
    adminSaveLearningIndicator: function () { return adminSaveLearningIndicator_(trusted); },
    adminSetLearningIndicatorActive: function () { return adminSetLearningIndicatorActive_(trusted); },
    listAvailableLearningObjectives: function () { return listAvailableLearningObjectives_(); },
    listAvailableLearningClassOptions: function () { return listAvailableLearningClassOptions_(); },
    listAvailableLearningSubjectOptions: function () { return listAvailableLearningSubjectOptions_(); },
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
  bundleEditorEnhancementsAssertReady_();
  const title = requiredText_(payload.title, 'Judul bundel', 180);
  requiredText_(payload.subject, 'Mata pelajaran', 120);
  requiredText_(payload.className, 'Kelas', 80);
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!questions.length || questions.length > 200) throw new Error('Jumlah soal bundel harus antara 1 dan 200.');
  const bundleId = String(payload.bundleId || payload.id || makeId_('BND'));
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
  const sheet = getSheet_('QuestionBundles'), values = sheet.getDataRange().getValues(), headers = values[0].map(String);
  const idCol = headers.indexOf('bundleId');
  let rowNumber = -1, existing = null;
  for (let i=1;i<values.length;i++) if (String(values[i][idCol])===bundleId) { rowNumber=i+1; existing=listRows_('QuestionBundles').find(function(b){return String(b.bundleId)===bundleId;}); break; }
  if (existing && String(existing.status).toLowerCase()==='archived') throw new Error('Bundel yang sudah diarsipkan tidak dapat diubah.');
  const classification=String(payload.classification || (existing && existing.classification) || 'REGULER').trim().toUpperCase();
  if (['REGULER','SOLO_TAX'].indexOf(classification)<0) throw new Error('Klasifikasi bundel harus REGULER atau SOLO_TAX.');
  if (classification === 'SOLO_TAX') questions.forEach(function(q,i){ validateSoloTaxQuestion_(q,i); });
  else questions.forEach(function(q,i){
    const type=String(q.type||'multiple_choice'),points=Number(q.points);
    if(['multiple_choice','true_false','true_false_multi','multi_select','matching','essay'].indexOf(type)<0)throw new Error('Tipe soal tidak valid pada soal nomor '+(i+1));
    if(!isFinite(points)||points<0||points>1000)throw new Error('Bobot nilai tidak valid pada soal nomor '+(i+1));
  });
  const now=currentTimestamp_();
  const snapshot={schemaVersion:1,bundleId:bundleId,classification:classification,title:title,subject:String(payload.subject||''),className:String(payload.className||''),description:String(payload.description||''),tpCode:String(payload.tpCode||'').trim().toUpperCase(),learningObjectiveId:String(payload.learningObjectiveId||'').trim(),learningIndicatorId:String(payload.learningIndicatorId||'').trim(),passageText:String(payload.passageText||''),passageImageUrl:String(payload.passageImageUrl||''),passages:Array.isArray(payload.passages)?payload.passages:[],questions:questions};
  validateBundleLearningReference_(snapshot);
  snapshotBundleLearningReferences_(snapshot);
  validateBundleSnapshot_(snapshot);
  const snapshotJson=JSON.stringify(snapshot);
  let latest=null;
  if(existing && existing.latestVersionId){
    const prior=listRows_('BundleVersions').find(function(v){return String(v.versionId)===String(existing.latestVersionId);});
    if(prior && String(prior.snapshotJson)===snapshotJson) latest={versionId:prior.versionId,versionNumber:Number(prior.versionNumber)};
  }
    if(!latest)latest=createBundleVersion_(bundleId,snapshot,String(payload.changeNote||(existing?'Perubahan isi bundel':'Versi awal')),String(payload.createdBy||(existing&&existing.createdBy)||''));
    const record={bundleId:bundleId,title:title,subject:snapshot.subject,className:snapshot.className,description:snapshot.description,tpCode:snapshot.tpCode,passageText:snapshot.passageText,passageImageUrl:snapshot.passageImageUrl,passagesJson:JSON.stringify(snapshot.passages),questionsJson:JSON.stringify(snapshot.questions),status:'ready',classification:classification,latestVersionId:String(latest.versionId),latestVersionNumber:Number(latest.versionNumber),visibility:String(payload.visibility||(existing&&existing.visibility)||'shared')==='private'?'private':'shared',createdBy:String(payload.createdBy||(existing&&existing.createdBy)||''),createdAt:existing?String(existing.createdAt||now):now,updatedAt:now,archivedAt:'',archivedBy:''};
    if(rowNumber>0)headers.forEach(function(h,col){if(Object.prototype.hasOwnProperty.call(record,h))sheet.getRange(rowNumber,col+1).setValue(record[h]);});
    else appendRow_('QuestionBundles',record);
    if(payload.draftId)deleteQuestionBundleDraftRows_(String(payload.draftId),String(payload.createdBy||''));
    return {bundleId:bundleId,title:title,questionCount:questions.length,status:'ready',classification:classification,versionId:String(latest.versionId),versionNumber:Number(latest.versionNumber)};
  } finally { lock.releaseLock(); }
}
function soloTaxLevelPoints_(level){
  const key=String(level||'').trim().toUpperCase().replace(/[ -]+/g,'_');
  const levels={MULTISTRUKTURAL:3,RELATIONAL:4,EXTENDED_ABSTRACT:5};
  return Object.prototype.hasOwnProperty.call(levels,key)?levels[key]:0;
}
function validateSoloTaxQuestion_(question,index){
  const q=question||{},number=index+1;
  if(String(q.type||'').toLowerCase()!=='essay')throw new Error('SOLO Tax hanya mendukung tipe soal uraian (soal nomor '+number+').');
  if(!String(q.text||'').trim())throw new Error('Pertanyaan utama wajib diisi pada soal SOLO Tax nomor '+number+'.');
  const maximum=soloTaxLevelPoints_(q.soloLevel);
  if(!maximum)throw new Error('Level SOLO soal nomor '+number+' harus Multistruktural, Relational, atau Extended Abstract.');
  if(Number(q.points)!==maximum)throw new Error('Nilai maksimal soal nomor '+number+' harus '+maximum+' sesuai level SOLO.');
  if(!Array.isArray(q.subquestions)||!q.subquestions.length||q.subquestions.some(function(x){return !String(x||'').trim();}))throw new Error('Setiap soal SOLO Tax harus memiliki minimal satu subpertanyaan yang terisi (soal nomor '+number+').');
  if(!String(q.answerGuide||'').trim())throw new Error('Panduan jawaban wajib diisi pada soal SOLO Tax nomor '+number+'.');
  if(!String(q.rubric||'').trim())throw new Error('Rubrik penilaian wajib diisi pada soal SOLO Tax nomor '+number+'.');
  if(!Array.isArray(q.learningIndicatorIds)||!q.learningIndicatorIds.length)throw new Error('Pilih minimal satu indikator TP untuk soal SOLO Tax nomor '+number+'.');
  const ids=q.learningIndicatorIds.map(function(id){return String(id||'').trim();});
  if(ids.some(function(id){return !id;})||ids.some(function(id,i){return ids.indexOf(id)!==i;}))throw new Error('Daftar indikator TP pada soal nomor '+number+' tidak valid.');
  if(!Array.isArray(q.rubricLevels)||!q.rubricLevels.length||q.rubricLevels.some(function(x){return !String(x||'').trim();}))throw new Error('Rubrik SOLO Tax harus memiliki deskripsi kriteria yang terisi pada soal nomor '+number+'.');
  return true;
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
  return {bundle:{bundleId:bundle.bundleId,title:snapshot.title,subject:snapshot.subject,className:String(snapshot.className||''),description:snapshot.description,tpCode:String(snapshot.tpCode||''),learningObjectiveId:String(snapshot.learningObjectiveId||''),learningIndicatorId:String(snapshot.learningIndicatorId||''),passageText:snapshot.passageText,passageImageUrl:snapshot.passageImageUrl,passages:snapshot.passages||[],status:bundle.status,visibility:String(bundle.visibility||'shared').toLowerCase(),isOwner:isOwner,classification:String(snapshot.classification||bundle.classification||'REGULER'),versionId:version?version.versionId:String(bundle.latestVersionId||''),versionNumber:version?version.versionNumber:Number(bundle.latestVersionNumber||0)},questions:snapshot.questions||[]};
}
function createAssessment_(payload) {
  const title=requiredText_(payload.title,'Judul',180);
  let questions=Array.isArray(payload.questions)?payload.questions:[];
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
    const bundlePassages=Array.isArray(sourceVersion.snapshot.passages)?sourceVersion.snapshot.passages:[];
    questions=(sourceVersion.snapshot.questions||[]).map(function(question){
      const copy=Object.assign({},question);
      const passage=bundlePassages.find(function(item){return String(item.id||'')===String(copy.passageId||'');});
      if(passage){copy.passageText=String(passage.text||'');copy.passageImageUrl=String(passage.imageUrl||'');}
      return copy;
    });
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
      appendRow_('Questions',{questionId:makeId_('Q'),assessmentId:assessmentId,order:index+1,type:type,text:String(question.text||''),points:points,optionsJson:JSON.stringify(question.options||[]),answerJson:JSON.stringify(classification==='SOLO_TAX'?{__soloTaxMeta:{soloLevel:String(question.soloLevel||''),learningIndicatorIds:question.learningIndicatorIds||[],learningIndicators:question.learningIndicators||[],answerGuide:String(question.answerGuide||''),learningObjectiveSnapshot:sourceVersion&&sourceVersion.snapshot.learningObjectiveSnapshot?sourceVersion.snapshot.learningObjectiveSnapshot:null}}:(question.answer===undefined?null:question.answer)),rubric:String(question.rubric||''),pairsJson:JSON.stringify(question.pairs||''),imageUrl:String(question.imageUrl||''),optionImagesJson:JSON.stringify(question.optionImages||[]),subquestionsJson:JSON.stringify(question.subquestions||[]),subquestionImagesJson:JSON.stringify(question.subquestionImages||[]),rubricLevelsJson:JSON.stringify(question.rubricLevels||[]),passageText:String(question.passageText||''),passageImageUrl:String(question.passageImageUrl||''),sourceBundleVersionId:sourceVersion?sourceVersion.versionId:'',sourceQuestionKey:sourceVersion?String(question.questionId||question.id||('Q-'+(index+1))):''});
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

  const canIncludeAnswers = payload.includeAnswers === true &&
    (user.role === 'admin' ||
      (user.role === 'teacher' &&
        String(assessment.createdBy || '').trim().toLowerCase() ===
          String(user.email || '').trim().toLowerCase()));

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
        answer: canIncludeAnswers ? parseJson_(question.answerJson, null) : undefined,
        soloMeta: canIncludeAnswers ? (function(){const stored=parseJson_(question.answerJson,null);return stored&&stored.__soloTaxMeta?stored.__soloTaxMeta:null;})() : undefined,
        soloLevel: canIncludeAnswers ? (function(){const stored=parseJson_(question.answerJson,null);return stored&&stored.__soloTaxMeta?stored.__soloTaxMeta.soloLevel:'';})() : undefined,
        learningIndicatorIds: canIncludeAnswers ? (function(){const stored=parseJson_(question.answerJson,null);return stored&&stored.__soloTaxMeta?stored.__soloTaxMeta.learningIndicatorIds||[]:[];})() : undefined,
        answerGuide: canIncludeAnswers ? (function(){const stored=parseJson_(question.answerJson,null);return stored&&stored.__soloTaxMeta?stored.__soloTaxMeta.answerGuide||'':'';})() : undefined,
        order: Number(question.order),
        type: question.type,
        text: question.text,
        points: String(assessment.classification || '').toUpperCase() === 'SOLO_TAX' && !canIncludeAnswers ? undefined : Number(question.points),
        options: parseJson_(question.optionsJson, []),
        rubric: canIncludeAnswers ? question.rubric : '',
        pairs: parseJson_(question.pairsJson, ''),
        imageUrl: question.imageUrl,
        optionImages: parseJson_(question.optionImagesJson, []),
        subquestions: parseJson_(question.subquestionsJson, []),
        subquestionImages: parseJson_(question.subquestionImagesJson, []),
        rubricLevels: canIncludeAnswers ? parseJson_(question.rubricLevelsJson, []) : [],
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
  const assessmentId = requiredText_(payload.id || payload.assessmentId, 'ID asesmen', 100);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_('Assessments');
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) throw new Error('Asesmen tidak ditemukan.');
    const headers = values[0].map(String);
    const idCol = headers.indexOf('assessmentId');
    const statusCol = headers.indexOf('status');
    const updatedCol = headers.indexOf('updatedAt');
    if (idCol < 0 || statusCol < 0) throw new Error('Kolom database asesmen tidak lengkap.');
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === assessmentId) { rowIndex = i; break; }
    }
    if (rowIndex < 0) throw new Error('Asesmen tidak ditemukan.');
    const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
    if (!assessment) throw new Error('Asesmen tidak ditemukan.');
    const status = String(assessment.status || '').toLowerCase();
    if (status === 'archived') throw new Error('Asesmen yang diarsipkan tidak dapat dipublikasikan.');
    if (status === 'published') return { id: assessmentId, status: 'published', alreadyPublished: true };
    if (!String(assessment.title || '').trim() || !String(assessment.className || '').trim()) {
      throw new Error('Judul dan kelas wajib diisi sebelum dipublikasikan.');
    }
    const duration = Number(assessment.duration);
    if (!isFinite(duration) || duration < 1 || duration > 300) throw new Error('Durasi asesmen harus antara 1 dan 300 menit.');
    if (assessment.startAt && !isFinite(new Date(assessment.startAt).getTime())) throw new Error('Waktu mulai asesmen tidak valid.');
    if (assessment.endAt && !isFinite(new Date(assessment.endAt).getTime())) throw new Error('Waktu selesai asesmen tidak valid.');
    if (assessment.startAt && assessment.endAt && new Date(assessment.endAt).getTime() <= new Date(assessment.startAt).getTime()) {
      throw new Error('Waktu selesai harus setelah waktu mulai.');
    }
    const questionCount = listRows_('Questions').filter(function (question) {
      return String(question.assessmentId) === assessmentId;
    }).length;
    if (questionCount < 1) throw new Error('Asesmen harus memiliki minimal satu soal sebelum dipublikasikan.');
    sheet.getRange(rowIndex + 1, statusCol + 1).setValue('published');
    if (updatedCol >= 0) sheet.getRange(rowIndex + 1, updatedCol + 1).setValue(currentTimestamp_());
    return { id: assessmentId, status: 'published', questionCount: questionCount };
  } finally {
    lock.releaseLock();
  }
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
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
    const previous = listRows_('Attempts').find(function (attempt) {
      return String(attempt.assessmentId) === assessmentId && String(attempt.studentId) === studentId;
    });
    if (previous) {
      if (String(previous.status) !== 'in_progress') throw new Error('Jawaban untuk asesmen ini sudah pernah dikirim.');
      assertStudentAssessmentIdentity_(assessment, user);
      const duration = Number(assessment.duration);
      const started = new Date(previous.startedAt).getTime();
      if (!isFinite(duration) || duration < 1 || !isFinite(started)) throw new Error('Waktu sesi tidak valid. Hubungi guru.');
      const expired = Date.now() > started + duration * 60000 + 30000;
      return { attemptId: String(previous.attemptId), startedAt: previous.startedAt, status: 'in_progress', duration: duration, resumed: true, expired: expired, answers: parseJson_(previous.answersJson, {}) };
    }
    assertStudentAssessmentAccess_(assessment, user);
    const duration = Number(assessment.duration);
    if (!isFinite(duration) || duration < 1 || duration > 300) throw new Error('Durasi asesmen tidak valid.');
    const questions = listRows_('Questions').filter(function (question) { return String(question.assessmentId) === assessmentId; });
    if (!questions.length) throw new Error('Asesmen belum memiliki soal dan tidak dapat dikerjakan.');
    const attemptId = makeId_('ATT'), startedAt = currentTimestamp_();
    const maxScore = questions.reduce(function (sum, question) { return sum + (Number(question.points) || 0); }, 0);
    appendRow_('Attempts', {
      attemptId: attemptId, assessmentId: assessmentId, studentId: studentId,
      startedAt: startedAt, submittedAt: '', status: 'in_progress', score: 0,
      maxScore: maxScore, focusLossCount: 0, answersJson: '{}', teacherFeedback: ''
    });
    return { attemptId: attemptId, startedAt: startedAt, status: 'in_progress', duration: duration, resumed: false, answers: {} };
  } finally {
    lock.releaseLock();
  }
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
    const currentAssessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
  assertStudentAssessmentIdentity_(currentAssessment, user);
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
    const started = new Date(row[col('startedAt')]).getTime(), durationMs = Number(currentAssessment.duration) * 60000;
    if (!isFinite(started) || !isFinite(durationMs) || durationMs <= 0 || Date.now() > started + durationMs + 30000) throw new Error('Waktu pengerjaan sudah habis.');
    const incomingAnswers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers) ? payload.answers : {};
    const questions = listRows_('Questions').filter(function (question) { return String(question.assessmentId) === assessmentId; });
    if (!questions.length) throw new Error('Asesmen tidak memiliki soal.');
    const allowed = {};
    questions.forEach(function (question) { allowed[String(question.questionId)] = true; });
    const filteredAnswers = {};
    Object.keys(incomingAnswers).forEach(function (questionId) { if (allowed[questionId]) filteredAnswers[questionId] = incomingAnswers[questionId]; });
    const answers = mergeUploadedAnswerPhotos_(attemptId, filteredAnswers, parseJson_(row[col('answersJson')], {}));
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
    const currentAssessment = listRows_('Assessments').find(function (item) {
      return String(item.assessmentId) === assessmentId;
    });
    if (!currentAssessment) throw new Error('Asesmen tidak ditemukan.');
    const previous = listRows_('Attempts').find(function (attempt) {
      return String(attempt.assessmentId) === assessmentId && String(attempt.studentId) === studentId;
    });
    if (previous && String(previous.status) !== 'in_progress') throw new Error('Jawaban untuk asesmen ini sudah pernah dikirim.');
    if (previous && previous.startedAt) {
      const started = new Date(previous.startedAt).getTime();
      const durationMs = Number(currentAssessment.duration) * 60000;
      if (!isFinite(started) || !isFinite(durationMs) || durationMs <= 0) throw new Error('Waktu sesi pengerjaan tidak valid.');
      const remainingMs = started + durationMs - Date.now();
      if (remainingMs > 8 * 60000) throw new Error('Pengumpulan jawaban hanya dapat dilakukan pada 8 menit terakhir. Silakan periksa jawaban kembali.');
      if (remainingMs < -30000 && payload.autoSubmitOnExpiry !== true) throw new Error('Waktu pengerjaan sudah habis. Jawaban tidak dapat dikirim terlambat.');
    }
  const submittedAnswers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers) ? payload.answers : {};
  const questions = listRows_('Questions').filter(function (question) {
    return String(question.assessmentId) === assessmentId;
  });
  if (!questions.length) throw new Error('Asesmen tidak memiliki soal.');
  const allowedQuestionIds = {};
  questions.forEach(function (question) { allowedQuestionIds[String(question.questionId)] = true; });
  const answers = {};
  Object.keys(submittedAnswers).forEach(function (questionId) {
    if (allowedQuestionIds[questionId]) answers[questionId] = submittedAnswers[questionId];
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
    assertStudentAssessmentIdentity_(currentAssessment, user);
  } else {
    assertStudentAssessmentAccess_(currentAssessment, user);
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
      const assessment = assessments.find(function (item) { return item.assessmentId === attempt.assessmentId; });
      const viewer = payload.currentUser;
      const canViewInternal = !!(viewer && viewer.role === 'teacher' && assessment &&
        String(assessment.createdBy || '').trim().toLowerCase() === String(viewer.email || '').trim().toLowerCase());
      const details = allQuestions
        .filter(function (question) { return question.assessmentId === attempt.assessmentId; })
        .sort(function (a, b) { return Number(a.order) - Number(b.order); })
        .map(function (question) {
          return {
            id: question.questionId,
            order: Number(question.order),
            type: question.type,
            text: question.text,
            points: assessment && String(assessment.classification || '').toUpperCase() === 'SOLO_TAX' && !canViewInternal ? undefined : Number(question.points) || 0,
            rubric: canViewInternal ? question.rubric : '',
            rubricLevels: canViewInternal ? parseJson_(question.rubricLevelsJson, []) : [],
            soloMeta: canViewInternal ? (function(){const stored=parseJson_(question.answerJson,null);return stored&&stored.__soloTaxMeta?stored.__soloTaxMeta:null;})() : undefined,
            soloLevel: canViewInternal ? (function(){const stored=parseJson_(question.answerJson,null);return stored&&stored.__soloTaxMeta?String(stored.__soloTaxMeta.soloLevel||''):'';})() : undefined,
            answerGuide: canViewInternal ? (function(){const stored=parseJson_(question.answerJson,null);return stored&&stored.__soloTaxMeta?String(stored.__soloTaxMeta.answerGuide||''):'';})() : undefined,
            subquestions: parseJson_(question.subquestionsJson, []),
            passageText: String(question.passageText || ''),
            passageImageUrl: String(question.passageImageUrl || ''),
            options: parseJson_(question.optionsJson, []),
            pairs: parseJson_(question.pairsJson, []),
            answer: canViewInternal ? parseJson_(question.answerJson, null) : undefined,
            imageUrl: question.imageUrl,
            optionImages: parseJson_(question.optionImagesJson, [])
          };
        });
      if (canViewInternal) {
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
        questionScores: assessment && String(assessment.classification || '').toUpperCase() === 'SOLO_TAX' && !canViewInternal ? {} : parseJson_(attempt.questionScoresJson, {}),
        questionDetails: details,
        assessmentClassification: assessment ? String(assessment.classification || 'REGULER') : 'REGULER',
        soloClassReflection: canViewInternal && assessment && String(assessment.classification || '').toUpperCase() === 'SOLO_TAX'
          ? (function () {
              const reflections = listRows_('Events').filter(function (event) {
                if (String(event.eventType) !== 'AI_SOLO_CLASS_REFLECTION') return false;
                const detail = parseJson_(event.detailsJson, {});
                return String(detail.assessmentId || '') === String(assessment.assessmentId);
              }).sort(function (a,b) { return String(a.eventAt).localeCompare(String(b.eventAt)); });
              return reflections.length ? parseJson_(reflections[reflections.length-1].detailsJson,{}) : null;
            })()
          : undefined,
        soloIndicators: canViewInternal && assessment && String(assessment.classification || '').toUpperCase() === 'SOLO_TAX'
          ? (function () {
              const mapped = {};
              details.forEach(function (question) {
                const meta = question.soloMeta || {};
                const snapshots = Array.isArray(meta.learningIndicators) ? meta.learningIndicators : [];
                const indicators = snapshots.length ? snapshots : (Array.isArray(meta.learningIndicatorIds) ? meta.learningIndicatorIds.map(function(id){return {indicatorId:id};}) : []);
                indicators.forEach(function (indicator) {
                  const id = String(indicator.indicatorId || '');
                  if (!id) return;
                  if (!mapped[id]) {
                    mapped[id] = {
                      indicatorId: id,
                      indicatorCode: String(indicator.indicatorCode || id),
                      description: String(indicator.description || 'Indikator tersimpan pada snapshot soal'),
                      questionIds: [],
                      questionOrders: []
                    };
                  }
                  if (mapped[id].questionIds.indexOf(String(question.id)) < 0) {
                    mapped[id].questionIds.push(String(question.id));
                    mapped[id].questionOrders.push(Number(question.order));
                  }
                });
              });
              return Object.keys(mapped).map(function (id) { return mapped[id]; });
            })()
          : undefined,
        soloReview: canViewInternal && assessment && String(assessment.classification || '').toUpperCase() === 'SOLO_TAX'
          ? (function () {
              const history = listRows_('Events').filter(function (event) {
                return String(event.attemptId) === String(attempt.attemptId) &&
                  String(event.eventType).indexOf('SOLO_INDICATOR_VERIFICATION') === 0;
              }).sort(function (a, b) { return String(a.eventAt).localeCompare(String(b.eventAt)); });
              const latest = history.length ? history[history.length - 1] : null;
              const details = latest ? parseJson_(latest.detailsJson, {}) : {};
              const aiHistory = listRows_('Events').filter(function (event) {
                return String(event.attemptId) === String(attempt.attemptId) && String(event.eventType) === 'AI_SOLO_SCORING_RECOMMENDATION';
              }).sort(function (a, b) { return String(a.eventAt).localeCompare(String(b.eventAt)); });
              const latestAi = aiHistory.length ? aiHistory[aiHistory.length - 1] : null;
              const aiDetails = latestAi ? parseJson_(latestAi.detailsJson, {}) : {};
              return {
                status: latest && latest.eventType === 'SOLO_INDICATOR_VERIFICATION' ? 'verified' : 'pending',
                results: latest && latest.eventType === 'SOLO_INDICATOR_VERIFICATION' && Array.isArray(details.results) ? details.results : [],
                recommendation: latestAi && aiDetails.dominantRecommendation ? aiDetails.dominantRecommendation : null,
                recommendationProvider: latestAi ? String(aiDetails.provider || '') : '',
                recommendationModel: latestAi ? String(aiDetails.model || '') : '',
                recommendationPromptVersion: latestAi ? String(aiDetails.promptVersion || '') : '',
                tpAchievement: latest && latest.eventType === 'SOLO_INDICATOR_VERIFICATION' && details.tpAchievement ? details.tpAchievement : null,
                verifiedAt: latest && latest.eventType === 'SOLO_INDICATOR_VERIFICATION' ? String(latest.eventAt || '') : '',
                verifiedBy: latest && latest.eventType === 'SOLO_INDICATOR_VERIFICATION' ? String(details.verifiedBy || '') : '',
                history: history.map(function (event) {
                  const detail = parseJson_(event.detailsJson, {});
                  return { eventType: String(event.eventType), eventAt: String(event.eventAt || ''), verifiedBy: String(detail.verifiedBy || ''), reason: String(detail.reason || '') };
                }),
                dominant: (function () {
                  const dominantEvents = listRows_('Events').filter(function (event) {
                    return String(event.attemptId) === String(attempt.attemptId) &&
                      String(event.eventType).indexOf('SOLO_DOMINANT_LEVEL_') === 0;
                  }).sort(function (a, b) { return String(a.eventAt).localeCompare(String(b.eventAt)); });
                  const latestDominant = dominantEvents.length ? dominantEvents[dominantEvents.length - 1] : null;
                  const detail = latestDominant ? parseJson_(latestDominant.detailsJson, {}) : {};
                  const currentIndicator = history.length ? history[history.length - 1] : null;
                  const isCurrent = latestDominant && latestDominant.eventType === 'SOLO_DOMINANT_LEVEL_VERIFICATION' &&
                    currentIndicator && currentIndicator.eventType === 'SOLO_INDICATOR_VERIFICATION' &&
                    String(latestDominant.eventAt) >= String(currentIndicator.eventAt) &&
                    (!latestAi || String(latestDominant.eventAt) >= String(latestAi.eventAt));
                  return {
                    status: isCurrent ? 'verified' : 'pending',
                    aiLevel: isCurrent ? String(detail.aiLevel || '') : '',
                    teacherLevel: isCurrent ? String(detail.teacherLevel || '') : '',
                    aiEvidenceSummary: isCurrent ? String(detail.aiEvidenceSummary || '') : '',
                    teacherReason: isCurrent ? String(detail.teacherReason || '') : '',
                    verifiedAt: isCurrent ? String(latestDominant.eventAt || '') : '',
                    verifiedBy: isCurrent ? String(detail.verifiedBy || '') : '',
                    aiProvider: isCurrent ? String(detail.aiProvider || '') : '',
                    aiModel: isCurrent ? String(detail.aiModel || '') : '',
                    promptVersion: isCurrent ? String(detail.promptVersion || '') : '',
                    questionEvidence: isCurrent && Array.isArray(detail.questionEvidence) ? detail.questionEvidence : []
                  };
                })()
              };
            })()
          : undefined,
        soloAiAssessment: canViewInternal && assessment && String(assessment.classification || '').toUpperCase() === 'SOLO_TAX'
          ? (function () {
              const events = listRows_('Events').filter(function (event) {
                return String(event.attemptId) === String(attempt.attemptId) &&
                  String(event.eventType) === 'AI_SOLO_SCORING_RECOMMENDATION';
              }).sort(function (a, b) { return String(a.eventAt).localeCompare(String(b.eventAt)); });
              if (!events.length) return null;
              const latest = events[events.length - 1];
              const detail = parseJson_(latest.detailsJson, {});
              return {
                promptId: String(detail.promptId || ''),
                promptVersion: Number(detail.promptVersion) || 0,
                provider: String(detail.provider || ''),
                dominantRecommendation: detail.dominantRecommendation && typeof detail.dominantRecommendation === 'object' ? detail.dominantRecommendation : null,
                model: String(detail.model || ''),
                requestedBy: String(detail.requestedBy || ''),
                eventAt: String(latest.eventAt || ''),
                usage: detail.usage || {},
                results: Array.isArray(detail.results) ? detail.results : []
              };
            })()
          : undefined
      });
    });
}

/**
 * Menyimpan nilai akhir dan umpan balik dari guru.
 */
function gradeAttempt_(payload) {
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const questionScores = payload.questionScores;
  if (!questionScores || typeof questionScores !== 'object' || Array.isArray(questionScores)) {
    throw new Error('Skor setiap soal wajib diisi sebelum penilaian disimpan.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const attempt = listRows_('Attempts').find(function (item) {
      return String(item.attemptId) === attemptId;
    });
    if (!attempt) throw new Error('Pengerjaan tidak ditemukan.');
    const status = String(attempt.status || '').toLowerCase();
    if (status !== 'needs_review' && status !== 'graded') {
      throw new Error('Pengerjaan yang masih berlangsung atau belum dikirim tidak dapat dinilai.');
    }

    const questions = listRows_('Questions').filter(function (q) {
      return String(q.assessmentId) === String(attempt.assessmentId);
    });
    if (!questions.length) throw new Error('Soal asesmen tidak ditemukan.');
    const assessment = listRows_('Assessments').find(function(item){return String(item.assessmentId)===String(attempt.assessmentId);});
    const isSoloTax = assessment && String(assessment.classification || '').toUpperCase() === 'SOLO_TAX';
    const submittedAnswers = parseJson_(attempt.answersJson, {});

    const scoreKeys = Object.keys(questionScores);
    if (scoreKeys.length !== questions.length) {
      throw new Error('Skor harus diisi tepat untuk seluruh soal dalam asesmen.');
    }

    const savedScores = {};
    let score = 0;
    let maxScore = 0;
    const seenQuestionIds = {};
    questions.forEach(function (q) {
      const questionId = String(q.questionId || '');
      if (!questionId || seenQuestionIds[questionId]) {
        throw new Error('Daftar soal asesmen tidak valid.');
      }
      seenQuestionIds[questionId] = true;

      const maximum = Number(q.points);
      const rawValue = questionScores[questionId];
      const value = Number(rawValue);
      if (!Object.prototype.hasOwnProperty.call(questionScores, questionId) ||
          rawValue === null || rawValue === undefined ||
          (typeof rawValue === 'string' && rawValue.trim() === '') ||
          typeof rawValue === 'boolean' ||
          !isFinite(maximum) || maximum < 0 ||
          !isFinite(value) || value < 0 || value > maximum) {
        throw new Error('Skor soal nomor ' + q.order + ' tidak valid. Nilai harus antara 0 dan ' + maximum + '.');
      }
      if (isSoloTax && String(q.type) === 'essay') {
        const response = submittedAnswers[questionId];
        let hasResponse = false;
        if (typeof response === 'string') hasResponse = !!response.trim();
        else if (response && typeof response === 'object' && !Array.isArray(response)) {
          hasResponse = Object.keys(response).some(function(key){
            if (key === 'photos') return false;
            const item = response[key];
            return item !== null && item !== undefined && String(item).trim() !== '';
          }) || (Array.isArray(response.photos) && response.photos.length > 0);
        }
        if (!hasResponse && value !== 0) throw new Error('Soal SOLO Tax tanpa jawaban harus memperoleh nilai 0 (soal nomor ' + q.order + ').');
        if (hasResponse && value < 1) throw new Error('Jawaban SOLO Tax yang dikumpulkan harus memperoleh minimal 1 poin (soal nomor ' + q.order + ').');
      }
      savedScores[questionId] = value;
      score += value;
      maxScore += maximum;
    });

    if (scoreKeys.some(function (key) { return !seenQuestionIds[key]; })) {
      throw new Error('Terdapat skor untuk soal yang bukan bagian dari asesmen ini.');
    }

    const sheet = getSheet_('Attempts');
    const values = sheet.getDataRange().getValues();
    if (!values.length) throw new Error('Struktur data pengerjaan tidak valid.');
    const headers = values[0].map(String);
    const requiredColumns = ['attemptId', 'score', 'maxScore', 'status', 'teacherFeedback', 'questionScoresJson'];
    const columnIndex = function (name) { return headers.indexOf(name); };
    requiredColumns.forEach(function (name) {
      if (columnIndex(name) < 0) throw new Error('Kolom ' + name + ' tidak ditemukan pada data pengerjaan.');
    });

    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      if (String(values[rowIndex][columnIndex('attemptId')]) === attemptId) {
        sheet.getRange(rowIndex + 1, columnIndex('score') + 1).setValue(score);
        sheet.getRange(rowIndex + 1, columnIndex('maxScore') + 1).setValue(maxScore);
        sheet.getRange(rowIndex + 1, columnIndex('status') + 1).setValue('graded');
        sheet.getRange(rowIndex + 1, columnIndex('teacherFeedback') + 1)
          .setValue(String(payload.feedback || ''));
        sheet.getRange(rowIndex + 1, columnIndex('questionScoresJson') + 1)
          .setValue(JSON.stringify(savedScores));
        if (isSoloTax) {
          appendRow_('Events', {
            eventId: makeId_('EVT'), attemptId: attemptId, studentId: String(attempt.studentId || ''),
            eventType: 'SOLO_INDICATOR_VERIFICATION_INVALIDATED', eventAt: currentTimestamp_(),
            detailsJson: JSON.stringify({ reason: 'Nilai soal berubah; verifikasi indikator perlu diperiksa ulang.' })
          });
          appendRow_('Events', {
            eventId: makeId_('EVT'), attemptId: attemptId, studentId: String(attempt.studentId || ''),
            eventType: 'SOLO_DOMINANT_LEVEL_INVALIDATED', eventAt: currentTimestamp_(),
            detailsJson: JSON.stringify({ reason: 'Nilai soal berubah; level SOLO dominan perlu ditinjau ulang.' })
          });
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
  } finally {
    lock.releaseLock();
  }
}
/**
 * Menyimpan verifikasi guru untuk seluruh indikator SOLO Tax pada satu pengerjaan.
 * Riwayat disimpan sebagai event append-only agar struktur spreadsheet tetap.
 */

function requestSoloAiAssessment_(payload) {
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const settings = aiSettings_();
  if (!settings.scoringEnabled) throw new Error('AI Penilaian belum diaktifkan oleh Admin.');
  const prompt = aiPrompts_().filter(function (item) {
    return item.service === 'SCORING' && item.active === true;
  }).sort(function (a, b) { return Number(b.version) - Number(a.version); })[0];
  if (!prompt) throw new Error('Belum ada prompt AI Penilaian aktif.');
  const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
  if (!attempt || ['needs_review', 'graded'].indexOf(String(attempt.status || '').toLowerCase()) < 0) {
    throw new Error('AI Penilaian hanya dapat diminta untuk jawaban yang sudah dikirim.');
  }
  const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === String(attempt.assessmentId); });
  if (!assessment || String(assessment.classification || '').toUpperCase() !== 'SOLO_TAX') {
    throw new Error('AI Penilaian SOLO hanya berlaku untuk Asesmen SOLO Tax.');
  }
  const questions = listRows_('Questions').filter(function (item) {
    return String(item.assessmentId) === String(attempt.assessmentId);
  }).sort(function (a, b) { return Number(a.order) - Number(b.order); });
  if (!questions.length || questions.some(function (q) { return String(q.type) !== 'essay'; })) {
    throw new Error('Struktur soal asesmen SOLO Tax tidak valid.');
  }
  const answers = parseJson_(attempt.answersJson, {});
  const questionInputs = [], deterministic = [];
  questions.forEach(function (question) {
    const answer = answers[String(question.questionId)] || {};
    const photos = answer && Array.isArray(answer.photos) ? answer.photos : [];
    const subquestions = parseJson_(question.subquestionsJson, []);
    const textResponses = [];
    if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
      Object.keys(answer).forEach(function (key) {
        if (key === 'photos' || key === 'text') return;
        const value = String(answer[key] == null ? '' : answer[key]).trim();
        if (value && /^\d+$/.test(key)) {
          textResponses.push({ subquestionIndex: Number(key) + 1, prompt: String(subquestions[Number(key)] || ''), answer: value });
        }
      });
      if (String(answer.text || '').trim()) textResponses.push({ subquestionIndex: 1, prompt: '', answer: String(answer.text).trim() });
    } else if (typeof answer === 'string' && answer.trim()) {
      textResponses.push({ subquestionIndex: 1, prompt: '', answer: answer.trim() });
    }
    const meta = parseJson_(question.answerJson, {}) || {};
    const soloMeta = meta.__soloTaxMeta || {};
    const indicators = Array.isArray(soloMeta.learningIndicators) ? soloMeta.learningIndicators : [];
    if (!textResponses.length && !photos.length) {
      deterministic.push({
        questionId: String(question.questionId), order: Number(question.order),
        recommendedScore: 0, maximumScore: Number(question.points),
        reason: 'Tidak ada jawaban teks maupun foto yang dikumpulkan.',
        evidence: [], evidenceSufficient: true, manualPhotoReviewRequired: false,
        indicatorAnalysis: indicators.map(function (indicator) {
          return { indicatorId: String(indicator.indicatorId), status: 'insufficient_evidence', evidence: 'Tidak ada jawaban yang dapat dijadikan bukti.' };
        })
      });
      return;
    }
    if (!textResponses.length && photos.length) {
      deterministic.push({
        questionId: String(question.questionId), order: Number(question.order),
        recommendedScore: null, maximumScore: Number(question.points),
        reason: 'Jawaban hanya berupa foto. Foto tidak dikirim ke AI dan wajib diperiksa manual oleh guru.',
        evidence: [], evidenceSufficient: false, manualPhotoReviewRequired: true,
        indicatorAnalysis: indicators.map(function (indicator) {
          return { indicatorId: String(indicator.indicatorId), status: 'insufficient_evidence', evidence: 'Bukti berupa foto harus diperiksa langsung oleh guru.' };
        })
      });
      return;
    }
    questionInputs.push({
      questionId: String(question.questionId),
      order: Number(question.order),
      mainQuestion: String(question.text || ''),
      soloLevel: String(soloMeta.soloLevel || ''),
      maximumScore: Number(question.points),
      subquestions: subquestions,
      textResponses: textResponses,
      hasPhotoAttachment: photos.length > 0,
      answerGuide: String(soloMeta.answerGuide || ''),
      rubric: String(question.rubric || ''),
      rubricLevels: parseJson_(question.rubricLevelsJson, []),
      indicators: indicators.map(function (indicator) {
        return { indicatorId: String(indicator.indicatorId), indicatorCode: String(indicator.indicatorCode || ''), description: String(indicator.description || '') };
      })
    });
  });
  let aiResults = [], dominantRecommendation = null, usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model = '';
  if (questionInputs.length) {
    const systemPrompt = prompt.content + '\n\nATURAN WAJIB OUTPUT: Kembalikan JSON valid saja tanpa markdown dengan bentuk {"questions":[{"questionId":"...","recommendedScore":1,"evidenceSufficient":true,"reason":"...","evidence":["kutipan/parafrasa bukti jawaban"],"indicatorAnalysis":[{"indicatorId":"...","status":"mastered|developing|needs_improvement|insufficient_evidence","evidence":"alasan berbasis jawaban"}]}],"dominantLevel":{"level":"PRESTRUCTURAL|UNISTRUCTURAL|MULTISTRUKTURAL|RELATIONAL|EXTENDED_ABSTRACT","evidenceSummary":"ringkasan bukti kualitatif lintas jawaban","questionEvidence":[{"questionId":"...","evidence":"bukti spesifik dari jawaban pada soal ini"}]}}. Nilai rekomendasi per soal harus berada pada rentang 1 sampai nilai maksimal jika jawaban teks ada dan bukti cukup. Jika bukti tidak cukup, recommendedScore harus null dan evidenceSufficient false. Jangan memberi skor 0 untuk jawaban yang berisi teks. Jangan mengarang bukti. Analisis setiap indikator yang tercantum. Foto tidak disertakan dalam data; jika hasPhotoAttachment true, tandai bahwa guru harus memeriksa foto secara manual. Rekomendasi level dominan harus berdasarkan pola kualitas berpikir secara holistik dari bukti kualitatif seluruh soal yang diberikan, bukan dari skor, persentase, atau perhitungan ambang. questionEvidence harus mencakup setiap questionId yang dianalisis tepat satu kali. Jika bukti kualitatif tidak cukup, dominantLevel harus null. Jangan membuat nilai persentase indikator atau TP.';
    try {
      const response = tokenPortalChatCompletion_([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Nilai data jawaban anonim berikut. Tidak ada identitas siswa. Data: ' + JSON.stringify({ questions: questionInputs }) }
      ], settings.model, settings.maxOutputTokens);
      model = response.model;
      usage = response.usage;
      let parsed;
      try {
        let clean = String(response.content || '').trim()
          .replace(/^\s*```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/, '').trim();
        // Beberapa model menambahkan kalimat pembuka/penutup di luar JSON.
        // Ambil objek JSON terluar sebelum parsing; jangan mengubah isi JSON.
        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) clean = clean.slice(firstBrace, lastBrace + 1);
        parsed = JSON.parse(clean);
      } catch (error) {
        const finish = String(response.finishReason || 'tidak tersedia');
        const tail = String(response.content || '').slice(-180).replace(/\s+/g, ' ');
        throw new Error('Format jawaban AI tidak valid (finish_reason: ' + finish + '). ' +
          'Kemungkinan keluaran terpotong atau model menambahkan format yang tidak sesuai. ' +
          'Akhir respons: ' + tail);
      }
      if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length !== questionInputs.length) {
        throw new Error('Hasil AI tidak mencakup seluruh soal uraian yang dapat dianalisis.');
      }
      const byQuestion = {};
      questionInputs.forEach(function (item) { byQuestion[item.questionId] = item; });
      const seen = {};
      aiResults = parsed.questions.map(function (item) {
        const id = String(item.questionId || '');
        const input = byQuestion[id];
        if (!input || seen[id]) throw new Error('Hasil AI memuat ID soal yang tidak valid atau berulang.');
        seen[id] = true;
        const enough = item.evidenceSufficient === true;
        const reason = String(item.reason || '').trim();
        if (!reason) throw new Error('AI harus menjelaskan alasan rekomendasi pada soal nomor ' + input.order + '.');
        const score = item.recommendedScore === null || item.recommendedScore === undefined ? null : Number(item.recommendedScore);
        if (enough && (!isFinite(score) || score < 1 || score > Number(input.maximumScore))) {
          throw new Error('Rekomendasi nilai AI di luar rentang untuk soal nomor ' + input.order + '.');
        }
        if (!enough && score !== null) throw new Error('AI harus mengosongkan rekomendasi nilai jika bukti tidak mencukupi.');
        const evidence = Array.isArray(item.evidence) ? item.evidence.map(function (value) { return String(value || '').trim(); }).filter(Boolean) : [];
        if (enough && !evidence.length) throw new Error('AI harus menyertakan bukti jawaban untuk setiap rekomendasi nilai.');
        const expectedIndicators = input.indicators.map(function (indicator) { return indicator.indicatorId; }).sort();
        const indicatorResults = Array.isArray(item.indicatorAnalysis) ? item.indicatorAnalysis : [];
        const receivedIndicators = indicatorResults.map(function (indicator) { return String(indicator.indicatorId || ''); }).sort();
        if (expectedIndicators.length !== receivedIndicators.length || expectedIndicators.some(function (id, index) { return id !== receivedIndicators[index]; })) {
          throw new Error('Analisis AI harus mencakup setiap indikator pada soal nomor ' + input.order + '.');
        }
        const statuses = ['mastered', 'developing', 'needs_improvement', 'insufficient_evidence'];
        const normalizedIndicators = indicatorResults.map(function (indicator) {
          const status = String(indicator.status || '');
          const indicatorEvidence = String(indicator.evidence || '').trim();
          if (statuses.indexOf(status) < 0 || !indicatorEvidence) throw new Error('Analisis indikator AI tidak valid atau tanpa bukti.');
          return { indicatorId: String(indicator.indicatorId), status: status, evidence: indicatorEvidence };
        });
        return {
          questionId: id, order: input.order,
          recommendedScore: enough ? score : null, maximumScore: Number(input.maximumScore),
          reason: reason.slice(0, 2000),
          evidence: evidence.slice(0, 20),
          evidenceSufficient: enough,
          manualPhotoReviewRequired: input.hasPhotoAttachment,
          indicatorAnalysis: normalizedIndicators
        };
      });
      if (!deterministic.length) {
        const dominant = parsed.dominantLevel;
        if (dominant !== null) {
          if (!dominant || typeof dominant !== 'object' || Array.isArray(dominant)) {
            throw new Error('Rekomendasi level SOLO dominan AI tidak valid.');
          }
          const allowedLevels = ['PRESTRUCTURAL', 'UNISTRUCTURAL', 'MULTISTRUKTURAL', 'RELATIONAL', 'EXTENDED_ABSTRACT'];
          const level = String(dominant.level || '').trim().toUpperCase().replace(/[ -]+/g, '_');
          const evidenceSummary = String(dominant.evidenceSummary || '').trim();
          const questionEvidence = Array.isArray(dominant.questionEvidence) ? dominant.questionEvidence : [];
          const expectedIds = questionInputs.map(function (item) { return item.questionId; }).sort();
          const receivedIds = questionEvidence.map(function (item) { return String(item && item.questionId || ''); }).sort();
          if (allowedLevels.indexOf(level) < 0 || !evidenceSummary || evidenceSummary.length > 5000 ||
              questionEvidence.length !== expectedIds.length ||
              expectedIds.some(function (id, index) { return id !== receivedIds[index]; })) {
            throw new Error('Rekomendasi level dominan harus memuat level dan bukti dari setiap soal yang dianalisis.');
          }
          dominantRecommendation = {
            level: level,
            evidenceSummary: evidenceSummary,
            questionEvidence: questionEvidence.map(function (item) {
              const evidence = String(item.evidence || '').trim();
              if (!evidence || evidence.length > 3000) throw new Error('Bukti level dominan pada setiap soal wajib diisi.');
              return { questionId: String(item.questionId), evidence: evidence };
            })
          };
        }
      }
    } catch (error) {
      logAiUsage_('AI_SOLO_SCORING_FAILED', {
        provider: 'TOKENPORTAL', model: settings.model, promptId: prompt.promptId,
        promptVersion: prompt.version, status: 'failed', usage: usage,
        error: String(error && error.message || error).slice(0, 500)
      });
      throw error;
    }
  }
  const results = deterministic.concat(aiResults).sort(function (a, b) { return a.order - b.order; });
  const now = currentTimestamp_();
  const record = {
    version: 1, assessmentId: String(attempt.assessmentId), promptId: prompt.promptId,
    promptVersion: Number(prompt.version), provider: 'TOKENPORTAL', model: model || settings.model,
    usage: usage, requestedBy: String(payload.currentUser && payload.currentUser.email || ''),
    analyzedQuestionIds: questionInputs.map(function (item) { return item.questionId; }).sort(),
    dominantRecommendation: dominantRecommendation,
    results: results
  };
  appendRow_('Events', {
    eventId: makeId_('EVT'), attemptId: attemptId, studentId: String(attempt.studentId || ''),
    eventType: 'AI_SOLO_SCORING_RECOMMENDATION', eventAt: now,
    detailsJson: JSON.stringify(record)
  });
  return { attemptId: attemptId, status: 'completed', promptId: prompt.promptId, promptVersion: prompt.version, provider: 'TOKENPORTAL', model: record.model, usage: usage, dominantRecommendation: dominantRecommendation, results: results };
}

function soloAchievementCategory_(percentage) {
  const value = Number(percentage);
  if (!isFinite(value) || value < 0 || value > 100) throw new Error('Persentase ketercapaian harus berada pada rentang 0–100%.');
  if (value > 85) return 'exceeds';
  if (value >= 70) return 'achieved';
  return 'not_achieved';
}

function saveSoloIndicatorVerification_(payload) {
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const submitted = payload.results;
  if (!Array.isArray(submitted) || !submitted.length) throw new Error('Verifikasi indikator belum diisi.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
    if (!attempt || String(attempt.status || '').toLowerCase() !== 'graded') {
      throw new Error('Penilaian seluruh soal harus selesai sebelum indikator diverifikasi.');
    }
    const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === String(attempt.assessmentId); });
    if (!assessment || String(assessment.classification || '').toUpperCase() !== 'SOLO_TAX') {
      throw new Error('Verifikasi indikator hanya berlaku untuk Asesmen SOLO Tax.');
    }
    const questions = listRows_('Questions').filter(function (item) { return String(item.assessmentId) === String(attempt.assessmentId); });
    const mapped = {};
    questions.forEach(function (question) {
      const meta = parseJson_(question.answerJson, {}) || {};
      const solo = meta.__soloTaxMeta || {};
      const indicators = Array.isArray(solo.learningIndicators) && solo.learningIndicators.length
        ? solo.learningIndicators
        : (Array.isArray(solo.learningIndicatorIds) ? solo.learningIndicatorIds.map(function(id){return {indicatorId:id};}) : []);
      indicators.forEach(function (indicator) {
        const key = String(indicator.indicatorId || '');
        if (!key) return;
        if (!mapped[key]) mapped[key] = [];
        if (mapped[key].indexOf(String(question.questionId)) < 0) mapped[key].push(String(question.questionId));
      });
    });
    const expectedIds = Object.keys(mapped).sort();
    const receivedIds = submitted.map(function (item) { return String(item && item.indicatorId || ''); }).sort();
    if (!expectedIds.length) throw new Error('Asesmen ini belum memiliki indikator TP yang terhubung dengan soal.');
    if (receivedIds.length !== expectedIds.length || receivedIds.some(function (id, index) { return id !== expectedIds[index]; })) {
      throw new Error('Verifikasi harus mencakup setiap indikator yang terhubung dengan soal, tepat satu kali.');
    }
    const results = submitted.map(function (item) {
      const id = String(item.indicatorId);
      const rawPercentage = item.percentage;
      if (rawPercentage === '' || rawPercentage === null || rawPercentage === undefined) {
        throw new Error('Persentase ketercapaian setiap indikator wajib diisi.');
      }
      const percentage = Number(rawPercentage);
      if (!isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw new Error('Persentase ketercapaian harus berupa angka 0–100%.');
      }
      const evidence = String(item.evidence || '').trim();
      if (!evidence || evidence.length > 3000) throw new Error('Bukti atau alasan verifikasi wajib diisi (maksimal 3.000 karakter).');
      return {
        indicatorId: id, percentage: percentage,
        category: soloAchievementCategory_(percentage),
        evidence: evidence, questionIds: mapped[id].slice()
      };
    });
    const averagePercentage = results.reduce(function (sum, item) { return sum + item.percentage; }, 0) / results.length;
    const roundedAveragePercentage = Math.round(averagePercentage * 100) / 100;
    const tpAchievement = {
      averagePercentage: roundedAveragePercentage,
      category: soloAchievementCategory_(roundedAveragePercentage),
      indicatorCount: results.length,
      weighting: 'EQUAL'
    };
    const now = currentTimestamp_();
    const user = payload.currentUser || {};
    appendRow_('Events', {
      eventId: makeId_('EVT'), attemptId: attemptId, studentId: String(attempt.studentId || ''),
      eventType: 'SOLO_INDICATOR_VERIFICATION', eventAt: now,
      detailsJson: JSON.stringify({ version: 2, assessmentId: String(attempt.assessmentId), verifiedBy: String(user.email || ''), results: results, tpAchievement: tpAchievement })
    });
    appendRow_('Events', {
      eventId: makeId_('EVT'), attemptId: attemptId, studentId: String(attempt.studentId || ''),
      eventType: 'SOLO_DOMINANT_LEVEL_INVALIDATED', eventAt: now,
      detailsJson: JSON.stringify({ reason: 'Verifikasi indikator berubah; rekomendasi level dominan perlu ditinjau ulang.' })
    });
    return { attemptId: attemptId, status: 'verified', verifiedAt: now, indicatorCount: results.length, tpAchievement: tpAchievement };
  } finally {
    lock.releaseLock();
  }
}
function aiScriptProperties_() {
  return PropertiesService.getScriptProperties();
}
function aiSettings_() {
  const raw = aiScriptProperties_().getProperty(RUMBLE_AI_SETTINGS_KEY_);
  let saved = {};
  try { saved = raw ? JSON.parse(raw) : {}; } catch (error) { saved = {}; }
  return {
    provider: 'TOKENPORTAL',
    model: String(saved.model || ''),
    scoringEnabled: saved.scoringEnabled === true,
    reflectionEnabled: saved.reflectionEnabled === true,
    dailyTokenLimit: Math.max(0, Number(saved.dailyTokenLimit) || 0),
    maxOutputTokens: Math.max(128, Math.min(8000, Number(saved.maxOutputTokens) || 1600)),
    updatedAt: String(saved.updatedAt || ''),
    updatedBy: String(saved.updatedBy || '')
  };
}
function adminGetAiSettings_() {
  const settings = aiSettings_();
  settings.hasApiKey = !!aiScriptProperties_().getProperty(RUMBLE_AI_API_KEY_);
  return settings;
}
function adminSaveAiSettings_(payload) {
  const model = requiredText_(payload.model, 'Model AI', 120);
  const dailyTokenLimit = Number(payload.dailyTokenLimit);
  const maxOutputTokens = Number(payload.maxOutputTokens);
  if (!isFinite(dailyTokenLimit) || dailyTokenLimit < 0 || dailyTokenLimit > 100000000) {
    throw new Error('Batas token harian harus berupa angka 0 sampai 100.000.000. Isi 0 jika tidak dibatasi.');
  }
  if (!isFinite(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 8000) {
    throw new Error('Batas token keluaran per permintaan harus 128 sampai 8.000.');
  }
  const properties = aiScriptProperties_();
  const key = String(payload.apiKey || '').trim();
  if (key && !/^tp-[A-Za-z0-9_-]{12,}$/.test(key)) throw new Error('Format API key TokenPortal tidak sesuai.');
  if (key && payload.clearApiKey === true) throw new Error('Pilih untuk menyimpan API key baru atau menghapus API key lama, bukan keduanya.');
  const activePrompts = aiPrompts_();
  const scoringPromptReady = activePrompts.some(function (item) { return item.service === 'SCORING' && item.active === true && !!item.testedAt; });
  const reflectionPromptReady = activePrompts.some(function (item) { return item.service === 'REFLECTION' && item.active === true && !!item.testedAt; });
  // Simpan kredensial dan konfigurasi provider terlebih dahulu agar Admin dapat
  // menguji koneksi serta prompt sebelum mengaktifkan layanan AI.
  if (key) properties.setProperty(RUMBLE_AI_API_KEY_, key);
  if (payload.clearApiKey === true) properties.deleteProperty(RUMBLE_AI_API_KEY_);
  const current = aiSettings_();
  const promptWarnings = [];
  if (payload.scoringEnabled === true && !scoringPromptReady) promptWarnings.push('AI Penilaian tetap nonaktif sampai prompt Penilaian lulus uji simulasi dan diaktifkan.');
  if (payload.reflectionEnabled === true && !reflectionPromptReady) promptWarnings.push('AI Refleksi tetap nonaktif sampai prompt Refleksi lulus uji simulasi dan diaktifkan.');
  const saved = {
    model: model,
    scoringEnabled: payload.scoringEnabled === true && scoringPromptReady,
    reflectionEnabled: payload.reflectionEnabled === true && reflectionPromptReady,
    dailyTokenLimit: Math.floor(dailyTokenLimit),
    maxOutputTokens: Math.floor(maxOutputTokens),
    updatedAt: currentTimestamp_(),
    updatedBy: String(payload.currentUser && payload.currentUser.email || '')
  };
  properties.setProperty(RUMBLE_AI_SETTINGS_KEY_, JSON.stringify(saved));
  return Object.assign(adminGetAiSettings_(), { promptWarnings: promptWarnings });
}

function aiTokensUsedToday_() {
  const timezone = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  return listRows_('Events').filter(function (event) {
    return String(event.eventType || '').indexOf('AI_') === 0 &&
      Utilities.formatDate(new Date(event.eventAt), timezone, 'yyyy-MM-dd') === today;
  }).reduce(function (total, event) {
    const details = parseJson_(event.detailsJson, {});
    return total + (Number(details.usage && details.usage.totalTokens) || 0);
  }, 0);
}

function tokenPortalChatCompletion_(messages, model, maxTokens) {
  const properties = aiScriptProperties_();
  const apiKey = properties.getProperty(RUMBLE_AI_API_KEY_);
  if (!apiKey) throw new Error('API key TokenPortal belum dikonfigurasi oleh Admin.');
  const settings = aiSettings_();
  const selectedModel = requiredText_(model || settings.model, 'Model AI', 120);
  let outputLimit = Math.max(128, Math.min(8000, Number(maxTokens) || settings.maxOutputTokens));
  if (settings.dailyTokenLimit > 0) {
    const remaining = settings.dailyTokenLimit - aiTokensUsedToday_();
    if (remaining < 128) throw new Error('Batas token AI harian telah tercapai. Coba lagi setelah periode penggunaan berikutnya.');
    outputLimit = Math.min(outputLimit, remaining);
  }
  const response = UrlFetchApp.fetch(RUMBLE_AI_ENDPOINT_ + '/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: selectedModel,
      messages: messages,
      max_tokens: outputLimit,
      stream: false
    }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = response.getContentText() || '';
  let data = {};
  try { data = JSON.parse(body); } catch (error) {}
  if (status < 200 || status >= 300) {
    const providerMessage = data && data.error && data.error.message ? String(data.error.message) : '';
    throw new Error('TokenPortal gagal merespons (HTTP ' + status + ')' + (providerMessage ? ': ' + providerMessage.slice(0, 240) : '. Periksa API key, model, dan saldo.'));
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || '') : '';
  if (!content) throw new Error('Respons TokenPortal tidak berisi teks jawaban yang dapat dibaca.');
  const usage = data.usage || {};
  return {
    content: content,
    model: String(data.model || selectedModel),
    requestId: String(data.id || ''),
    finishReason: String(data.choices[0].finish_reason || ''),
    usage: {
      promptTokens: Number(usage.prompt_tokens) || 0,
      completionTokens: Number(usage.completion_tokens) || 0,
      totalTokens: Number(usage.total_tokens) || 0
    }
  };
}
function logAiUsage_(eventType, details) {
  appendRow_('Events', {
    eventId: makeId_('EVT'), attemptId: '', studentId: '',
    eventType: eventType, eventAt: currentTimestamp_(),
    detailsJson: JSON.stringify(details || {})
  });
}
function adminTestAiConnection_(payload) {
  const settings = aiSettings_();
  const model = requiredText_(payload.model || settings.model, 'Model AI', 120);
  const started = new Date().getTime();
  try {
    const result = tokenPortalChatCompletion_([
      { role: 'system', content: 'Balas hanya dengan JSON valid: {"status":"ok","message":"connected"}.' },
      { role: 'user', content: 'Ini uji koneksi simulasi Rumble Assessment. Jangan gunakan data siswa.' }
    ], model, 128);
    const details = {
      provider: 'TOKENPORTAL', model: result.model, requestId: result.requestId,
      durationMs: new Date().getTime() - started, usage: result.usage, status: 'success'
    };
    logAiUsage_('AI_PROVIDER_TEST_SUCCESS', details);
    return { status: 'success', provider: 'TOKENPORTAL', model: result.model, response: result.content.slice(0, 500), usage: result.usage, durationMs: details.durationMs };
  } catch (error) {
    const details = {
      provider: 'TOKENPORTAL', model: model, durationMs: new Date().getTime() - started,
      status: 'failed', error: String(error && error.message || error).slice(0, 500)
    };
    logAiUsage_('AI_PROVIDER_TEST_FAILED', details);
    throw error;
  }
}
function adminListAiModels_() {
  // API key is optional here so the Admin can select a model before saving a new key.
  const apiKey = aiScriptProperties_().getProperty(RUMBLE_AI_API_KEY_);
  const options = { method: 'get', muteHttpExceptions: true };
  if (apiKey) options.headers = { Authorization: 'Bearer ' + apiKey };
  try {
    const response = UrlFetchApp.fetch(RUMBLE_AI_ENDPOINT_ + '/models', options);
    const status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      const data = JSON.parse(response.getContentText() || '{}');
      const models = Array.isArray(data.data) ? data.data : [];
      const normalized = models.map(function (item) {
        return { id: String(item.id || ''), name: String(item.name || item.id || '') };
      }).filter(function (item) { return !!item.id; });
      if (normalized.length) return normalized;
    }
  } catch (error) {
    // Use the documented starter model below when the catalog endpoint is unavailable.
  }
  // Fallback avoids a dead-end: Admin can save the API key and model, then refresh the catalog.
  return [{ id: 'glm-53-flash', name: 'GLM-5.3 Flash (TokenPortal - pilihan awal)' }];
}

const RUMBLE_AI_PROMPTS_KEY_ = 'RUMBLE_AI_PROMPT_INDEX_V1';
function aiPromptContentKey_(promptId) { return 'RUMBLE_AI_PROMPT_CONTENT_' + String(promptId || ''); }
function aiPromptTestKey_(promptId) { return 'RUMBLE_AI_PROMPT_TEST_' + String(promptId || ''); }
function aiPrompts_() {
  const properties = aiScriptProperties_();
  const raw = properties.getProperty(RUMBLE_AI_PROMPTS_KEY_);
  let index = [];
  try { index = raw ? JSON.parse(raw) : []; } catch (error) { index = []; }
  if (!Array.isArray(index)) return [];
  return index.map(function (item) {
    return Object.assign({}, item, {
      content: properties.getProperty(aiPromptContentKey_(item.promptId)) || '',
      testSummary: properties.getProperty(aiPromptTestKey_(item.promptId)) || ''
    });
  });
}
function saveAiPrompts_(items) {
  const properties = aiScriptProperties_();
  const index = items.map(function (item) {
    properties.setProperty(aiPromptContentKey_(item.promptId), String(item.content || ''));
    properties.setProperty(aiPromptTestKey_(item.promptId), String(item.testSummary || ''));
    const copy = Object.assign({}, item);
    delete copy.content;
    delete copy.testSummary;
    return copy;
  });
  properties.setProperty(RUMBLE_AI_PROMPTS_KEY_, JSON.stringify(index));
}
function adminListAiPrompts_() {
  return aiPrompts_().slice().sort(function (a, b) {
    return String(a.service).localeCompare(String(b.service)) || Number(b.version) - Number(a.version);
  });
}
function adminSaveAiPrompt_(payload) {
  const service = String(payload.service || '').trim().toUpperCase();
  if (['SCORING', 'REFLECTION'].indexOf(service) < 0) throw new Error('Jenis prompt AI tidak valid.');
  const content = requiredText_(payload.content, 'Isi prompt', 1200);
  const items = aiPrompts_();
  if (items.length >= 40) throw new Error('Batas 40 versi prompt tercapai. Tinjau dan arsipkan versi lama sebelum menambah versi baru.');
  const version = items.filter(function (item) { return item.service === service; })
    .reduce(function (max, item) { return Math.max(max, Number(item.version) || 0); }, 0) + 1;
  const prompt = {
    promptId: 'PROMPT_' + service + '_' + version,
    service: service,
    version: version,
    content: content,
    changeNote: String(payload.changeNote || '').slice(0, 500),
    active: false,
    testedAt: '',
    testSummary: '',
    createdAt: currentTimestamp_(),
    createdBy: String(payload.currentUser && payload.currentUser.email || '')
  };
  items.push(prompt);
  saveAiPrompts_(items);
  return prompt;
}
function adminTestAiPrompt_(payload) {
  const promptId = requiredText_(payload.promptId, 'ID prompt', 120);
  const items = aiPrompts_();
  const prompt = items.find(function (item) { return item.promptId === promptId; });
  if (!prompt) throw new Error('Versi prompt tidak ditemukan.');
  const simulation = prompt.service === 'SCORING'
    ? {
        task: 'simulasi penilaian jawaban uraian',
        question: 'Jelaskan mengapa 2x + 3 = 7 menghasilkan x = 2.',
        studentAnswer: 'Kurangi kedua ruas dengan 3 sehingga 2x = 4, lalu bagi 2 sehingga x = 2.',
        answerGuide: 'Jawaban menjelaskan operasi yang sama pada kedua ruas.',
        rubric: 'Nilai proses penalaran dan ketepatan kesimpulan.'
      }
    : {
        task: 'simulasi refleksi pembelajaran kelas',
        classStatistics: { participantCount: 20, completedCount: 18, objectiveAchievementPercent: 76, indicatorMastered: 9, indicatorDeveloping: 6, indicatorNeedsImprovement: 3 },
        levelDistribution: { PRESTRUCTURAL: 1, UNISTRUCTURAL: 3, MULTISTRUKTURAL: 7, RELATIONAL: 6, EXTENDED_ABSTRACT: 1 }
      };
  let result;
  try {
    result = tokenPortalChatCompletion_([
      { role: 'system', content: prompt.content },
      { role: 'user', content: 'UJI COBA DENGAN DATA SIMULASI, BUKAN DATA SISWA NYATA. Berikan hasil sesuai prompt. Data simulasi: ' + JSON.stringify(simulation) }
    ], aiSettings_().model, aiSettings_().maxOutputTokens);
  } catch (error) {
    logAiUsage_('AI_PROMPT_TEST_FAILED', {
      provider: 'TOKENPORTAL', model: aiSettings_().model, promptId: promptId,
      service: prompt.service, status: 'failed', error: String(error && error.message || error).slice(0, 500)
    });
    throw error;
  }
  const testedAt = currentTimestamp_();
  prompt.testedAt = testedAt;
  prompt.testSummary = result.content.slice(0, 1000);
  prompt.testUsage = result.usage;
  prompt.testedBy = String(payload.currentUser && payload.currentUser.email || '');
  saveAiPrompts_(items);
  logAiUsage_('AI_PROMPT_TEST_SUCCESS', {
    provider: 'TOKENPORTAL', model: result.model, promptId: promptId,
    service: prompt.service, status: 'success', usage: result.usage, testedAt: testedAt
  });
  return { promptId: promptId, testedAt: testedAt, model: result.model, response: result.content.slice(0, 3000), usage: result.usage };
}
function adminActivateAiPrompt_(payload) {
  const promptId = requiredText_(payload.promptId, 'ID prompt', 120);
  const items = aiPrompts_();
  const selected = items.find(function (item) { return item.promptId === promptId; });
  if (!selected) throw new Error('Versi prompt tidak ditemukan.');
  if (!selected.testedAt) throw new Error('Prompt harus berhasil diuji menggunakan data simulasi sebelum diaktifkan.');
  items.forEach(function (item) {
    if (item.service === selected.service) item.active = item.promptId === promptId;
  });
  saveAiPrompts_(items);
  return { promptId: promptId, service: selected.service, version: selected.version, active: true };
}

function adminListAiUsage_() {
  return listRows_('Events').filter(function (event) {
    return String(event.eventType || '').indexOf('AI_') === 0;
  }).slice(-200).reverse().map(function (event) {
    const details = parseJson_(event.detailsJson, {});
    return {
      eventType: String(event.eventType || ''),
      eventAt: String(event.eventAt || ''),
      provider: String(details.provider || ''),
      model: String(details.model || ''),
      status: String(details.status || ''),
      durationMs: Number(details.durationMs) || 0,
      usage: details.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      error: String(details.error || '')
    };
  });
}

function requestSoloClassReflection_(payload) {
  const assessmentId = requiredText_(payload.assessmentId, 'ID asesmen', 100);
  const settings = aiSettings_();
  if (!settings.reflectionEnabled) throw new Error('AI Refleksi belum diaktifkan oleh Admin.');
  const prompt = aiPrompts_().filter(function (item) {
    return item.service === 'REFLECTION' && item.active === true;
  }).sort(function (a, b) { return Number(b.version) - Number(a.version); })[0];
  if (!prompt) throw new Error('Belum ada prompt AI Refleksi aktif.');
  const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === assessmentId; });
  if (!assessment || String(assessment.classification || '').toUpperCase() !== 'SOLO_TAX') {
    throw new Error('Refleksi AI hanya tersedia untuk asesmen SOLO Tax.');
  }
  const questions = listRows_('Questions').filter(function (item) {
    return String(item.assessmentId) === assessmentId;
  }).sort(function (a, b) { return Number(a.order) - Number(b.order); });
  const attempts = listRows_('Attempts').filter(function (item) {
    return String(item.assessmentId) === assessmentId && String(item.status || '').toLowerCase() === 'graded';
  });
  if (!attempts.length) throw new Error('Belum ada hasil akhir yang dinilai. Refleksi dapat dibuat setelah penilaian murid selesai.');
  const events = listRows_('Events').filter(function (event) {
    return String(event.eventType || '') === 'SOLO_INDICATOR_VERIFICATION' &&
      attempts.some(function (attempt) { return String(attempt.attemptId) === String(event.attemptId); });
  });
  const latestReviewByAttempt = {};
  events.forEach(function (event) {
    const id = String(event.attemptId);
    if (!latestReviewByAttempt[id] || String(event.eventAt) > String(latestReviewByAttempt[id].eventAt)) latestReviewByAttempt[id] = event;
  });
  const levelNames = {
    PRESTRUCTURAL:'Prestructural', UNISTRUKTURAL:'Unistructural',
    MULTISTRUKTURAL:'Multistructural', RELATIONAL:'Relational',
    EXTENDED_ABSTRACT:'Extended Abstract'
  };
  const levelCounts = {PRESTRUCTURAL:0,UNISTRUKTURAL:0,MULTISTRUKTURAL:0,RELATIONAL:0,EXTENDED_ABSTRACT:0};
  const verifiedLevelCounts = {PRESTRUCTURAL:0,UNISTRUKTURAL:0,MULTISTRUKTURAL:0,RELATIONAL:0,EXTENDED_ABSTRACT:0};
  let scorePercentTotal = 0, scorePercentCount = 0, verifiedLevelCount = 0;
  const indicatorTotals = {};
  attempts.forEach(function (attempt) {
    const max = Number(attempt.maxScore), score = Number(attempt.score);
    if (isFinite(max) && max > 0 && isFinite(score)) { scorePercentTotal += score / max * 100; scorePercentCount++; }
    const review = latestReviewByAttempt[String(attempt.attemptId)];
    if (!review) return;
    const detail = parseJson_(review.detailsJson, {});
    (Array.isArray(detail.results) ? detail.results : []).forEach(function (item) {
      const id = String(item.indicatorId || '');
      if (!id) return;
      if (!indicatorTotals[id]) indicatorTotals[id] = {sum:0,count:0};
      const pct = Number(item.percentage);
      if (isFinite(pct) && pct >= 0 && pct <= 100) { indicatorTotals[id].sum += pct; indicatorTotals[id].count++; }
    });
    const dominantEvents = listRows_('Events').filter(function (event) {
      return String(event.attemptId) === String(attempt.attemptId) &&
        String(event.eventType) === 'SOLO_DOMINANT_LEVEL_VERIFICATION';
    }).sort(function (a,b) { return String(a.eventAt).localeCompare(String(b.eventAt)); });
    const dominant = dominantEvents.length ? parseJson_(dominantEvents[dominantEvents.length-1].detailsJson,{}) : null;
    const level = dominant && String(dominant.teacherLevel || '').toUpperCase().replace(/[ -]+/g,'_');
    if (level && Object.prototype.hasOwnProperty.call(verifiedLevelCounts,level)) {
      verifiedLevelCounts[level]++; verifiedLevelCount++;
    }
  });
  const indicatorRows = listRows_('LearningIndicators');
  const indicatorSummary = Object.keys(indicatorTotals).map(function (id) {
    const item = indicatorTotals[id], ref = indicatorRows.find(function (row) { return String(row.indicatorId) === id; });
    return {indicatorId:id,code:ref?String(ref.indicatorCode||id):id,description:ref?String(ref.description||''):'',averagePercent:Math.round(item.sum/item.count*100)/100,verifiedStudents:item.count};
  });
  const questionSummary = questions.map(function (question) {
    const meta = parseJson_(question.answerJson,{}) || {}, solo = meta.__soloTaxMeta || {};
    const level = String(solo.soloLevel || '').toUpperCase().replace(/[ -]+/g,'_');
    const scores = attempts.map(function (attempt) {
      const values = parseJson_(attempt.questionScoresJson,{});
      const value = Number(values[String(question.questionId)]);
      return isFinite(value) && Number(question.points)>0 ? value/Number(question.points)*100 : null;
    }).filter(function (value) { return value !== null; });
    const avg = scores.length ? scores.reduce(function (sum,value) { return sum+value; },0)/scores.length : null;
    const low = scores.filter(function (value) { return value < 50; }).length;
    const high = scores.filter(function (value) { return value >= 80; }).length;
    return {
      order:Number(question.order),level:level,levelLabel:levelNames[level]||String(solo.soloLevel||''),
      question:String(question.text||'').slice(0,1200),
      indicators:(Array.isArray(solo.learningIndicators)?solo.learningIndicators:[]).map(function (x) { return {code:String(x.indicatorCode||''),description:String(x.description||'')}; }),
      averageScorePercent:avg===null?null:Math.round(avg*100)/100,
      below50Percent:scores.length?Math.round(low/scores.length*10000)/100:null,
      atLeast80Percent:scores.length?Math.round(high/scores.length*10000)/100:null,
      scoredResponses:scores.length
    };
  });
  const levelDistribution = {};
  Object.keys(levelCounts).forEach(function (key) { levelDistribution[key] = verifiedLevelCounts[key]; });
  const typeGroups = {
    conceptUnderstanding:questionSummary.filter(function (q) { return q.level==='MULTISTRUKTURAL'; }),
    connectingConcepts:questionSummary.filter(function (q) { return q.level==='RELATIONAL'; }),
    applyingToNewSituations:questionSummary.filter(function (q) { return q.level==='EXTENDED_ABSTRACT'; })
  };
  function meanQuestionScore(items) {
    const vals=items.map(function (item) { return item.averageScorePercent; }).filter(function (v) { return v!==null; });
    return vals.length?Math.round(vals.reduce(function (sum,v) { return sum+v; },0)/vals.length*100)/100:null;
  }
  const data = {
    assessmentTitle:String(assessment.title||''),subject:String(assessment.subject||''),className:String(assessment.className||''),
    participants:attempts.length,overallAveragePercent:scorePercentCount?Math.round(scorePercentTotal/scorePercentCount*100)/100:null,
    tpAchievement:indicatorSummary.length?Math.round(indicatorSummary.reduce(function (sum,item) { return sum+item.averagePercent; },0)/indicatorSummary.length*100)/100:null,
    verifiedIndicatorCount:indicatorSummary.length,indicatorSummary:indicatorSummary,
    verifiedDominantLevelCount:verifiedLevelCount,dominantLevelDistribution:levelDistribution,
    unverifiedDominantLevelCount:attempts.length-verifiedLevelCount,
    questionTypeAchievement:{
      conceptUnderstanding:{questionCount:typeGroups.conceptUnderstanding.length,averagePercent:meanQuestionScore(typeGroups.conceptUnderstanding)},
      connectingConcepts:{questionCount:typeGroups.connectingConcepts.length,averagePercent:meanQuestionScore(typeGroups.connectingConcepts)},
      applyingToNewSituations:{questionCount:typeGroups.applyingToNewSituations.length,averagePercent:meanQuestionScore(typeGroups.applyingToNewSituations)}
    },
    questionAnalysis:questionSummary
  };
  const systemPrompt = prompt.content + '\n\nATURAN WAJIB: Gunakan hanya data agregat berikut. Jangan menebak kesalahan spesifik yang tidak dapat dibuktikan oleh distribusi skor; nyatakan keterbatasan jika jawaban rinci tidak dianalisis. Jangan mengarang persentase. Bahas: (1) persentase ketercapaian TP kelas, (2) capaian Multistruktural untuk pemahaman konsep, Relational untuk menghubungkan konsep, Extended Abstract untuk penerapan pada situasi baru, (3) analisis butir, pola skor rendah/tinggi, dan kualitas soal dengan catatan keterbatasan bukti, (4) refleksi pembelajaran, (5) rekomendasi tindak lanjut bagi guru. Bedakan level SOLO yang sudah diverifikasi guru dari yang belum diverifikasi. Kembalikan JSON valid saja dengan bentuk {"tpAchievement":"...","abilityAnalysis":"...","errorAndItemQuality":"...","learningReflection":"...","teacherRecommendations":["..."],"limitations":"..."}; setiap bagian berupa teks Bahasa Indonesia.';
  const started = new Date().getTime();
  try {
    const response = tokenPortalChatCompletion_([
      {role:'system',content:systemPrompt},
      {role:'user',content:'Buat refleksi pembelajaran kelas berdasarkan rekap hasil akhir SOLO Tax berikut. Data anonim dan agregat: '+JSON.stringify(data)}
    ], settings.model, settings.maxOutputTokens);
    let parsed;
    try {
      const clean=response.content.replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();
      parsed=JSON.parse(clean);
    } catch (error) { throw new Error('AI Refleksi tidak mengembalikan JSON valid. Periksa prompt REFLECTION aktif.'); }
    const required=['tpAchievement','abilityAnalysis','errorAndItemQuality','learningReflection','limitations'];
    required.forEach(function (key) { if (typeof parsed[key] !== 'string' || !parsed[key].trim()) throw new Error('Bagian refleksi AI belum lengkap: '+key+'.'); });
    if (!Array.isArray(parsed.teacherRecommendations) || !parsed.teacherRecommendations.length) throw new Error('Rekomendasi tindak lanjut guru belum tersedia.');
    const result = {
      assessmentId:assessmentId,assessmentTitle:String(assessment.title||''),generatedAt:currentTimestamp_(),
      generatedBy:String(payload.currentUser&&payload.currentUser.email||''),promptId:prompt.promptId,promptVersion:Number(prompt.version)||0,
      provider:'TOKENPORTAL',model:response.model,usage:response.usage,statistics:data,
      reflection:{
        tpAchievement:parsed.tpAchievement,abilityAnalysis:parsed.abilityAnalysis,
        errorAndItemQuality:parsed.errorAndItemQuality,learningReflection:parsed.learningReflection,
        teacherRecommendations:parsed.teacherRecommendations.map(function (x) { return String(x||'').trim(); }).filter(Boolean),
        limitations:parsed.limitations
      }
    };
    appendRow_('Events',{eventId:makeId_('EVT'),attemptId:'',studentId:'',eventType:'AI_SOLO_CLASS_REFLECTION',eventAt:result.generatedAt,detailsJson:JSON.stringify(result)});
    logAiUsage_('AI_SOLO_CLASS_REFLECTION_SUCCESS',{provider:'TOKENPORTAL',model:response.model,promptId:prompt.promptId,service:'REFLECTION',status:'success',durationMs:new Date().getTime()-started,usage:response.usage,assessmentId:assessmentId});
    return result;
  } catch (error) {
    logAiUsage_('AI_SOLO_CLASS_REFLECTION_FAILED',{provider:'TOKENPORTAL',model:settings.model,promptId:prompt.promptId,service:'REFLECTION',status:'failed',durationMs:new Date().getTime()-started,error:String(error&&error.message||error).slice(0,500),assessmentId:assessmentId});
    throw error;
  }
}

function saveSoloDominantVerification_(payload) {
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const allowedLevels = ['PRESTRUCTURAL', 'UNISTRUKTURAL', 'MULTISTRUKTURAL', 'RELATIONAL', 'EXTENDED_ABSTRACT'];
  const teacherLevel = String(payload.teacherLevel || '').trim().toUpperCase().replace(/[ -]+/g, '_');
  const teacherReason = String(payload.teacherReason || '').trim();
  if (allowedLevels.indexOf(teacherLevel) < 0) {
    throw new Error('Hasil verifikasi guru harus menggunakan salah satu dari lima level SOLO.');
  }
  if (teacherReason.length > 3000) throw new Error('Catatan guru maksimal 3.000 karakter.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const attempt = listRows_('Attempts').find(function (item) { return String(item.attemptId) === attemptId; });
    if (!attempt || String(attempt.status || '').toLowerCase() !== 'graded') {
      throw new Error('Seluruh soal harus selesai dinilai sebelum level SOLO dominan diverifikasi.');
    }
    const assessment = listRows_('Assessments').find(function (item) { return String(item.assessmentId) === String(attempt.assessmentId); });
    if (!assessment || String(assessment.classification || '').toUpperCase() !== 'SOLO_TAX') {
      throw new Error('Verifikasi level dominan hanya berlaku untuk Asesmen SOLO Tax.');
    }
    const events = listRows_('Events').filter(function (event) { return String(event.attemptId) === attemptId; });
    const latestIndicatorReview = events.filter(function (event) {
      return String(event.eventType).indexOf('SOLO_INDICATOR_VERIFICATION') === 0;
    }).sort(function (a, b) { return String(a.eventAt).localeCompare(String(b.eventAt)); }).pop();
    if (!latestIndicatorReview || latestIndicatorReview.eventType !== 'SOLO_INDICATOR_VERIFICATION') {
      throw new Error('Seluruh indikator TP harus diverifikasi ulang setelah penilaian terakhir.');
    }
    const reviewDetails = parseJson_(latestIndicatorReview.detailsJson, {});
    const results = Array.isArray(reviewDetails.results) ? reviewDetails.results : [];
    if (!results.length || results.some(function (item) {
      const percentage = Number(item && item.percentage);
      const evidence = String(item && item.evidence || '').trim();
      return !item || !item.indicatorId || !isFinite(percentage) || percentage < 0 || percentage > 100 || !evidence || evidence.length > 3000 || item.category !== soloAchievementCategory_(percentage);
    })) {
      throw new Error('Bukti dan persentase verifikasi indikator belum lengkap atau tidak valid.');
    }
    const latestAiEvent = events.filter(function (event) {
      return String(event.eventType) === 'AI_SOLO_SCORING_RECOMMENDATION';
    }).sort(function (a, b) { return String(a.eventAt).localeCompare(String(b.eventAt)); }).pop();
    if (!latestAiEvent) throw new Error('Rekomendasi level dominan AI belum tersedia. Jalankan analisis AI terlebih dahulu.');
    const aiDetails = parseJson_(latestAiEvent.detailsJson, {});
    const recommendation = aiDetails.dominantRecommendation;
    if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) {
      throw new Error('AI belum menghasilkan rekomendasi level dominan berbasis bukti yang cukup.');
    }
    const aiLevel = String(recommendation.level || '').trim().toUpperCase().replace(/[ -]+/g, '_');
    if (allowedLevels.indexOf(aiLevel) < 0) throw new Error('Level rekomendasi AI tidak valid.');
    const aiEvidence = String(recommendation.evidenceSummary || '').trim();
    if (!aiEvidence || aiEvidence.length > 5000) throw new Error('Ringkasan bukti kualitatif dari AI tidak valid.');
    if (teacherLevel !== aiLevel && !teacherReason) throw new Error('Alasan perubahan level dari rekomendasi AI wajib diisi.');
    const questionEvidence = Array.isArray(recommendation.questionEvidence) ? recommendation.questionEvidence : [];
    const analyzedQuestionIds = Array.isArray(aiDetails.analyzedQuestionIds) ? aiDetails.analyzedQuestionIds.map(String).sort() : [];
    const receivedEvidenceIds = questionEvidence.map(function (item) { return String(item && item.questionId || ''); }).sort();
    if (!analyzedQuestionIds.length || questionEvidence.length !== analyzedQuestionIds.length ||
        analyzedQuestionIds.some(function (id, index) { return id !== receivedEvidenceIds[index]; })) {
      throw new Error('Bukti level dominan harus mencakup tepat satu bukti untuk setiap soal yang dianalisis AI.');
    }
    const questionIds = {};
    listRows_('Questions').filter(function (item) { return String(item.assessmentId) === String(attempt.assessmentId); }).forEach(function (item) {
      questionIds[String(item.questionId)] = true;
    });
    const checkedEvidence = questionEvidence.map(function (item) {
      const id = String(item && item.questionId || '');
      const evidence = String(item && item.evidence || '').trim();
      if (!questionIds[id] || !evidence || evidence.length > 3000) {
        throw new Error('Bukti level SOLO harus merujuk pada soal asesmen dan menyertakan penjelasan yang valid.');
      }
      return { questionId: id, evidence: evidence };
    });
    const now = currentTimestamp_(), user = payload.currentUser || {};
    appendRow_('Events', {
      eventId: makeId_('EVT'), attemptId: attemptId, studentId: String(attempt.studentId || ''),
      eventType: 'SOLO_DOMINANT_LEVEL_VERIFICATION', eventAt: now,
      detailsJson: JSON.stringify({
        version: 2, assessmentId: String(attempt.assessmentId),
        verifiedBy: String(user.email || ''), aiLevel: aiLevel, teacherLevel: teacherLevel,
        aiEvidenceSummary: aiEvidence, questionEvidence: checkedEvidence,
        teacherReason: teacherReason, aiProvider: String(aiDetails.provider || ''),
        aiModel: String(aiDetails.model || ''), promptVersion: String(aiDetails.promptVersion || '')
      })
    });
    return { attemptId: attemptId, status: 'verified', aiLevel: aiLevel, teacherLevel: teacherLevel, verifiedAt: now };
  } finally {
    lock.releaseLock();
  }
}

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
    const latestValues = attemptSheet.getDataRange().getValues();
    let latestRowIndex = -1, latestAttemptRow = null;
    for (let i = 1; i < latestValues.length; i++) {
      if (String(latestValues[i][col('attemptId')]) === attemptId &&
          String(latestValues[i][col('studentId')]) === studentId &&
          String(latestValues[i][col('assessmentId')]) === assessmentId) {
        latestRowIndex = i; latestAttemptRow = latestValues[i]; break;
      }
    }
    if (latestRowIndex < 0 || !latestAttemptRow || String(latestAttemptRow[col('status')]) !== 'in_progress') {
      throw new Error('Sesi pengerjaan tidak ditemukan atau sudah berakhir.');
    }
    const latestAnswers = parseJson_(latestAttemptRow[col('answersJson')], {});
    const latestAnswer = latestAnswers[questionId] && typeof latestAnswers[questionId] === 'object' && !Array.isArray(latestAnswers[questionId])
      ? latestAnswers[questionId] : { text: typeof latestAnswers[questionId] === 'string' ? latestAnswers[questionId] : '' };
    latestAnswer.photos = Array.isArray(latestAnswer.photos) ? latestAnswer.photos : [];
    if (String(assessment.classification || '').toUpperCase() === 'SOLO_TAX' && latestAnswer.photos.length >= 1) {
      throw new Error('SOLO Tax hanya mengizinkan satu foto untuk setiap soal utama.');
    }
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
    const answers = latestAnswers;
    const answer = latestAnswer;
    answer.photos.push({ fileId: fileId, url: file.getUrl(), imageUrl: imageUrl, name: file.getName() });
    answers[questionId] = answer;
    attemptSheet.getRange(latestRowIndex + 1, answersCol + 1).setValue(JSON.stringify(answers));
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
function updateRowByKey_(tableName, keyHeader, keyValue, fields) {
  const sheet = getSheet_(tableName);
  const lastColumn = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastColumn < 1 || lastRow < 1) {
    throw new Error('Sheet ' + tableName + ' belum memiliki header yang valid.');
  }
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) { return String(h).trim(); });
  const keyCol = headers.indexOf(keyHeader);
  if (keyCol < 0) throw new Error('Kolom ' + keyHeader + ' tidak tersedia pada ' + tableName + '.');
  const columns = {};
  Object.keys(fields).forEach(function (key) {
    const col = headers.indexOf(key);
    if (col < 0) throw new Error('Kolom ' + key + ' tidak tersedia pada ' + tableName + '.');
    columns[key] = col;
  });
  const data = sheet.getRange(2, 1, Math.max(lastRow - 1, 1), lastColumn).getValues();
  let rowNumber = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][keyCol]) === String(keyValue)) {
      rowNumber = i + 2;
      break;
    }
  }
  if (rowNumber < 0) throw new Error('Data ' + tableName + ' tidak ditemukan: ' + keyValue);

  const rowRange = sheet.getRange(rowNumber, 1, 1, lastColumn);
  const updatedRow = rowRange.getValues()[0];
  const formulas = rowRange.getFormulas()[0];
  // Preserve formulas in untouched columns while applying the requested values.
  formulas.forEach(function (formula, index) {
    if (formula) updatedRow[index] = formula;
  });
  Object.keys(columns).forEach(function (key) {
    updatedRow[columns[key]] = fields[key];
  });
  rowRange.setValues([updatedRow]);
}
function bundleSnapshotFromRecord_(bundle,classification){
  return {schemaVersion:1,bundleId:String(bundle.bundleId),classification:String(classification||'REGULER').toUpperCase(),title:String(bundle.title||''),subject:String(bundle.subject||''),className:String(bundle.className||''),description:String(bundle.description||''),tpCode:String(bundle.tpCode||''),learningObjectiveId:String(bundle.learningObjectiveId||''),learningIndicatorId:String(bundle.learningIndicatorId||''),passageText:String(bundle.passageText||''),passageImageUrl:String(bundle.passageImageUrl||''),passages:parseJson_(bundle.passagesJson,[]),questions:parseJson_(bundle.questionsJson,[])};
}

function snapshotBundleLearningReferences_(snapshot) {
  if (String(snapshot.classification || '').toUpperCase() !== 'SOLO_TAX') return snapshot;
  const objectiveId = String(snapshot.learningObjectiveId || '');
  const objective = listRows_('LearningObjectives').find(function (item) {
    return String(item.objectiveId) === objectiveId;
  });
  if (!objective) throw new Error('Snapshot SOLO Tax tidak dapat menyimpan tujuan pembelajaran yang dipilih.');
  snapshot.learningObjectiveSnapshot = {
    objectiveId: String(objective.objectiveId || ''),
    tpCode: String(objective.tpCode || snapshot.tpCode || ''),
    title: String(objective.title || ''),
    subject: String(objective.subject || snapshot.subject || ''),
    className: String(objective.className || snapshot.className || ''),
    description: String(objective.description || '')
  };
  const indicators = listRows_('LearningIndicators');
  snapshot.questions = (snapshot.questions || []).map(function (question) {
    const copy = Object.assign({}, question);
    copy.learningIndicators = (Array.isArray(question.learningIndicatorIds) ? question.learningIndicatorIds : []).map(function (id) {
      const row = indicators.find(function (item) {
        return String(item.indicatorId) === String(id) && String(item.objectiveId) === objectiveId;
      });
      if (!row) throw new Error('Indikator TP tidak dapat disimpan pada snapshot bundel.');
      return {
        indicatorId: String(row.indicatorId || ''),
        objectiveId: String(row.objectiveId || ''),
        indicatorCode: String(row.indicatorCode || ''),
        description: String(row.description || '')
      };
    });
    return copy;
  });
  return snapshot;
}

function validateBundleLearningReference_(snapshot){
  const objectiveId=String(snapshot.learningObjectiveId||'').trim(),legacyId=String(snapshot.learningIndicatorId||'').trim(),ids=[];
  (snapshot.questions||[]).forEach(function(q){(Array.isArray(q.learningIndicatorIds)?q.learningIndicatorIds:[]).forEach(function(id){ids.push(String(id||'').trim());});});
  const indicatorIds=Array.from(new Set([legacyId].concat(ids).filter(Boolean)));
  if(!objectiveId&&!indicatorIds.length){if(String(snapshot.classification||'').toUpperCase()==='SOLO_TAX')throw new Error('Pilih tujuan pembelajaran dan indikator TP untuk bundel SOLO Tax.');return true;}
  if(!objectiveId)throw new Error('Pilih tujuan pembelajaran sebelum memilih indikator.');
  learningRepositoryAssertReady_();
  const objective=listRows_('LearningObjectives').find(function(row){return String(row.objectiveId)===objectiveId&&learningActive_(row.active);});
  if(!objective)throw new Error('Tujuan pembelajaran yang dipilih tidak tersedia atau tidak aktif.');
  if(String(objective.subject||'').trim().toLowerCase()!==String(snapshot.subject||'').trim().toLowerCase())throw new Error('Mata pelajaran bundel harus sama dengan mata pelajaran tujuan pembelajaran.');
  if(String(objective.className||'').trim().toLowerCase()!==String(snapshot.className||'').trim().toLowerCase())throw new Error('Kelas bundel harus sama dengan kelas tujuan pembelajaran.');
  indicatorIds.forEach(function(indicatorId){
    const indicator=listRows_('LearningIndicators').find(function(row){return String(row.indicatorId)===indicatorId&&String(row.objectiveId)===objectiveId&&learningActive_(row.active);});
    if(!indicator)throw new Error('Indikator tidak aktif atau tidak terhubung dengan tujuan pembelajaran yang dipilih.');
  });
  return true;
}
function validateBundleSnapshot_(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new Error('Snapshot bundel tidak valid.');
  requiredText_(snapshot.bundleId,'ID bundel',100);
  const classification=String(snapshot.classification||'').toUpperCase();
  if(['REGULER','SOLO_TAX'].indexOf(classification)<0)throw new Error('Klasifikasi bundel tidak valid.');
  if(!Array.isArray(snapshot.questions)||snapshot.questions.length<1||snapshot.questions.length>200)throw new Error('Snapshot harus memiliki 1 sampai 200 soal.');
  snapshot.questions.forEach(function(q,i){
    if(classification==='SOLO_TAX'){validateSoloTaxQuestion_(q,i);return;}
    const type=String(q&&q.type||'multiple_choice'),points=Number(q&&q.points);
    if(['multiple_choice','true_false','true_false_multi','multi_select','matching','essay'].indexOf(type)<0)throw new Error('Tipe soal snapshot tidak valid pada nomor '+(i+1));
    if(!isFinite(points)||points<0||points>1000)throw new Error('Bobot soal snapshot tidak valid pada nomor '+(i+1));
  });
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

function validateLearningMigrationPreflight_(spreadsheet) {
  const migrationSheet = spreadsheet.getSheetByName('SchemaMigrations');
  if (!migrationSheet) {
    throw new Error('Sheet SchemaMigrations belum tersedia. Selesaikan migrasi fondasi versioning terlebih dahulu.');
  }
  validateRepositorySheetHeaders_(migrationSheet, 'SchemaMigrations', ['migrationId', 'status']);
  Object.keys(LEARNING_REPOSITORY_TABLES_).forEach(function (tableName) {
    const sheet = spreadsheet.getSheetByName(tableName);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow === 0 && lastColumn === 0) return;
    if (lastRow < 1 || lastColumn < 1) {
      throw new Error('Struktur sheet ' + tableName + ' tidak valid: baris data dan header tidak konsisten. Migrasi dihentikan sebelum mengubah sheet apa pun.');
    }
    const rawHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const seen = {};
    rawHeaders.forEach(function (value, index) {
      const raw = String(value == null ? '' : value);
      const header = raw.trim();
      if (!header) {
        throw new Error('Header kosong pada kolom ' + (index + 1) + ' di sheet ' + tableName + '. Migrasi dihentikan sebelum perubahan.');
      }
      if (raw !== header) {
        throw new Error('Header "' + raw + '" pada sheet ' + tableName + ' memiliki spasi di awal/akhir. Rapikan secara manual sebelum migrasi.');
      }
      if (seen[header]) {
        throw new Error('Header duplikat "' + header + '" pada sheet ' + tableName + '. Migrasi dihentikan sebelum perubahan.');
      }
      seen[header] = true;
    });
  });
  return true;
}

function migrateLearningRepositoryV1_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Repositori hanya boleh dimigrasikan setelah fondasi versioning selesai.
    // Pemeriksaan dilakukan sebelum perubahan sheet apa pun.
    assertBundleVersioningReady_();
    const migrationId = 'LEARNING_REPOSITORY_V1';
    const spreadsheet = getSpreadsheet_();
    validateLearningMigrationPreflight_(spreadsheet);
    const migrationSheet = spreadsheet.getSheetByName('SchemaMigrations');
    if (listRows_('SchemaMigrations').some(function (r) {
      return String(r.migrationId) === migrationId && String(r.status) === 'completed';
    })) return { success: true, alreadyApplied: true, migrationId: migrationId };

    const changes = {};
    Object.keys(LEARNING_REPOSITORY_TABLES_).forEach(function (tableName) {
      let sheet = spreadsheet.getSheetByName(tableName);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(tableName);
        const headers = LEARNING_REPOSITORY_TABLES_[tableName];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setFrozenRows(1);
        changes[tableName] = { created: true, addedHeaders: [] };
        return;
      }
      if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
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

function validateRepositorySheetHeaders_(sheet, sheetName, requiredHeaders) {
  if (!sheet) throw new Error('Sheet ' + sheetName + ' belum tersedia.');
  const lastColumn = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastRow < 1 || lastColumn < 1) {
    throw new Error('Sheet ' + sheetName + ' kosong atau belum memiliki baris header. Periksa struktur sheet sebelum menjalankan endpoint repositori.');
  }
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) {
    return String(value == null ? '' : value).trim();
  });
  const seen = {};
  headers.forEach(function (header, index) {
    if (!header) throw new Error('Header kosong pada kolom ' + (index + 1) + ' di sheet ' + sheetName + '.');
    if (seen[header]) throw new Error('Header duplikat "' + header + '" pada sheet ' + sheetName + '.');
    seen[header] = true;
  });
  requiredHeaders.forEach(function (header) {
    if (headers.indexOf(header) < 0) {
      throw new Error('Kolom ' + header + ' belum tersedia pada ' + sheetName + '. Jalankan migrasi repositori.');
    }
  });
  return headers;
}
function learningRepositoryAssertReady_() {
  const spreadsheet = getSpreadsheet_();
  const migrationSheet = spreadsheet.getSheetByName('SchemaMigrations');
  if (!migrationSheet) {
    throw new Error('Sheet SchemaMigrations belum tersedia. Selesaikan migrasi fondasi versioning dan repositori pembelajaran terlebih dahulu.');
  }
  validateRepositorySheetHeaders_(migrationSheet, 'SchemaMigrations', ['migrationId', 'status']);
  const migrationCompleted = listRows_('SchemaMigrations').some(function (row) {
    return String(row.migrationId) === 'LEARNING_REPOSITORY_V1' &&
      String(row.status) === 'completed';
  });
  if (!migrationCompleted) {
    throw new Error('Migrasi LEARNING_REPOSITORY_V1 belum tercatat completed. Jalankan migrasi repositori secara eksplisit setelah BUNDLE_VERSIONING_V1 selesai.');
  }
  Object.keys(LEARNING_REPOSITORY_TABLES_).forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw new Error('Repositori Pembelajaran belum dimigrasikan. Jalankan migrateLearningRepositoryV1_() secara eksplisit.');
    validateRepositorySheetHeaders_(sheet, name, LEARNING_REPOSITORY_TABLES_[name]);
  });
}
function learningActive_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}
function learningAuditBegin_(user, action, entityType, entityId, beforeValue, afterValue) {
  const logId = makeId_('AUD');
  appendRow_('AdminAuditLog', {
    logId: logId, actorUserId: String(user.userId || ''),
    actorEmail: String(user.email || ''), action: 'PENDING_' + action,
    entityType: entityType, entityId: String(entityId),
    beforeJson: beforeValue == null ? '' : JSON.stringify(beforeValue),
    afterJson: afterValue == null ? '' : JSON.stringify(afterValue),
    createdAt: currentTimestamp_()
  });
  return logId;
}
function learningAuditComplete_(logId, action) {
  updateRowByKey_('AdminAuditLog', 'logId', logId, { action: action });
}
function learningAuditedWrite_(user, action, entityType, entityId, beforeValue, afterValue, writeFn) {
  // Catat intent terlebih dahulu agar perubahan tidak dapat terjadi tanpa jejak audit.
  const logId = learningAuditBegin_(user, action, entityType, entityId, beforeValue, afterValue);
  try {
    writeFn();
  } catch (writeError) {
    throw new Error('Penulisan ' + entityType + ' gagal atau belum dapat dipastikan selesai. Audit ' + logId + ' tetap berstatus PENDING_' + action + ' untuk rekonsiliasi. Detail: ' + writeError.message);
  }
  try {
    learningAuditComplete_(logId, action);
  } catch (auditError) {
    throw new Error(entityType + ' telah ditulis, tetapi audit ' + logId + ' belum dapat ditandai selesai. Periksa AdminAuditLog dan rekonsiliasi entri PENDING_' + action + '. Detail: ' + auditError.message);
  }
}
function adminListPendingLearningAudits_() {
  learningRepositoryAssertReady_();
  return listRows_('AdminAuditLog').filter(function (row) {
    return String(row.action || '').indexOf('PENDING_') === 0;
  }).map(function (row) {
    return {
      logId: String(row.logId || ''), actorUserId: String(row.actorUserId || ''),
      actorEmail: String(row.actorEmail || ''), action: String(row.action || ''),
      entityType: String(row.entityType || ''), entityId: String(row.entityId || ''),
      beforeJson: String(row.beforeJson || ''), afterJson: String(row.afterJson || ''),
      createdAt: String(row.createdAt || '')
    };
  });
}

function adminReconcileLearningAudit_(payload, user) {
  learningRepositoryAssertReady_();
  const logId = requiredText_(payload.logId, 'ID audit', 100);
  const resolution = requiredText_(payload.resolution, 'Hasil rekonsiliasi', 30).toLowerCase();
  const note = requiredText_(payload.note, 'Catatan rekonsiliasi', 2000);
  const allowed = ['applied', 'not_applied', 'manual'];
  if (allowed.indexOf(resolution) < 0) throw new Error('Hasil rekonsiliasi tidak valid.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const row = listRows_('AdminAuditLog').find(function (item) {
      return String(item.logId || '') === logId;
    });
    if (!row) throw new Error('Catatan audit tidak ditemukan.');
    if (String(row.action || '').indexOf('PENDING_') !== 0) {
      throw new Error('Catatan audit ini bukan lagi berstatus PENDING atau sudah direkonsiliasi.');
    }
    const finalAction = resolution === 'applied' ? 'RECONCILED_APPLIED' :
      (resolution === 'not_applied' ? 'RECONCILED_NOT_APPLIED' : 'RECONCILED_MANUAL');
    const auditRows = listRows_('AdminAuditLog');
    const priorDecision = auditRows.find(function (item) {
      return String(item.action || '') === 'RECONCILE_PENDING' &&
        String(item.entityId || '') === logId;
    });
    if (priorDecision) {
      // Retry aman: jika keputusan sudah tercatat tetapi pembaruan baris asal gagal,
      // gunakan keputusan yang sama dan jangan membuat entri rekonsiliasi duplikat.
      let prior;
      try { prior = JSON.parse(String(priorDecision.afterJson || '{}')); } catch (parseError) { prior = null; }
      const priorAction = prior && String(prior.finalAction || '');
      if (['RECONCILED_APPLIED', 'RECONCILED_NOT_APPLIED', 'RECONCILED_MANUAL'].indexOf(priorAction) < 0) {
        throw new Error('Entri rekonsiliasi sebelumnya tidak valid. Periksa AdminAuditLog secara manual.');
      }
      // Retry hanya idempoten jika keputusan dan catatan sama; jangan diam-diam
      // menerima keputusan berbeda untuk audit yang sama.
      if (!prior || String(prior.resolution || '') !== resolution || String(prior.note || '') !== note) {
        throw new Error('Audit ini sudah memiliki keputusan rekonsiliasi yang berbeda. Periksa entri RECONCILE_PENDING sebelum mencoba lagi.');
      }
      updateRowByKey_('AdminAuditLog', 'logId', logId, { action: priorAction });
      return { logId: logId, action: priorAction, reusedDecision: true };
    }
    // Simpan keputusan sebagai entri audit baru sebelum menutup status PENDING.
    appendRow_('AdminAuditLog', {
      logId: makeId_('AUD'), actorUserId: String(user.userId || ''),
      actorEmail: String(user.email || ''), action: 'RECONCILE_PENDING',
      entityType: 'AdminAuditLog', entityId: logId,
      beforeJson: JSON.stringify({ action: String(row.action || '') }),
      afterJson: JSON.stringify({ resolution: resolution, note: note, finalAction: finalAction }),
      createdAt: currentTimestamp_()
    });
    updateRowByKey_('AdminAuditLog', 'logId', logId, { action: finalAction });
    return { logId: logId, action: finalAction, reusedDecision: false };
  } finally {
    lock.releaseLock();
  }
}

function learningObjectivePublic_(row) {
  return {
    objectiveId: String(row.objectiveId || ''), tpCode: String(row.tpCode || ''),
    title: String(row.title || ''), subject: String(row.subject || ''), className: String(row.className || ''),
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
function adminListLearningClassOptions_() {
  learningRepositoryAssertReady_();
  const names = {};
  ['Users','LearningObjectives','Assessments','QuestionBundles'].forEach(function (tableName) {
    listRows_(tableName).forEach(function (row) {
      if (tableName === 'Users' && String(row.role || '').toLowerCase() !== 'student') return;
      const name = String(row.className || '').trim();
      if (name) names[name] = true;
    });
  });
  return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'id'); });
}
function adminListLearningSubjectOptions_() {
  learningRepositoryAssertReady_();
  const names = {};
  ['LearningObjectives','QuestionBundles','Assessments'].forEach(function (tableName) {
    listRows_(tableName).forEach(function (row) {
      const name = String(row.subject || '').trim();
      if (name) names[name] = true;
    });
  });
  return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'id'); });
}
function listAvailableLearningClassOptions_() {
  learningRepositoryAssertReady_();
  const names = {};
  listRows_('LearningObjectives').filter(function (row) { return learningActive_(row.active); }).forEach(function (row) {
    const name = String(row.className || '').trim();
    if (name) names[name] = true;
  });
  return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'id'); });
}
function listAvailableLearningSubjectOptions_() {
  learningRepositoryAssertReady_();
  const names = {};
  listRows_('LearningObjectives').filter(function (row) { return learningActive_(row.active); }).forEach(function (row) {
    const name = String(row.subject || '').trim();
    if (name) names[name] = true;
  });
  return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'id'); });
}
function listAvailableLearningObjectives_() {
  learningRepositoryAssertReady_();
  return listRows_('LearningObjectives').filter(function (r) { return learningActive_(r.active); }).map(learningObjectivePublic_);
}
function adminSaveLearningObjective_(payload) {
  learningRepositoryAssertReady_();
  bundleEditorEnhancementsAssertReady_();
  const code = requiredText_(payload.tpCode, 'Kode TP', 60).toUpperCase();
  const title = requiredText_(payload.title, 'Judul TP', 240);
  const subject = requiredText_(payload.subject, 'Mata pelajaran', 120);
  const className = requiredText_(payload.className, 'Kelas', 80);
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
        String(r.subject).trim().toLowerCase() === subject.toLowerCase() &&
        String(r.className || '').trim().toLowerCase() === className.toLowerCase();
    });
    if (duplicate) throw new Error('Kode TP sudah digunakan pada mata pelajaran dan kelas tersebut.');
    const now = currentTimestamp_();
    const after = {
      objectiveId: id || makeId_('TP'), tpCode: code, title: title, subject: subject, className: className,
      description: description, createdBy: before ? String(before.createdBy || '') : String(payload.currentUser.email || ''),
      createdAt: before ? String(before.createdAt || now) : now, updatedAt: now,
      active: before ? learningActive_(before.active) : true
    };
    learningAuditedWrite_(payload.currentUser, before ? 'UPDATE' : 'CREATE', 'LearningObjective', after.objectiveId, before || null, after, function () {
      if (before) updateRowByKey_('LearningObjectives', 'objectiveId', id, after);
      else appendRow_('LearningObjectives', after);
    });
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
    learningAuditedWrite_(payload.currentUser, payload.active ? 'ACTIVATE' : 'DEACTIVATE', 'LearningObjective', id, before, after, function () {
      updateRowByKey_('LearningObjectives', 'objectiveId', id, after);
    });
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
    learningAuditedWrite_(payload.currentUser, before ? 'UPDATE' : 'CREATE', 'LearningIndicator', after.indicatorId, before || null, after, function () {
      if (before) updateRowByKey_('LearningIndicators', 'indicatorId', id, after);
      else appendRow_('LearningIndicators', after);
    });
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
    learningAuditedWrite_(payload.currentUser, payload.active ? 'ACTIVATE' : 'DEACTIVATE', 'LearningIndicator', id, before, after, function () {
      updateRowByKey_('LearningIndicators', 'indicatorId', id, after);
    });
    return learningIndicatorPublic_(after);
  } finally { lock.releaseLock(); }
}



/* -------------------------------------------------------------------------
 * Bundle editor enhancements: TP class mapping and resumable autosave drafts.
 * Run once after BUNDLE_VERSIONING_V1 and LEARNING_REPOSITORY_V1.
 * ------------------------------------------------------------------------- */
const BUNDLE_EDITOR_ENHANCEMENT_MIGRATION_ = 'BUNDLE_EDITOR_ENHANCEMENTS_V1';
const QUESTION_BUNDLE_DRAFT_HEADERS_ = [
  'draftId','revisionId','chunkIndex','chunkCount','draftChunk','bundleId',
  'title','subject','className','classification','visibility','questionCount','createdBy','createdAt','updatedAt'
];

/** Public Apps Script menu entry point for the private migration helper. */
function runBundleEditorEnhancementsMigration() {
  return migrateBundleEditorEnhancementsV1_();
}

function migrateBundleEditorEnhancementsV1_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    assertBundleVersioningReady_();
    learningRepositoryAssertReady_();
    const spreadsheet = getSpreadsheet_();
    const migrations = listRows_('SchemaMigrations');
    if (migrations.some(function (row) {
      return String(row.migrationId) === BUNDLE_EDITOR_ENHANCEMENT_MIGRATION_ && String(row.status) === 'completed';
    })) {
      bundleEditorEnhancementsAssertReady_();
      return { success: true, alreadyApplied: true, migrationId: BUNDLE_EDITOR_ENHANCEMENT_MIGRATION_ };
    }
    const changes = {};
    ['LearningObjectives','QuestionBundles'].forEach(function (name) {
      const sheet = spreadsheet.getSheetByName(name);
      if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
        throw new Error('Sheet ' + name + ' belum memiliki header. Migrasi dihentikan.');
      }
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      if (headers.indexOf('className') < 0) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue('className');
        changes[name] = ['className'];
      } else changes[name] = [];
    });
    let draftSheet = spreadsheet.getSheetByName('QuestionBundleDrafts');
    if (!draftSheet) {
      draftSheet = spreadsheet.insertSheet('QuestionBundleDrafts');
      draftSheet.getRange(1, 1, 1, QUESTION_BUNDLE_DRAFT_HEADERS_.length).setValues([QUESTION_BUNDLE_DRAFT_HEADERS_]);
      draftSheet.setFrozenRows(1);
      draftSheet.getRange(1, 1, 1, QUESTION_BUNDLE_DRAFT_HEADERS_.length)
        .setFontWeight('bold').setBackground('#142d4e').setFontColor('#ffffff');
      draftSheet.autoResizeColumns(1, QUESTION_BUNDLE_DRAFT_HEADERS_.length);
      changes.QuestionBundleDrafts = { created: true };
    } else {
      const current = draftSheet.getLastColumn() ? draftSheet.getRange(1, 1, 1, draftSheet.getLastColumn()).getValues()[0].map(String) : [];
      QUESTION_BUNDLE_DRAFT_HEADERS_.forEach(function (header) {
        if (current.indexOf(header) < 0) {
          draftSheet.getRange(1, draftSheet.getLastColumn() + 1).setValue(header);
          current.push(header);
        }
      });
      changes.QuestionBundleDrafts = { created: false };
    }
    appendRow_('SchemaMigrations', {
      migrationId: BUNDLE_EDITOR_ENHANCEMENT_MIGRATION_, version: 1,
      appliedAt: currentTimestamp_(), appliedBy: Session.getActiveUser().getEmail() || 'Apps Script editor',
      status: 'completed', detailsJson: JSON.stringify(changes)
    });
    bundleEditorEnhancementsAssertReady_();
    return { success: true, migrationId: BUNDLE_EDITOR_ENHANCEMENT_MIGRATION_, changes: changes };
  } finally {
    lock.releaseLock();
  }
}

function bundleEditorEnhancementsAssertReady_() {
  const rows = listRows_('SchemaMigrations');
  if (!rows.some(function (row) {
    return String(row.migrationId) === BUNDLE_EDITOR_ENHANCEMENT_MIGRATION_ && String(row.status) === 'completed';
  })) throw new Error('Migrasi BUNDLE_EDITOR_ENHANCEMENTS_V1 belum selesai. Jalankan migrateBundleEditorEnhancementsV1_() terlebih dahulu.');
  validateRepositorySheetHeaders_(getSheet_('LearningObjectives'), 'LearningObjectives', ['className']);
  validateRepositorySheetHeaders_(getSheet_('QuestionBundles'), 'QuestionBundles', ['className']);
  validateRepositorySheetHeaders_(getSheet_('QuestionBundleDrafts'), 'QuestionBundleDrafts', QUESTION_BUNDLE_DRAFT_HEADERS_);
}

function saveQuestionBundleDraft_(payload) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
  bundleEditorEnhancementsAssertReady_();
  const user = payload.currentUser;
  if (!user || user.role !== 'teacher') throw new Error('Akun guru terverifikasi diperlukan.');
  const draftId = String(payload.draftId || '').trim() || makeId_('DRF');
  const sheet = getSheet_('QuestionBundleDrafts');
  const allRows = listRows_('QuestionBundleDrafts');
  const previous = allRows.filter(function (row) { return String(row.draftId) === draftId; });
  if (previous.some(function (row) {
    return String(row.createdBy || '').trim().toLowerCase() !== String(user.email || '').trim().toLowerCase();
  })) throw new Error('Draft ini bukan milik akun guru yang sedang masuk.');
  const source = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : {};
  const snapshot = {
    title: String(source.title || ''),
    subject: String(source.subject || ''),
    className: String(source.className || ''),
    description: String(source.description || ''),
    classification: String(source.classification || 'REGULER').toUpperCase(),
    visibility: String(source.visibility || 'shared') === 'private' ? 'private' : 'shared',
    learningObjectiveId: String(source.learningObjectiveId || ''),
    learningIndicatorId: String(source.learningIndicatorId || ''),
    tpCode: String(source.tpCode || ''),
    passageText: String(source.passageText || ''),
    passageImageUrl: String(source.passageImageUrl || ''),
    passages: Array.isArray(source.passages) ? source.passages : [],
    questions: Array.isArray(source.questions) ? source.questions : []
  };
  if (['REGULER','SOLO_TAX'].indexOf(snapshot.classification) < 0) throw new Error('Klasifikasi draft tidak valid.');
  if (snapshot.questions.length > 200) throw new Error('Draft tidak boleh melebihi 200 soal.');
  const json = JSON.stringify(snapshot);
  if (json.length > 2000000) throw new Error('Draft terlalu besar untuk disimpan. Kurangi ukuran teks atau gambar.');
  const chunkSize = 40000;
  const chunkCount = Math.max(1, Math.ceil(json.length / chunkSize));
  const revisionId = makeId_('REV');
  const now = currentTimestamp_();
  const createdAt = previous.length ? String(previous[0].createdAt || now) : now;
  const bundleId = String(payload.bundleId || (previous[0] && previous[0].bundleId) || '');
  for (let index = 0; index < chunkCount; index++) {
    appendRow_('QuestionBundleDrafts', {
      draftId: draftId, revisionId: revisionId, chunkIndex: index,
      chunkCount: chunkCount, draftChunk: json.slice(index * chunkSize, (index + 1) * chunkSize),
      bundleId: bundleId, title: snapshot.title, subject: snapshot.subject,
      className: snapshot.className, classification: snapshot.classification,
      visibility: snapshot.visibility, questionCount: snapshot.questions.length, createdBy: String(user.email || ''),
      createdAt: createdAt, updatedAt: now
    });
  }
  // Keep the previous complete revision until every chunk of the new revision is stored.
  deleteQuestionBundleDraftOldRevisions_(draftId, revisionId);
  return { draftId: draftId, updatedAt: now, questionCount: snapshot.questions.length };
  } finally { lock.releaseLock(); }
}

function deleteQuestionBundleDraftOldRevisions_(draftId, keepRevisionId) {
  const sheet = getSheet_('QuestionBundleDrafts');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const idCol = headers.indexOf('draftId'), revisionCol = headers.indexOf('revisionId');
  for (let row = values.length - 1; row >= 1; row--) {
    if (String(values[row][idCol]) === String(draftId) && String(values[row][revisionCol]) !== String(keepRevisionId)) {
      sheet.deleteRow(row + 1);
    }
  }
}

function listQuestionBundleDrafts_(payload) {
  bundleEditorEnhancementsAssertReady_();
  const email = String(payload.currentUser && payload.currentUser.email || '').trim().toLowerCase();
  const rows = listRows_('QuestionBundleDrafts').filter(function (row) {
    return String(row.createdBy || '').trim().toLowerCase() === email;
  });
  const grouped = {};
  rows.forEach(function (row) { (grouped[row.draftId] || (grouped[row.draftId] = [])).push(row); });
  return Object.keys(grouped).map(function (id) {
    const revision = latestCompleteQuestionBundleDraftRevision_(grouped[id]);
    if (!revision) return null;
    const row = revision.rows[0];
    return {
      draftId: String(row.draftId), bundleId: String(row.bundleId || ''),
      title: String(row.title || ''), subject: String(row.subject || ''),
      className: String(row.className || ''), classification: String(row.classification || 'REGULER'),
      questionCount: Number(row.questionCount) || 0, updatedAt: String(row.updatedAt || '')
    };
  }).filter(Boolean).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function latestCompleteQuestionBundleDraftRevision_(rows) {
  const groups = {};
  (rows || []).forEach(function (row) {
    const id = String(row.revisionId || '');
    if (!id) return;
    (groups[id] || (groups[id] = [])).push(row);
  });
  const complete = Object.keys(groups).map(function (id) {
    const items = groups[id].slice().sort(function (a, b) { return Number(a.chunkIndex) - Number(b.chunkIndex); });
    const expected = Number(items[0].chunkCount) || 0;
    if (!expected || items.length !== expected) return null;
    for (let i = 0; i < expected; i++) if (Number(items[i].chunkIndex) !== i) return null;
    return { revisionId: id, rows: items, updatedAt: String(items[0].updatedAt || '') };
  }).filter(Boolean);
  complete.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  return complete[0] || null;
}

function getQuestionBundleDraft_(payload) {
  bundleEditorEnhancementsAssertReady_();
  const draftId = requiredText_(payload.draftId, 'ID draft', 100);
  const email = String(payload.currentUser && payload.currentUser.email || '').trim().toLowerCase();
  const rows = listRows_('QuestionBundleDrafts').filter(function (row) {
    return String(row.draftId) === draftId && String(row.createdBy || '').trim().toLowerCase() === email;
  });
  if (!rows.length) throw new Error('Draft bundel tidak ditemukan atau bukan milik akun ini.');
  const revision = latestCompleteQuestionBundleDraftRevision_(rows);
  if (!revision) throw new Error('Draf belum memiliki versi tersimpan yang lengkap. Coba muat ulang setelah koneksi stabil.');
  const revisionRows = revision.rows;
  const json = revisionRows.map(function (row) { return String(row.draftChunk || ''); }).join('');
  return {
    draftId: draftId, bundleId: String(revisionRows[0].bundleId || ''),
    snapshot: JSON.parse(json), updatedAt: String(revisionRows[0].updatedAt || '')
  };
}

function deleteQuestionBundleDraft_(payload) {
  bundleEditorEnhancementsAssertReady_();
  const draftId = requiredText_(payload.draftId, 'ID draft', 100);
  const email = String(payload.currentUser && payload.currentUser.email || '').trim().toLowerCase();
  const rows = listRows_('QuestionBundleDrafts').filter(function (row) {
    return String(row.draftId) === draftId;
  });
  if (rows.some(function (row) { return String(row.createdBy || '').trim().toLowerCase() !== email; })) {
    throw new Error('Draft ini bukan milik akun guru yang sedang masuk.');
  }
  deleteQuestionBundleDraftRows_(draftId, email);
  return { success: true, draftId: draftId };
}

function deleteQuestionBundleDraftRows_(draftId, ownerEmail) {
  if (!draftId) return;
  const sheet = getSheet_('QuestionBundleDrafts');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const idCol = headers.indexOf('draftId'), ownerCol = headers.indexOf('createdBy');
  const email = String(ownerEmail || '').trim().toLowerCase();
  for (let row = values.length - 1; row >= 1; row--) {
    if (String(values[row][idCol]) === String(draftId)) {
      if (email && String(values[row][ownerCol] || '').trim().toLowerCase() !== email) {
        throw new Error('Draft ini bukan milik akun guru yang sedang masuk.');
      }
      sheet.deleteRow(row + 1);
    }
  }
}
