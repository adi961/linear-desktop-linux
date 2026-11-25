import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const APPRUN = resolve('packaging/appimage/AppRun');
// The commands AppRun needs. PATH is limited to these so no test can open a
// real dialog (zenity, kdialog, notify-send) on the desktop.
const TOOLS = ['sh', 'cat', 'dirname', 'readlink', 'sed', 'mkdir', 'cp', 'find', 'rm', 'tr', 'grep'];

let dir;
let appDir;
let sysctl;
let apparmor;
let env;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linear-apprun-'));
  appDir = join(dir, 'AppDir');
  mkdirSync(join(appDir, 'usr/lib/linear'), { recursive: true });
  mkdirSync(join(appDir, 'usr/share/applications'), { recursive: true });
  mkdirSync(join(appDir, 'usr/share/icons/hicolor/256x256/apps'), { recursive: true });
  cpSync(APPRUN, join(appDir, 'AppRun'));
  // Stand-in for Electron: records its arguments.
  writeFileSync(join(appDir, 'usr/lib/linear/linear'), `#!/bin/sh\necho "launched $*"\n`, { mode: 0o755 });
  cpSync('packaging/linear-links', join(appDir, 'usr/lib/linear/linear-links'));
  cpSync('packaging/linear.desktop', join(appDir, 'usr/share/applications/linear.desktop'));
  writeFileSync(join(appDir, 'usr/share/icons/hicolor/256x256/apps/linear.png'), 'png');

  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const tool of TOOLS) symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`]).toString().trim(), join(bin, tool));
  sysctl = join(dir, 'sysctl');
  apparmor = join(dir, 'apparmor.d');
  mkdirSync(join(sysctl, 'kernel'), { recursive: true });
  mkdirSync(apparmor);
  env = {
    PATH: bin,
    HOME: join(dir, 'home'),
    LINEAR_APPRUN_SYSCTL_DIR: sysctl,
    LINEAR_APPRUN_APPARMOR_DIR: apparmor,
  };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sysctlSet = (name, value) => writeFileSync(join(sysctl, name), `${value}\n`);
const appRun = (args = [], extraEnv = {}) =>
  spawnSync(join(appDir, 'AppRun'), args, { env: { ...env, ...extraEnv }, encoding: 'utf8' });

test('starts Linear with the arguments when the sandbox can work', () => {
  const r = appRun(['linear://issue/ABC-1']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'launched linear://issue/ABC-1');
});

test('AppArmor-restricted user namespaces: explains the one-time fix instead of starting', () => {
  sysctlSet('kernel/apparmor_restrict_unprivileged_userns', 1);
  const r = appRun([], { APPIMAGE: '/home/me/Applications/Linear.AppImage' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '', 'Linear must not start');
  assert.match(r.stderr, /AppArmor blocks/);
  assert.match(r.stderr, /"\/home\/me\/Applications\/Linear.AppImage" --install-apparmor-profile/);
});

test('an installed profile lets it start', () => {
  sysctlSet('kernel/apparmor_restrict_unprivileged_userns', 1);
  writeFileSync(join(apparmor, 'linear-appimage'), '');
  assert.equal(appRun().status, 0);
});

test('user namespaces disabled in the kernel: points to the regular installer', () => {
  sysctlSet('kernel/unprivileged_userns_clone', 0);
  const r = appRun();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /disabled on this\nsystem.*regular installer/s);
});

test('the AppArmor profile covers both FUSE-mounted and self-extracted runs', () => {
  const profile = appRun(['--print-apparmor-profile']).stdout;
  assert.match(profile, /profile linear-appimage \/tmp\/\{\.mount_\*,appimage_extracted_\*\}\/usr\/lib\/linear\/linear flags=\(unconfined\)/);
  assert.match(profile, /^\s+userns,$/m);
});

test('--integrate adds a desktop entry for the AppImage path; --unintegrate removes it', () => {
  const r = appRun(['--integrate'], { APPIMAGE: '/home/me/Applications/Linear.AppImage' });
  assert.equal(r.status, 0, r.stderr);
  const desktop = readFileSync(join(env.HOME, '.local/share/applications/linear.desktop'), 'utf8');
  // Unquoted: xdg-utils (xdg-open on Sway and others) can't handle quotes.
  assert.match(desktop, /^Exec=\/home\/me\/Applications\/Linear.AppImage %U$/m);
  assert.ok(existsSync(join(env.HOME, '.local/share/icons/hicolor/256x256/apps/linear.png')));

  assert.equal(appRun(['--unintegrate']).status, 0);
  assert.equal(existsSync(join(env.HOME, '.local/share/applications/linear.desktop')), false);
  assert.equal(existsSync(join(env.HOME, '.local/share/icons/hicolor/256x256/apps/linear.png')), false);
});

test('--integrate quotes a path with spaces, as the desktop entry spec requires', () => {
  assert.equal(appRun(['--integrate'], { APPIMAGE: '/home/me/My Apps/Linear.AppImage' }).status, 0);
  const desktop = readFileSync(join(env.HOME, '.local/share/applications/linear.desktop'), 'utf8');
  assert.match(desktop, /^Exec="\/home\/me\/My Apps\/Linear.AppImage" %U$/m);
});

test('--integrate refuses paths that would need escaping in the desktop entry', () => {
  for (const path of ['/tmp/a"b.AppImage', '/tmp/$x.AppImage', '/tmp/a`b.AppImage', '/tmp/a\\b.AppImage', '/tmp/a&b.AppImage', '/tmp/a|b.AppImage']) {
    const r = appRun(['--integrate'], { APPIMAGE: path });
    assert.equal(r.status, 1, path);
    assert.match(r.stderr, /Move the AppImage/, path);
  }
  assert.equal(existsSync(join(env.HOME, '.local/share/applications/linear.desktop')), false);
});

test('--integrate outside an AppImage refuses', () => {
  const r = appRun(['--integrate']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be run from the AppImage/);
});
