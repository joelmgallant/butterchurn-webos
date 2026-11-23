// Turns a raw s16le stereo PCM stream into the byte time-domain arrays that
// butterchurn's render({audioLevels}) takes in place of a Web Audio analyser.
//
// The TV's capture tap (hw:0,10) is post-volume and quiet: peaks of ~6000 of
// 32767 at volume 21. An automatic gain scales the tracked peak to `target`
// (of 127), so the picture reacts the same at any volume. `floor` keeps hiss
// and silence from being blown up to full scale.
(function (root) {
  'use strict';

  var BYTES_PER_FRAME = 4;

  function create(options) {
    options = options || {};
    var fftSize = options.fftSize || 1024;
    var target = options.target || 100;
    var floor = options.floor || 400;
    var sampleRate = options.sampleRate || 48000;
    var decaySeconds = options.decaySeconds || 3;
    var decayPerFrame = Math.exp(-1 / (sampleRate * decaySeconds));

    var ringLeft = new Int16Array(fftSize);
    var ringRight = new Int16Array(fftSize);
    var oldestIndex = 0;
    var trackedPeak = floor;
    var carry = new Uint8Array(BYTES_PER_FRAME);
    var carryLength = 0;

    var out = {
      timeByteArray: new Uint8Array(fftSize),
      timeByteArrayL: new Uint8Array(fftSize),
      timeByteArrayR: new Uint8Array(fftSize)
    };

    function readSample(low, high) {
      return ((high << 8) | low) << 16 >> 16;
    }

    function addFrame(left, right) {
      ringLeft[oldestIndex] = left;
      ringRight[oldestIndex] = right;
      oldestIndex = (oldestIndex + 1) % fftSize;
      var loudest = Math.max(left < 0 ? -left : left, right < 0 ? -right : right);
      trackedPeak = Math.max(loudest, trackedPeak * decayPerFrame, floor);
    }

    function pushBytes(bytes) {
      var index = 0;
      while (carryLength > 0 && carryLength < BYTES_PER_FRAME && index < bytes.length) {
        carry[carryLength++] = bytes[index++];
      }
      if (carryLength === BYTES_PER_FRAME) {
        addFrame(readSample(carry[0], carry[1]), readSample(carry[2], carry[3]));
        carryLength = 0;
      }
      for (; index + BYTES_PER_FRAME <= bytes.length; index += BYTES_PER_FRAME) {
        addFrame(readSample(bytes[index], bytes[index + 1]), readSample(bytes[index + 2], bytes[index + 3]));
      }
      while (index < bytes.length) carry[carryLength++] = bytes[index++];
    }

    function toByte(sample, gain) {
      var scaled = Math.round(sample * gain) + 128;
      return scaled < 0 ? 0 : (scaled > 255 ? 255 : scaled);
    }

    function read() {
      var gain = target / trackedPeak;
      for (var i = 0; i < fftSize; i++) {
        var ringIndex = (oldestIndex + i) % fftSize;
        var left = ringLeft[ringIndex];
        var right = ringRight[ringIndex];
        out.timeByteArrayL[i] = toByte(left, gain);
        out.timeByteArrayR[i] = toByte(right, gain);
        out.timeByteArray[i] = toByte((left + right) / 2, gain);
      }
      return out;
    }

    return {
      pushBytes: pushBytes,
      read: read,
      peak: function () { return trackedPeak; }
    };
  }

  var api = { create: create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PcmLevels = api;
})(this);
