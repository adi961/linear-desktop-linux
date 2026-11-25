// 7-Zip, compiled to WebAssembly (7z-wasm), so building needs no system 7z.
// It reads Linear's NSIS installer, the 7z payload inside it, the PE icon
// resources of Linear.exe and Electron's zip.

import { chmod, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import SevenZip from '7z-wasm';
import { BuildError } from './util.mjs';

const HOST = '/host'; // where the real filesystem is mounted inside 7-Zip

// 7-Zip's in-memory filesystem ignores the umask, so files from archives
// without Unix permissions (the Windows installer) come out world-writable.
async function applyUmask(dir) {
  const umask = process.umask();
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(entry.parentPath, entry.name);
    const { mode } = await stat(path);
    if (mode & umask) await chmod(path, mode & 0o7777 & ~umask);
  }
}

// Extracts `files` (7-Zip wildcards allowed; everything when empty) from
// `archive` into `outDir`. `flat` drops the archive's directory structure.
export async function extract(archive, outDir, { files = [], flat = false } = {}) {
  // A fresh instance per call: a failed run leaves the instance unusable.
  const output = [];
  const zip = await SevenZip({ print: (line) => output.push(line), printErr: (line) => output.push(line) });
  zip.FS.mkdir(HOST);
  zip.FS.mount(zip.NODEFS, { root: '/' }, HOST);
  const host = (path) => HOST + resolve(path);

  let code;
  try {
    code = zip.callMain([flat ? 'e' : 'x', '-y', '-bso0', '-bsp0', `-o${host(outDir)}`, host(archive), ...files]);
  } catch {
    code = 'exception'; // 7-Zip's fatal errors surface as thrown C++ exceptions
  }
  if (code !== 0) {
    const details = output.filter((line) => line.trim()).slice(-5).join('\n');
    throw new BuildError(`7-Zip could not extract ${archive} (${code}):\n${details}`);
  }
  await applyUmask(outDir);
}
