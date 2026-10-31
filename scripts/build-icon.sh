#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
iconset="$root/assets/Obavenus.iconset"
png="$root/assets/Obavenus.png"

mkdir -p "$iconset"
swift "$root/scripts/draw-icon.swift" "$png"
sips -z 16 16 "$png" --out "$iconset/icon_16x16.png" >/dev/null
sips -z 32 32 "$png" --out "$iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$png" --out "$iconset/icon_32x32.png" >/dev/null
sips -z 64 64 "$png" --out "$iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$png" --out "$iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$png" --out "$iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$png" --out "$iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$png" --out "$iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$png" --out "$iconset/icon_512x512.png" >/dev/null
cp "$png" "$iconset/icon_512x512@2x.png"
node "$root/scripts/pack-icns.cjs" "$iconset" "$root/assets/Obavenus.icns"
rm -rf "$iconset"
