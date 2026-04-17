'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  numberToDifficulty,
  difficultyColor,
  statusLabel,
  statusColor,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('numberToDifficulty: maps 0..3 to labels', () => {
  assert.equal(numberToDifficulty(0), 'ușoară');
  assert.equal(numberToDifficulty(1), 'medie');
  assert.equal(numberToDifficulty(2), 'dificilă');
  assert.equal(numberToDifficulty(3), 'concurs');
  assert.equal(numberToDifficulty(99), 'concurs');
  assert.equal(numberToDifficulty(undefined), 'concurs');
});

test('difficultyColor: hex values for each bucket, falls back to red', () => {
  assert.equal(difficultyColor(0), '5cb85c');
  assert.equal(difficultyColor(1), 'f0ad4e');
  assert.equal(difficultyColor(2), '5bc0de');
  assert.equal(difficultyColor(3), 'd9534f');
  assert.equal(difficultyColor(42), 'd9534f');
});

test('statusLabel: handles solved / tried / unknown', () => {
  assert.equal(statusLabel('solved'), 'rezolvată');
  assert.equal(statusLabel('tried'), 'încercată');
  assert.equal(statusLabel('unattempted'), 'neîncercată');
  assert.equal(statusLabel(null), 'neîncercată');
});

test('statusColor: colors match status label intent', () => {
  assert.equal(statusColor('solved'), '5cb85c');
  assert.equal(statusColor('tried'), 'f0ad4e');
  assert.equal(statusColor('unattempted'), '6c757d');
  assert.equal(statusColor(''), '6c757d');
});
