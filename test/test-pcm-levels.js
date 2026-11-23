// Run: node test/test-pcm-levels.js
'use strict';
var assert = require('assert');
var PcmLevels = require('../web/pcm-levels.js');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Interleaved stereo s16le bytes from [left, right] sample pairs.
function stereoBytes(frames) {
  var bytes = new Uint8Array(frames.length * 4);
  var view = new DataView(bytes.buffer);
  frames.forEach(function (frame, index) {
    view.setInt16(index * 4, frame[0], true);
    view.setInt16(index * 4 + 2, frame[1], true);
  });
  return bytes;
}

function repeatFrame(frame, count) {
  var frames = [];
  for (var i = 0; i < count; i++) frames.push(frame);
  return frames;
}

test('silence reads as the 128 midpoint on every channel', function () {
  var levels = PcmLevels.create({ fftSize: 8 });
  levels.pushBytes(stereoBytes(repeatFrame([0, 0], 8)));
  var out = levels.read();
  assert.deepStrictEqual(Array.from(out.timeByteArrayL), [128, 128, 128, 128, 128, 128, 128, 128]);
  assert.deepStrictEqual(Array.from(out.timeByteArrayR), [128, 128, 128, 128, 128, 128, 128, 128]);
  assert.deepStrictEqual(Array.from(out.timeByteArray), [128, 128, 128, 128, 128, 128, 128, 128]);
});

test('arrays are fftSize long before any audio arrives', function () {
  var out = PcmLevels.create({ fftSize: 16 }).read();
  assert.strictEqual(out.timeByteArray.length, 16);
  assert.strictEqual(out.timeByteArrayL[0], 128);
});

test('a loud signal is scaled so its peak lands on the target', function () {
  var levels = PcmLevels.create({ fftSize: 4, target: 100 });
  levels.pushBytes(stereoBytes([[6000, -6000], [-6000, 6000], [3000, 0], [0, -3000]]));
  var out = levels.read();
  assert.deepStrictEqual(Array.from(out.timeByteArrayL), [228, 28, 178, 128]);
  assert.deepStrictEqual(Array.from(out.timeByteArrayR), [28, 228, 128, 78]);
  // The mono channel is the mean of left and right.
  assert.deepStrictEqual(Array.from(out.timeByteArray), [128, 128, 153, 103]);
});

test('quiet noise below the floor is not blown up to full scale', function () {
  var levels = PcmLevels.create({ fftSize: 2, target: 100, floor: 1000 });
  levels.pushBytes(stereoBytes([[100, 100], [-100, -100]]));
  var out = levels.read();
  assert.deepStrictEqual(Array.from(out.timeByteArrayL), [138, 118]);
});

test('the newest fftSize frames are kept, oldest first', function () {
  var levels = PcmLevels.create({ fftSize: 2, target: 100, floor: 1 });
  levels.pushBytes(stereoBytes([[1000, 0], [2000, 0], [3000, 0], [4000, 0]]));
  var out = levels.read();
  assert.deepStrictEqual(Array.from(out.timeByteArrayL), [203, 228]);
});

test('a frame split across chunks is reassembled', function () {
  var levels = PcmLevels.create({ fftSize: 2, target: 100, floor: 1 });
  var bytes = stereoBytes([[4000, 0], [-4000, 0]]);
  levels.pushBytes(bytes.subarray(0, 3));
  levels.pushBytes(bytes.subarray(3, 6));
  levels.pushBytes(bytes.subarray(6));
  assert.deepStrictEqual(Array.from(levels.read().timeByteArrayL), [228, 28]);
});

test('the gain follows the music down as the peak decays', function () {
  var levels = PcmLevels.create({ fftSize: 4, target: 100, floor: 100, sampleRate: 1000, decaySeconds: 1 });
  levels.pushBytes(stereoBytes(repeatFrame([8000, 8000], 4)));
  var loudPeak = levels.peak();
  levels.pushBytes(stereoBytes(repeatFrame([1000, 1000], 4000)));
  assert.ok(levels.peak() < loudPeak / 2, 'peak decayed: ' + levels.peak());
  assert.ok(levels.peak() >= 1000, 'peak never drops below the live signal');
});

test('the peak survives silence at the floor, not zero', function () {
  var levels = PcmLevels.create({ fftSize: 4, floor: 500, sampleRate: 1000, decaySeconds: 0.01 });
  levels.pushBytes(stereoBytes(repeatFrame([0, 0], 1000)));
  assert.strictEqual(levels.peak(), 500);
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
