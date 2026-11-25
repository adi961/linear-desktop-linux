import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const USER_AGENT = 'linear-desktop-linux';

// Expected failures with a message meant for the user (no stack trace).
export class BuildError extends Error {}

export function log(message) {
  process.stderr.write(`[linear-linux] ${message}\n`);
}

export async function hashFile(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  return hash.digest(encoding);
}

export async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new BuildError(`GET ${url} failed: HTTP ${response.status}`);
  return response.text();
}

// Writes through a .part file so an interrupted download never leaves a
// truncated file behind.
export async function download(url, dest) {
  log(`downloading ${url}`);
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok || !response.body) throw new BuildError(`GET ${url} failed: HTTP ${response.status}`);
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
    await rename(part, dest);
  } finally {
    await rm(part, { force: true });
  }
}

// Runs a command, failing with its stderr. Throws a BuildError when the
// command isn't installed.
export async function run(cmd, args, { env } = {}) {
  try {
    await execFileAsync(cmd, args, { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  } catch (error) {
    if (error.code === 'ENOENT') throw new BuildError(`"${cmd}" is required but not installed`);
    throw new BuildError(`${cmd} ${args.join(' ')} failed:\n${error.stderr?.toString().trim() || error.message}`);
  }
}
