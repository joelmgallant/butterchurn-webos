// Run: node test/test-preset-guard.js
'use strict';
var assert = require('assert');
var PresetGuard = require('../web/preset-guard.js');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Feeds frames at `fps` from startMs for `seconds`; returns the first verdict.
function runFrames(guard, startMs, fps, seconds) {
  var verdict = null;
  var frameCount = Math.round(fps * seconds);
  for (var i = 1; i <= frameCount && !verdict; i++) {
    verdict = guard.frame(startMs + i * 1000 / fps);
  }
  return verdict;
}

function makeGuard(extra) {
  return PresetGuard.create(Object.assign({ minFps: 40, settleSeconds: 2, sampleSeconds: 4, presetCount: 10 }, extra || {}));
}

test('a fast preset is measured once and not blocked', function () {
  var guard = makeGuard();
  guard.begin('fast', 0);
  var verdict = runFrames(guard, 0, 60, 10);
  assert.strictEqual(verdict.name, 'fast');
  assert.ok(Math.abs(verdict.fps - 60) <= 1, 'fps ' + verdict.fps);
  assert.strictEqual(verdict.slow, false);
  assert.strictEqual(verdict.blocked, false);
  assert.strictEqual(guard.isBlocked('fast'), false);
  assert.strictEqual(runFrames(guard, 10000, 60, 10), null, 'only one verdict per preset');
});

test('a slow preset is blocked after the settle and sample windows', function () {
  var guard = makeGuard();
  guard.begin('slow', 0);
  var verdict = runFrames(guard, 0, 20, 10);
  assert.strictEqual(verdict.slow, true);
  assert.strictEqual(verdict.blocked, true);
  assert.ok(Math.abs(verdict.fps - 20) <= 1, 'fps ' + verdict.fps);
  assert.strictEqual(guard.isBlocked('slow'), true);
  assert.deepStrictEqual(guard.blockedNames(), ['slow']);
});

test('frames during the settle window (the blend) do not count', function () {
  var guard = makeGuard();
  guard.begin('blends-slowly', 0);
  // 2 s at 10 fps while blending, then 60 fps.
  assert.strictEqual(runFrames(guard, 0, 10, 2), null);
  var verdict = runFrames(guard, 2000, 60, 8);
  assert.strictEqual(verdict.slow, false);
});

test('no verdict before the sample window ends', function () {
  var guard = makeGuard();
  guard.begin('young', 0);
  assert.strictEqual(runFrames(guard, 0, 20, 5.5), null);
});

test('a pause in frames (page hidden) restarts the measurement', function () {
  var guard = makeGuard();
  guard.begin('paused', 0);
  assert.strictEqual(runFrames(guard, 0, 60, 3), null);
  // No frames for 30 s, then smooth again: must not read as ~2 fps.
  assert.strictEqual(guard.frame(33000), null);
  var verdict = runFrames(guard, 33000, 60, 10);
  assert.strictEqual(verdict.slow, false);
});

test('blocking stops at the cap so the pack never runs dry', function () {
  var guard = makeGuard({ presetCount: 4, maxBlockedFraction: 0.5 });
  ['a', 'b', 'c'].forEach(function (name, index) {
    var start = index * 20000;
    guard.begin(name, start);
    var verdict = runFrames(guard, start, 20, 10);
    assert.strictEqual(verdict.slow, true);
    assert.strictEqual(verdict.blocked, index < 2, name + ' blocked');
  });
  assert.deepStrictEqual(guard.blockedNames(), ['a', 'b']);
});

test('names blocked on an earlier run start blocked', function () {
  var guard = makeGuard({ blocked: ['old-slow'] });
  assert.strictEqual(guard.isBlocked('old-slow'), true);
  assert.strictEqual(guard.isBlocked('other'), false);
});

test('frames before any begin() are ignored', function () {
  var guard = makeGuard();
  assert.strictEqual(runFrames(guard, 0, 20, 10), null);
});

var failed = 0;
tests.forEach(function (entry) {
  try {
    entry.fn();
    console.log('ok   ' + entry.name);
  } catch (err) {
    failed++;
    console.log('FAIL ' + entry.name + '\n     ' + err.message);
  }
});
console.log(tests.length - failed + '/' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
