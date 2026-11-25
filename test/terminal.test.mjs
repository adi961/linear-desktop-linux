import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const terminal = createRequire(import.meta.url)('../src/app/terminal.js');

let dir;
let bin;
const savedEnv = { PATH: process.env.PATH, TERMINAL: process.env.TERMINAL };

function fakeExecutable(name, body = 'exit 0') {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

async function waitFor(predicate, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linear-term-'));
  bin = join(dir, 'bin');
  mkdirSync(bin);
});

afterEach(() => {
  process.env.PATH = savedEnv.PATH;
  if (savedEnv.TERMINAL === undefined) delete process.env.TERMINAL;
  else process.env.TERMINAL = savedEnv.TERMINAL;
  rmSync(dir, { recursive: true, force: true });
});

test('lists only terminals found in PATH', () => {
  fakeExecutable('foot');
  fakeExecutable('kitty');
  writeFileSync(join(bin, 'alacritty'), 'not executable');
  const apps = terminal.getInstalledTerminalApps({ PATH: bin });
  assert.deepEqual(apps, [
    { id: 'kitty', name: 'kitty' },
    { id: 'foot', name: 'foot' },
  ]);
});

test('uses the terminal Linear asked for, by display name', () => {
  fakeExecutable('foot');
  fakeExecutable('konsole');
  assert.equal(terminal.resolveTerminal('Konsole', { PATH: bin }).name, 'Konsole');
});

test('default terminal: $TERMINAL, then xdg-terminal-exec, then known list', () => {
  fakeExecutable('xterm');
  assert.equal(terminal.resolveTerminal(undefined, { PATH: bin }).name, 'XTerm');
  fakeExecutable('xdg-terminal-exec');
  assert.equal(terminal.resolveTerminal(undefined, { PATH: bin }).name, 'xdg-terminal-exec');
  fakeExecutable('wezterm');
  const t = terminal.resolveTerminal(undefined, { PATH: bin, TERMINAL: 'wezterm' });
  assert.equal(t.name, 'wezterm');
  assert.deepEqual(t.argv(['a']), ['start', '--', 'a']);
});

test('$TERMINAL keeps its flags; unknown emulators get -e', () => {
  fakeExecutable('kitty');
  fakeExecutable('myterm');
  const kitty = terminal.resolveTerminal(undefined, { PATH: bin, TERMINAL: 'kitty --single-instance' });
  assert.deepEqual(kitty.argv(['x']), ['--single-instance', '--', 'x']);
  const custom = terminal.resolveTerminal(undefined, { PATH: bin, TERMINAL: join(bin, 'myterm') });
  assert.deepEqual(custom.argv(['x']), ['-e', 'x']);
});

test('a requested terminal that is missing falls back to an installed one', () => {
  fakeExecutable('foot');
  assert.equal(terminal.resolveTerminal('Ghostty', { PATH: bin }).name, 'foot');
});

test('no terminal at all resolves to undefined', () => {
  assert.equal(terminal.resolveTerminal(undefined, { PATH: bin }), undefined);
});

test('argument styles per emulator', () => {
  const cmd = ['/bin/sh', '-c', "echo 'hi'"];
  const argv = (name) => terminal.KNOWN_TERMINALS.find((t) => t.name === name).argv(cmd);
  assert.deepEqual(argv('Ghostty'), ['-e', ...cmd]);
  assert.deepEqual(argv('GNOME Terminal'), ['--', ...cmd]);
  assert.deepEqual(argv('Xfce Terminal'), ['-x', ...cmd]);
  assert.deepEqual(argv('foot'), cmd);
  // Tilix and GNOME Console take one string, so it must be shell-quoted.
  const [flag, line] = argv('Tilix');
  assert.equal(flag, '-e');
  assert.equal(execFileSync('/bin/sh', ['-c', `set -- ${line}; printf '%s|' "$@"`]).toString(), `/bin/sh|-c|echo 'hi'|`);
});

test('runner executes the script, deletes it and waits for Enter', () => {
  const marker = join(dir, 'ran');
  const script = join(dir, 'script.command');
  writeFileSync(script, `#!/bin/sh\necho ok > '${marker}'\nexit 3\n`, { mode: 0o755 });
  const [sh, ...args] = terminal.wrapScript(script);
  const out = execFileSync(sh, args, { input: '\n' }).toString();
  assert.equal(readFileSync(marker, 'utf8'), 'ok\n');
  assert.equal(existsSync(script), false, 'the script (may contain the prompt) is removed');
  assert.match(out, /exited with status 3/);
});

test('openScript runs the script in the terminal, private to the user', async () => {
  // A fake terminal that records the script's mode, then runs its command
  // with no input, as a terminal would. Its 5th argument is the script.
  fakeExecutable('foot', `stat -c %a "$5" > '${join(dir, 'mode')}'\n"$@" < /dev/null`);
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  delete process.env.TERMINAL;
  const marker = join(dir, 'ran');
  const script = join(dir, 'linear-terminal-1.command');
  writeFileSync(script, `#!/bin/sh\necho ok > '${marker}'\n`, { mode: 0o755 });

  assert.deepEqual(await terminal.openScript(script, 'foot'), { success: true });
  assert.ok(await waitFor(() => existsSync(marker)), 'the script should have run');
  assert.equal(readFileSync(join(dir, 'mode'), 'utf8').trim(), '700');
  assert.ok(await waitFor(() => !existsSync(script)), 'the script should be deleted');
});

test('openScript reports a missing terminal', async () => {
  process.env.PATH = bin;
  delete process.env.TERMINAL;
  const result = await terminal.openScript(join(dir, 's.command'), undefined);
  assert.equal(result.success, false);
  assert.match(result.error, /No supported terminal/);
});
