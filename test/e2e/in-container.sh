#!/bin/sh
# Runs inside the test container (see get-sh.sh). As root: adds what a
# minimal image lacks compared with a desktop install, creates a user, and
# runs itself again as that user to install, check and uninstall Linear.
set -eu

as_root() {
  case "$E2E_IMAGE" in
    ubuntu*|debian*)
      apt-get update -qq
      packages="curl ca-certificates"
      [ "$E2E_MODE" != --appimage ] || [ -n "$E2E_WITHOUT_FILE" ] || packages="$packages file"
      # shellcheck disable=SC2086 # word splitting intended
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $packages >/dev/null ;;
    fedora*)
      dnf install -y -q util-linux shadow-utils file >/dev/null ;;
    archlinux*)
      pacman -Sy --noconfirm --needed file >/dev/null ;;
  esac
  useradd -m -u "$E2E_UID" tester
  # su resets the environment; pass on what the user part needs.
  su tester -c "E2E_MODE='$E2E_MODE' LINEAR_LINUX_RELEASES_URL='$LINEAR_LINUX_RELEASES_URL' sh /e2e/in-container.sh"
}

as_user() {
  cache="$HOME/.cache/linear-desktop-linux"
  apps="$HOME/.local/share/applications"
  mkdir -p "$cache/downloads"
  cp /e2e/seed/* "$cache/downloads/"

  # shellcheck disable=SC2086 # E2E_MODE is empty or one option
  sh /e2e/get.sh $E2E_MODE
  if [ "$E2E_MODE" = --appimage ]; then
    test -x "$HOME/Applications/Linear.AppImage"
  else
    test -x "$HOME/.local/share/linear-desktop/linear"
    test -L "$HOME/.local/bin/linear"
  fi
  test -f "$HOME/.local/share/icons/hicolor/256x256/apps/linear.png"
  echo "== installed OK: $(grep '^Exec=' "$apps/linear.desktop")"

  sh /e2e/get.sh --uninstall
  test ! -e "$apps/linear.desktop"
  test ! -e "$cache"
  echo "== uninstalled OK"
}

if [ "$(id -u)" = 0 ]; then as_root; else as_user; fi
