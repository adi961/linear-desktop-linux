# Linear desktop for Linux (unofficial)

Runs the **official** Linear desktop app on Linux. Linear ships the same
Electron app for macOS and Windows but no Linux build. This project builds one
on your machine from Linear's Windows release, and adds the few Linux pieces
Linear's code lacks.

Because it runs Linear's own desktop code, you get the real app: native
notifications that open the issue when clicked, tabs, the global command menu,
`linear://` links, the unread badge, and starting coding agents (amp, claude,
codex, opencode) in a terminal. Web wrappers around linear.app miss these,
notifications included.

Not affiliated with or endorsed by Linear. See [Licensing](#licensing).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/adi961/linear-desktop-linux/main/get.sh | sh
```

This downloads Linear from Linear (verified against its published hash),
builds the Linux app and installs it for your user. Linear then appears in your
app launcher. You need `curl` and `tar`; the build brings its own Node.js if
yours is older than 20.12 or missing. The first run downloads about 360 MB.

Options (pass them after `sh -s --`, e.g. `… | sh -s -- --system`):

| Option | |
|---|---|
| `--appimage` | Build `~/Applications/Linear.AppImage` instead of installing, and add it to the app menu |
| `--no-integrate` | With `--appimage`: don't add it to the app menu |
| `--system` | Install for all users into `/opt` (asks for sudo) |
| `--uninstall` | Remove Linear and the build cache (add `--system` for a system-wide install). Your Linear data in `~/.config/Linear` is kept |

To read the script before running it: `curl -fsSLO https://raw.githubusercontent.com/adi961/linear-desktop-linux/main/get.sh`,
then `sh get.sh`.

### AppImage

`… | sh -s -- --appimage` produces a single-file `Linear.AppImage` (x86_64 or
aarch64). It also needs the `file` command. The AppImage manages its own
desktop integration:

```sh
~/Applications/Linear.AppImage --integrate     # add to the app menu, register linear:// links
~/Applications/Linear.AppImage --unintegrate   # undo that
```

Notifications, the unread badge and `linear://` links need the menu entry that
`--integrate` adds. Without FUSE installed the AppImage still runs, but unpacks
itself on every start; install `fuse3` to avoid that.

## Sandbox

Linear runs with Chromium's sandbox, and refuses to start with it turned off.
The sandbox needs unprivileged user namespaces, or a setuid helper.

- **Regular install:** works everywhere. If user namespaces are restricted,
  `--system` installs the setuid helper, and the installer tells you when you
  need it.
- **AppImage:** can't use the setuid helper. On Ubuntu 24.04 and later,
  AppArmor restricts user namespaces, and the AppImage explains this instead of
  starting. Allow it once with
  `~/Applications/Linear.AppImage --install-apparmor-profile` (uses sudo). This
  installs the same kind of profile Ubuntu ships for Chrome, Brave and Slack;
  see it with `--print-apparmor-profile`. Where user namespaces are switched
  off in the kernel, use the regular install.

## Updating

Linear tells you when a new version is out. Run the install command again to
update; downloads that haven't changed are reused.

## Build from a checkout

Needs Node.js 20.12+ and pnpm.

```sh
pnpm install
pnpm build                    # or: pnpm build --appimage, --arch arm64, --help
./dist/linear-<version>-linux-x64/install.sh             # per user
sudo ./dist/linear-<version>-linux-x64/install.sh --system
```

## How it works

| Piece | Where |
|---|---|
| Installer: fetches the builder release and Node.js if needed, builds, installs | `get.sh` |
| Build: download and verify, extract (7-Zip compiled to WebAssembly), patch, repack, set Electron fuses | `scripts/build.mjs`, `scripts/lib/` |
| Patches to Linear's minified main process: literal before/after pairs, each must match exactly once or the build fails | `scripts/lib/patches.mjs` |
| Linux modules packed into the app at `/linux` | `src/app/` |
| Install script, desktop entry, AppImage launcher | `packaging/` |

What the patches change on Linux (macOS and Windows code is untouched):

- **Coding-agent terminal launcher**: Linear's macOS launcher, with its `open -a`
  replaced by a Linux terminal (`src/app/terminal.js`). Linear's choice of
  terminal is used first, then `$TERMINAL`, `xdg-terminal-exec`, and known
  emulators.
- **Unread badge**: the Unity LauncherEntry API, which KDE Plasma, Dash-to-Dock
  and Ubuntu Dock show (`src/app/badge.js`).
- **Window lifecycle**: closing the last window quits, and the window is
  restored next launch, as on Windows.
- **Updater**: off, replaced by the update notification
  (`src/app/update-check.js`).

`src/app/bootstrap.js` also turns on Wayland window decorations and the
GlobalShortcuts portal, and sets the window icon.

Not ported: macOS-only features (trackpad haptics, force press, swipe
navigation, the `screencapture` screenshot tool).

## Licensing

This project's code is MIT licensed. Linear's app is Linear's software. Its
[terms](https://linear.app/terms) don't allow redistributing it, so this
project never publishes a built app: releases contain only the build tooling,
and every user's machine downloads Linear directly from Linear. Whether
building it this way is in line with Linear's terms is for you to judge.

## Development

```sh
pnpm test                                               # unit tests
LINEAR_MAIN_JS=path/to/out/main/index.js pnpm test      # also patch Linear's real bundle
pnpm package-builder && test/e2e/get-sh.sh ubuntu:24.04 [--appimage]   # installer in a clean container
```

A weekly CI job builds against Linear's latest release and opens an issue if a
patch stops matching.
