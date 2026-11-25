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
      [ "$E2E_MODE" != --open-links ] || packages="$packages xdg-utils"
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
  if [ "$E2E_MODE" = --open-links ]; then
    # A browser that currently handles web links, as on a desktop.
    mkdir -p "$apps" "$HOME/.config"
    printf '[Desktop Entry]\nType=Application\nName=Browser\nExec=/bin/true %%u\nMimeType=x-scheme-handler/https;\n' > "$apps/browser.desktop"
    xdg-mime default browser.desktop x-scheme-handler/http x-scheme-handler/https
  fi

  # shellcheck disable=SC2086 # E2E_MODE is empty or one option
  sh /e2e/get.sh $E2E_MODE
  if [ "$E2E_MODE" = --appimage ]; then
    test -x "$HOME/Applications/Linear.AppImage"
  else
    test -x "$HOME/.local/share/linear-desktop/linear"
    test -L "$HOME/.local/bin/linear"
  fi
  test -f "$HOME/.local/share/icons/hicolor/256x256/apps/linear.png"
  if [ "$E2E_MODE" = --open-links ]; then
    links="$HOME/.local/share/linear-desktop/linear-links"
    [ "$("$links" --status)" = on ]
    [ "$(xdg-mime query default x-scheme-handler/https)" = linear-links.desktop ]
    [ "$("$links" --explain https://linear.app/acme/issue/A-1)" = "app linear://linear.app/acme/issue/A-1" ]
    echo "== link handling on"
  fi
  # Unquoted Exec, or xdg-open (xdg-utils) can't start Linear for linear:// links.
  grep -q "^Exec=$HOME/" "$apps/linear.desktop"
  echo "== installed OK: $(grep '^Exec=' "$apps/linear.desktop")"

  sh /e2e/get.sh --uninstall
  test ! -e "$apps/linear.desktop"
  test ! -e "$cache"
  if [ "$E2E_MODE" = --open-links ]; then
    [ "$(xdg-mime query default x-scheme-handler/https)" = browser.desktop ]
    echo "== browser restored"
  fi
  echo "== uninstalled OK"
}

if [ "$(id -u)" = 0 ]; then as_root; else as_user; fi
