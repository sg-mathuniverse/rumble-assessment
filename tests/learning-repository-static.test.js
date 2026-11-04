/**
 * Static guard tests for the Apps Script learning repository.
 * Run from the repository root: node tests/learning-repository-static.test.js
 * These tests do not connect to Apps Script or any spreadsheet.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('Code.gs', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
assert.doesNotThrow(() => new vm.Script(source), 'Code.gs must be syntactically valid JavaScript');

const appScriptStart = html.indexOf('<script>', html.indexOf('<body'));
const appScriptEnd = html.indexOf('</script>', appScriptStart);
assert.ok(appScriptStart >= 0 && appScriptEnd > appScriptStart, 'index.html must contain the application script');
assert.doesNotThrow(() => new vm.Script(html.slice(appScriptStart + 8, appScriptEnd)), 'index.html application script must be syntactically valid JavaScript');
assert.ok(html.includes("['learningRepository','▤ TP & Indikator']"), 'Admin navigation must expose the learning repository page');
assert.ok(html.includes('function learningRepositoryPage()'), 'Admin learning repository page must be implemented');
assert.ok(html.includes("api('adminListPendingLearningAudits')"), 'Admin UI must load pending audit records');
assert.ok(html.includes("api('adminReconcileLearningAudit'"), 'Admin UI must provide audit reconciliation');
assert.ok(html.includes("api('listAvailableLearningObjectives')"), 'Teacher editor must load active learning objectives');
assert.ok(html.includes("api('listAvailableLearningIndicators'"), 'Teacher editor must load indicators for the selected objective');
assert.ok(html.includes('learningObjectiveId:(s.meta||{}).learningObjectiveId'), 'Bundle save must include the selected learning objective ID');
assert.ok(html.includes('learningIndicatorId:(s.meta||{}).learningIndicatorId'), 'Bundle save must include the selected learning indicator ID');


function bodyOf(name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Missing function: ' + name);
  const end = nextName ? source.indexOf('function ' + nextName + '(', start + 1) : -1;
  return source.slice(start, end < 0 ? source.length : end);
}

const update = bodyOf('updateRowByKey_', 'bundleSnapshotFromRecord_');
assert.match(update, /Object\.keys\(fields\)\.forEach/, 'All update columns must be validated before writing');
assert.match(update, /getFormulas\(\)/, 'Untouched formulas must be preserved');
assert.match(update, /setValues\(\[updatedRow\]\)/, 'A row update must use one range write');
assert.doesNotMatch(update, /\.setValue\(/, 'A row update must not write cells individually');

const migrationPreflight = bodyOf('validateLearningMigrationPreflight_', 'migrateLearningRepositoryV1_');
assert.match(migrationPreflight, /header kosong/i, 'Migration preflight must reject blank headers');
assert.match(migrationPreflight, /header duplikat/i, 'Migration preflight must reject duplicate headers');
assert.match(migrationPreflight, /spasi di awal\/akhir/i, 'Migration preflight must reject padded headers');
const migration = bodyOf('migrateLearningRepositoryV1_', 'validateRepositorySheetHeaders_');
assert.match(migration, /validateLearningMigrationPreflight_\(spreadsheet\)/, 'Migration must run full preflight before writing sheets');
assert.ok(migration.indexOf('validateLearningMigrationPreflight_(spreadsheet)') < migration.indexOf('spreadsheet.insertSheet'), 'Preflight must run before inserting any sheet');

const headerValidation = bodyOf('validateRepositorySheetHeaders_', 'learningRepositoryAssertReady_');
assert.match(headerValidation, /getLastColumn\(\)/, 'Header validation must check sheet dimensions');
assert.match(headerValidation, /header kosong/i, 'Readiness must reject blank headers');
assert.match(headerValidation, /header duplikat/i, 'Readiness must reject duplicate headers');
const readiness = bodyOf('learningRepositoryAssertReady_', 'learningActive_');
assert.match(readiness, /LEARNING_REPOSITORY_V1/, 'Readiness must require completed migration');

const pendingAuditList = bodyOf('adminListPendingLearningAudits_', 'adminReconcileLearningAudit_');
assert.match(pendingAuditList, /PENDING_/, 'Pending audit endpoint must filter pending records');
const reconcile = bodyOf('adminReconcileLearningAudit_', 'learningObjectivePublic_');
assert.match(reconcile, /LockService\.getScriptLock/, 'Audit reconciliation must use a script lock');
assert.match(reconcile, /RECONCILED_APPLIED/, 'Audit reconciliation must record applied decisions');
assert.match(reconcile, /RECONCILED_NOT_APPLIED/, 'Audit reconciliation must record not-applied decisions');
assert.match(reconcile, /RECONCILED_MANUAL/, 'Audit reconciliation must record manual decisions');
assert.match(reconcile, /RECONCILE_PENDING/, 'Audit reconciliation must append a separate audit event');
assert.match(reconcile, /priorDecision/, 'Audit reconciliation retries must detect an existing decision');
assert.match(reconcile, /reusedDecision: true/, 'Audit reconciliation retries must reuse the prior decision');
assert.match(reconcile, /JSON\.parse\(String\(priorDecision\.afterJson/, 'Prior reconciliation decision must be validated before reuse');

assert.match(reconcile, /updateRowByKey_\('AdminAuditLog'/, 'Audit reconciliation must close the original pending record');
assert.match(source, /'adminListPendingLearningAudits','adminReconcileLearningAudit'/, 'Audit reconciliation endpoints must be admin-only');
assert.match(html, /adminListPendingLearningAudits/, 'Admin UI must load pending audit records');
assert.match(html, /adminReconcileLearningAudit/, 'Admin UI must submit audit reconciliation decisions');
assert.match(html, /auditResolution_/, 'Admin UI must require a reconciliation decision');
assert.match(html, /auditNote_/, 'Admin UI must collect a reconciliation note');

const reconciliationRows = [
  { logId: 'AUD-PENDING-1', actorUserId: 'admin-1', actorEmail: 'admin@example.test',
    action: 'PENDING_UPDATE', entityType: 'LearningObjective', entityId: 'TP-1',
    beforeJson: '{}', afterJson: '{}', createdAt: '2026-01-01T00:00:00.000Z' }
];
let appendCount = 0;
let failNextOriginalUpdate = true;
const reconciliationContext = {
  learningRepositoryAssertReady_: function () {},
  requiredText_: function (value, label) {
    const result = String(value || '').trim();
    if (!result) throw new Error(label + ' wajib diisi.');
    return result;
  },
  LockService: { getScriptLock: function () {
    return { waitLock: function () {}, releaseLock: function () {} };
  } },
  listRows_: function () { return reconciliationRows.map(function (row) { return Object.assign({}, row); }); },
  appendRow_: function (_table, row) { reconciliationRows.push(Object.assign({}, row)); appendCount++; },
  updateRowByKey_: function (_table, _key, id, fields) {
    if (id === 'AUD-PENDING-1' && failNextOriginalUpdate) {
      failNextOriginalUpdate = false;
      throw new Error('simulated write failure');
    }
    const row = reconciliationRows.find(function (item) { return item.logId === id; });
    if (!row) throw new Error('missing row');
    Object.assign(row, fields);
  },
  makeId_: function () { return 'AUD-DECISION-1'; },
  currentTimestamp_: function () { return '2026-01-01T00:01:00.000Z'; },
  JSON: JSON
};
vm.createContext(reconciliationContext);
vm.runInContext(reconcile, reconciliationContext);
assert.throws(function () {
  reconciliationContext.adminReconcileLearningAudit_(
    { logId: 'AUD-PENDING-1', resolution: 'unknown', note: 'uji' },
    { userId: 'admin-1', email: 'admin@example.test' }
  );
}, /tidak valid/, 'Unknown reconciliation decisions must be rejected');
assert.throws(function () {
  reconciliationContext.adminReconcileLearningAudit_(
    { logId: 'AUD-PENDING-1', resolution: 'applied', note: 'sudah diperiksa' },
    { userId: 'admin-1', email: 'admin@example.test' }
  );
}, /simulated write failure/, 'First attempt should expose the simulated finalization failure');
assert.equal(appendCount, 1, 'First attempt must append exactly one decision audit');
assert.equal(reconciliationRows[0].action, 'PENDING_UPDATE', 'Failed finalization must leave the original record pending');
assert.throws(function () {
  reconciliationContext.adminReconcileLearningAudit_(
    { logId: 'AUD-PENDING-1', resolution: 'not_applied', note: 'permintaan retry berbeda' },
    { userId: 'admin-1', email: 'admin@example.test' }
  );
}, /keputusan rekonsiliasi yang berbeda/, 'Conflicting retry must not silently reuse the first decision');
assert.equal(reconciliationRows[0].action, 'PENDING_UPDATE', 'Conflicting retry must leave the original record pending');
const retryResult = reconciliationContext.adminReconcileLearningAudit_(
  { logId: 'AUD-PENDING-1', resolution: 'applied', note: 'sudah diperiksa' },
  { userId: 'admin-1', email: 'admin@example.test' }
);
assert.equal(retryResult.action, 'RECONCILED_APPLIED', 'Matching retry must reuse the first recorded decision');
assert.equal(retryResult.reusedDecision, true, 'Matching retry must report reuse of the original decision');
assert.equal(appendCount, 1, 'Retry must not append a duplicate decision audit');
assert.equal(reconciliationRows[0].action, 'RECONCILED_APPLIED', 'Matching retry must close the original pending record');



const audit = bodyOf('learningAuditedWrite_', 'learningObjectivePublic_');
assert.match(audit, /learningAuditBegin_/, 'Audit intent must be persisted before entity write');
assert.match(audit, /writeFn\(\)/, 'Audited write must execute the entity write');
assert.match(audit, /learningAuditComplete_/, 'Audit intent must be finalized after entity write');
assert.match(audit, /PENDING_/, 'Incomplete writes must remain visibly pending');

for (const endpoint of [
  'adminSaveLearningObjective_',
  'adminSetLearningObjectiveActive_',
  'adminSaveLearningIndicator_',
  'adminSetLearningIndicatorActive_'
]) {
  const start = source.indexOf('function ' + endpoint + '(');
  assert.notEqual(start, -1, 'Missing endpoint: ' + endpoint);
  const next = source.indexOf('\nfunction ', start + 1);
  const section = source.slice(start, next < 0 ? source.length : next);
  assert.match(section, /learningAuditedWrite_/, endpoint + ' must use audited write wrapper');
}


assert.match(html, /learningRepositoryPage\(\)/, 'Admin learning repository page must be registered');
assert.match(html, /adminListLearningObjectives/, 'Admin UI must load learning objectives');
assert.match(html, /adminListLearningIndicators/, 'Admin UI must load learning indicators');
assert.match(html, /listAvailableLearningObjectives/, 'Teacher UI must load active learning objectives');
assert.match(html, /listAvailableLearningIndicators/, 'Teacher UI must load active learning indicators');
assert.match(html, /id="bundleLearningObjective"/, 'Bundle editor must expose the objective selector');
assert.match(html, /id="bundleLearningIndicator"/, 'Bundle editor must expose the indicator selector');
assert.match(html, /learningObjectiveId:\(s\.meta\|\|\{\}\)\.learningObjectiveId/, 'Bundle save must submit the objective reference');
assert.match(html, /learningIndicatorId:\(s\.meta\|\|\{\}\)\.learningIndicatorId/, 'Bundle save must submit the indicator reference');
assert.match(source, /validateBundleLearningReference_\(snapshot\)/, 'Server must validate bundle learning references');
assert.match(source, /learningObjectiveId:String\(payload\.learningObjectiveId/, 'Version snapshot must persist objective ID');
assert.match(source, /learningIndicatorId:String\(payload\.learningIndicatorId/, 'Version snapshot must persist indicator ID');


const assessmentCreation = bodyOf('createAssessment_', 'getAssessment_');
assert.match(assessmentCreation, /sourceVersion=getBundleVersion_/, 'Assessment creation must resolve a concrete bundle version');
assert.match(assessmentCreation, /questions=sourceVersion\.snapshot\.questions/, 'Assessment questions must come from the immutable version snapshot');
assert.match(assessmentCreation, /current\.latestVersionId\)!==String\(sourceVersion\.versionId\)/, 'Assessment creation must detect a bundle version changed during creation');
assert.match(assessmentCreation, /bundleVersionId:sourceVersion\?sourceVersion\.versionId:''/, 'Assessment must retain its source version reference');
assert.match(assessmentCreation, /sourceBundleVersionId:sourceVersion\?sourceVersion\.versionId:''/, 'Copied questions must retain their source version reference');
const bundleRead = bodyOf('getQuestionBundle_', 'createAssessment_');
assert.match(bundleRead, /getBundleVersion_\(\{versionId:bundle\.latestVersionId\}\)/, 'Opening a bundle must resolve the latest immutable version');
assert.match(bundleRead, /learningObjectiveId:String\(snapshot\.learningObjectiveId/, 'Bundle read must return the objective from its snapshot');
assert.match(bundleRead, /learningIndicatorId:String\(snapshot\.learningIndicatorId/, 'Bundle read must return the indicator from its snapshot');
assert.match(source, /function validateSoloTaxQuestion_\(/, 'SOLO Tax bundles must use dedicated essay validation');
assert.match(source, /SOLO Tax hanya mendukung tipe soal uraian/, 'SOLO Tax must reject non-essay question types');
assert.match(source, /SOLO Tax hanya mengizinkan satu foto/, 'SOLO Tax must enforce one answer photo per main question');
assert.match(source, /hasResponse && value < 1/, 'Submitted SOLO Tax answers must receive at least one point');
assert.match(source, /!hasResponse && value !== 0/, 'Blank SOLO Tax answers must receive zero');
assert.match(source, /function saveSoloIndicatorVerification_\(/, 'SOLO Tax indicator verification must be persisted by a dedicated server function');
assert.match(source, /SOLO_INDICATOR_VERIFICATION_INVALIDATED/, 'Changing a score must invalidate prior indicator verification');
assert.match(source, /assessment && String\(assessment\.classification \|\| ''\)\.toUpperCase\(\) === 'SOLO_TAX' && !canViewInternal \? \{\}/, 'Students must not receive per-question SOLO Tax scores');
assert.match(source, /saveSoloIndicatorVerification: function \(\)/, 'Teacher route must expose the indicator verification action');
assert.match(source, /function saveSoloDominantVerification_\(/, 'Dominant SOLO level must have a dedicated teacher verification endpoint');
assert.match(source, /function requestSoloAiAssessment_\(/, 'AI scoring must run only through an explicit teacher request');
assert.match(source, /if \(!settings\.scoringEnabled\)/, 'AI scoring must remain disabled unless enabled by Admin');
assert.match(source, /hasPhotoAttachment: photos\.length > 0/, 'AI input may indicate a photo exists without sending the photo');
assert.match(source, /AI_SOLO_SCORING_RECOMMENDATION/, 'AI scoring recommendations must be saved separately from final grades');
assert.match(source, /AI_SOLO_SCORING_FAILED/, 'Failed AI scoring requests must be logged');
assert.match(source, /recommendedScore: 0/, 'An entirely blank SOLO response must be assigned zero without relying on AI');
assert.match(source, /manualPhotoReviewRequired: true/, 'Photo-only answers must be reserved for manual teacher review');
assert.match(html, /function soloAiPanel\(/, 'Teacher reports must display AI scoring recommendations and evidence');
assert.match(html, /requestSoloAiAssessment\(/, 'Teacher UI must provide an explicit action to request AI scoring');

assert.match(source, /PropertiesService\.getScriptProperties\(\)/, 'AI credentials must be stored in server-side Script Properties');
assert.match(source, /RUMBLE_AI_PROMPT_CONTENT_/, 'Prompt text must be stored separately from the prompt index to respect Script Properties value limits');
assert.match(source, /requiredText_\(payload\.content, 'Isi prompt', 1200\)/, 'Each prompt version must stay within the bounded server property size');

assert.match(source, /settings\.hasApiKey = !!aiScriptProperties_\(\)\.getProperty/, 'Admin settings may expose only whether an API key exists, never the key itself');
assert.match(source, /Aktifkan prompt AI Penilaian yang sudah lulus uji simulasi/, 'AI scoring cannot be enabled without a tested active prompt');
assert.match(source, /Aktifkan prompt AI Refleksi yang sudah lulus uji simulasi/, 'AI reflection cannot be enabled without a tested active prompt');
assert.match(source, /prompt harus berhasil diuji menggunakan data simulasi/i, 'A prompt must pass simulation testing before activation');
assert.match(source, /UJI COBA DENGAN DATA SIMULASI, BUKAN DATA SISWA NYATA/, 'Prompt testing must use simulated data only');

assert.match(source, /aiEvidenceSummary: aiEvidence/, 'Dominant level audit must preserve the qualitative AI evidence summary');
assert.match(source, /teacherReason: teacherReason/, 'Teacher overrides of the AI level must retain a reason');
assert.match(source, /latestAnswer\.photos\.length >= 1/, 'Concurrent SOLO Tax photo uploads must recheck the saved photo list under lock');
assert.match(source, /points: String\(assessment\.classification \|\| ''\)\.toUpperCase\(\) === 'SOLO_TAX' && !canIncludeAnswers \? undefined/, 'Students must not receive per-question SOLO Tax points in assessment details');
assert.match(source, /rubricLevels: canViewInternal \? parseJson_\(question\.rubricLevelsJson, \[\]\) : \[\]/, 'Students must not receive internal SOLO rubrics from submitted attempt details');
assert.match(source, /const teacherOnly = \[/, 'Teacher-only actions must be explicitly registered');

const routeAction = bodyOf('routeAction_', 'assertAssessmentOwner_');
const routeContext = {
  getCurrentUser_: function () {
    return { authenticated: true, user: { userId: 'user-1', email: 'user@example.test', role: routeContext.testRole } };
  },
  adminListPendingLearningAudits_: function () { return ['admin-only-data']; },
  adminReconcileLearningAudit_: function () { return { action: 'RECONCILED_APPLIED' }; },
  listAvailableLearningObjectives_: function () { return ['active-objectives']; },
  listAvailableLearningIndicators_: function () { return ['active-indicators']; }
};
vm.createContext(routeContext);
vm.runInContext(routeAction, routeContext);
for (const role of ['teacher', 'student']) {
  routeContext.testRole = role;
  assert.throws(function () {
    routeContext.routeAction_('adminListPendingLearningAudits', { sessionToken: 'valid-session' });
  }, /administrator/, role + ' must not list pending admin audits');
  assert.throws(function () {
    routeContext.routeAction_('adminReconcileLearningAudit', { sessionToken: 'valid-session', logId: 'AUD-1' });
  }, /administrator/, role + ' must not reconcile admin audits');
}
routeContext.testRole = 'student';
assert.throws(function () {
  routeContext.routeAction_('listAvailableLearningObjectives', { sessionToken: 'valid-session' });
}, /Admin dan Guru/, 'Student must not read learning repository references');
routeContext.testRole = 'teacher';
assert.deepEqual(Array.from(routeContext.routeAction_('listAvailableLearningObjectives', { sessionToken: 'valid-session' })), ['active-objectives'], 'Teacher may read active learning objectives');
routeContext.testRole = 'admin';
assert.deepEqual(Array.from(routeContext.routeAction_('adminListPendingLearningAudits', { sessionToken: 'valid-session' })), ['admin-only-data'], 'Admin may list pending audit records');
assert.equal(routeContext.routeAction_('adminReconcileLearningAudit', { sessionToken: 'valid-session', logId: 'AUD-1' }).action, 'RECONCILED_APPLIED', 'Admin may reconcile audit records');

function extractFunction(name, sourceText) {
  const start = sourceText.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Missing function for isolated test: ' + name);
  const next = sourceText.indexOf(String.fromCharCode(10) + 'function ', start + 1);
  return sourceText.slice(start, next < 0 ? sourceText.length : next);
}

const migrationContext = {
  LEARNING_REPOSITORY_TABLES_: {
    LearningObjectives: ['objectiveId', 'tpCode', 'title'],
    LearningIndicators: ['indicatorId', 'objectiveId', 'indicatorCode'],
    AdminAuditLog: ['logId', 'action']
  }
};
vm.createContext(migrationContext);
vm.runInContext(extractFunction('validateRepositorySheetHeaders_', source), migrationContext);
vm.runInContext(extractFunction('validateLearningMigrationPreflight_', source), migrationContext);
function mockSheet(headers, lastRow) {
  return {
    getLastRow: function () { return lastRow === undefined ? 1 : lastRow; },
    getLastColumn: function () { return headers.length; },
    getRange: function () { return { getValues: function () { return [headers]; } }; }
  };
}
function mockSpreadsheet(sheets) {
  return { getSheetByName: function (name) { return sheets[name] || null; } };
}
const validMigrationSheets = {
  SchemaMigrations: mockSheet(['migrationId', 'version', 'appliedAt', 'appliedBy', 'status', 'detailsJson']),
  LearningObjectives: mockSheet(['objectiveId', 'tpCode', 'title', 'subject']),
  LearningIndicators: mockSheet(['indicatorId', 'objectiveId', 'indicatorCode']),
  AdminAuditLog: mockSheet(['logId', 'action'])
};
assert.equal(migrationContext.validateLearningMigrationPreflight_(mockSpreadsheet(validMigrationSheets)), true,
  'Valid existing headers must pass migration preflight; missing required columns can be appended later');
assert.throws(function () {
  migrationContext.validateLearningMigrationPreflight_(mockSpreadsheet(Object.assign({}, validMigrationSheets, {
    LearningIndicators: mockSheet(['indicatorId', '', 'indicatorCode'])
  })));
}, /Header kosong/, 'Blank target header must fail preflight');
assert.throws(function () {
  migrationContext.validateLearningMigrationPreflight_(mockSpreadsheet(Object.assign({}, validMigrationSheets, {
    LearningObjectives: mockSheet(['objectiveId', 'tpCode', 'tpCode'])
  })));
}, /Header duplikat/, 'Duplicate target header must fail preflight');
assert.throws(function () {
  migrationContext.validateLearningMigrationPreflight_(mockSpreadsheet(Object.assign({}, validMigrationSheets, {
    LearningObjectives: mockSheet(['objectiveId', ' tpCode ', 'title'])
  })));
}, /spasi di awal.*akhir/, 'Padded target header must fail preflight');
assert.throws(function () {
  migrationContext.validateLearningMigrationPreflight_(mockSpreadsheet({
    LearningObjectives: validMigrationSheets.LearningObjectives
  }));
}, /SchemaMigrations belum tersedia/, 'Missing migration ledger must fail before touching target sheets');
const migrationBody = extractFunction('migrateLearningRepositoryV1_', source);
assert.ok(migrationBody.indexOf('validateLearningMigrationPreflight_(spreadsheet)') <
  migrationBody.indexOf('spreadsheet.insertSheet(tableName)'), 'All target headers must be preflighted before any sheet is created');
assert.ok(migrationBody.indexOf('validateLearningMigrationPreflight_(spreadsheet)') <
  migrationBody.indexOf("appendRow_('SchemaMigrations'"), 'Preflight must run before migration completion is recorded');

const crudContext = {
  rows: {
    LearningObjectives: [
      { objectiveId: 'TP-1', tpCode: 'TP01', title: 'TP awal', subject: 'Matematika', description: '', active: true, createdAt: 'old', updatedAt: 'old', createdBy: 'admin' }
    ],
    LearningIndicators: [
      { indicatorId: 'IND-1', objectiveId: 'TP-1', indicatorCode: 'IND01', description: 'Indikator awal', active: true, createdAt: 'old', updatedAt: 'old' }
    ]
  },
  learningRepositoryAssertReady_: function () {},
  requiredText_: function (value, label, max) {
    const result = String(value || '').trim();
    if (!result) throw new Error(label + ' wajib diisi.');
    if (result.length > max) throw new Error(label + ' terlalu panjang.');
    return result;
  },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  listRows_: function (name) { return crudContext.rows[name].map(function (row) { return Object.assign({}, row); }); },
  appendRow_: function (name, row) { crudContext.rows[name].push(Object.assign({}, row)); },
  updateRowByKey_: function (name, key, id, fields) {
    const row = crudContext.rows[name].find(function (item) { return String(item[key]) === String(id); });
    if (!row) throw new Error('not found');
    Object.assign(row, fields);
  },
  learningAuditedWrite_: function (_user, _action, _type, _id, _before, _after, writeFn) { writeFn(); },
  currentTimestamp_: function () { return '2026-11-03T00:00:00.000Z'; },
  makeId_: function (prefix) { return prefix + '-NEW'; },
  learningActive_: function (value) { return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'; },
  learningObjectivePublic_: function (row) { return Object.assign({}, row); },
  learningIndicatorPublic_: function (row) { return Object.assign({}, row); }
};
vm.createContext(crudContext);
for (const name of ['adminSaveLearningObjective_', 'adminSetLearningObjectiveActive_', 'adminSaveLearningIndicator_', 'adminSetLearningIndicatorActive_']) {
  vm.runInContext(extractFunction(name, source), crudContext);
}
const currentUser = { userId: 'admin-1', email: 'admin@example.test' };
assert.throws(function () {
  crudContext.adminSaveLearningObjective_({ tpCode: 'tp01', title: 'TP duplikat', subject: 'Matematika', currentUser: currentUser });
}, /Kode TP sudah digunakan/, 'Duplicate objective code in the same subject must be rejected');
const otherSubject = crudContext.adminSaveLearningObjective_({ tpCode: 'tp01', title: 'TP IPA', subject: 'IPA', currentUser: currentUser });
assert.equal(otherSubject.tpCode, 'TP01', 'Objective codes must be normalized to uppercase');
assert.throws(function () {
  crudContext.adminSaveLearningIndicator_({ objectiveId: 'TP-NONACTIVE', indicatorCode: 'I02', description: 'x', currentUser: currentUser });
}, /TP yang aktif/, 'Indicator must reference an active objective');
assert.throws(function () {
  crudContext.adminSaveLearningIndicator_({ objectiveId: 'TP-1', indicatorCode: 'ind01', description: 'Duplikat', currentUser: currentUser });
}, /Kode indikator sudah digunakan/, 'Duplicate indicator code within the same objective must be rejected');
const newIndicator = crudContext.adminSaveLearningIndicator_({ objectiveId: 'TP-1', indicatorCode: 'ind02', description: 'Indikator baru', currentUser: currentUser });
assert.equal(newIndicator.indicatorCode, 'IND02', 'Indicator code must be normalized to uppercase');
crudContext.adminSetLearningIndicatorActive_({ indicatorId: newIndicator.indicatorId, active: false, currentUser: currentUser });
assert.equal(crudContext.rows.LearningIndicators.find(function (row) { return row.indicatorId === newIndicator.indicatorId; }).active, false, 'Indicator deactivation must be persisted');
crudContext.adminSetLearningObjectiveActive_({ objectiveId: 'TP-1', active: false, currentUser: currentUser });
assert.equal(crudContext.rows.LearningObjectives.find(function (row) { return row.objectiveId === 'TP-1'; }).active, false, 'Objective deactivation must be persisted');






const headerContext = { LEARNING_REPOSITORY_TABLES_: {
  LearningObjectives: ['objectiveId', 'tpCode', 'title'],
  LearningIndicators: ['indicatorId', 'objectiveId', 'indicatorCode']
} };
vm.createContext(headerContext);
vm.runInContext(extractFunction('validateRepositorySheetHeaders_', source), headerContext);
vm.runInContext(extractFunction('validateLearningMigrationPreflight_', source), headerContext);
function fakeSheet(headers, lastRow) {
  return {
    getLastRow: function () { return lastRow === undefined ? 1 : lastRow; },
    getLastColumn: function () { return headers.length; },
    getRange: function () { return { getValues: function () { return [headers]; } }; }
  };
}
assert.deepEqual(Array.from(headerContext.validateRepositorySheetHeaders_(
  fakeSheet(['objectiveId', 'tpCode', 'title']), 'LearningObjectives',
  ['objectiveId', 'tpCode', 'title']
)), ['objectiveId', 'tpCode', 'title'], 'Valid required headers must pass validation');
assert.throws(function () {
  headerContext.validateRepositorySheetHeaders_(fakeSheet(['objectiveId', '', 'title']), 'LearningObjectives', ['objectiveId']);
}, /Header kosong/, 'Blank headers must be rejected');
assert.throws(function () {
  headerContext.validateRepositorySheetHeaders_(fakeSheet(['objectiveId', 'tpCode', 'tpCode']), 'LearningObjectives', ['objectiveId']);
}, /Header duplikat/, 'Duplicate headers must be rejected');
assert.throws(function () {
  headerContext.validateRepositorySheetHeaders_(fakeSheet(['objectiveId']), 'LearningObjectives', ['objectiveId', 'tpCode']);
}, /Kolom tpCode belum tersedia/, 'Missing required headers must be rejected by readiness validation');
assert.throws(function () {
  headerContext.validateRepositorySheetHeaders_(fakeSheet([], 0), 'LearningObjectives', ['objectiveId']);
}, /kosong atau belum memiliki/, 'Empty sheets must be rejected by readiness validation');

let mutationCount = 0;
const malformedSpreadsheet = {
  getSheetByName: function (name) {
    if (name === 'SchemaMigrations') return fakeSheet(['migrationId', 'status']);
    if (name === 'LearningObjectives') return fakeSheet(['objectiveId', ' ', 'title']);
    return null;
  },
  insertSheet: function () { mutationCount++; throw new Error('must not mutate during preflight'); }
};
assert.throws(function () {
  headerContext.validateLearningMigrationPreflight_(malformedSpreadsheet);
}, /Header kosong/, 'Migration preflight must reject malformed headers');
assert.equal(mutationCount, 0, 'Migration preflight must fail before any sheet mutation');

const validPreflightSpreadsheet = {
  getSheetByName: function (name) {
    if (name === 'SchemaMigrations') return fakeSheet(['migrationId', 'status']);
    if (name === 'LearningObjectives') return fakeSheet(['objectiveId', 'tpCode']);
    if (name === 'LearningIndicators') return fakeSheet([], 0);
    return null;
  }
};
assert.equal(headerContext.validateLearningMigrationPreflight_(validPreflightSpreadsheet), true, 'Valid existing sheets and empty new sheets must pass migration preflight');


const referenceContext = {
  learningRepositoryAssertReady_: function () {},
  learningActive_: function (value) { return value === true || String(value) === 'true' || String(value) === '1'; },
  listRows_: function (name) {
    if (name === 'LearningObjectives') return [
      { objectiveId: 'TP-MATH', subject: 'Matematika', active: true },
      { objectiveId: 'TP-OFF', subject: 'Matematika', active: false },
      { objectiveId: 'TP-IPA', subject: 'IPA', active: true }
    ];
    if (name === 'LearningIndicators') return [
      { indicatorId: 'IND-MATH', objectiveId: 'TP-MATH', active: true },
      { indicatorId: 'IND-OFF', objectiveId: 'TP-MATH', active: false },
      { indicatorId: 'IND-OTHER', objectiveId: 'TP-IPA', active: true }
    ];
    if (name === 'BundleVersions') return referenceContext.versionRows;
    return [];
  },
  parseJson_: function (value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } },
  requiredText_: function (value, label, max) {
    const result = String(value || '').trim();
    if (!result) throw new Error(label + ' wajib diisi.');
    if (max && result.length > max) throw new Error(label + ' terlalu panjang.');
    return result;
  }
};
vm.createContext(referenceContext);
for (const name of ['validateBundleLearningReference_', 'validateBundleSnapshot_', 'getBundleVersion_']) {
  vm.runInContext(extractFunction(name, source), referenceContext);
}
const validSnapshot = {
  bundleId: 'BND-1', classification: 'REGULER', subject: 'Matematika',
  learningObjectiveId: 'TP-MATH', learningIndicatorId: 'IND-MATH',
  questions: [{ type: 'multiple_choice', points: 5 }]
};
assert.equal(referenceContext.validateBundleLearningReference_(validSnapshot), true, 'Active objective and its active indicator must validate');
assert.throws(function () {
  referenceContext.validateBundleLearningReference_(Object.assign({}, validSnapshot, { learningObjectiveId: '', learningIndicatorId: 'IND-MATH' }));
}, /Pilih tujuan pembelajaran/, 'Indicator cannot be assigned without an objective');
assert.throws(function () {
  referenceContext.validateBundleLearningReference_(Object.assign({}, validSnapshot, { learningObjectiveId: 'TP-OFF' }));
}, /tidak tersedia atau tidak aktif/, 'Inactive objective must be rejected');
assert.throws(function () {
  referenceContext.validateBundleLearningReference_(Object.assign({}, validSnapshot, { subject: 'IPA' }));
}, /Mata pelajaran bundel harus sama/, 'Objective subject must match bundle subject');
assert.throws(function () {
  referenceContext.validateBundleLearningReference_(Object.assign({}, validSnapshot, { learningIndicatorId: 'IND-OFF' }));
}, /tidak aktif atau tidak terhubung/, 'Inactive indicator must be rejected');
assert.throws(function () {
  referenceContext.validateBundleLearningReference_(Object.assign({}, validSnapshot, { learningIndicatorId: 'IND-OTHER' }));
}, /tidak aktif atau tidak terhubung/, 'Indicator from another objective must be rejected');
assert.equal(referenceContext.validateBundleLearningReference_({
  bundleId: 'BND-LEGACY', classification: 'REGULER', subject: 'Matematika',
  learningObjectiveId: '', learningIndicatorId: '', questions: [{ type: 'essay', points: 10 }]
}), true, 'Legacy bundle without learning references must remain valid');

const soloContext = {
  soloTaxLevelPoints_: null,
  requiredText_: function(value,label){const v=String(value||'').trim();if(!v)throw new Error(label+' wajib diisi.');return v;}
};
vm.createContext(soloContext);
vm.runInContext(extractFunction('soloTaxLevelPoints_', source), soloContext);
vm.runInContext(extractFunction('validateSoloTaxQuestion_', source), soloContext);
vm.runInContext(extractFunction('validateBundleSnapshot_', source), soloContext);
const validSoloQuestion = {
  type: 'essay', text: 'Jelaskan hubungan konsep.',
  soloLevel: 'RELATIONAL', points: 4,
  subquestions: ['Jelaskan bagian pertama.', 'Hubungkan hasilnya.'],
  answerGuide: 'Guru memeriksa hubungan antarkonsep.',
  rubric: '0 = Tidak menjawab.\\n1 = Jawaban belum tepat.\\n4 = Mengintegrasikan konsep.',
  rubricLevels: ['0 = Tidak menjawab.', '1 = Jawaban belum tepat.', '4 = Mengintegrasikan konsep.'],
  learningIndicatorIds: ['IND-MATH']
};
assert.equal(soloContext.soloTaxLevelPoints_('MULTISTRUKTURAL'), 3, 'Multistruktural must map to 3 points');
assert.equal(soloContext.soloTaxLevelPoints_('RELATIONAL'), 4, 'Relational must map to 4 points');
assert.equal(soloContext.soloTaxLevelPoints_('EXTENDED_ABSTRACT'), 5, 'Extended Abstract must map to 5 points');
assert.equal(soloContext.validateSoloTaxQuestion_(validSoloQuestion, 0), true, 'Complete SOLO essay question must validate');
assert.throws(function () { soloContext.validateSoloTaxQuestion_(Object.assign({}, validSoloQuestion, { type: 'multiple_choice' }), 0); }, /hanya mendukung tipe soal uraian/, 'SOLO Tax must reject multiple choice');
assert.throws(function () { soloContext.validateSoloTaxQuestion_(Object.assign({}, validSoloQuestion, { points: 5 }), 0); }, /Nilai maksimal/, 'SOLO points must match selected level');
assert.throws(function () { soloContext.validateSoloTaxQuestion_(Object.assign({}, validSoloQuestion, { subquestions: [] }), 0); }, /minimal satu subpertanyaan/, 'SOLO question must have at least one subquestion');
assert.throws(function () { soloContext.validateSoloTaxQuestion_(Object.assign({}, validSoloQuestion, { learningIndicatorIds: [] }), 0); }, /minimal satu indikator/, 'SOLO question must map at least one TP indicator');
assert.throws(function () { soloContext.validateSoloTaxQuestion_(Object.assign({}, validSoloQuestion, { answerGuide: '' }), 0); }, /Panduan jawaban wajib/, 'SOLO question must include an answer guide');
assert.throws(function () { soloContext.validateSoloTaxQuestion_(Object.assign({}, validSoloQuestion, { rubricLevels: [] }), 0); }, /Rubrik SOLO Tax harus memiliki/, 'SOLO question must include editable rubric criteria');
assert.equal(referenceContext.validateBundleLearningReference_({
  bundleId: 'BND-SOLO', classification: 'SOLO_TAX', subject: 'Matematika',
  learningObjectiveId: 'TP-MATH', questions: [Object.assign({}, validSoloQuestion, { learningIndicatorIds: ['IND-MATH'] })]
}), true, 'SOLO question indicators must be validated against its TP');
assert.throws(function () {
  referenceContext.validateBundleLearningReference_({
    bundleId: 'BND-SOLO', classification: 'SOLO_TAX', subject: 'Matematika',
    learningObjectiveId: 'TP-MATH', questions: [Object.assign({}, validSoloQuestion, { learningIndicatorIds: ['IND-OTHER'] })]
  });
}, /tidak aktif atau tidak terhubung/, 'SOLO indicators from a different TP must be rejected');
const soloSnapshot = { bundleId: 'BND-SOLO', classification: 'SOLO_TAX', questions: [validSoloQuestion] };
assert.equal(soloContext.validateSoloTaxQuestion_(soloSnapshot.questions[0], 0), true, 'SOLO snapshot question remains valid');
assert.equal(soloContext.validateBundleSnapshot_(soloSnapshot), true, 'SOLO bundle snapshots must validate the essay-only question structure');
assert.throws(function(){soloContext.validateBundleSnapshot_(Object.assign({},soloSnapshot,{questions:[Object.assign({},validSoloQuestion,{type:'matching'})]}));},/hanya mendukung tipe soal uraian/,'SOLO bundle snapshots must reject non-essay questions');

const frozenSnapshot = {
  bundleId: 'BND-1', classification: 'REGULER', subject: 'Matematika',
  learningObjectiveId: 'TP-MATH', learningIndicatorId: 'IND-MATH',
  questions: [{ type: 'multiple_choice', points: 5 }]
};
referenceContext.versionRows = [{
  versionId: 'BVER-1', bundleId: 'BND-1', versionNumber: 1,
  snapshotJson: JSON.stringify(frozenSnapshot), createdBy: 'teacher@example.test',
  createdAt: '2026-11-03T00:00:00.000Z', changeNote: 'Versi awal'
}];
const loadedVersion = referenceContext.getBundleVersion_({ versionId: 'BVER-1' });
assert.equal(loadedVersion.snapshot.learningObjectiveId, 'TP-MATH', 'Bundle version must preserve the learning objective ID');
assert.equal(loadedVersion.snapshot.learningIndicatorId, 'IND-MATH', 'Bundle version must preserve the learning indicator ID');
assert.throws(function () {
  referenceContext.getBundleVersion_({ versionId: 'BVER-MISSING' });
}, /Versi Bundel Soal tidak ditemukan/, 'Unknown bundle version must be rejected');
referenceContext.versionRows[0].snapshotJson = JSON.stringify(Object.assign({}, frozenSnapshot, { questions: [] }));
assert.throws(function () {
  referenceContext.getBundleVersion_({ versionId: 'BVER-1' });
}, /Snapshot harus memiliki/, 'Corrupted bundle snapshot must be rejected when loaded');


const assessmentContext = {
  assessmentRows: [], questionRows: [], bundleReads: 0, latestVersion: 'BVER-1',
  requiredText_: function (value, label) { const result = String(value || '').trim(); if (!result) throw new Error(label + ' wajib diisi.'); return result; },
  assertBundleVersioningReady_: function () {},
  listRows_: function (name) {
    if (name === 'QuestionBundles') {
      assessmentContext.bundleReads++;
      return [{ bundleId: 'BND-1', status: 'active', createdBy: 'owner@example.test', visibility: 'shared', latestVersionId: assessmentContext.latestVersion }];
    }
    return [];
  },
  getBundleVersion_: function () {
    return { versionId: 'BVER-1', versionNumber: 1, snapshot: {
      classification: 'REGULER', subject: 'Matematika', passageText: 'Bacaan versi 1',
      passageImageUrl: '', questions: [{ questionId: 'Q-SNAPSHOT', type: 'multiple_choice',
        text: 'Soal dari snapshot', points: 5, options: ['A', 'B'], answer: 'A' }]
    } };
  },
  LockService: { getScriptLock: function () { return {
    waitLock: function () {},
    releaseLock: function () {}
  }; } },
  makeId_: (function () { let n = 0; return function (prefix) { n++; return prefix + '-TEST-' + n; }; })(),
  currentTimestamp_: function () { return '2026-11-03T00:00:00.000Z'; },
  appendRow_: function (name, row) {
    if (name === 'Assessments') assessmentContext.assessmentRows.push(Object.assign({}, row));
    if (name === 'Questions') assessmentContext.questionRows.push(Object.assign({}, row));
  }
};
vm.createContext(assessmentContext);
vm.runInContext(extractFunction('createAssessment_', source), assessmentContext);
const assessmentUser = { email: 'owner@example.test' };
const createdFromSnapshot = assessmentContext.createAssessment_({
  title: 'Asesmen snapshot', sourceBundleId: 'BND-1', currentUser: assessmentUser,
  questions: []
});
assert.equal(createdFromSnapshot.bundleVersionId, 'BVER-1', 'Assessment must retain the selected bundle version ID');
assert.equal(createdFromSnapshot.bundleVersionNumber, 1, 'Assessment must retain the selected bundle version number');
assert.equal(assessmentContext.assessmentRows[0].passageText, 'Bacaan versi 1', 'Assessment passage must come from the immutable version snapshot');
assert.equal(assessmentContext.questionRows[0].text, 'Soal dari snapshot', 'Assessment questions must come from the immutable version snapshot, not client payload');
assert.equal(assessmentContext.questionRows[0].sourceBundleVersionId, 'BVER-1', 'Each copied question must retain its source bundle version');
assert.equal(assessmentContext.questionRows[0].sourceQuestionKey, 'Q-SNAPSHOT', 'Each copied question must retain its source question key');

const raceContext = Object.assign({}, assessmentContext, {
  assessmentRows: [], questionRows: [], bundleReads: 0, latestVersion: 'BVER-1',
  listRows_: function (name) {
    if (name !== 'QuestionBundles') return [];
    raceContext.bundleReads++;
    return [{ bundleId: 'BND-1', status: 'active', createdBy: 'owner@example.test',
      visibility: 'shared', latestVersionId: raceContext.bundleReads === 1 ? 'BVER-1' : 'BVER-2' }];
  },
  appendRow_: function (name, row) {
    if (name === 'Assessments') raceContext.assessmentRows.push(row);
    if (name === 'Questions') raceContext.questionRows.push(row);
  }
});
vm.createContext(raceContext);
vm.runInContext(extractFunction('createAssessment_', source), raceContext);
assert.throws(function () {
  raceContext.createAssessment_({ title: 'Asesmen race', sourceBundleId: 'BND-1', currentUser: assessmentUser, questions: [{ type: 'essay', points: 1 }] });
}, /Versi Bundel Soal berubah/, 'Assessment creation must reject a bundle version changed before the locked write');
assert.equal(raceContext.assessmentRows.length, 0, 'Version race must be detected before writing the assessment row');
assert.equal(raceContext.questionRows.length, 0, 'Version race must be detected before writing question rows');



const reconcileRetryContext = {
  rows: [
    { logId: 'AUD-PENDING-1', action: 'PENDING_UPDATE', entityId: 'TP-9' },
    { logId: 'AUD-DECISION-1', action: 'RECONCILE_PENDING', entityId: 'AUD-PENDING-1',
      afterJson: JSON.stringify({ resolution: 'applied', note: 'verified applied', finalAction: 'RECONCILED_APPLIED' }) }
  ],
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  learningRepositoryAssertReady_: function () {},
  requiredText_: function (v) { if (!String(v || '').trim()) throw new Error('required'); return String(v).trim(); },
  listRows_: function () { return reconcileRetryContext.rows; },
  updateRowByKey_: function (table, key, id, fields) {
    const row = reconcileRetryContext.rows.find(function (x) { return x[key] === id; });
    if (!row) throw new Error('missing row');
    Object.assign(row, fields);
  },
  appendRow_: function () { throw new Error('should not append duplicate decision'); },
  makeId_: function () { return 'AUD-UNEXPECTED'; },
  currentTimestamp_: function () { return 'now'; }
};
vm.createContext(reconcileRetryContext);
vm.runInContext(extractFunction('adminReconcileLearningAudit_', source), reconcileRetryContext);
assert.throws(function () {
  reconcileRetryContext.adminReconcileLearningAudit_({
    logId: 'AUD-PENDING-1', resolution: 'not_applied', note: 'different decision'
  }, { userId: 'ADMIN-1', email: 'admin@example.test' });
}, /keputusan rekonsiliasi yang berbeda/,
'Conflicting reconciliation retry must be rejected');
assert.equal(reconcileRetryContext.rows[0].action, 'PENDING_UPDATE',
'Conflicting retry must not change the pending audit');
const sameDecisionRetry = reconcileRetryContext.adminReconcileLearningAudit_({
  logId: 'AUD-PENDING-1', resolution: 'applied', note: 'verified applied'
}, { userId: 'ADMIN-1', email: 'admin@example.test' });
assert.equal(sameDecisionRetry.reusedDecision, true, 'Same reconciliation decision must be safely reusable');
assert.equal(reconcileRetryContext.rows[0].action, 'RECONCILED_APPLIED',
'Same decision retry must complete the original pending audit');

const auditFailureContext = {
  pending: [],
  learningAuditBegin_: function () {
    auditFailureContext.pending.push({ logId: 'AUD-WRITE-FAIL', action: 'PENDING_UPDATE' });
    return 'AUD-WRITE-FAIL';
  },
  learningAuditComplete_: function () { throw new Error('simulated completion failure'); }
};
vm.createContext(auditFailureContext);
vm.runInContext(extractFunction('learningAuditedWrite_', source), auditFailureContext);
let entityWriteAttempted = false;
assert.throws(function () {
  auditFailureContext.learningAuditedWrite_({}, 'UPDATE', 'LearningObjective', 'TP-1', {}, {}, function () {
    entityWriteAttempted = true;
    throw new Error('simulated entity write failure');
  });
}, /Audit AUD-WRITE-FAIL tetap berstatus PENDING_UPDATE/,
'Failed entity write must leave a pending audit for reconciliation');
assert.equal(entityWriteAttempted, true, 'Entity write callback must be attempted after pending audit is recorded');
assert.equal(auditFailureContext.pending[0].action, 'PENDING_UPDATE', 'Failed entity write must preserve the pending audit marker');

const auditFinalizeFailureContext = {
  pending: [],
  learningAuditBegin_: function () {
    auditFinalizeFailureContext.pending.push({ logId: 'AUD-FINALIZE-FAIL', action: 'PENDING_UPDATE' });
    return 'AUD-FINALIZE-FAIL';
  },
  learningAuditComplete_: function () { throw new Error('simulated audit update failure'); }
};
vm.createContext(auditFinalizeFailureContext);
vm.runInContext(extractFunction('learningAuditedWrite_', source), auditFinalizeFailureContext);
let committedEntity = false;
assert.throws(function () {
  auditFinalizeFailureContext.learningAuditedWrite_({}, 'UPDATE', 'LearningObjective', 'TP-2', {}, {}, function () {
    committedEntity = true;
  });
}, /telah ditulis, tetapi audit AUD-FINALIZE-FAIL belum dapat ditandai selesai/,
'Successful entity write with failed audit finalization must report the committed-write ambiguity');
assert.equal(committedEntity, true, 'Entity write must complete before audit finalization is attempted');
assert.equal(auditFinalizeFailureContext.pending[0].action, 'PENDING_UPDATE', 'Failed audit finalization must leave a pending marker for Admin reconciliation');


const routeAuthContext = {
  CONFIG: { APP_NAME: 'Rumble Assessment' },
  getCurrentUser_: function () { return routeAuthContext.auth; },
  adminListPendingLearningAudits_: function () { return { authorized: true, role: 'admin' }; },
  adminReconcileLearningAudit_: function (payload, user) {
    return { authorized: true, payload: payload, actorRole: user.role, actorId: user.userId };
  },
  adminListLearningObjectives_: function () { return { authorized: true, role: 'admin' }; },
  adminSaveLearningObjective_: function (payload) { return { authorized: true, actor: payload.currentUser.role }; },
  adminSetLearningObjectiveActive_: function (payload) { return { authorized: true, actor: payload.currentUser.role }; },
  adminListLearningIndicators_: function () { return { authorized: true, role: 'admin' }; },
  adminSaveLearningIndicator_: function (payload) { return { authorized: true, actor: payload.currentUser.role }; },
  adminSetLearningIndicatorActive_: function (payload) { return { authorized: true, actor: payload.currentUser.role }; },
  listAvailableLearningObjectives_: function () { return [{ objectiveId: 'TP-1', active: true }]; },
  listAvailableLearningIndicators_: function () { return [{ indicatorId: 'IND-1', active: true }]; }
};
vm.createContext(routeAuthContext);
vm.runInContext(extractFunction('routeAction_', source), routeAuthContext);
['teacher', 'student'].forEach(function (role) {
  routeAuthContext.auth = { authenticated: true, user: { role: role, userId: role + '-1', email: role + '@example.test' } };
  assert.throws(function () {
    routeAuthContext.routeAction_('adminListPendingLearningAudits', {});
  }, /hanya dapat digunakan oleh administrator sekolah/,
  role + ' must not list pending learning audit records');
  assert.throws(function () {
    routeAuthContext.routeAction_('adminReconcileLearningAudit', {
      logId: 'AUD-1', resolution: 'applied', note: 'test'
    });
  }, /hanya dapat digunakan oleh administrator sekolah/,
  role + ' must not reconcile learning audit records');
});
const adminCrudActions = [
  ['adminListLearningObjectives', {}],
  ['adminSaveLearningObjective', { tpCode: 'TP-1', title: 'Tujuan', subject: 'Matematika' }],
  ['adminSetLearningObjectiveActive', { objectiveId: 'TP-1', active: false }],
  ['adminListLearningIndicators', { objectiveId: 'TP-1' }],
  ['adminSaveLearningIndicator', { objectiveId: 'TP-1', indicatorCode: 'IND-1', description: 'Indikator' }],
  ['adminSetLearningIndicatorActive', { indicatorId: 'IND-1', active: false }]
];
['teacher', 'student'].forEach(function (role) {
  routeAuthContext.auth = { authenticated: true, user: { role: role, userId: role + '-2', email: role + '@example.test' } };
  adminCrudActions.forEach(function (entry) {
    assert.throws(function () { routeAuthContext.routeAction_(entry[0], entry[1]); },
      /hanya dapat digunakan oleh administrator sekolah/,
      role + ' must not invoke ' + entry[0]);
  });
});
routeAuthContext.auth = { authenticated: true, user: { role: 'teacher', userId: 'teacher-1', email: 'teacher@example.test' } };
assert.equal(routeAuthContext.routeAction_('listAvailableLearningObjectives', {}).length, 1,
  'Teacher must be allowed to read available objectives');
assert.equal(routeAuthContext.routeAction_('listAvailableLearningIndicators', { objectiveId: 'TP-1' }).length, 1,
  'Teacher must be allowed to read available indicators');
routeAuthContext.auth = { authenticated: true, user: { role: 'student', userId: 'student-1', email: 'student@example.test' } };
assert.throws(function () {
  routeAuthContext.routeAction_('listAvailableLearningObjectives', {});
}, /Repositori pembelajaran hanya dapat diakses/,
'Student must not read the learning repository');
routeAuthContext.auth = { authenticated: true, user: { role: 'admin', userId: 'admin-1', email: 'admin@example.test' } };
adminCrudActions.forEach(function (entry) {
  assert.equal(routeAuthContext.routeAction_(entry[0], entry[1]).authorized, true,
    'Admin must be allowed to invoke ' + entry[0]);
});

routeAuthContext.auth = { authenticated: true, user: { role: 'admin', userId: 'admin-1', email: 'admin@example.test' } };
assert.equal(routeAuthContext.routeAction_('adminListPendingLearningAudits', {}).authorized, true,
  'Admin must be able to list pending audit records');
const adminReconcileResult = routeAuthContext.routeAction_('adminReconcileLearningAudit', {
  logId: 'AUD-1', resolution: 'applied', note: 'verified'
});
assert.equal(adminReconcileResult.actorRole, 'admin', 'Reconciliation must receive the server-authenticated Admin identity');
assert.equal(adminReconcileResult.actorId, 'admin-1', 'Reconciliation actor ID must come from authenticated server identity');


const bundleReferenceContext = {
  learningRepositoryAssertReady_: function () {},
  learningActive_: function (value) { return value === true || String(value).toLowerCase() === 'true'; },
  listRows_: function (table) {
    if (table === 'LearningObjectives') return bundleReferenceContext.objectives;
    if (table === 'LearningIndicators') return bundleReferenceContext.indicators;
    return [];
  },
  objectives: [{ objectiveId: 'TP-A', subject: 'Matematika', active: true }],
  indicators: [{ indicatorId: 'IND-A', objectiveId: 'TP-A', active: true }]
};
vm.createContext(bundleReferenceContext);
vm.runInContext(extractFunction('validateBundleLearningReference_', source), bundleReferenceContext);
const validBundleReference = {
  subject: 'Matematika', learningObjectiveId: 'TP-A', learningIndicatorId: 'IND-A'
};
assert.equal(bundleReferenceContext.validateBundleLearningReference_(validBundleReference), true,
  'Active objective and indicator under the objective must validate');
assert.equal(bundleReferenceContext.validateBundleLearningReference_({
  subject: 'Matematika', learningObjectiveId: '', learningIndicatorId: ''
}), true, 'Bundle without learning references remains valid');
assert.throws(function () {
  bundleReferenceContext.validateBundleLearningReference_({
    subject: 'Matematika', learningObjectiveId: '', learningIndicatorId: 'IND-A'
  });
}, /Pilih tujuan pembelajaran/,
'Indicator cannot be referenced without an objective');
assert.throws(function () {
  bundleReferenceContext.validateBundleLearningReference_({
    subject: 'IPA', learningObjectiveId: 'TP-A', learningIndicatorId: 'IND-A'
  });
}, /Mata pelajaran bundel harus sama/,
'Bundle subject must match the objective subject');
assert.throws(function () {
  bundleReferenceContext.validateBundleLearningReference_({
    subject: 'Matematika', learningObjectiveId: 'TP-A', learningIndicatorId: 'IND-OTHER'
  });
}, /Indikator tidak aktif atau tidak terhubung/,
'Indicator must be active and belong to the selected objective');
bundleReferenceContext.objectives[0].active = false;
assert.throws(function () {
  bundleReferenceContext.validateBundleLearningReference_(validBundleReference);
}, /Tujuan pembelajaran yang dipilih tidak tersedia atau tidak aktif/,
'Inactive objective cannot be assigned to a new bundle version');
bundleReferenceContext.objectives[0].active = true;
bundleReferenceContext.indicators[0].active = false;
assert.throws(function () {
  bundleReferenceContext.validateBundleLearningReference_(validBundleReference);
}, /Indikator tidak aktif atau tidak terhubung/,
'Inactive indicator cannot be assigned to a new bundle version');

const saveBundleBody = extractFunction('saveQuestionBundle_', source);
assert.ok(saveBundleBody.indexOf('validateBundleLearningReference_(snapshot)') <
  saveBundleBody.indexOf('createBundleVersion_('),
'New bundle version must validate active learning references before snapshot persistence');
const assessmentBody = extractFunction('createAssessment_', source);
assert.ok(assessmentBody.indexOf('sourceVersion=getBundleVersion_') <
  assessmentBody.indexOf('sourceVersion.snapshot.questions'),
'Assessment must load its immutable source bundle version before copying questions');
assert.ok(assessmentBody.indexOf('String(current.latestVersionId)!==String(sourceVersion.versionId)') >= 0,
'Assessment creation must reject if the source bundle version changes during creation');
assert.ok(assessmentBody.indexOf('bundleVersionId:sourceVersion?sourceVersion.versionId') >= 0,
'Assessment must persist the exact source bundle version reference');


const historicalBundleContext = {
  assertBundleVersioningReady_: function () {},
  requiredText_: function (value) { if (!String(value || '').trim()) throw new Error('required'); return String(value).trim(); },
  listRows_: function (table) {
    if (table === 'QuestionBundles') return [{
      bundleId: 'BUNDLE-1', createdBy: 'teacher@example.test', visibility: 'private',
      latestVersionId: 'VERSION-1', latestVersionNumber: 1, status: 'draft'
    }];
    return [];
  },
  getBundleVersion_: function () {
    return {
      versionId: 'VERSION-1', versionNumber: 1,
      snapshot: {
        title: 'Bundel historis', subject: 'Matematika', description: '',
        tpCode: 'TP-A', learningObjectiveId: 'TP-A', learningIndicatorId: 'IND-A',
        classification: 'REGULER', questions: [{ questionId: 'Q-1' }]
      }
    };
  },
  bundleSnapshotFromRecord_: function () { throw new Error('historical version must be loaded'); }
};
vm.createContext(historicalBundleContext);
vm.runInContext(extractFunction('getQuestionBundle_', source), historicalBundleContext);
const historicalBundle = historicalBundleContext.getQuestionBundle_({
  bundleId: 'BUNDLE-1',
  currentUser: { role: 'teacher', email: 'teacher@example.test' }
});
assert.equal(historicalBundle.bundle.learningObjectiveId, 'TP-A',
  'Historical bundle must retain its saved learning objective reference');
assert.equal(historicalBundle.bundle.learningIndicatorId, 'IND-A',
  'Historical bundle must retain its saved learning indicator reference');
assert.equal(historicalBundle.questions[0].questionId, 'Q-1',
  'Historical bundle must return the immutable saved question snapshot');
assert.ok(source.includes('const snapshot=version?version.snapshot:bundleSnapshotFromRecord_'),
  'Opening a versioned bundle must read its version snapshot rather than current learning master data');


function makeAssessmentTestContext(latestVersionSequence) {
  let bundleReads = 0;
  const written = [];
  return {
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    assertBundleVersioningReady_: function () {},
    requiredText_: function (v) { if (!String(v || '').trim()) throw new Error('required'); return String(v).trim(); },
    listRows_: function (table) {
      if (table === 'QuestionBundles') {
        const index = Math.min(bundleReads++, latestVersionSequence.length - 1);
        return [{ bundleId: 'BUNDLE-1', status: 'ready', visibility: 'shared',
          createdBy: 'teacher@example.test', latestVersionId: latestVersionSequence[index] }];
      }
      return [];
    },
    getBundleVersion_: function () {
      return { versionId: 'VERSION-7', versionNumber: 7, snapshot: {
        classification: 'REGULER', subject: 'Matematika', passageText: 'Teks historis',
        passageImageUrl: 'https://example.test/passage.png',
        learningObjectiveId: 'TP-OLD', learningIndicatorId: 'IND-OLD',
        questions: [{ questionId: 'Q-OLD', type: 'multiple_choice', points: 5,
          text: 'Soal dari snapshot', options: ['A', 'B'], answer: 'A' }]
      } };
    },
    makeId_: function (prefix) { return prefix + '-CREATED'; },
    currentTimestamp_: function () { return '2026-11-03T00:00:00Z'; },
    written: written,
    appendRow_: function (table, row) { written.push({ table: table, row: row }); }
  };
}
const assessmentSnapshotContext = makeAssessmentTestContext(['VERSION-7', 'VERSION-7']);
vm.createContext(assessmentSnapshotContext);
vm.runInContext(extractFunction('createAssessment_', source), assessmentSnapshotContext);
const assessmentCreated = assessmentSnapshotContext.createAssessment_({
  title: 'Asesmen snapshot', sourceBundleId: 'BUNDLE-1',
  currentUser: { role: 'teacher', email: 'teacher@example.test' }
});
const assessmentRow = assessmentSnapshotContext.written.find(function (x) { return x.table === 'Assessments'; }).row;
const questionRow = assessmentSnapshotContext.written.find(function (x) { return x.table === 'Questions'; }).row;
assert.equal(assessmentCreated.bundleVersionId, 'VERSION-7',
  'Assessment response must expose the exact source bundle version');
assert.equal(assessmentRow.bundleVersionId, 'VERSION-7',
  'Assessment record must persist the exact source bundle version');
assert.equal(assessmentRow.bundleVersionNumber, 7,
  'Assessment record must persist the source version number');
assert.equal(assessmentRow.subject, 'Matematika',
  'Assessment metadata must come from the immutable source snapshot');
assert.equal(assessmentRow.passageText, 'Teks historis',
  'Assessment passage must come from the immutable source snapshot');
assert.equal(assessmentRow.classification, 'REGULER',
  'Assessment classification must come from the immutable source snapshot');
assert.equal(questionRow.sourceBundleVersionId, 'VERSION-7',
  'Each assessment question must retain its source bundle version');
assert.equal(questionRow.sourceQuestionKey, 'Q-OLD',
  'Each assessment question must retain its original snapshot question key');
assert.equal(questionRow.text, 'Soal dari snapshot',
  'Assessment questions must be copied from the immutable snapshot');

const changedPointerContext = makeAssessmentTestContext(['VERSION-7', 'VERSION-8']);
vm.createContext(changedPointerContext);
vm.runInContext(extractFunction('createAssessment_', source), changedPointerContext);
assert.throws(function () {
  changedPointerContext.createAssessment_({
    title: 'Asesmen race', sourceBundleId: 'BUNDLE-1',
    currentUser: { role: 'teacher', email: 'teacher@example.test' }
  });
}, /Versi Bundel Soal berubah saat Asesmen dibuat/,
'Assessment creation must abort if the bundle latest-version pointer changes');
assert.equal(changedPointerContext.written.length, 0,
  'A bundle-version race must not write a partial assessment or questions');


const answerAccessContext = {
  requiredText_: function (v) { if (!String(v || '').trim()) throw new Error('required'); return String(v).trim(); },
  listRows_: function (table) {
    if (table === 'Assessments') return [{
      assessmentId: 'ASM-1', createdBy: 'teacher@example.test',
      status: 'published', title: 'Uji kunci jawaban'
    }];
    if (table === 'Questions') return [{
      assessmentId: 'ASM-1', questionId: 'Q-1', order: 1,
      type: 'multiple_choice', text: 'Pertanyaan', points: 1,
      optionsJson: '["A","B"]', answerJson: '"A"', rubric: '',
      pairsJson: '""', imageUrl: '', optionImagesJson: '[]',
      subquestionsJson: '[]', subquestionImagesJson: '[]',
      rubricLevelsJson: '[]', passageText: '', passageImageUrl: ''
    }];
    if (table === 'Attempts') return [];
    return [];
  },
  parseJson_: function (value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } },
  assertStudentAssessmentAccess_: function () {},
  assertStudentAssessmentIdentity_: function () {}
};
vm.createContext(answerAccessContext);
vm.runInContext(extractFunction('getAssessment_', source), answerAccessContext);
function detailFor(user, includeAnswers) {
  return answerAccessContext.getAssessment_({
    id: 'ASM-1', includeAnswers: includeAnswers,
    currentUser: user
  });
}
const studentDetail = detailFor({ role: 'student', userId: 'student-1' }, true);
assert.equal(studentDetail.questions[0].answer, undefined,
  'Student must not receive answer keys even when includeAnswers is requested');
assert.throws(function () {
  detailFor({ role: 'teacher', email: 'other@example.test' }, true);
}, /Akses ditolak/,
'A teacher must not access another teacher assessment or its answer keys');
const ownerTeacherDetail = detailFor({ role: 'teacher', email: 'teacher@example.test' }, true);
assert.equal(ownerTeacherDetail.questions[0].answer, 'A',
  'The assessment owner may request answer keys');
const adminDetail = detailFor({ role: 'admin', email: 'admin@example.test' }, true);
assert.equal(adminDetail.questions[0].answer, 'A',
  'Admin may request answer keys');
const studentSource = extractFunction('getAssessment_', source);
assert.ok(studentSource.includes('const canIncludeAnswers = payload.includeAnswers === true'),
  'Answer inclusion must be decided by server-side authorization, not client input alone');

const publishContext = {
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () { publishContext.released = true; } }; } },
  getSheet_: function () { return {
    getDataRange: function () { return { getValues: function () { return [
      ['assessmentId', 'status', 'updatedAt'],
      ['ASM-1', publishContext.assessment.status, '']
    ]; } }; },
    getRange: function (row, col) { return { setValue: function (value) {
      publishContext.writes.push({ row: row, col: col, value: value });
    } }; }
  }; },
  listRows_: function (table) {
    if (table === 'Assessments') return [publishContext.assessment];
    if (table === 'Questions') return publishContext.questions;
    return [];
  },
  requiredText_: function (v) { if (!String(v || '').trim()) throw new Error('ID wajib'); return String(v).trim(); },
  currentTimestamp_: function () { return '2026-11-04T00:00:00Z'; },
  assessment: { assessmentId: 'ASM-1', status: 'draft', title: 'Uji', className: 'VII-A', duration: 60 },
  questions: [{ assessmentId: 'ASM-1', questionId: 'Q-1' }],
  writes: [], released: false
};
vm.createContext(publishContext);
vm.runInContext(extractFunction('publishAssessment_', source), publishContext);
const published = publishContext.publishAssessment_({ id: 'ASM-1' });
assert.equal(published.status, 'published', 'Valid draft with questions can be published');
assert.equal(published.questionCount, 1, 'Publish response must report validated question count');
assert.equal(publishContext.writes[0].value, 'published', 'Publish must write published status');
assert.equal(publishContext.released, true, 'Publish must always release its script lock');
publishContext.writes = []; publishContext.released = false; publishContext.questions = [];
assert.throws(function () { publishContext.publishAssessment_({ id: 'ASM-1' }); }, /minimal satu soal/,
  'Empty assessment cannot be published');
assert.equal(publishContext.writes.length, 0, 'Empty assessment must not change status');
publishContext.assessment.status = 'archived'; publishContext.questions = [{ assessmentId: 'ASM-1' }];
assert.throws(function () { publishContext.publishAssessment_({ id: 'ASM-1' }); }, /diarsipkan/,
  'Archived assessment cannot be published');
assert.equal(publishContext.writes.length, 0, 'Archived assessment must not change status');
publishContext.assessment.status = 'draft'; publishContext.assessment.duration = 0;
assert.throws(function () { publishContext.publishAssessment_({ id: 'ASM-1' }); }, /Durasi asesmen/,
  'Invalid duration must block publication');
assert.equal(publishContext.writes.length, 0, 'Invalid assessment must not change status');
function makeStartAttemptContext() {
  const ctx = {
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () { ctx.released = true; } }; } },
    requiredText_: function (v) { if (!String(v || '').trim()) throw new Error('ID wajib'); return String(v).trim(); },
    listRows_: function (table) { return table === 'Assessments' ? [ctx.assessment] : table === 'Attempts' ? ctx.attempts : table === 'Questions' ? ctx.questions : []; },
    assertStudentAssessmentAccess_: function (assessment, user) { if (!assessment || assessment.status !== 'published' || user.className !== assessment.className) throw new Error('Asesmen tidak tersedia.'); },
    assertStudentAssessmentIdentity_: function (assessment, user) { if (!assessment || assessment.status !== 'published' || user.className !== assessment.className) throw new Error('Asesmen tidak tersedia.'); },
    makeId_: function () { return 'ATT-NEW'; }, currentTimestamp_: function () { return new Date().toISOString(); },
    appendRow_: function (table, row) { ctx.appended.push({ table: table, row: row }); },
    assessment: { assessmentId: 'ASM-1', status: 'published', className: 'VII-A', duration: 60 },
    attempts: [], questions: [{ assessmentId: 'ASM-1', questionId: 'Q-1', points: 5 }], appended: [], released: false
  }; return ctx;
}
const startAttemptContext = makeStartAttemptContext();
vm.createContext(startAttemptContext);
vm.runInContext(extractFunction('startAttempt_', source), startAttemptContext);
const startedAttempt = startAttemptContext.startAttempt_({ assessmentId: 'ASM-1', currentUser: { role: 'student', userId: 'ST-1', className: 'VII-A' } });
assert.equal(startedAttempt.status, 'in_progress', 'Eligible student can start a published assessment');
assert.equal(startAttemptContext.appended.length, 1, 'Starting an assessment creates exactly one attempt');
assert.equal(startAttemptContext.appended[0].row.maxScore, 5, 'Attempt max score is derived from its questions');
assert.equal(startAttemptContext.released, true, 'Attempt start always releases its lock');
const emptyStartContext = makeStartAttemptContext(); emptyStartContext.questions = [];
vm.createContext(emptyStartContext); vm.runInContext(extractFunction('startAttempt_', source), emptyStartContext);
assert.throws(function () { emptyStartContext.startAttempt_({ assessmentId: 'ASM-1', currentUser: { role: 'student', userId: 'ST-1', className: 'VII-A' } }); }, /belum memiliki soal/,
  'Student cannot start an assessment with no questions');
assert.equal(emptyStartContext.appended.length, 0, 'Empty assessment must not create an attempt');
const unpublishedStartContext = makeStartAttemptContext(); unpublishedStartContext.assessment.status = 'draft';
vm.createContext(unpublishedStartContext); vm.runInContext(extractFunction('startAttempt_', source), unpublishedStartContext);
assert.throws(function () { unpublishedStartContext.startAttempt_({ assessmentId: 'ASM-1', currentUser: { role: 'student', userId: 'ST-1', className: 'VII-A' } }); }, /tidak tersedia/,
  'Student cannot start a draft assessment');
assert.equal(unpublishedStartContext.appended.length, 0, 'Unavailable assessment must not create an attempt');

const submitSource = extractFunction('submitAttempt_', source);
assert.ok(submitSource.indexOf("const currentAssessment = listRows_('Assessments')") > submitSource.indexOf('lock.waitLock'),
  'Submission must reload assessment state only after acquiring the lock');
assert.ok(submitSource.includes('const allowedQuestionIds = {}'),
  'Submission must build an allowlist of question IDs belonging to the assessment');
assert.ok(submitSource.includes('if (allowedQuestionIds[questionId]) answers[questionId] = submittedAnswers[questionId]'),
  'Submission must discard answer keys for questions outside the assessment');
assert.ok(submitSource.includes("if (!questions.length) throw new Error('Asesmen tidak memiliki soal.')"),
  'Submission must reject assessments without questions');

const saveAttemptSource = extractFunction('saveAttempt_', source);
assert.ok(saveAttemptSource.indexOf("const currentAssessment = listRows_('Assessments')") > saveAttemptSource.indexOf('lock.waitLock'),
  'Draft save must reload assessment state after acquiring the lock');
assert.ok(saveAttemptSource.includes('const allowed = {}') &&
  saveAttemptSource.includes('if (allowed[questionId]) filteredAnswers[questionId] = incomingAnswers[questionId]'),
  'Draft save must discard answers for questions outside the assessment');
assert.ok(saveAttemptSource.includes("if (!questions.length) throw new Error('Asesmen tidak memiliki soal.')"),
  'Draft save must reject an assessment with no questions');
assert.ok(submitSource.includes('assertStudentAssessmentIdentity_(assessment, user)'),
  'Initial submission access check must use the assessment loaded before the lock');
assert.ok(submitSource.indexOf("const currentAssessment = listRows_('Assessments')") > submitSource.indexOf('lock.waitLock'),
  'Submission must reload assessment state after acquiring the lock');


const gradingSource = extractFunction('gradeAttempt_', source);
assert.ok(gradingSource.includes("status !== 'needs_review' && status !== 'graded'"),
  'Manual grading must reject attempts that are not submitted for review or already graded');
assert.ok(gradingSource.includes('lock.waitLock(30000)') && gradingSource.includes('lock.releaseLock()'),
  'Manual grading must be protected by a Script Lock and release it in finally');
assert.ok(gradingSource.includes('Skor setiap soal wajib diisi'),
  'Manual grading must not accept a client-supplied total without per-question scores');
assert.ok(gradingSource.includes('scoreKeys.length !== questions.length'),
  'Manual grading must require scores for every question and reject extra score keys');
assert.ok(gradingSource.includes('JSON.stringify(savedScores)'),
  'Manual grading must persist only the validated server-side score map');
assert.ok(html.includes("if(raw.trim()===''){toast('Skor soal '"),
  'The grading UI must require an explicit score for each question; zero must be entered explicitly');

function makeGradeContext(status, questionScores) {
  const ctx = {
    locked: false, released: false, writes: [],
    LockService: { getScriptLock: function () { return {
      waitLock: function () { ctx.locked = true; },
      releaseLock: function () { ctx.released = true; ctx.locked = false; }
    }; } },
    requiredText_: function (value) { if (!String(value || '').trim()) throw new Error('ID wajib'); return String(value).trim(); },
    parseJson_: function (value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } },
    appendRow_: function (table, row) { (ctx.appended || (ctx.appended = [])).push({ table: table, row: row }); },
    makeId_: function (prefix) { return prefix + '-TEST'; },
    currentTimestamp_: function () { return '2026-11-04T00:00:00Z'; },
    listRows_: function (table) {
      if (table === 'Attempts') return [{ attemptId: 'ATT-1', assessmentId: 'ASM-1', status: status }];
      if (table === 'Questions') return [
        { questionId: 'Q-1', assessmentId: 'ASM-1', order: 1, points: 2 },
        { questionId: 'Q-2', assessmentId: 'ASM-1', order: 2, points: 3 }
      ];
      return [];
    },
    getSheet_: function () { return {
      getDataRange: function () { return { getValues: function () {
        return [
          ['attemptId', 'score', 'maxScore', 'status', 'teacherFeedback', 'questionScoresJson'],
          ['ATT-1', 0, 5, status, '', '']
        ];
      } }; },
      getRange: function (row, col) { return { setValue: function (value) {
        ctx.writes.push({ row: row, col: col, value: value });
      } }; }
    }; }
  };
  vm.createContext(ctx);
  vm.runInContext(gradingSource, ctx);
  return ctx;
}
const gradeContext = makeGradeContext('needs_review');
const gradeResult = gradeContext.gradeAttempt_({
  attemptId: 'ATT-1', questionScores: { 'Q-1': 1, 'Q-2': 2 }, feedback: 'Baik'
});
assert.equal(gradeResult.score, 3, 'Server must calculate total score from individual question scores');
assert.equal(gradeResult.maxScore, 5, 'Server must calculate maximum score from assessment questions');
assert.equal(gradeResult.status, 'graded', 'Submitted attempt must transition to graded');
assert.equal(gradeContext.writes.find(x => x.col === 2).value, 3, 'Persisted score must use server calculation');
assert.equal(gradeContext.writes.find(x => x.col === 3).value, 5, 'Persisted maximum must use assessment questions');
assert.equal(JSON.parse(gradeContext.writes.find(x => x.col === 6).value)['Q-2'], 2,
  'Only validated per-question scores must be persisted');
assert.equal(gradeContext.released, true, 'Grading lock must always be released');

const zeroGradeContext = makeGradeContext('needs_review');
const zeroGrade = zeroGradeContext.gradeAttempt_({
  attemptId: 'ATT-1', questionScores: { 'Q-1': 0, 'Q-2': 0 }
});
assert.equal(zeroGrade.score, 0, 'An explicitly entered zero score must remain valid');

const alreadyGradedContext = makeGradeContext('graded');
assert.equal(alreadyGradedContext.gradeAttempt_({
  attemptId: 'ATT-1', questionScores: { 'Q-1': 2, 'Q-2': 3 }
}).score, 5, 'An already graded attempt may be corrected by its authorized teacher');

const inProgressContext = makeGradeContext('in_progress');
assert.throws(function () {
  inProgressContext.gradeAttempt_({ attemptId: 'ATT-1', questionScores: { 'Q-1': 1, 'Q-2': 2 } });
}, /masih berlangsung atau belum dikirim/,
'An in-progress attempt must not be manually graded');
assert.equal(inProgressContext.writes.length, 0, 'Rejected in-progress grading must not write scores');
assert.equal(inProgressContext.released, true, 'Lock must be released after a rejected grading attempt');

const missingScoresContext = makeGradeContext('needs_review');
assert.throws(function () {
  missingScoresContext.gradeAttempt_({ attemptId: 'ATT-1', score: 5, maxScore: 5 });
}, /Skor setiap soal wajib diisi/,
'Client-supplied total score must not be accepted without per-question scores');
assert.equal(missingScoresContext.writes.length, 0, 'Missing per-question scores must not write a grade');

const blankScoreContext = makeGradeContext('needs_review');
assert.throws(function () {
  blankScoreContext.gradeAttempt_({ attemptId: 'ATT-1', questionScores: { 'Q-1': '', 'Q-2': 2 } });
}, /tidak valid/,
'Blank score must not be silently converted to zero');
assert.equal(blankScoreContext.writes.length, 0, 'Blank per-question score must not write a grade');

const extraScoreContext = makeGradeContext('needs_review');
assert.throws(function () {
  extraScoreContext.gradeAttempt_({ attemptId: 'ATT-1', questionScores: { 'Q-1': 1, 'Q-2': 2, 'Q-EXTRA': 1 } });
}, /tepat untuk seluruh soal/,
'Extra question score keys must be rejected');
assert.equal(extraScoreContext.writes.length, 0, 'Extra question score keys must not write a grade');



const snapshotReferenceContext = {
  listRows_: function (table) {
    if (table === 'LearningObjectives') return [{
      objectiveId: 'TP-1', tpCode: 'TP-MAT-01', title: 'Memahami relasi', subject: 'Matematika', description: 'Tujuan pembelajaran'
    }];
    if (table === 'LearningIndicators') return [{
      indicatorId: 'IND-1', objectiveId: 'TP-1', indicatorCode: 'IND-MAT-01', description: 'Menghubungkan dua konsep'
    }];
    return [];
  }
};
vm.createContext(snapshotReferenceContext);
vm.runInContext(extractFunction('snapshotBundleLearningReferences_', source), snapshotReferenceContext);
const enrichedSoloSnapshot = snapshotReferenceContext.snapshotBundleLearningReferences_({
  classification: 'SOLO_TAX', learningObjectiveId: 'TP-1', tpCode: 'TP-MAT-01', subject: 'Matematika',
  questions: [{ learningIndicatorIds: ['IND-1'] }]
});
assert.equal(enrichedSoloSnapshot.learningObjectiveSnapshot.title, 'Memahami relasi',
  'SOLO bundle snapshot must preserve the selected TP definition');
assert.equal(enrichedSoloSnapshot.questions[0].learningIndicators[0].description, 'Menghubungkan dua konsep',
  'SOLO bundle snapshot must preserve each mapped indicator definition');

const soloVerificationContext = {
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () { soloVerificationContext.released = true; } }; } },
  requiredText_: function (value) { if (!String(value || '').trim()) throw new Error('ID wajib'); return String(value).trim(); },
  parseJson_: function (value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } },
  listRows_: function (table) {
    if (table === 'Attempts') return [{ attemptId: 'ATT-SOLO', assessmentId: 'ASM-SOLO', studentId: 'ST-1', status: 'graded' }];
    if (table === 'Assessments') return [{ assessmentId: 'ASM-SOLO', classification: 'SOLO_TAX' }];
    if (table === 'Questions') return [
      { questionId: 'SQ-1', assessmentId: 'ASM-SOLO', answerJson: JSON.stringify({ __soloTaxMeta: { learningIndicatorIds: ['IND-A', 'IND-B'] } }) },
      { questionId: 'SQ-2', assessmentId: 'ASM-SOLO', answerJson: JSON.stringify({ __soloTaxMeta: { learningIndicatorIds: ['IND-B'] } }) }
    ];
    return [];
  },
  appendRow_: function (table, row) { soloVerificationContext.appended.push({ table: table, row: row }); },
  makeId_: function (prefix) { return prefix + '-TEST'; },
  currentTimestamp_: function () { return '2026-11-04T00:00:00Z'; },
  appended: [], released: false
};
vm.createContext(soloVerificationContext);
vm.runInContext(extractFunction('soloAchievementCategory_', source), soloVerificationContext);
vm.runInContext(extractFunction('saveSoloIndicatorVerification_', source), soloVerificationContext);
const soloVerificationResult = soloVerificationContext.saveSoloIndicatorVerification_({
  attemptId: 'ATT-SOLO', currentUser: { role: 'teacher', email: 'teacher@example.test' },
  results: [
    { indicatorId: 'IND-A', percentage: 90, evidence: 'Siswa menghubungkan konsep pada jawaban soal pertama.' },
    { indicatorId: 'IND-B', percentage: 80, evidence: 'Siswa menunjukkan hubungan parsial pada dua soal.' }
  ]
});
assert.equal(soloVerificationResult.status, 'verified', 'Teacher can verify all mapped indicators');
assert.equal(soloVerificationResult.indicatorCount, 2, 'Verification covers each distinct mapped indicator');
assert.equal(soloVerificationResult.tpAchievement.averagePercentage, 85, 'TP achievement is the equal-weighted mean of indicator percentages');
assert.equal(soloVerificationResult.tpAchievement.category, 'achieved', 'An average of exactly 85 percent is achieved, not exceeds');
assert.equal(soloVerificationContext.appended[0].row.detailsJson.includes('"percentage":90'), true, 'Indicator percentage must be audit logged');
assert.equal(soloVerificationContext.soloAchievementCategory_(85), 'achieved', '85 percent belongs to achieved');
assert.equal(soloVerificationContext.soloAchievementCategory_(85.01), 'exceeds', 'Only values above 85 percent exceed');
assert.equal(soloVerificationContext.soloAchievementCategory_(69.99), 'not_achieved', 'Values below 70 percent are not achieved');
assert.equal(soloVerificationContext.appended[0].table, 'Events', 'Verification must be appended to the audit event log');
assert.equal(soloVerificationContext.released, true, 'Verification lock must always be released');
assert.throws(function () {
  soloVerificationContext.saveSoloIndicatorVerification_({
    attemptId: 'ATT-SOLO', currentUser: { email: 'teacher@example.test' },
    results: [{ indicatorId: 'IND-A', percentage: 90, evidence: 'Bukti.' }]
  });
}, /setiap indikator/, 'Verification must cover every mapped indicator exactly once');
assert.throws(function () {
  soloVerificationContext.saveSoloIndicatorVerification_({
    attemptId: 'ATT-SOLO', currentUser: { email: 'teacher@example.test' },
    results: [
      { indicatorId: 'IND-A', percentage: 90, evidence: 'Bukti.' },
      { indicatorId: 'IND-B', percentage: 101, evidence: 'Bukti.' }
    ]
  });
}, /Persentase ketercapaian/, 'Percentage above 100 must be rejected');


const dominantVerificationContext = {
  soloAchievementCategory_: function (percentage) { return percentage > 85 ? 'exceeds' : percentage >= 70 ? 'achieved' : 'not_achieved'; },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () { dominantVerificationContext.released = true; } }; } },
  requiredText_: function (value) { if (!String(value || '').trim()) throw new Error('ID wajib'); return String(value).trim(); },
  parseJson_: function (value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } },
  listRows_: function (table) {
    if (table === 'Attempts') return [{ attemptId: 'ATT-SOLO', assessmentId: 'ASM-SOLO', studentId: 'ST-1', status: 'graded' }];
    if (table === 'Assessments') return [{ assessmentId: 'ASM-SOLO', classification: 'SOLO_TAX' }];
    if (table === 'Questions') return [{ questionId: 'SQ-1', assessmentId: 'ASM-SOLO' }];
    if (table === 'Events') return [{
      attemptId: 'ATT-SOLO', eventType: 'SOLO_INDICATOR_VERIFICATION',
      eventAt: '2026-11-04T00:00:00Z',
      detailsJson: JSON.stringify({ results: [{ indicatorId: 'IND-A', percentage: 90, category: 'exceeds', evidence: 'Siswa menghubungkan konsep.' }] })
    }, {
      attemptId: 'ATT-SOLO', eventType: 'AI_SOLO_SCORING_RECOMMENDATION',
      eventAt: '2026-11-03T23:59:00Z',
      detailsJson: JSON.stringify({ provider: 'TOKENPORTAL', model: 'model-test', promptVersion: 2, dominantRecommendation: { level: 'RELATIONAL', evidenceSummary: 'Jawaban mengintegrasikan dua konsep secara konsisten.', questionEvidence: [{ questionId: 'SQ-1', evidence: 'Siswa menghubungkan konsep A dan B.' }] } })
    }];
    return [];
  },
  appendRow_: function (table, row) { dominantVerificationContext.appended.push({ table: table, row: row }); },
  makeId_: function (prefix) { return prefix + '-TEST'; },
  currentTimestamp_: function () { return '2026-11-04T00:01:00Z'; },
  appended: [], released: false
};
vm.createContext(dominantVerificationContext);
vm.runInContext(extractFunction('saveSoloDominantVerification_', source), dominantVerificationContext);
const dominantResult = dominantVerificationContext.saveSoloDominantVerification_({
  attemptId: 'ATT-SOLO', currentUser: { email: 'teacher@example.test' },
  teacherLevel: 'RELATIONAL', teacherReason: ''
});
assert.equal(dominantResult.status, 'verified', 'Teacher can verify an AI-supported dominant SOLO level');
assert.equal(dominantVerificationContext.appended[0].table, 'Events', 'Dominant-level verification must be audit logged');
assert.equal(dominantVerificationContext.released, true, 'Dominant-level verification lock must be released');
assert.throws(function () {
  dominantVerificationContext.saveSoloDominantVerification_({
    attemptId: 'ATT-SOLO', currentUser: { email: 'teacher@example.test' },
    teacherLevel: 'EXTENDED_ABSTRACT'
  });
}, /Alasan perubahan level/, 'Teacher must explain a different final level from the AI recommendation');

console.log('PASS: learning repository static guard tests');
