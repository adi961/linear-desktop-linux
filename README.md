# Linear desktop for Linux (unofficial)

Builds a Linux version of the **official** Linear desktop app. Linear ships
the same Electron app for macOS and Windows and doesn't publish a Linux build.
This project takes the Windows build, puts it on the Linux build of the same
Electron version, and adds the few Linux pieces Linear's code lacks.

Because it runs Linear's own desktop code, you get the real desktop app:
native notifications (with click-through to the issue), tabs, the global
command menu, `linear://` links, the unread badge, and launching coding agents
(amp, claude, codex, opencode) in a terminal. Web wrappers around linear.app
miss these, notifications included.

Not affiliated with or endorsed by Linear. Linear's app isn't redistributed:
the build downloads it from `releases.linear.app` and verifies it.

## Build and install

Needs Node.js 20+, pnpm, `7z` (p7zip/7zip) and `tar`.

```sh
pnpm install
pnpm build                      # latest Linear, for this machine's architecture
./dist/linear-<version>-linux-x64/install.sh            # per user (~/.local)
sudo ./dist/linear-<version>-linux-x64/install.sh --system   # or system-wide
```

Run `pnpm build --help` for options (`--arch arm64`, or `--version` with
`--sha512` to pin an older release). Use `install.sh --uninstall` to remove it;
your data in `~/.config/Linear` is kept.

The Chromium sandbox stays on. Where unprivileged user namespaces are
restricted (Ubuntu 24.04+ AppArmor, hardened kernels), use `--system`, which
installs the setuid sandbox helper. The installer warns you if this applies.

## Updating

The app notifies you when Linear publishes a new version. Rebuild and reinstall
to update. Set `LINEAR_LINUX_UPDATE_CHECK=0` to turn the check off.

## How it works

| Piece | Where |
|---|---|
| Download, verify, extract, patch, repack, set fuses, package | `scripts/build.mjs`, `scripts/lib/` |
| Patches to Linear's minified main process (literal before/after pairs; each must match exactly once or the build fails) | `scripts/lib/patches.mjs` |
| Linux modules packed into the app at `/linux` | `src/app/` |

What the patches change on Linux (macOS and Windows code is untouched):

- **Coding-tool terminal launcher**: Linear's macOS launcher class, with its
  `open -a` call replaced by a Linux terminal (`src/app/terminal.js`). The
  terminal Linear asks for is used first, then `$TERMINAL`,
  `xdg-terminal-exec`, and known emulators.
- **Unread badge**: the Unity LauncherEntry API, which KDE Plasma, Dash-to-Dock
  and Ubuntu Dock show (`src/app/badge.js`).
- **Window lifecycle**: closing the last window quits and restores the window
  next launch, as on Windows.
- **Updater**: off, replaced by the update notification
  (`src/app/update-check.js`).

`src/app/bootstrap.js` also turns on Wayland window decorations and the
GlobalShortcuts portal, and sets the window icon.

Not ported: macOS-only features (trackpad haptics, force press, swipe
navigation, the `screencapture` screenshot tool).

## Tests

```sh
pnpm test
LINEAR_MAIN_JS=path/to/out/main/index.js pnpm test   # also patch Linear's real bundle
```
