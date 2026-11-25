import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('packaging/linear-links');
const explain = (url) => execFileSync('sh', [SCRIPT, '--explain', url], { encoding: 'utf8' }).trim();

test('Linear routes open in the app, everything else in the browser', () => {
  const cases = {
    'https://linear.app/acme/issue/ACM-12/fix-the-thing': 'app linear://linear.app/acme/issue/ACM-12/fix-the-thing',
    'https://linear.app/acme/issue/ACM-12': 'app linear://linear.app/acme/issue/ACM-12',
    'https://LINEAR.app/acme/Project/x#comment-1': 'app linear://linear.app/acme/Project/x#comment-1',
    'https://linear.app/acme/inbox/': 'app linear://linear.app/acme/inbox/',
    'http://linear.app/acme/view/abc?x=1': 'app linear://linear.app/acme/view/abc?x=1',
    'https://linear.app/review/org/repo/pull/12/files': 'app linear://linear.app/review/org/repo/pull/12/files',
    'https://linear.review/org/repo/pull/12': 'app linear://linear.app/review/org/repo/pull/12',
    // Pages linear.app keeps in the browser itself.
    'https://linear.app/docs/getting-started': 'browser',
    'https://linear.app/changelog': 'browser',
    'https://linear.app/acme': 'browser',
    'https://linear.app/': 'browser',
    'https://linear.app/oauth/authorize?client_id=1': 'browser',
    // The app sends its own links to the browser with noRedirect=1.
    'https://linear.app/acme/issue/ACM-12?noRedirect=1': 'browser',
    'https://linear.app/acme/issue/ACM-12?a=1&noRedirect=1': 'browser',
    // Look-alikes and other sites.
    'https://linear.app.evil.example/acme/issue/A-1': 'browser',
    'https://evil.example/linear.app/acme/issue/A-1': 'browser',
    'https://linear.review/org/repo/issues/12': 'browser',
    'https://github.com/x/y': 'browser',
    'mailto:someone@example.com': 'browser',
  };
  for (const [url, expected] of Object.entries(cases)) {
    assert.equal(explain(url), expected === 'browser' ? `browser ${url}` : expected, url);
  }
});

// The rest uses the real xdg-mime in an isolated home.
const haveXdgMime = spawnSync('sh', ['-c', 'command -v xdg-mime']).status === 0;

let dir;
let env;
let log;
const run = (args) => spawnSync('sh', [SCRIPT, ...args], { env, encoding: 'utf8' });
const runInstalled = (url) =>
  spawnSync(join(env.XDG_DATA_HOME, 'linear-desktop-links', 'linear-links'), [url], { env, encoding: 'utf8' });
const httpsHandler = () => execFileSync('xdg-mime', ['query', 'default', 'x-scheme-handler/https'], { env, encoding: 'utf8' }).trim();
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linear-links-'));
  log = join(dir, 'calls.log');
  const bin = join(dir, 'bin');
  const apps = join(dir, 'data', 'applications');
  mkdirSync(bin);
  mkdirSync(apps, { recursive: true });
  // A fake browser entry, a fake Linear and a fake gio that record their arguments.
  writeFileSync(join(apps, 'fakebrowser.desktop'), '[Desktop Entry]\nType=Application\nName=Fake\nExec=/bin/true %u\nMimeType=x-scheme-handler/https;\n');
  writeFileSync(join(dir, 'linear'), `#!/bin/sh\necho "linear $*" >> '${log}'\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'gio'), `#!/bin/sh\necho "gio $*" >> '${log}'\n`, { mode: 0o755 });
  env = {
    HOME: dir,
    PATH: `${bin}:${process.env.PATH}`,
    XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_DATA_HOME: join(dir, 'data'),
    XDG_DATA_DIRS: join(dir, 'none'),
  };
  mkdirSync(env.XDG_CONFIG_HOME);
  execFileSync('xdg-mime', ['default', 'fakebrowser.desktop', 'x-scheme-handler/http', 'x-scheme-handler/https'], { env });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('enable, open links, re-enable and disable', { skip: !haveXdgMime }, () => {
  assert.equal(run(['--status']).stdout.trim(), 'off');
  assert.equal(run(['--enable', join(dir, 'linear')]).status, 0);
  assert.equal(run(['--status']).stdout.trim(), 'on');
  assert.equal(httpsHandler(), 'linear-links.desktop');

  // The registered copy of the script does the routing.
  runInstalled('https://linear.app/acme/issue/ACM-1');
  runInstalled('https://github.com/x/y');
  assert.deepEqual(calls(), [
    'linear linear://linear.app/acme/issue/ACM-1',
    `gio launch ${join(dir, 'data', 'applications', 'fakebrowser.desktop')} https://github.com/x/y`,
  ]);

  // Re-enabling (an update) keeps the original browser, not itself.
  assert.equal(run(['--enable', join(dir, 'linear')]).status, 0);
  assert.match(readFileSync(join(env.XDG_CONFIG_HOME, 'linear-desktop-linux', 'links.conf'), 'utf8'), /^browser=fakebrowser\.desktop$/m);

  assert.equal(run(['--disable']).status, 0);
  assert.equal(run(['--status']).stdout.trim(), 'off');
  assert.equal(httpsHandler(), 'fakebrowser.desktop');
  assert.equal(existsSync(join(env.XDG_DATA_HOME, 'applications', 'linear-links.desktop')), false);
  assert.equal(existsSync(join(env.XDG_DATA_HOME, 'linear-desktop-links')), false);
});

test('a Linear link goes to the browser when the app is gone', { skip: !haveXdgMime }, () => {
  run(['--enable', join(dir, 'linear')]);
  rmSync(join(dir, 'linear'));
  runInstalled('https://linear.app/acme/issue/ACM-1');
  assert.deepEqual(calls(), [`gio launch ${join(dir, 'data', 'applications', 'fakebrowser.desktop')} https://linear.app/acme/issue/ACM-1`]);
});

test('switching browsers: status turns off, and re-enabling uses the new browser', { skip: !haveXdgMime }, () => {
  run(['--enable', join(dir, 'linear')]);
  writeFileSync(join(env.XDG_DATA_HOME, 'applications', 'other.desktop'), '[Desktop Entry]\nType=Application\nName=Other\nExec=/bin/true %u\nMimeType=x-scheme-handler/https;\n');
  execFileSync('xdg-mime', ['default', 'other.desktop', 'x-scheme-handler/http', 'x-scheme-handler/https'], { env });
  assert.equal(run(['--status']).stdout.trim(), 'off');

  run(['--enable', join(dir, 'linear')]);
  assert.match(readFileSync(join(env.XDG_CONFIG_HOME, 'linear-desktop-linux', 'links.conf'), 'utf8'), /^browser=other\.desktop$/m);
  run(['--disable']);
  assert.equal(httpsHandler(), 'other.desktop');
});

test('enabling needs a real app', { skip: !haveXdgMime }, () => {
  const r = run(['--enable', join(dir, 'missing')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not an executable/);
});

test('the File menu gets the link handling checkbox', () => {
  const { addLinuxItems, LINKS_LABEL } = createRequire(import.meta.url)('../src/app/menu.js');
  const template = [{ label: 'File', submenu: [{ label: 'New Window' }] }, { label: 'Edit', submenu: [] }];
  addLinuxItems(template);
  const item = template[0].submenu.at(-1);
  assert.equal(template[0].submenu.at(-2).type, 'separator');
  assert.equal(item.label, LINKS_LABEL);
  assert.equal(item.type, 'checkbox');
  assert.equal(typeof item.click, 'function');
  assert.deepEqual(template[1].submenu, []);
});
