/**
 * Static guard tests for the Apps Script learning repository.
 * Run from the repository root: node tests/learning-repository-static.test.js
 * These tests do not connect to Apps Script or any spreadsheet.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('Code.gs', 'utf8');
assert.doesNotThrow(() => new vm.Script(source), 'Code.gs must be syntactically valid JavaScript');

function bodyOf(name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Missing function: ' + name);
  const end = nextName ? source.indexOf('function ' + nextName + '(', start + 1) : -1;
  return source.slice(start, end < 0 ? source.length : end);
}

const update = bodyOf('updateRowByKey_', 'bundleSnapshotFromRecord_');
assert.match(update, /Object\\.keys\\(fields\\)\\.forEach/, 'All update columns must be validated before writing');
assert.match(update, /getFormulas\\(\\)/, 'Untouched formulas must be preserved');
assert.match(update, /setValues\\(\\[updatedRow\\]\\)/, 'A row update must use one range write');
assert.doesNotMatch(update, /\\.setValue\\(/, 'A row update must not write cells individually');

const readiness = bodyOf('learningRepositoryAssertReady_', 'learningActive_');
assert.match(readiness, /getLastColumn\\(\\)/, 'Readiness must check sheet dimensions');
assert.match(readiness, /header kosong/i, 'Readiness must reject blank headers');
assert.match(readiness, /header duplikat/i, 'Readiness must reject duplicate headers');
assert.match(readiness, /LEARNING_REPOSITORY_V1/, 'Readiness must require completed migration');

const audit = bodyOf('learningAuditedWrite_', 'learningObjectivePublic_');
assert.match(audit, /learningAuditBegin_/, 'Audit intent must be persisted before entity write');
assert.match(audit, /writeFn\\(\\)/, 'Audited write must execute the entity write');
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
  const next = source.indexOf('\\nfunction ', start + 1);
  const section = source.slice(start, next < 0 ? source.length : next);
  assert.match(section, /learningAuditedWrite_/, endpoint + ' must use audited write wrapper');
}

console.log('PASS: learning repository static guard tests');
