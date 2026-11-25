'use strict';

// Linux terminal launching for Linear's coding-tool integration.
//
// Linear's POSIX (macOS) launcher writes a self-contained shell script (cd,
// exports and the tool command) and hands it to `openScript(scriptPath,
// terminalName)`, which on macOS runs `open -a <Terminal>`. The build patches
// that class to use this module on Linux (see scripts/lib/patches.mjs).
// `terminalName` is a name from `getInstalledTerminalApps()`, or undefined
// for "the default terminal".

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;

// `argv(command)` turns a command vector into the emulator's arguments.
const KNOWN_TERMINALS = [
  { name: 'Ghostty', bin: 'ghostty', argv: (c) => ['-e', ...c] },
  { name: 'kitty', bin: 'kitty', argv: (c) => ['--', ...c] },
  { name: 'Alacritty', bin: 'alacritty', argv: (c) => ['-e', ...c] },
  { name: 'WezTerm', bin: 'wezterm', argv: (c) => ['start', '--', ...c] },
  { name: 'foot', bin: 'foot', argv: (c) => c },
  { name: 'Konsole', bin: 'konsole', argv: (c) => ['-e', ...c] },
  { name: 'Ptyxis', bin: 'ptyxis', argv: (c) => ['--', ...c] },
  { name: 'GNOME Terminal', bin: 'gnome-terminal', argv: (c) => ['--', ...c] },
  { name: 'GNOME Console', bin: 'kgx', argv: (c) => ['-e', c.map(shellQuote).join(' ')] },
  { name: 'Xfce Terminal', bin: 'xfce4-terminal', argv: (c) => ['-x', ...c] },
  { name: 'Tilix', bin: 'tilix', argv: (c) => ['-e', c.map(shellQuote).join(' ')] },
  { name: 'Terminator', bin: 'terminator', argv: (c) => ['-x', ...c] },
  { name: 'XTerm', bin: 'xterm', argv: (c) => ['-e', ...c] },
];

// Desktop-agnostic launchers that respect the user's configured terminal.
const DEFAULT_LAUNCHERS = [
  { name: 'xdg-terminal-exec', bin: 'xdg-terminal-exec', argv: (c) => c },
  { name: 'x-terminal-emulator', bin: 'x-terminal-emulator', argv: (c) => ['-e', ...c] },
];

// Runs the script, deletes it (it can contain the issue prompt) and keeps the
// window open so the output stays readable, like macOS Terminal and Linear's
// Windows launcher (`powershell -NoExit`).
const RUNNER =
  'script="$1"; "$script"; status=$?; rm -f -- "$script"; ' +
  'printf "\\n[Process exited with status %s] Press Enter to close." "$status"; read -r _';

function wrapScript(scriptPath) {
  return ['/bin/sh', '-c', RUNNER, 'linear-terminal', scriptPath];
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findExecutable(bin, env) {
  if (bin.includes('/')) return isExecutable(bin) ? bin : undefined;
  return (env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, bin))
    .find(isExecutable);
}

function getInstalledTerminalApps(env = process.env) {
  return KNOWN_TERMINALS.filter((t) => findExecutable(t.bin, env)).map(({ bin, name }) => ({ id: bin, name }));
}

// $TERMINAL may carry flags ("kitty --single-instance"); unknown emulators get
// the conventional -e.
function terminalFromEnv(env) {
  const [bin, ...flags] = (env.TERMINAL ?? '').trim().split(/\s+/);
  if (!bin) return undefined;
  const known = KNOWN_TERMINALS.find((t) => t.bin === path.basename(bin));
  const argv = known?.argv ?? ((c) => ['-e', ...c]);
  return { name: env.TERMINAL, bin, argv: (c) => [...flags, ...argv(c)] };
}

// Order: the terminal Linear asked for, $TERMINAL, the desktop-agnostic
// launchers, then the first known emulator installed.
function resolveTerminal(terminalName, env = process.env) {
  const candidates = [
    KNOWN_TERMINALS.find((t) => t.name === terminalName),
    terminalFromEnv(env),
    ...DEFAULT_LAUNCHERS,
    ...KNOWN_TERMINALS,
  ];
  for (const terminal of candidates) {
    const exe = terminal && findExecutable(terminal.bin, env);
    if (exe) return { name: terminal.name, exe, argv: terminal.argv };
  }
  return undefined;
}

// Electron's own variables would leak into the user's shell and change how
// tools in it behave.
function childEnv(env = process.env) {
  const out = { ...env };
  if (out.ORIGINAL_XDG_CURRENT_DESKTOP) out.XDG_CURRENT_DESKTOP = out.ORIGINAL_XDG_CURRENT_DESKTOP;
  for (const key of Object.keys(out)) {
    if (key.startsWith('ELECTRON_') || key === 'ORIGINAL_XDG_CURRENT_DESKTOP' || key === 'CHROME_DESKTOP') delete out[key];
  }
  return out;
}

// Resolves to Linear's launcher result shape: { success, error? }.
async function openScript(scriptPath, terminalName) {
  const terminal = resolveTerminal(terminalName);
  if (!terminal) {
    return { success: false, error: 'No supported terminal emulator found. Install one or set $TERMINAL.' };
  }
  try {
    fs.chmodSync(scriptPath, 0o700); // Linear writes it world-readable (0755)
    const child = spawn(terminal.exe, terminal.argv(wrapScript(scriptPath)), {
      detached: true,
      stdio: 'ignore',
      env: childEnv(),
      cwd: os.homedir(),
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return { success: true };
  } catch (error) {
    console.error(`linux-terminal: could not launch ${terminal.name}`, error);
    return { success: false, error: 'Could not open terminal' };
  }
}

module.exports = {
  KNOWN_TERMINALS,
  childEnv,
  getInstalledTerminalApps,
  openScript,
  resolveTerminal,
  wrapScript,
};
