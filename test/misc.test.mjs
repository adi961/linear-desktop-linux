import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { detectElectronVersion } from '../scripts/lib/sources.mjs';

const require = createRequire(import.meta.url);
const { badgeCount } = require('../src/app/badge.js');
const { compareVersions, parseLatestYml } = require('../src/app/release-feed.js');
const { childEnv } = require('../src/app/env.js');

const LATEST_YML = `version: 1.32.8
files:
  - url: Linear Setup 1.32.8.exe
    sha512: 0Uj1P5Th6+WkOjOHitCmvhkKc3X0KOZghwG1v5B8P+otBt5AaYQDxr7dZ3vAxACSKyvX7mh9apLLmmNc3rv4Rw==
    size: 233629176
path: Linear Setup 1.32.8.exe
sha512: 0Uj1P5Th6+WkOjOHitCmvhkKc3X0KOZghwG1v5B8P+otBt5AaYQDxr7dZ3vAxACSKyvX7mh9apLLmmNc3rv4Rw==
releaseDate: '2026-10-30T17:03:22.590Z'
`;

test('badge count from Linear badge strings', () => {
  assert.equal(badgeCount(undefined), 0);
  assert.equal(badgeCount(''), 0);
  assert.equal(badgeCount('0'), 0);
  assert.equal(badgeCount('12'), 12);
  assert.equal(badgeCount('•'), 1);
  assert.equal(badgeCount('-4'), 0);
});

test('latest.yml parsing uses the top-level fields', () => {
  assert.deepEqual(parseLatestYml(LATEST_YML), {
    version: '1.32.8',
    path: 'Linear Setup 1.32.8.exe',
    sha512: '0Uj1P5Th6+WkOjOHitCmvhkKc3X0KOZghwG1v5B8P+otBt5AaYQDxr7dZ3vAxACSKyvX7mh9apLLmmNc3rv4Rw==',
  });
  assert.throws(() => parseLatestYml('version: 1.0.0\n'), /Could not parse/);
});

test('version comparison is numeric', () => {
  assert.equal(compareVersions('1.32.9', '1.32.8'), 1);
  assert.equal(compareVersions('1.32.8', '1.32.8'), 0);
  assert.equal(compareVersions('1.4.0', '1.32.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('Electron version is found across a read-chunk boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'linear-ev-'));
  const file = join(dir, 'Linear.exe');
  const chunk = 8 * 1024 * 1024;
  const fd = openSync(file, 'w');
  writeSync(fd, Buffer.from('Chrome/152.0 Electron/44.9.1 Safari'), 0, undefined, chunk - 19);
  writeSync(fd, Buffer.alloc(1024), 0, 1024, chunk + 100);
  closeSync(fd);
  try {
    assert.equal(await detectElectronVersion(file), '44.9.1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('child environment drops Electron variables and restores the desktop', () => {
  const env = childEnv({
    PATH: '/bin',
    ELECTRON_RUN_AS_NODE: '1',
    CHROME_DESKTOP: 'linear.desktop',
    XDG_CURRENT_DESKTOP: 'Unity',
    ORIGINAL_XDG_CURRENT_DESKTOP: 'sway',
  });
  assert.deepEqual(env, { PATH: '/bin', XDG_CURRENT_DESKTOP: 'sway' });
});
