#!/usr/bin/env node
//
// Streams the TV's mixed audio to the butterchurn screen saver page.
//
//   GET  /pcm     raw s16le stereo 48 kHz from ALSA hw:0,10, for as long as
//                 the request stays open. One listener at a time: the device
//                 is exclusive, so a new request stops the old capture.
//   POST /status  the page's own report (fps, preset, audio peak), logged.
//   GET  /status  the last report, to check the page from ssh.
//
// hw:0,10 carries HDMI input audio while the screen saver shows over the
// input (measured on the G2, webOS 7.3.1, 2026-11-21). arecord runs only
// while a page listens, so LG's own users of the tap are never held off.
//
// Loopback only: the page and this server are both on the TV.
//
// Undo: rm /var/lib/webosbrew/init.d/58-audio-bridge, then
//       kill "$(cat /tmp/audio-bridge.pid)"
'use strict';

var http = require('http');
var fs = require('fs');
var childProcess = require('child_process');

var DEFAULT_PORT = 8097;
var LOG_PATH = '/var/lib/audio-bridge/audio-bridge.log';
var PID_PATH = '/tmp/audio-bridge.pid';
var LOG_MAX_BYTES = 64 * 1024;
var MAX_STATUS_BYTES = 4096;
// Short periods keep the picture in step with the music; arecord falls back
// to the nearest the driver allows.
var ARECORD = ['arecord', '-q', '-D', 'hw:0,10', '-f', 'S16_LE', '-r', '48000', '-c', '2',
  '-t', 'raw', '-F', '10000', '-B', '40000'];

function createBridge(options) {
  var captureCommand = options.captureCommand || ARECORD;
  var log = options.log || function () {};
  var current = null;
  var lastStatus = null;
  var activeCaptures = 0;

  function stopCapture(capture, reason) {
    if (capture.stopped) return;
    capture.stopped = true;
    log('capture stopped (' + reason + ')');
    capture.child.kill('SIGTERM');
  }

  function streamPcm(req, res) {
    if (current) stopCapture(current, 'a new listener took over');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    var child = childProcess.spawn(captureCommand[0], captureCommand.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    var capture = { child: child, stopped: false };
    current = capture;
    activeCaptures++;
    log('capture started (pid ' + child.pid + ')');

    var stderr = '';
    child.stderr.on('data', function (chunk) { stderr = (stderr + chunk).slice(-500); });
    // The response ends in finish(), after exit, so an early exit is reported
    // as an exit rather than as the listener leaving.
    child.stdout.pipe(res, { end: false });

    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      activeCaptures--;
      if (current === capture) current = null;
      res.end();
    }
    child.on('error', function (err) {
      log('capture failed: ' + err.message);
      capture.stopped = true;
      finish();
    });
    child.on('exit', function (code, signal) {
      if (!capture.stopped) log('capture exited (code ' + code + ', signal ' + signal + ')' + (stderr ? ': ' + stderr.trim() : ''));
      capture.stopped = true;
      finish();
    });
    res.on('close', function () { stopCapture(capture, 'listener left'); });
  }

  function receiveStatus(req, res) {
    var body = '';
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > MAX_STATUS_BYTES) req.destroy();
    });
    req.on('end', function () {
      var report;
      try {
        report = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }
      report.receivedAt = new Date().toISOString();
      lastStatus = report;
      log('status ' + JSON.stringify(report));
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
    });
  }

  var server = http.createServer(function (req, res) {
    var urlPath = req.url.split('?')[0];
    if (req.method === 'GET' && urlPath === '/pcm') return streamPcm(req, res);
    if (req.method === 'POST' && urlPath === '/status') return receiveStatus(req, res);
    if (req.method === 'GET' && urlPath === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(lastStatus));
    }
    res.writeHead(404);
    res.end();
  });
  server.activeCaptureCount = function () { return activeCaptures; };
  server.on('close', function () { if (current) stopCapture(current, 'server closing'); });
  return server;
}

function appendLog(line) {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) fs.renameSync(LOG_PATH, LOG_PATH + '.1');
    var stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(LOG_PATH, stamp + ' ' + line + '\n');
  } catch (err) {
    // Logging must never take the bridge down.
  }
}

function alreadyRunning() {
  try {
    process.kill(parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10), 0);
    return true;
  } catch (err) {
    return false;
  }
}

function main() {
  if (alreadyRunning()) return;
  fs.writeFileSync(PID_PATH, String(process.pid));
  var port = parseInt(process.env.AUDIO_BRIDGE_PORT, 10) || DEFAULT_PORT;
  var server = createBridge({ log: appendLog });
  server.listen(port, '127.0.0.1', function () { appendLog('started (pid ' + process.pid + ') on 127.0.0.1:' + port); });
  server.on('error', function (err) {
    appendLog('server error: ' + err.message);
    process.exit(1);
  });
  function shutdown() {
    appendLog('stopped');
    try { fs.unlinkSync(PID_PATH); } catch (err) { /* already gone */ }
    server.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createBridge: createBridge };
if (require.main === module) main();
