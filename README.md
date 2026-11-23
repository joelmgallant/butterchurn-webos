# Butterchurn TV

[Butterchurn](https://github.com/jberg/butterchurn) (MilkDrop in WebGL) on a
rooted LG G2 (webOS 7.3.1), drawn over an HDMI input and reacting to its audio.

- `bridge/audio-bridge.js` runs on the TV (node 12) on `127.0.0.1:8097`.
  `GET /pcm` streams the TV's mixed audio (ALSA `hw:0,10`, s16le stereo
  48 kHz) and runs `arecord` only while a page listens. `GET /status` returns
  the page's last report (fps, preset, audio peak, errors).
  `bridge/58-audio-bridge` is its Homebrew Channel boot hook.
- `web/` is the page: `pcm-levels.js` turns the PCM into butterchurn's
  `render({audioLevels})` input with automatic gain, and `app.js` cycles a random
  preset from the base pack every 30 s.
- `build-app.py` packages `web/` as the app `org.joelmgallant.butterchurn`
  with `defaultWindowType: overlay`, so it draws over the input while the input
  stays in front and keeps playing. Any key closes it. The launch param
  `{"width": N}` sets the render width (1280 by default).

Launch it with `luna-send -n 1 luna://com.webos.applicationManager/launch
'{"id":"org.joelmgallant.butterchurn"}'` (stdin held open, as luna-send needs on
webOS 7). On the author's TV a small evdev watcher does that on the remote's 3
key.

It is an app rather than a Glasshouse screen saver: webOS 7's app manager
cannot switch the screen saver app between QML and web without a restart, so
a web screen saver cannot sit beside QML ones on this TV.

## Use

    (cd tools && npm ci)        # LG's ares-package, once
    ./build-app.py              # dist/org.joelmgallant.butterchurn_<version>_all.ipk
    ./deploy.sh <tv-address>    # build, install app + bridge, restart the bridge (SSH_KEY=... optional)

## Test

    node test/test-pcm-levels.js
    node test/test-audio-bridge.js
    node test/local-smoke.js    # then open http://127.0.0.1:8098/ (after build-app.py)

On the TV: `curl -s http://127.0.0.1:8097/status`; the bridge's log is
`/var/lib/audio-bridge/audio-bridge.log`.

## Undo on the TV

    rm /var/lib/webosbrew/init.d/58-audio-bridge
    kill "$(cat /tmp/audio-bridge.pid)"
    luna-send -n 1 luna://com.webos.appInstallService/dev/remove '{"id":"org.joelmgallant.butterchurn"}'

Butterchurn and its presets are MIT (`web/THIRD-PARTY-LICENSES.txt`).
