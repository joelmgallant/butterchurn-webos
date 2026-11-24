// Measures each preset's frame rate on the TV itself and blocks the ones that
// run below `minFps`, so the rotation skips them on later turns and launches.
//
// A static score cannot predict this: the cost splits between per-vertex and
// per-point equations run in JS on the TV's CPU and warp/comp shaders run on
// its GPU, and which one binds depends on the hardware.
//
// The first `settleSeconds` after a preset loads are not measured (the blend
// draws two presets at once, and shader compilation hitches). A gap of more
// than a second between frames (page hidden) restarts the window. At most
// `maxBlockedFraction` of the pack is ever blocked, so a TV that is slow at
// everything keeps a rotation.
(function (root) {
  'use strict';

  var PAUSE_MS = 1000;

  function create(options) {
    options = options || {};
    var minFps = options.minFps || 40;
    var settleMs = (options.settleSeconds || 4) * 1000;
    var sampleMs = (options.sampleSeconds || 5) * 1000;
    var maxBlocked = Math.floor((options.presetCount || 0) * (options.maxBlockedFraction || 0.5));
    var blocked = (options.blocked || []).slice();

    var current = null;

    function begin(name, nowMs) {
      current = { name: name, windowStart: nowMs + settleMs, frames: 0, lastFrame: nowMs, done: false };
    }

    function verdictFor(measured) {
      var fps = Math.round(measured.frames * 10000 / sampleMs) / 10;
      var slow = fps < minFps;
      var block = slow && blocked.length < maxBlocked && blocked.indexOf(measured.name) === -1;
      if (block) blocked.push(measured.name);
      return { name: measured.name, fps: fps, slow: slow, blocked: block };
    }

    // Call once per rendered frame; returns a verdict once per preset, else null.
    function frame(nowMs) {
      if (!current || current.done) return null;
      if (nowMs - current.lastFrame > PAUSE_MS) {
        current.windowStart = Math.max(current.windowStart, nowMs);
        current.frames = 0;
      }
      current.lastFrame = nowMs;
      if (nowMs <= current.windowStart) return null;
      current.frames++;
      if (nowMs < current.windowStart + sampleMs) return null;
      current.done = true;
      return verdictFor(current);
    }

    return {
      begin: begin,
      frame: frame,
      isBlocked: function (name) { return blocked.indexOf(name) !== -1; },
      blockedNames: function () { return blocked.slice(); }
    };
  }

  var api = { create: create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PresetGuard = api;
})(this);
