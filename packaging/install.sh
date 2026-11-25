#!/bin/sh
# Installs (or removes) the Linux build of Linear produced by scripts/build.mjs.
#
#   ./install.sh                     per-user install into ~/.local
#   sudo ./install.sh --system       system-wide install into /opt and /usr/local
#   ./install.sh --uninstall [--system]
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
mode=user
action=install
for arg in "$@"; do
  case "$arg" in
    --system) mode=system ;;
    --uninstall) action=uninstall ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$mode" = system ]; then
  [ "$(id -u)" -eq 0 ] || { echo "--system needs root (run with sudo)" >&2; exit 1; }
  app_dir=/opt/linear-desktop
  bin_dir=/usr/local/bin
  data_dir=/usr/local/share
else
  [ "$(id -u)" -ne 0 ] || { echo "refusing a per-user install as root; use --system" >&2; exit 1; }
  app_dir=${XDG_DATA_HOME:-$HOME/.local/share}/linear-desktop
  bin_dir=$HOME/.local/bin
  data_dir=${XDG_DATA_HOME:-$HOME/.local/share}
fi

refresh_caches() {
  command -v update-desktop-database >/dev/null 2>&1 &&
    update-desktop-database -q "$data_dir/applications" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 &&
    gtk-update-icon-cache -q -t -f "$data_dir/icons/hicolor" 2>/dev/null || true
}

if [ "$action" = uninstall ]; then
  rm -rf "$app_dir"
  rm -f "$bin_dir/linear" "$data_dir/applications/linear.desktop"
  find "$data_dir/icons/hicolor" -path '*/apps/linear.png' -delete 2>/dev/null || true
  refresh_caches
  echo "Linear removed. Your data in ~/.config/Linear was kept."
  exit 0
fi

[ -x "$here/app/linear" ] || { echo "app/linear not found next to install.sh" >&2; exit 1; }

# Copy next to the target first: a failed copy leaves the old install intact.
mkdir -p "$(dirname "$app_dir")"
rm -rf "$app_dir.new"
cp -a "$here/app" "$app_dir.new"
cp "$here/BUILD-INFO.json" "$app_dir.new/"
rm -rf "$app_dir"
mv "$app_dir.new" "$app_dir"

if [ "$mode" = system ]; then
  # Setuid sandbox helper: needed where unprivileged user namespaces are
  # restricted (for example Ubuntu 24.04+ AppArmor, hardened kernels).
  chown root:root "$app_dir/chrome-sandbox"
  chmod 4755 "$app_dir/chrome-sandbox"
fi

mkdir -p "$bin_dir" "$data_dir/applications"
ln -sf "$app_dir/linear" "$bin_dir/linear"
sed "s|@EXEC@|$app_dir/linear|" "$here/share/applications/linear.desktop" > "$data_dir/applications/linear.desktop"
mkdir -p "$data_dir/icons"
cp -R "$here/share/icons/." "$data_dir/icons/"
refresh_caches
if [ "$mode" = user ] && command -v xdg-mime >/dev/null 2>&1; then
  mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}" # xdg-mime fails if it's missing
  xdg-mime default linear.desktop x-scheme-handler/linear
fi

echo "Linear installed to $app_dir"
echo "Start it from your app launcher or run: $bin_dir/linear"

# Warn if Chromium's sandbox will not be able to start.
if [ "$mode" = user ]; then
  userns_ok=1
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" = 0 ] && userns_ok=0
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ] && userns_ok=0
  if [ "$userns_ok" = 0 ]; then
    echo
    echo "WARNING: unprivileged user namespaces are restricted on this system, so the"
    echo "Chromium sandbox may fail to start. Install system-wide instead, which sets"
    echo "up the setuid sandbox helper:  sudo $here/install.sh --system"
  fi
fi
