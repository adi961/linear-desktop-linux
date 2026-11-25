// The two upstream inputs: Linear's Windows installer and the matching
// Electron build for Linux. Both are downloaded into a cache and always
// verified against a published digest.

import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FEED_URL, parseLatestYml } from '../../src/app/release-feed.js';
import { BuildError, download, fetchText, hashFile, log } from './util.mjs';

// Fetches `url` into `file` unless a cached copy already matches `digest`
// ({ algorithm, encoding, value }). A cached copy that doesn't match is
// downloaded again; a fresh download that doesn't match is an error.
export async function fetchVerified({ url, file, digest }) {
  const matches = async () => (await hashFile(file, digest.algorithm, digest.encoding)) === digest.value;
  if (existsSync(file) && (await matches())) {
    log(`using cached ${basename(file)} (${digest.algorithm} verified)`);
    return file;
  }
  await download(url, file);
  if (!(await matches())) throw new BuildError(`${basename(file)} failed ${digest.algorithm} verification`);
  log(`verified ${basename(file)} (${digest.algorithm})`);
  return file;
}

// The latest release's hash comes from latest.yml. Linear doesn't publish
// hashes for older releases, so pinning one needs an explicit --sha512.
export async function fetchInstaller({ version, sha512, cacheDir }) {
  const latest = parseLatestYml(await fetchText(`${FEED_URL}latest.yml`));
  const wanted = version ?? latest.version;
  const expected = wanted === latest.version ? latest.sha512 : sha512;
  if (!expected) {
    throw new BuildError(
      `Linear ${wanted} is not the latest release (${latest.version}), so its hash isn't published. ` +
        'Pass --sha512 <base64> to pin it.',
    );
  }
  if (sha512 && sha512 !== expected) throw new BuildError(`--sha512 doesn't match the published hash for Linear ${wanted}`);

  const fileName = `Linear Setup ${wanted}.exe`;
  const file = await fetchVerified({
    url: FEED_URL + encodeURIComponent(fileName),
    file: join(cacheDir, fileName),
    digest: { algorithm: 'sha512', encoding: 'base64', value: expected },
  });
  return { version: wanted, file };
}

export async function fetchElectron({ version, arch, cacheDir }) {
  const name = `electron-v${version}-linux-${arch}.zip`;
  const base = `https://github.com/electron/electron/releases/download/v${version}/`;
  const sums = await fetchText(`${base}SHASUMS256.txt`);
  const value = sums.match(new RegExp(`^([0-9a-f]{64}) \\*?${name.replace(/\./g, '\\.')}$`, 'm'))?.[1];
  if (!value) throw new BuildError(`${name} is not listed in Electron's SHASUMS256.txt`);
  return fetchVerified({ url: base + name, file: join(cacheDir, name), digest: { algorithm: 'sha256', encoding: 'hex', value } });
}

// Linear.exe embeds Chromium's user-agent template, "Electron/<version>".
// Scanned in chunks; the overlap keeps a match from being split across two.
export async function detectElectronVersion(exePath) {
  const needle = /Electron\/(\d+\.\d+\.\d+)/g;
  const chunk = Buffer.alloc(8 * 1024 * 1024);
  const found = new Set();
  const handle = await open(exePath, 'r');
  try {
    let tail = '';
    for (let position = 0; ; ) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const text = tail + chunk.toString('latin1', 0, bytesRead);
      for (const [, version] of text.matchAll(needle)) found.add(version);
      tail = text.slice(-64);
    }
  } finally {
    await handle.close();
  }
  if (found.size !== 1) {
    throw new BuildError(`Expected one Electron version in ${basename(exePath)}, found: ${[...found].join(', ') || 'none'}`);
  }
  return [...found][0];
}
