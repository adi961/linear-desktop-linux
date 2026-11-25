#!/bin/sh
# Installs (or removes) the Linux build of Linear produced by scripts/build.mjs.
#
#   ./install.sh                     per-user install into ~/.local
#   sudo ./install.sh --system       system-wide install into /opt and /usr/local
#   ./install.sh --uninstall [--system]
#
#   --open-links / --no-open-links   open Linear links from other apps in Linear
#                                    (per user; also in Linear's File menu). A
#                                    reinstall keeps the current choice.
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
mode=user
action=install
open_links=keep
for arg in "$@"; do
  case "$arg" in
    --system) mode=system ;;
    --uninstall) action=uninstall ;;
    --open-links) open_links=yes ;;
    --no-open-links) open_links=no ;;
    -h|--help) sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$mode" = system ]; then
  [ "$(id -u)" -eq 0 ] || { echo "--system needs root (run with sudo)" >&2; exit 1; }
  [ "$open_links" = keep ] || { echo "link handling is per user: turn it on in Linear's File menu" >&2; exit 2; }
  app_dir=/opt/linear-desktop
  bin_dir=/usr/local/bin
  data_dir=/usr/local/share
else
  [ "$(id -u)" -ne 0 ] || { echo "refusing a per-user install as root; use --system" >&2; exit 1; }
  app_dir=${XDG_DATA_HOME:-$HOME/.local/share}/linear-desktop
  bin_dir=$HOME/.local/bin
  data_dir=${XDG_DATA_HOME:-$HOME/.local/share}
fi

# A path for a desktop entry's Exec. Quoted only when it has whitespace: the
# spec allows both, but xdg-utils (used by xdg-open on many desktops, e.g.
# Sway) doesn't remove quotes and then can't find the program.
exec_path() {
  case "$1" in
    *[[:space:]]*) printf '"%s"' "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

refresh_caches() {
  command -v update-desktop-database >/dev/null 2>&1 &&
    update-desktop-database -q "$data_dir/applications" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 &&
    gtk-update-icon-cache -q -t -f "$data_dir/icons/hicolor" 2>/dev/null || true
}

if [ "$action" = uninstall ]; then
  if [ "$mode" = user ] && [ -x "$app_dir/linear-links" ]; then
    "$app_dir/linear-links" --disable >/dev/null
  fi
  rm -rf "$app_dir"
  rm -f "$bin_dir/linear" "$data_dir/applications/linear.desktop"
  find "$data_dir/icons/hicolor" -path '*/apps/linear.png' -delete 2>/dev/null || true
  refresh_caches
  echo "Linear removed. Your data in ~/.config/Linear was kept."
  exit 0
fi

[ -x "$here/app/linear" ] || { echo "app/linear not found next to install.sh" >&2; exit 1; }
# The path goes into the desktop entry's Exec. Characters that would need
# escaping there are refused rather than escaped.
case "$app_dir" in
  *[\"\`\$\\\&\|]*) echo "can't install into $app_dir: it contains \" \` \$ \\ & or |" >&2; exit 1 ;;
esac

# Copy next to the target first: a failed copy leaves the old install intact.
mkdir -p "$(dirname "$app_dir")"
rm -rf "$app_dir.new"
cp -a "$here/app" "$app_dir.new"
cp "$here/BUILD-INFO.json" "$app_dir.new/"
cp "$here/install.sh" "$app_dir.new/install.sh" # kept for: install.sh --uninstall
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
sed "s|@EXEC@|$(exec_path "$app_dir/linear")|" "$here/share/applications/linear.desktop" > "$data_dir/applications/linear.desktop"
mkdir -p "$data_dir/icons"
cp -R "$here/share/icons/." "$data_dir/icons/"
refresh_caches
if [ "$mode" = user ] && command -v xdg-mime >/dev/null 2>&1; then
  mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}" # xdg-mime fails if it's missing
  xdg-mime default linear.desktop x-scheme-handler/linear
fi

# Link handling: apply the requested choice, or refresh the handler (it keeps
# a copy of linear-links) when it's already on.
if [ "$mode" = user ]; then
  links="$app_dir/linear-links"
  case "$open_links" in
    yes) "$links" --enable "$app_dir/linear" ;;
    no) "$links" --disable ;;
    keep) [ "$("$links" --status)" = off ] || "$links" --enable "$app_dir/linear" >/dev/null ;;
  esac
fi

echo "Linear installed to $app_dir"
echo "Start it from your app launcher or run: $bin_dir/linear"
echo "Remove it with: $app_dir/install.sh --uninstall$([ "$mode" = system ] && echo ' --system')"

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
