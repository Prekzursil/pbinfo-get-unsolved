'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  copyTextViaClipboardApi,
  copyTextViaExecCommand,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('copyTextViaClipboardApi: absent navigator → attempted=false', async () => {
  assert.deepEqual(await copyTextViaClipboardApi(null, 'x'), { attempted: false, error: null });
  assert.deepEqual(await copyTextViaClipboardApi({}, 'x'), { attempted: false, error: null });
  assert.deepEqual(await copyTextViaClipboardApi({ clipboard: {} }, 'x'), {
    attempted: false,
    error: null,
  });
});

test('copyTextViaClipboardApi: success path', async () => {
  const calls = [];
  const navigator = { clipboard: { writeText: async (v) => calls.push(v) } };
  const res = await copyTextViaClipboardApi(navigator, 'hello');
  assert.deepEqual(res, { attempted: true, error: null });
  assert.deepEqual(calls, ['hello']);
});

test('copyTextViaClipboardApi: writeText throws returns attempted=true error=err', async () => {
  const err = new Error('nope');
  const navigator = {
    clipboard: {
      writeText: async () => {
        throw err;
      },
    },
  };
  const res = await copyTextViaClipboardApi(navigator, 'x');
  assert.equal(res.attempted, true);
  assert.equal(res.error, err);
});

test('copyTextViaExecCommand: null document returns false', () => {
  assert.equal(copyTextViaExecCommand(null, 'x'), false);
});

test('copyTextViaExecCommand: success path returns true', () => {
  let appended = 0;
  let selected = 0;
  const fakeEl = {
    style: {},
    setAttribute: () => {},
    focus: () => {},
    select: () => (selected += 1),
    remove: () => {},
  };
  const document = {
    createElement: () => fakeEl,
    body: { appendChild: () => (appended += 1) },
    execCommand: () => true,
  };
  assert.equal(copyTextViaExecCommand(document, 'hi'), true);
  assert.equal(appended, 1);
  assert.equal(selected, 1);
  assert.equal(fakeEl.value, 'hi');
});

test('copyTextViaExecCommand: execCommand returning false propagates', () => {
  const document = {
    createElement: () => ({
      style: {},
      setAttribute: () => {},
      focus: () => {},
      select: () => {},
      remove: () => {},
    }),
    body: { appendChild: () => {} },
    execCommand: () => false,
  };
  assert.equal(copyTextViaExecCommand(document, 'hi'), false);
});

test('copyTextViaExecCommand: missing execCommand returns false', () => {
  const document = {
    createElement: () => ({
      style: {},
      setAttribute: () => {},
      focus: () => {},
      select: () => {},
      remove: () => {},
    }),
    body: { appendChild: () => {} },
    // no execCommand
  };
  assert.equal(copyTextViaExecCommand(document, 'hi'), false);
});

test('copyTextViaExecCommand: throwing DOM returns false', () => {
  const document = {
    createElement: () => {
      throw new Error('nope');
    },
  };
  assert.equal(copyTextViaExecCommand(document, 'hi'), false);
});
