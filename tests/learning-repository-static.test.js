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

const headerValidation = bodyOf('validateRepositorySheetHeaders_', 'learningRepositoryAssertReady_');
assert.match(headerValidation, /getLastColumn\(\)/, 'Header validation must check sheet dimensions');
assert.match(headerValidation, /header kosong/i, 'Readiness must reject blank headers');
assert.match(headerValidation, /header duplikat/i, 'Readiness must reject duplicate headers');
const readiness = bodyOf('learningRepositoryAssertReady_', 'learningActive_');
assert.match(readiness, /LEARNING_REPOSITORY_V1/, 'Readiness must require completed migration');

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
assert.match(assessmentCreation, /bundleVersionId:sourceVersion\\?sourceVersion\\.versionId:''/, 'Assessment must retain its source version reference');
assert.match(assessmentCreation, /sourceBundleVersionId:sourceVersion\\?sourceVersion\\.versionId:''/, 'Copied questions must retain their source version reference');
const bundleRead = bodyOf('getQuestionBundle_', 'createAssessment_');
assert.match(bundleRead, /getBundleVersion_\(\{versionId:bundle\.latestVersionId\}\)/, 'Opening a bundle must resolve the latest immutable version');
assert.match(bundleRead, /learningObjectiveId:String\(snapshot\.learningObjectiveId/, 'Bundle read must return the objective from its snapshot');
assert.match(bundleRead, /learningIndicatorId:String\(snapshot\.learningIndicatorId/, 'Bundle read must return the indicator from its snapshot');
assert.match(source, /if \(classification === 'SOLO_TAX'\) throw new Error/, 'SOLO Tax creation must remain disabled until its editor is ready');
assert.match(source, /const teacherOnly = \[/, 'Teacher-only actions must be explicitly registered');

console.log('PASS: learning repository static guard tests');
