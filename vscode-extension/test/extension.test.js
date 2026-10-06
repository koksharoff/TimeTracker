const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const extension = require('../out/extension.js');

test('extension exports activate and deactivate', () => {
  assert.equal(typeof extension.activate, 'function');
  assert.equal(typeof extension.deactivate, 'function');
});

test('createTrackingEvent returns a structured local event payload', () => {
  const fileInfo = {
    path: path.join('tmp', 'demo.ts'),
    language: 'typescript',
    fileName: 'demo.ts',
    workspaceFolder: null,
  };

  const payload = extension.createTrackingEvent(fileInfo, 'file_changed', 1500);

  assert.equal(payload.event, 'file_changed');
  assert.equal(payload.file.fileName, 'demo.ts');
  assert.equal(payload.elapsedMs, 1500);
  assert.ok(payload.session.startedAt);
});

test('getEventLogPath returns a path string', () => {
  assert.equal(typeof extension.getEventLogPath(), 'string');
});

test('isNewLocalCommit detects a commit made on top of the previous HEAD', () => {
  const head = { name: 'main', commit: 'aaa' };
  assert.equal(extension.isNewLocalCommit(head, { parents: ['aaa'], authorEmail: 'me@x.io' }, 'main', 'me@x.io'), true);
});

test('isNewLocalCommit ignores branch switches, resets and foreign commits', () => {
  const head = { name: 'main', commit: 'aaa' };
  assert.equal(extension.isNewLocalCommit(head, { parents: ['aaa'] }, 'feature', null), false);
  assert.equal(extension.isNewLocalCommit(head, { parents: ['zzz'] }, 'main', null), false);
  assert.equal(extension.isNewLocalCommit(undefined, { parents: ['aaa'] }, 'main', null), false);
  assert.equal(extension.isNewLocalCommit(head, { parents: ['aaa'], authorEmail: 'other@x.io' }, 'main', 'me@x.io'), false);
});

test('tracking events carry profile fields', () => {
  const payload = extension.createTrackingEvent(null);
  assert.ok('githubLogin' in payload.session);
  assert.ok('displayName' in payload.session);
});
