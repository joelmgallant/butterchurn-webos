// Stands in for arecord in local smoke tests: real-time 48 kHz stereo s16le
// with a 120 bpm kick and a drifting tone, so butterchurn has a beat to show.
'use strict';
var RATE = 48000;
var CHUNK_FRAMES = 480;
var frame = 0;
setInterval(function () {
  var buf = Buffer.alloc(CHUNK_FRAMES * 4);
  for (var i = 0; i < CHUNK_FRAMES; i++, frame++) {
    var t = frame / RATE;
    var beat = t % 0.5;
    var kick = Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 8);
    var tone = 0.3 * Math.sin(2 * Math.PI * (440 + 110 * Math.sin(t / 3)) * t);
    var left = Math.round((kick + tone) * 6000);
    var right = Math.round((kick - tone) * 6000);
    buf.writeInt16LE(left, i * 4);
    buf.writeInt16LE(right, i * 4 + 2);
  }
  process.stdout.write(buf);
}, 10);
