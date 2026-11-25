import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SevenZip from '7z-wasm';
import { extract } from '../scripts/lib/seven-zip.mjs';

// Builds a fixture archive with 7-Zip itself: an executable, a nested file and
// a world-writable file (as archives without Unix permissions extract).
async function makeZip(dir) {
  const src = join(dir, 'src');
  mkdirSync(join(src, 'nested'), { recursive: true });
  writeFileSync(join(src, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(src, 'nested', 'data.txt'), 'hello');
  writeFileSync(join(src, 'loose.txt'), 'x', { mode: 0o666 });
  const zip = await SevenZip({ print() {}, printErr() {} });
  zip.FS.mkdir('/host');
  zip.FS.mount(zip.NODEFS, { root: '/' }, '/host');
  zip.FS.chdir(`/host${src}`);
  assert.equal(zip.callMain(['a', '-tzip', `/host${dir}/fixture.zip`, 'tool', 'nested', 'loose.txt']), 0);
  return join(dir, 'fixture.zip');
}

test('extracts with structure, keeps executables and applies the umask', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'linear-7z-'));
  try {
    const archive = await makeZip(dir);
    const out = join(dir, 'out');
    await extract(archive, out);
    assert.equal(readFileSync(join(out, 'nested', 'data.txt'), 'utf8'), 'hello');
    assert.equal(statSync(join(out, 'tool')).mode & 0o111, 0o111, 'executable bit kept');
    const umask = process.umask();
    for (const f of ['tool', 'loose.txt', 'nested/data.txt']) {
      assert.equal(statSync(join(out, f)).mode & umask, 0, `${f} respects the umask`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flat extraction of selected files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'linear-7z-'));
  try {
    const archive = await makeZip(dir);
    const out = join(dir, 'flat');
    await extract(archive, out, { files: ['nested/*'], flat: true });
    assert.deepEqual(readdirSync(out), ['data.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing archive fails with 7-Zip\'s message, and later calls still work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'linear-7z-'));
  try {
    await assert.rejects(extract(join(dir, 'nope.7z'), join(dir, 'x')), /could not extract.*\n.*No such file/s);
    const archive = await makeZip(dir);
    await extract(archive, join(dir, 'after'));
    assert.ok(statSync(join(dir, 'after', 'tool')).isFile());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
