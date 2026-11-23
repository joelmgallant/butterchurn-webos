// Local smoke test: the real bridge on 127.0.0.1:8097 fed synth-capture.js,
// and dist/app served on 127.0.0.1:8098. Open http://127.0.0.1:8098/ and read
// http://127.0.0.1:8097/status.
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var bridge = require('../bridge/audio-bridge.js');
var APP_DIR = path.join(__dirname, '..', 'dist', 'app');
var TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.json': 'application/json' };

bridge.createBridge({
  captureCommand: [process.execPath, path.join(__dirname, 'synth-capture.js')],
  log: function (line) { console.log('bridge: ' + line); }
}).listen(8097, '127.0.0.1');

http.createServer(function (req, res) {
  var name = req.url.split('?')[0] === '/' ? 'index.html' : path.basename(req.url.split('?')[0]);
  fs.readFile(path.join(APP_DIR, name), function (err, data) {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8098, '127.0.0.1', function () { console.log('serving dist/app on http://127.0.0.1:8098/'); });
