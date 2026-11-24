// Butterchurn over an HDMI input, fed the TV's own audio by audio-bridge.js.
(function () {
  'use strict';

  var BRIDGE = 'http://127.0.0.1:8097';
  // The G2's compositor is 1920x1080; rendering below it and letting the
  // canvas scale keeps the frame rate up on the TV's GPU.
  // Launch params ({"params":{"width":960}}) override it, for tuning on the TV.
  var launchParams = {};
  try { launchParams = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}') || {}; } catch (err) { /* no params */ }
  var RENDER_WIDTH = Math.max(320, Math.min(1920, parseInt(launchParams.width, 10) || 1280));
  var RENDER_HEIGHT = Math.round(RENDER_WIDTH * 9 / 16);
  // Per-vertex equations run in JS on the TV's CPU once per mesh point per
  // frame; butterchurn's default 48x36 mesh is 1728 points, 32x24 is 768.
  var MESH_WIDTH = Math.max(8, Math.min(64, parseInt(launchParams.mesh, 10) || 32));
  var MESH_HEIGHT = Math.round(MESH_WIDTH * 3 / 4);
  // Presets measured below this frame rate are skipped from then on
  // (preset-guard.js); {"resetSlow":true} forgets the list.
  var MIN_FPS = Math.max(1, parseInt(launchParams.minFps, 10) || 40);
  var SLOW_STORAGE_KEY = 'butterchurn.slowPresets';
  var PRESET_SECONDS = 30;
  var BLEND_SECONDS = 2.7;
  var STATUS_SECONDS = 10;
  var RECONNECT_MS = 2000;

  var canvas = document.getElementById('visual');
  var notice = document.getElementById('notice');
  var levels = PcmLevels.create({ fftSize: 1024 });
  var report = { stream: 'connecting', bytes: 0, errors: [] };

  function noteError(message) {
    report.errors.push(String(message).slice(0, 200));
    if (report.errors.length > 5) report.errors.shift();
  }
  window.addEventListener('error', function (event) { noteError(event.message); });

  function showNotice(text) {
    notice.textContent = text;
    notice.style.display = 'block';
  }

  function postStatus(extra) {
    var body = JSON.stringify(Object.assign({}, report, extra || {}));
    // text/plain keeps it a simple request, with no CORS preflight.
    fetch(BRIDGE + '/status', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' } })
      .catch(function () {});
  }

  function listen() {
    report.stream = 'connecting';
    fetch(BRIDGE + '/pcm', { cache: 'no-store' }).then(function (response) {
      if (!response.ok || !response.body) throw new Error('bridge answered ' + response.status);
      report.stream = 'open';
      var reader = response.body.getReader();
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) throw new Error('stream ended');
          report.bytes += result.value.length;
          levels.pushBytes(result.value);
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      report.stream = 'down: ' + err.message;
      setTimeout(listen, RECONNECT_MS);
    });
  }

  function loadSlowList() {
    try {
      if (launchParams.resetSlow) window.localStorage.removeItem(SLOW_STORAGE_KEY);
      var stored = JSON.parse(window.localStorage.getItem(SLOW_STORAGE_KEY) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch (err) {
      return [];
    }
  }

  function saveSlowList(names) {
    try { window.localStorage.setItem(SLOW_STORAGE_KEY, JSON.stringify(names)); } catch (err) { /* not persisted */ }
  }

  function shuffled(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var held = copy[i];
      copy[i] = copy[j];
      copy[j] = held;
    }
    return copy;
  }

  function start() {
    if (!canvas.getContext('webgl2')) {
      showNotice('This TV’s browser has no WebGL 2, which Butterchurn needs.');
      postStatus({ fatal: 'no webgl2' });
      return;
    }
    canvas.width = RENDER_WIDTH;
    canvas.height = RENDER_HEIGHT;

    var butterchurnApi = window.butterchurn.default || window.butterchurn;
    var presetApi = window.butterchurnPresets.default || window.butterchurnPresets;
    // Required by createVisualizer; the audio itself arrives through render().
    var audioContext = new (window.AudioContext || window.webkitAudioContext)();
    var visualizer = butterchurnApi.createVisualizer(audioContext, canvas, {
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
      pixelRatio: 1,
      textureRatio: 1,
      meshWidth: MESH_WIDTH,
      meshHeight: MESH_HEIGHT
    });

    var presets = presetApi.getPresets();
    var presetNames = Object.keys(presets);
    var guard = PresetGuard.create({
      minFps: MIN_FPS,
      settleSeconds: BLEND_SECONDS + 1.5,
      sampleSeconds: 5,
      presetCount: presetNames.length,
      blocked: loadSlowList()
    });
    report.verdicts = [];

    var queue = [];
    var rotationTimer = null;
    function nextPreset(blendSeconds) {
      if (!queue.length) {
        queue = shuffled(presetNames.filter(function (presetName) { return !guard.isBlocked(presetName); }));
      }
      var name = queue.shift();
      try {
        visualizer.loadPreset(presets[name], blendSeconds);
        report.preset = name;
        guard.begin(name, performance.now());
      } catch (err) {
        noteError('preset ' + name + ': ' + err.message);
      }
      clearTimeout(rotationTimer);
      rotationTimer = setTimeout(function () { nextPreset(BLEND_SECONDS); }, PRESET_SECONDS * 1000);
    }
    nextPreset(0);

    function handleVerdict(verdict) {
      report.verdicts.push(verdict);
      if (report.verdicts.length > 8) report.verdicts.shift();
      if (!verdict.blocked) return;
      saveSlowList(guard.blockedNames());
      nextPreset(BLEND_SECONDS);
    }

    var frames = 0;
    function frame(timestamp) {
      visualizer.render({ audioLevels: levels.read() });
      frames++;
      var verdict = guard.frame(timestamp);
      if (verdict) handleVerdict(verdict);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    var lastBytes = 0;
    setInterval(function () {
      postStatus({
        fps: Math.round(frames / STATUS_SECONDS),
        bytesPerSecond: Math.round((report.bytes - lastBytes) / STATUS_SECONDS),
        peak: Math.round(levels.peak()),
        presetCount: presetNames.length,
        renderWidth: RENDER_WIDTH,
        mesh: MESH_WIDTH + 'x' + MESH_HEIGHT,
        minFps: MIN_FPS,
        slowPresets: guard.blockedNames()
      });
      frames = 0;
      lastBytes = report.bytes;
    }, STATUS_SECONDS * 1000);

    listen();
    postStatus({ started: true, userAgent: navigator.userAgent });
  }

  // As an app (not the screen saver, which the system closes itself), any key
  // closes it, as a key closes a screen saver. The Magic Remote sends 1199
  // (cursor hide) on its own about a minute after it stops moving.
  var KEY_CURSOR_HIDE = 1199;
  if (location.href.indexOf('org.joelmgallant.butterchurn') !== -1) {
    document.addEventListener('keydown', function (event) {
      if (event.keyCode === KEY_CURSOR_HIDE) return;
      event.preventDefault();
      postStatus({ closedByKey: event.keyCode });
      window.close();
    });
  }

  try {
    start();
  } catch (err) {
    showNotice('Butterchurn could not start: ' + err.message);
    noteError(err.stack || err.message);
    postStatus({ fatal: err.message });
  }
})();
