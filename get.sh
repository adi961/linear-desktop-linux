#!/bin/sh
# Builds the official Linear desktop app for Linux on this machine and
# installs it. Linear is downloaded from Linear and nothing of it is
# redistributed; see https://github.com/adi961/linear-desktop-linux
#
#   curl -fsSL https://raw.githubusercontent.com/adi961/linear-desktop-linux/main/get.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/adi961/linear-desktop-linux/main/get.sh | sh -s -- --appimage
#
# Options:
#   --appimage                 build ~/Applications/Linear.AppImage instead of installing
#   --no-integrate             with --appimage: don't add it to the app menu
#   --system                   install system-wide into /opt (uses sudo)
#   --open-links               open Linear links from other apps (Slack, mail…) in Linear
#   --no-open-links            stop doing that (also in Linear's File menu)
#   --uninstall                remove Linear and the build cache (add --system for a system-wide install)
#   --linear-version <x.y.z>   build that Linear version instead of the latest (needs --sha512)
#   --sha512 <base64>          installer hash for --linear-version
#   -h, --help                 show this help
#
# Running it again updates Linear. Environment:
#   LINEAR_LINUX_RELEASE=vX.Y.Z    use that release of this project, not the latest
#   LINEAR_LINUX_RELEASES_URL=URL  download the builder from a mirror
#   LINEAR_APPIMAGE_DIR=DIR        where --appimage puts Linear.AppImage

# Everything runs from main(), so a partially downloaded script does nothing.
set -eu

REPO=adi961/linear-desktop-linux
BUILDER=linear-desktop-linux-builder.tar.gz
# Runs the build when Node.js 20.12+ isn't installed (official build, nodejs.org).
NODE_VERSION=24.22.3

node_sha256() {
  case "$arch" in
    x64) echo 061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2 ;;
    arm64) echo 261af2af250dfd7e9f25cf151d1b2713a0adf8f10a9ad116c4947f68627affe8 ;;
  esac
}

say() { printf '==> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  if [ -f "$0" ]; then
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  else # piped from curl
    echo "Options and usage: https://github.com/$REPO#install"
  fi
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d ' ' -f 1
  elif have shasum; then shasum -a 256 "$1" | cut -d ' ' -f 1
  else die "sha256sum or shasum is required"
  fi
}

download() {
  say "downloading $1"
  curl -fsSL --retry 3 -o "$2.part" "$1" || die "download failed: $1"
  mv "$2.part" "$2"
}

node_is_recent() {
  have node && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 20 || (major === 20 && minor >= 12) ? 0 : 1);' 2>/dev/null
}

# Prints the Node.js to run the builder with: the system's, or an official
# build downloaded and verified once, then cached.
node_runtime() {
  if node_is_recent; then
    echo node
    return
  fi
  name="node-v$NODE_VERSION-linux-$arch"
  if [ ! -x "$cache/$name/bin/node" ]; then
    download "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.gz" "$cache/$name.tar.gz"
    [ "$(sha256_of "$cache/$name.tar.gz")" = "$(node_sha256)" ] || die "the Node.js download failed verification"
    # Unpacked aside and renamed, so an interrupted unpack is never mistaken
    # for a working Node.js.
    rm -rf "$cache/$name.partial"
    mkdir -p "$cache/$name.partial"
    tar -xzf "$cache/$name.tar.gz" -C "$cache/$name.partial" --strip-components=1
    mv "$cache/$name.partial" "$cache/$name"
    rm -f "$cache/$name.tar.gz"
  fi
  echo "$cache/$name/bin/node"
}

fetch_builder() {
  if [ -n "${LINEAR_LINUX_RELEASES_URL:-}" ]; then
    base=$LINEAR_LINUX_RELEASES_URL
  elif [ -n "${LINEAR_LINUX_RELEASE:-}" ]; then
    base="https://github.com/$REPO/releases/download/$LINEAR_LINUX_RELEASE"
  else
    base="https://github.com/$REPO/releases/latest/download"
  fi
  download "$base/SHA256SUMS" "$cache/SHA256SUMS"
  download "$base/$BUILDER" "$cache/$BUILDER"
  expected=$(grep " $BUILDER\$" "$cache/SHA256SUMS" | cut -d ' ' -f 1)
  [ -n "$expected" ] && [ "$(sha256_of "$cache/$BUILDER")" = "$expected" ] ||
    die "the builder download failed verification"
  rm -rf "$cache/builder"
  mkdir -p "$cache/builder"
  tar -xzf "$cache/$BUILDER" -C "$cache/builder" --strip-components=1
}

have_fuse() { have fusermount3 || have fusermount; }

run_appimage() {
  if have_fuse; then
    "$@"
  else # an AppImage can still run without FUSE by extracting itself first
    APPIMAGE_EXTRACT_AND_RUN=1 "$@"
  fi
}

uninstall() {
  if [ "$system" = 1 ]; then
    [ -x /opt/linear-desktop/install.sh ] || die "no system-wide install found"
    sudo /opt/linear-desktop/install.sh --uninstall --system
  else
    appimage_file="${LINEAR_APPIMAGE_DIR:-$HOME/Applications}/Linear.AppImage"
    if [ -f "$appimage_file" ]; then
      run_appimage "$appimage_file" --unintegrate
      rm -f "$appimage_file"
    fi
    user_install="${XDG_DATA_HOME:-$HOME/.local/share}/linear-desktop/install.sh"
    [ ! -x "$user_install" ] || "$user_install" --uninstall
  fi
  rm -rf "$cache"
  say "removed Linear and the build cache"
}

main() {
  appimage=0 integrate=1 system=0 remove=0 linear_version="" sha512="" links_option=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --appimage) appimage=1 ;;
      --no-integrate) integrate=0 ;;
      --system) system=1 ;;
      --uninstall) remove=1 ;;
      --open-links|--no-open-links) links_option=$1 ;;
      --linear-version) [ $# -ge 2 ] || die "$1 needs a value"; linear_version=$2; shift ;;
      --sha512) [ $# -ge 2 ] || die "$1 needs a value"; sha512=$2; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
  done

  [ "$(uname -s)" = Linux ] || die "this installer is for Linux"
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
  [ "$(id -u)" -ne 0 ] || die "run this as your user, not root (--system uses sudo when needed)"
  [ "$appimage" = 0 ] || [ "$system" = 0 ] || die "--appimage and --system can't be combined"
  [ "$system" = 0 ] || [ -z "$links_option" ] || die "link handling is per user: turn it on in Linear's File menu"
  cache="${XDG_CACHE_HOME:-$HOME/.cache}/linear-desktop-linux"

  if [ "$remove" = 1 ]; then
    uninstall
    return
  fi

  for tool in curl tar; do have "$tool" || die "$tool is required"; done
  mkdir -p "$cache"
  fetch_builder
  node_bin=$(node_runtime)

  say "building Linear (this downloads about 360 MB the first time)"
  # The output directory starts empty, so the build's result is its only entry.
  rm -rf "$cache/dist"
  set -- --out "$cache/dist" --cache "$cache/downloads"
  [ "$appimage" = 0 ] || set -- "$@" --appimage
  [ -z "$linear_version" ] || set -- "$@" --version "$linear_version"
  [ -z "$sha512" ] || set -- "$@" --sha512 "$sha512"
  "$node_bin" "$cache/builder/scripts/build.mjs" "$@" >/dev/null || die "the build failed (see above)"
  dist=$(find "$cache/dist" -mindepth 1 -maxdepth 1 -type d -name 'linear-*')

  if [ "$appimage" = 1 ]; then
    dir="${LINEAR_APPIMAGE_DIR:-$HOME/Applications}"
    mkdir -p "$dir"
    cp "$dist.AppImage" "$dir/Linear.AppImage.new"
    chmod +x "$dir/Linear.AppImage.new"
    mv "$dir/Linear.AppImage.new" "$dir/Linear.AppImage"
    [ "$integrate" = 0 ] || run_appimage "$dir/Linear.AppImage" --integrate
    [ -z "$links_option" ] || run_appimage "$dir/Linear.AppImage" "$links_option"
    say "Linear is at $dir/Linear.AppImage"
    if ! have_fuse; then
      say "note: FUSE isn't installed, so the AppImage unpacks itself on every start (slower). Install fuse3 to avoid that."
    fi
  else
    if [ "$system" = 1 ]; then
      sudo "$dist/install.sh" --system
    else
      # shellcheck disable=SC2086 # empty or one option
      "$dist/install.sh" $links_option
    fi
  fi
  rm -rf "$cache/dist" # the downloads stay cached for the next update
  say "done. Run this again any time to update Linear."
}

main "$@"
