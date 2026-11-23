#!/bin/sh
# Build the app, then install it, the audio bridge and the bridge's boot hook
# on the TV, and restart the bridge. Usage: ./deploy.sh [address]
set -eu
TV="${1:-192.168.50.23}"
KEY="$HOME/.ssh/id_rsa"
SSH="ssh -i $KEY root@$TV"
HERE="$(cd "$(dirname "$0")" && pwd)"

IPK="$(python3 "$HERE/build-app.py" | tail -1)"
$SSH 'mkdir -p /var/lib/audio-bridge'
scp -i "$KEY" -q "$HERE/bridge/audio-bridge.js" "root@$TV:/var/lib/audio-bridge/audio-bridge.js"
scp -i "$KEY" -q "$HERE/bridge/58-audio-bridge" "root@$TV:/var/lib/webosbrew/init.d/58-audio-bridge"
scp -i "$KEY" -q "$IPK" "root@$TV:/tmp/butterchurn.ipk"
# luna-send needs stdin held open on this TV, or it prints nothing.
$SSH 'chmod 755 /var/lib/webosbrew/init.d/58-audio-bridge
  if [ -f /tmp/audio-bridge.pid ]; then kill "$(cat /tmp/audio-bridge.pid)" 2>/dev/null || true; sleep 1; fi; rm -f /tmp/audio-bridge.pid
  /var/lib/webosbrew/init.d/58-audio-bridge
  sleep 25 | luna-send -i luna://com.webos.appInstallService/dev/install "{\"id\":\"org.joelmgallant.butterchurn\",\"ipkUrl\":\"/tmp/butterchurn.ipk\",\"subscribe\":true}" | grep -o "\"state\":\"[^\"]*\"" | tail -1
  rm -f /tmp/butterchurn.ipk
  tail -2 /var/lib/audio-bridge/audio-bridge.log' | tr -d '\r'
