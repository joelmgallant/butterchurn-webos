// Stands in for arecord in the bridge tests: writes zeroed PCM until killed.
'use strict';
var chunk = Buffer.alloc(1920);
setInterval(function () { process.stdout.write(chunk); }, 5);
