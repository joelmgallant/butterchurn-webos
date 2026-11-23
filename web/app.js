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
      textureRatio: 1
    });

    var presets = presetApi.getPresets();
    var queue = [];
    function nextPreset(blendSeconds) {
      if (!queue.length) queue = shuffled(Object.keys(presets));
      var name = queue.shift();
      try {
        visualizer.loadPreset(presets[name], blendSeconds);
        report.preset = name;
      } catch (err) {
        noteError('preset ' + name + ': ' + err.message);
      }
    }
    nextPreset(0);
    setInterval(function () { nextPreset(BLEND_SECONDS); }, PRESET_SECONDS * 1000);

    var frames = 0;
    function frame() {
      visualizer.render({ audioLevels: levels.read() });
      frames++;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    var lastBytes = 0;
    setInterval(function () {
      postStatus({
        fps: Math.round(frames / STATUS_SECONDS),
        bytesPerSecond: Math.round((report.bytes - lastBytes) / STATUS_SECONDS),
        peak: Math.round(levels.peak()),
        presetCount: Object.keys(presets).length,
        renderWidth: RENDER_WIDTH
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
