'use strict';

// Linear's release feed (electron-builder "generic" provider). Shared by the
// build scripts and by the in-app update check.

const FEED_URL = 'https://releases.linear.app/';

// latest.yml carries version, path (installer file name) and a base64 sha512.
function parseLatestYml(text) {
  const field = (name) => new RegExp(`^${name}:\\s*'?([^'\\n]+?)'?\\s*$`, 'm').exec(text)?.[1];
  const release = { version: field('version'), path: field('path'), sha512: field('sha512') };
  if (!release.version || !release.path || !release.sha512) throw new Error('Could not parse Linear latest.yml');
  return release;
}

// Linear versions are plain x.y.z.
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return Math.sign(pa[i] - pb[i]);
  }
  return 0;
}

module.exports = { FEED_URL, parseLatestYml, compareVersions };
