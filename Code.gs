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
    'userId', 'name', 'email', 'role', 'className', 'active', 'createdAt'
  ],
  Assessments: [
    'assessmentId', 'title', 'subject', 'className', 'duration',
    'startAt', 'endAt', 'passageText', 'passageImageUrl', 'status', 'createdBy', 'createdAt', 'updatedAt'
  ],
  QuestionBundles: ['bundleId','title','subject','description','tpCode','passageText','passageImageUrl','passagesJson','questionsJson','status','createdBy','createdAt','updatedAt'],
  LearningObjectives: ['objectiveId','tpCode','title','subject','description','createdBy','createdAt','updatedAt','active'],
  Questions: [
    'questionId', 'assessmentId', 'order', 'type', 'text', 'points',
    'optionsJson', 'answerJson', 'rubric', 'pairsJson', 'imageUrl', 'optionImagesJson', 'subquestionsJson', 'rubricLevelsJson', 'passageText', 'passageImageUrl'
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
    'fileId', 'attemptId', 'studentId', 'driveFileId', 'fileUrl', 'createdAt'
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
  const cacheKey = 'rumble_frontend_html_v6';
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = 'https://raw.githubusercontent.com/sg-mathuniverse/rumble-assessment/uiux-security-refresh-2026-10-29/index.html';
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
  if (action === 'getCurrentUser') return getCurrentUser_();

  // Identitas berasal dari sesi Google server, bukan dari payload browser.
  const auth = getCurrentUser_();
  if (!auth || !auth.authenticated || !auth.user) {
    throw new Error('Akses ditolak. Masuk menggunakan akun Google sekolah yang terdaftar dan aktif.');
  }
  const user = auth.user;
  const trusted = Object.assign({}, payload || {}, {
    currentUser: user,
    studentId: user.role === 'student' ? String(user.userId || '') : String(payload.studentId || ''),
    createdBy: user.email
  });
  const teacherOnly = [
    'createAssessment','deleteAssessment','saveQuestionBundle','listQuestionBundles',
    'getQuestionBundle','updateAssessment','uploadAssessmentImage','deleteAssessmentImage',
    'publishAssessment','gradeAttempt','listStudents'
  ];
  const studentOnly = ['submitAttempt','logEvent','uploadAnswerImage','startAttempt','saveAttempt'];
  const shared = ['listAssessments','getAssessment','listAttempts'];
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
      if (!attempt || String(attempt.studentId) !== String(user.userId)) throw new Error('Pengerjaan tidak ditemukan untuk akun ini.');
      return logEvent_(trusted);
    },
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
      return uploadAnswerImage_(Object.assign({}, trusted, { assessmentId: assessment.assessmentId }));
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
  setupDatabase();
  const title = requiredText_(payload.title, 'Judul bundel', 180);
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!questions.length || questions.length > 200) {
    throw new Error('Jumlah soal bundel harus antara 1 dan 200.');
  }
  questions.forEach(function (q, i) {
    const type = String(q.type || 'multiple_choice');
    const points = Number(q.points);
    if (['multiple_choice','true_false','true_false_multi','multi_select','matching','essay'].indexOf(type) < 0) {
      throw new Error('Tipe soal tidak valid pada soal nomor ' + (i + 1));
    }
    if (!isFinite(points) || points < 0 || points > 1000) {
      throw new Error('Bobot nilai tidak valid pada soal nomor ' + (i + 1));
    }
  });
  const bundleId = String(payload.bundleId || payload.id || makeId_('BND'));
  const sheet = getSheet_('QuestionBundles');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idCol = headers.indexOf('bundleId');
  let rowNumber = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === bundleId) { rowNumber = i + 1; break; }
  }
  const now = currentTimestamp_();
  const record = {
    bundleId: bundleId,
    title: title,
    subject: String(payload.subject || ''),
    description: String(payload.description || ''),
    tpCode: String(payload.tpCode || '').trim().toUpperCase(),
    passageText: String(payload.passageText || ''),
    passageImageUrl: String(payload.passageImageUrl || ''),
    passagesJson: JSON.stringify(Array.isArray(payload.passages)?payload.passages:[]),
    questionsJson: JSON.stringify(questions),
    status: 'ready',
    createdBy: String(payload.createdBy || ''),
    createdAt: rowNumber > 0 ? String(values[rowNumber - 1][headers.indexOf('createdAt')] || now) : now,
    updatedAt: now
  };
  if (rowNumber > 0) {
    headers.forEach(function (header, col) {
      if (Object.prototype.hasOwnProperty.call(record, header)) {
        sheet.getRange(rowNumber, col + 1).setValue(record[header]);
      }
    });
  } else {
    appendRow_('QuestionBundles', record);
  }
  return { bundleId: bundleId, title: title, questionCount: questions.length, status: 'ready' };
}

function listQuestionBundles_(payload) {
  setupDatabase();
  const user = payload.currentUser;
  if (!user || user.role !== 'teacher') throw new Error('Akun guru terverifikasi diperlukan.');
  return listRows_('QuestionBundles')
    .filter(function (bundle) {
      const owned = bundle.createdBy && String(bundle.createdBy).trim().toLowerCase() === String(user.email).trim().toLowerCase();
      const statusMatches = !payload.status || String(bundle.status) === String(payload.status);
      return owned && statusMatches;
    })
    .map(function (bundle) {
      const item = Object.assign({}, bundle);
      item.questionCount = parseJson_(bundle.questionsJson, []).length;
      delete item.questionsJson;
      delete item.passagesJson;
      return item;
    });
}

function getQuestionBundle_(payload) {
  setupDatabase();
  const bundleId = requiredText_(payload.bundleId || payload.id, 'ID bundel', 100);
  const bundle = listRows_('QuestionBundles').find(function (item) {
    return String(item.bundleId) === bundleId;
  });
  if (!bundle) throw new Error('Bundel soal tidak ditemukan.');
  const user = payload.currentUser;
  if (!user || user.role !== 'teacher') throw new Error('Akun guru terverifikasi diperlukan.');
  if (!bundle.createdBy || String(bundle.createdBy).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
    throw new Error('Akses ditolak. Bundel lama tanpa pemilik terverifikasi perlu dimigrasikan oleh administrator.');
  }
  return {
    bundle: {
      bundleId: bundle.bundleId,
      title: bundle.title,
      subject: bundle.subject,
      description: bundle.description,
      tpCode: String(bundle.tpCode || ''),
      passageText: bundle.passageText,
      passageImageUrl: bundle.passageImageUrl,
      passages: parseJson_(bundle.passagesJson, []),
      status: bundle.status
    },
    questions: parseJson_(bundle.questionsJson, [])
  };
}

function createAssessment_(payload) {
  setupDatabase();
  const title = requiredText_(payload.title, 'Judul', 180);
  const questions = Array.isArray(payload.questions)
    ? payload.questions
    : [];

  if (questions.length < 1 || questions.length > 200) {
    throw new Error('Jumlah soal harus antara 1 dan 200.');
  }

  const assessmentId = makeId_('ASM');
  const timestamp = currentTimestamp_();

  appendRow_('Assessments', {
    assessmentId: assessmentId,
    title: title,
    subject: String(payload.subject || ''),
    className: String(payload.className || ''),
    duration: Math.max(1, Math.min(300, Number(payload.duration) || 60)),
    startAt: String(payload.startAt || ''),
    endAt: String(payload.endAt || ''),
    passageText: String(payload.passageText || ''),
    passageImageUrl: String(payload.passageImageUrl || ''),
    status: 'draft',
    createdBy: String(payload.createdBy || ''),
    createdAt: timestamp,
    updatedAt: timestamp
  });

  questions.forEach(function (question, index) {
    const type = String(question.type || 'multiple_choice');
    const points = Number(question.points);

    const allowedTypes = [
      'multiple_choice',
      'true_false',
      'true_false_multi',
      'multi_select',
      'matching',
      'essay'
    ];

    if (allowedTypes.indexOf(type) === -1) {
      throw new Error('Tipe soal tidak valid pada soal nomor ' + (index + 1));
    }

    if (!isFinite(points) || points < 0 || points > 1000) {
      throw new Error('Bobot soal tidak valid pada soal nomor ' + (index + 1));
    }

    appendRow_('Questions', {
      questionId: makeId_('Q'),
      assessmentId: assessmentId,
      order: index + 1,
      type: type,
      text: String(question.text || ''),
      points: points,
      optionsJson: JSON.stringify(question.options || []),
      answerJson: JSON.stringify(
        question.answer === undefined ? null : question.answer
      ),
      rubric: String(question.rubric || ''),
      pairsJson: JSON.stringify(question.pairs || ''),
      imageUrl: String(question.imageUrl || ''),
      optionImagesJson: JSON.stringify(question.optionImages || []),
      subquestionsJson: JSON.stringify(question.subquestions || []),
      rubricLevelsJson: JSON.stringify(question.rubricLevels || []),
      passageText: String(question.passageText || ''),
      passageImageUrl: String(question.passageImageUrl || '')
    });
  });

  return {
    id: assessmentId,
    title: title,
    status: 'draft',
    questionCount: questions.length
  };
}

/**
 * Mengambil daftar asesmen, dengan filter opsional.
 */
function getOrCreateChildFolder_(parentFolder, folderName) {
  const matches = parentFolder.getFoldersByName(folderName);
  return matches.hasNext() ? matches.next() : parentFolder.createFolder(folderName);
}

/**
 * Mengunggah gambar asesmen ke subfolder berdasarkan jenis gambar.
 * Gambar soal hanya dibagikan ke pengguna domain sekolah, bukan publik.
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

  let domainSharingEnabled = true;
  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sharingError) {
    domainSharingEnabled = false;
  }

  return {
    url: file.getUrl(),
    imageUrl: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600',
    fileId: file.getId(),
    name: file.getName(),
    folder: '01 - Gambar Asesmen/' + subfolderNames[kind],
    domainSharingEnabled: domainSharingEnabled,
    warning: domainSharingEnabled ? '' : 'Gambar tersimpan, tetapi izin berbagi domain tidak dapat diatur otomatis. Admin Google Workspace mungkin membatasi izin Drive.'
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
  const user = payload.currentUser;
  const expectedDescription = 'Rumble Assessment owner: ' + String(user && user.email || '').trim().toLowerCase();
  if (!user || user.role !== 'teacher' || String(file.getDescription() || '') !== expectedDescription) {
    throw new Error('Gambar tidak memiliki pemilik terverifikasi untuk akun guru ini. Minta administrator memigrasikan atau unggah ulang gambar lama.');
  }
  file.setTrashed(true);
  return { fileId: fileId, deleted: true };
}

function updateAssessment_(payload) {
  setupDatabase();
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
      rubricLevelsJson: JSON.stringify(question.rubricLevels || [])
    });
  });
  return { id: assessmentId, title: updates.title, status: 'draft', questionCount: questions.length };
}

/**
 * Menghapus asesmen draft dan soal-soalnya. Asesmen terpublikasi dilindungi.
 */
function deleteAssessment_(payload) {
  setupDatabase();
  const assessmentId = requiredText_(payload.id || payload.assessmentId, 'ID asesmen', 100);
  const assessmentSheet = getSheet_('Assessments');
  const values = assessmentSheet.getDataRange().getValues();
  if (!values.length) throw new Error('Asesmen tidak ditemukan.');
  const headers = values[0].map(String);
  const idCol = headers.indexOf('assessmentId');
  const statusCol = headers.indexOf('status');
  let rowNumber = -1;
  let status = '';
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === assessmentId) {
      rowNumber = i + 1;
      status = statusCol >= 0 ? String(values[i][statusCol]) : '';
      break;
    }
  }
  if (rowNumber < 0) throw new Error('Asesmen tidak ditemukan.');
  const attemptsSheet = getSheet_('Attempts');
  const attemptValues = attemptsSheet.getDataRange().getValues();
  if (attemptValues.length > 1) {
    const attemptHeaders = attemptValues[0].map(String);
    const attemptAssessmentCol = attemptHeaders.indexOf('assessmentId');
    if (attemptAssessmentCol >= 0) {
      for (let i = attemptValues.length - 1; i >= 1; i--) {
        if (String(attemptValues[i][attemptAssessmentCol]) === assessmentId) attemptsSheet.deleteRow(i + 1);
      }
    }
  }
  const questionSheet = getSheet_('Questions');
  const qValues = questionSheet.getDataRange().getValues();
  if (qValues.length > 1) {
    const qHeaders = qValues[0].map(String);
    const qIdCol = qHeaders.indexOf('assessmentId');
    for (let i = qValues.length - 1; i >= 1; i--) {
      if (qIdCol >= 0 && String(qValues[i][qIdCol]) === assessmentId) {
        questionSheet.deleteRow(i + 1);
      }
    }
  }
  assessmentSheet.deleteRow(rowNumber);
  return { assessmentId: assessmentId, deleted: true };
}

function deleteQuestionBundle_(payload) {
  setupDatabase();
  const bundleId = requiredText_(payload.id || payload.bundleId, 'ID bundel', 100);
  const sheet = getSheet_('QuestionBundles');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Bundel soal tidak ditemukan.');
  const headers = values[0].map(String), idCol = headers.indexOf('bundleId');
  if (idCol < 0) throw new Error('Kolom ID bundel tidak ditemukan.');
  let rowNumber = -1;
  for (let i = 1; i < values.length; i++) if (String(values[i][idCol]) === bundleId) { rowNumber = i + 1; break; }
  if (rowNumber < 0) throw new Error('Bundel soal tidak ditemukan.');
  sheet.deleteRow(rowNumber);
  return { bundleId: bundleId, deleted: true };
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
      const matchesStatus = !payload.status || String(assessment.status) === String(payload.status);
      const matchesClass = user.role === 'student' ||
        (!payload.className || String(assessment.className) === String(payload.className));
      return matchesStatus && matchesClass;
    })
    .map(function (assessment) {
      const item = Object.assign({}, assessment);
      item.questionCount = questions.filter(function (question) {
        return question.assessmentId === assessment.assessmentId;
      }).length;
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
    const answers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers) ? payload.answers : {};
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
    attemptsSheet.getRange(rowNumber, col('answersJson') + 1).setValue(JSON.stringify(answers));
  } else {
    appendRow_('Attempts', {
      attemptId: attemptId, assessmentId: assessmentId, studentId: studentId,
      startedAt: currentTimestamp_(), submittedAt: submittedAt, status: finalStatus,
      score: score, maxScore: maxScore,
      focusLossCount: Math.max(0, Number(payload.focusLossCount) || 0),
      answersJson: JSON.stringify(answers), teacherFeedback: ''
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
      return Object.assign({}, attempt, {
        assessmentTitle: assessment ? assessment.title : attempt.assessmentId,
        subject: assessment ? String(assessment.subject || '') : '',
        className: assessment ? String(assessment.className || '') : '',
        answers: parseJson_(attempt.answersJson, {}),
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
 * Mencatat peristiwa selama pengerjaan asesmen.
 */
function logEvent_(payload) {
  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const studentId = requiredText_(payload.studentId, 'ID siswa', 120);
  const eventType = requiredText_(payload.eventType, 'Jenis kejadian', 80);

  appendRow_('Events', {
    eventId: makeId_('EVT'),
    attemptId: attemptId,
    studentId: studentId,
    eventType: eventType,
    eventAt: currentTimestamp_(),
    detailsJson: JSON.stringify(payload.details || {})
  });

  return { logged: true };
}

/**
 * Membuat pengguna sederhana.
 * Autentikasi dan validasi izin perlu ditambahkan sebelum produksi.
 */
function getCurrentUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) return { authenticated: false, email: '', user: null, reason: 'email_unavailable' };
  const user = listRows_('Users').find(function (item) { return String(item.email || '').trim().toLowerCase() === email; });
  if (!user) return { authenticated: false, email: email, user: null, reason: 'not_registered' };
  const active = user.active === true || String(user.active).toLowerCase() === 'true' || String(user.active) === '1';
  if (!active) return { authenticated: false, email: email, user: null, reason: 'inactive' };
  const role = String(user.role || '').trim().toLowerCase();
  if (role !== 'teacher' && role !== 'student') return { authenticated: false, email: email, user: null, reason: 'invalid_role' };
  return { authenticated: true, email: email, user: { userId: user.userId, name: user.name, email: email, role: role, className: user.className || '' } };
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
  if (!CONFIG.DRIVE_FOLDER_ID) throw new Error('Isi CONFIG.DRIVE_FOLDER_ID terlebih dahulu.');
  const mimeType = String(payload.mimeType || 'image/jpeg');
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimeTypes.indexOf(mimeType) === -1) throw new Error('Format gambar harus JPG, PNG, atau WebP.');

  const base64 = String(payload.base64 || '');
  if (!base64 || base64.length > 8 * 1024 * 1024) throw new Error('Gambar kosong atau terlalu besar.');

  const attemptId = requiredText_(payload.attemptId, 'ID pengerjaan', 100);
  const studentId = requiredText_(payload.studentId, 'ID siswa', 120);
  const assessmentId = String(payload.assessmentId || 'Asesmen-Tanpa-ID').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  const safeAttemptId = attemptId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  const fileName = String(payload.fileName || 'jawaban.jpg').replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);

  const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const answerRoot = getOrCreateChildFolder_(root, '02 - Jawaban Siswa');
  const assessmentFolder = getOrCreateChildFolder_(answerRoot, assessmentId);
  const attemptFolder = getOrCreateChildFolder_(assessmentFolder, safeAttemptId);
  // Foto jawaban siswa sengaja tidak dibagikan melalui tautan domain/publik.
  const file = attemptFolder.createFile(blob);
  const fileId = makeId_('FILE');

  appendRow_('Files', {
    fileId: fileId,
    attemptId: attemptId,
    studentId: studentId,
    driveFileId: file.getId(),
    fileUrl: file.getUrl(),
    createdAt: currentTimestamp_()
  });

  return { fileId: fileId, name: file.getName(), url: file.getUrl(), folder: '02 - Jawaban Siswa/' + assessmentId + '/' + safeAttemptId };
}
