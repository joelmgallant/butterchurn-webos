// Run: node test/test-audio-bridge.js
'use strict';
var assert = require('assert');
var http = require('http');
var path = require('path');
var bridge = require('../bridge/audio-bridge.js');

var FAKE_CAPTURE = [process.execPath, path.join(__dirname, 'fake-capture.js')];

function startBridge(extra) {
  var events = [];
  var options = Object.assign({
    host: '127.0.0.1',
    port: 0,
    captureCommand: FAKE_CAPTURE,
    log: function (line) { events.push(line); }
  }, extra || {});
  var server = bridge.createBridge(options);
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port, events: events });
    });
  });
}

function request(port, method, urlPath, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: urlPath }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Opens /pcm and resolves once `byteCount` bytes have arrived.
function openStream(port, byteCount) {
  return new Promise(function (resolve, reject) {
    var req = http.get({ host: '127.0.0.1', port: port, path: '/pcm' }, function (res) {
      var received = 0;
      var done = false;
      res.on('data', function (chunk) {
        received += chunk.length;
        if (!done && received >= byteCount) { done = true; resolve({ req: req, res: res, received: received }); }
      });
      res.on('end', function () { if (!done) reject(new Error('stream ended after ' + received + ' bytes')); });
    });
    req.on('error', function (err) { if (err.code !== 'ECONNRESET') reject(err); });
  });
}

function waitFor(check, label) {
  var started = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (check()) return resolve();
      if (Date.now() - started > 3000) return reject(new Error('timed out waiting for ' + label));
      setTimeout(poll, 10);
    })();
  });
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('/pcm streams the capture output with CORS open', async function () {
  var b = await startBridge();
  var stream = await openStream(b.port, 4096);
  assert.strictEqual(stream.res.headers['access-control-allow-origin'], '*');
  assert.strictEqual(stream.res.headers['content-type'], 'application/octet-stream');
  stream.req.destroy();
  b.server.close();
});

test('closing the stream stops the capture', async function () {
  var b = await startBridge();
  var stream = await openStream(b.port, 1024);
  assert.strictEqual(b.server.activeCaptureCount(), 1);
  stream.req.destroy();
  await waitFor(function () { return b.server.activeCaptureCount() === 0; }, 'capture to stop');
  b.server.close();
});

test('a second listener takes the device from the first', async function () {
  var b = await startBridge();
  var first = await openStream(b.port, 1024);
  var firstEnded = new Promise(function (resolve) { first.res.on('end', resolve); first.res.on('close', resolve); });
  var second = await openStream(b.port, 1024);
  await firstEnded;
  assert.strictEqual(b.server.activeCaptureCount(), 1);
  second.req.destroy();
  b.server.close();
});

test('a capture that exits ends the response', async function () {
  var b = await startBridge({ captureCommand: [process.execPath, '-e', 'process.stdout.write(Buffer.alloc(64))'] });
  var res = await request(b.port, 'GET', '/pcm');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 64);
  await waitFor(function () { return b.server.activeCaptureCount() === 0; }, 'capture count to clear');
  assert.ok(b.events.some(function (line) { return /capture exited/.test(line); }), b.events.join('\n'));
  b.server.close();
});

test('a capture that cannot start ends the response and is logged', async function () {
  var b = await startBridge({ captureCommand: ['/nonexistent/arecord'] });
  var res = await request(b.port, 'GET', '/pcm');
  assert.strictEqual(res.body.length, 0);
  assert.ok(b.events.some(function (line) { return /capture failed/.test(line); }), b.events.join('\n'));
  b.server.close();
});

test('a status report posted by the page reads back and is logged', async function () {
  var b = await startBridge();
  var posted = await request(b.port, 'POST', '/status', JSON.stringify({ fps: 58, preset: 'Geiss' }));
  assert.strictEqual(posted.status, 204);
  var read = await request(b.port, 'GET', '/status');
  var report = JSON.parse(read.body);
  assert.strictEqual(report.fps, 58);
  assert.strictEqual(report.preset, 'Geiss');
  assert.ok(typeof report.receivedAt === 'string');
  assert.ok(b.events.some(function (line) { return /status .*Geiss/.test(line); }));
  b.server.close();
});

test('a status body that is not JSON is refused', async function () {
  var b = await startBridge();
  var posted = await request(b.port, 'POST', '/status', 'not json');
  assert.strictEqual(posted.status, 400);
  b.server.close();
});

test('an unknown path is a 404', async function () {
  var b = await startBridge();
  var res = await request(b.port, 'GET', '/nope');
  assert.strictEqual(res.status, 404);
  b.server.close();
});

(async function run() {
  var failed = 0;
  for (var i = 0; i < tests.length; i++) {
    try {
      await tests[i].fn();
      console.log('ok   ' + tests[i].name);
    } catch (err) {
      failed++;
      console.log('FAIL ' + tests[i].name + '\n     ' + (err && err.stack || err));
    }
  }
  console.log(tests.length - failed + '/' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
