#!/bin/sh
# End-to-end test of get.sh in a clean container: a fresh user on a distro
# with only curl added installs Linear (or the AppImage), then uninstalls it.
#
#   test/e2e/get-sh.sh <image> [--appimage]
#
# Serves the builder from dist/release (run scripts/package-builder.sh first).
# Downloads in .cache are copied in to save bandwidth; get.sh verifies them
# like fresh downloads. The steps inside the container are in-container.sh.
set -eu

image=$1
mode=${2:-}
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
[ -f "$root/dist/release/SHA256SUMS" ] || { echo "run scripts/package-builder.sh first" >&2; exit 1; }

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root/dist/release" >/dev/null 2>&1 &
server=$!
trap 'kill "$server"' EXIT

docker run --rm --network host \
  -v "$root/get.sh:/e2e/get.sh:ro" \
  -v "$root/test/e2e/in-container.sh:/e2e/in-container.sh:ro" \
  -v "$root/.cache:/e2e/seed:ro" \
  -e LINEAR_LINUX_RELEASES_URL="http://127.0.0.1:$port" \
  -e E2E_IMAGE="$image" -e E2E_MODE="$mode" -e E2E_UID="$(id -u)" -e E2E_WITHOUT_FILE="${E2E_WITHOUT_FILE:-}" \
  "$image" sh /e2e/in-container.sh
