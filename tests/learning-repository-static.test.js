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
const retryResult = reconciliationContext.adminReconcileLearningAudit_(
  { logId: 'AUD-PENDING-1', resolution: 'not_applied', note: 'permintaan retry berbeda' },
  { userId: 'admin-1', email: 'admin@example.test' }
);
assert.equal(retryResult.action, 'RECONCILED_APPLIED', 'Retry must reuse the first recorded decision');
assert.equal(retryResult.reusedDecision, true, 'Retry must report reuse of the original decision');
assert.equal(appendCount, 1, 'Retry must not append a duplicate decision audit');
assert.equal(reconciliationRows[0].action, 'RECONCILED_APPLIED', 'Retry must close the original pending record');



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
assert.match(source, /if \(classification === 'SOLO_TAX'\) throw new Error/, 'SOLO Tax creation must remain disabled until its editor is ready');
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
  const next = sourceText.indexOf('\\nfunction ', start + 1);
  return sourceText.slice(start, next < 0 ? sourceText.length : next);
}
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

console.log('PASS: learning repository static guard tests');
