// Packs the built app into an AppImage with pinned, hash-verified AppImage
// tools: appimagetool (for this machine) and the static type-2 runtime (for
// the target), which needs no libfuse2 on the user's system.

import { chmod, cp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchVerified } from './sources.mjs';
import { BuildError, log, run } from './util.mjs';

const APPIMAGE_ARCH = { x64: 'x86_64', arm64: 'aarch64' };

const APPIMAGETOOL = {
  version: '1.9.1',
  sha256: {
    x86_64: 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0',
    aarch64: 'f0837e7448a0c1e4e650a93bb3e85802546e60654ef287576f46c71c126a9158',
  },
};
const RUNTIME = {
  version: '20251108',
  sha256: {
    x86_64: '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d',
    aarch64: '00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444',
  },
};

function fetchAppImageTool(cacheDir) {
  const arch = APPIMAGE_ARCH[process.arch];
  const name = `appimagetool-${APPIMAGETOOL.version}-${arch}.AppImage`;
  return fetchVerified({
    url: `https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL.version}/appimagetool-${arch}.AppImage`,
    file: join(cacheDir, name),
    digest: { algorithm: 'sha256', encoding: 'hex', value: APPIMAGETOOL.sha256[arch] },
  });
}

function fetchRuntime(arch, cacheDir) {
  return fetchVerified({
    url: `https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME.version}/runtime-${arch}`,
    file: join(cacheDir, `appimage-runtime-${RUNTIME.version}-${arch}`),
    digest: { algorithm: 'sha256', encoding: 'hex', value: RUNTIME.sha256[arch] },
  });
}

// appimagetool needs `file`, which minimal systems lack. Checked before the
// build starts so it fails early.
export async function checkAppImagePrerequisites() {
  if (!APPIMAGE_ARCH[process.arch]) throw new BuildError(`Building AppImages is not supported on ${process.arch}`);
  try {
    await run('file', ['--version']);
  } catch {
    throw new BuildError(
      'Building the AppImage needs the "file" command. Install it, e.g.: sudo apt install file / sudo dnf install file / sudo pacman -S file',
    );
  }
}

// `dist` is a finished build (app/, share/). The AppDir keeps the same app
// layout under usr/, so AppRun can integrate it like install.sh does.
export async function buildAppImage({ dist, arch, root, workDir, cacheDir, output }) {
  const appImageArch = APPIMAGE_ARCH[arch];
  const appDir = join(workDir, 'Linear.AppDir');
  await cp(join(dist, 'app'), join(appDir, 'usr', 'lib', 'linear'), { recursive: true });
  await cp(join(dist, 'share'), join(appDir, 'usr', 'share'), { recursive: true });
  await cp(join(root, 'packaging', 'appimage', 'AppRun'), join(appDir, 'AppRun'));
  await chmod(join(appDir, 'AppRun'), 0o755);
  const desktop = await readFile(join(root, 'packaging', 'linear.desktop'), 'utf8');
  await writeFile(join(appDir, 'linear.desktop'), desktop.replace('@EXEC@', 'linear'));
  await cp(join(dist, 'share', 'icons', 'hicolor', '256x256', 'apps', 'linear.png'), join(appDir, 'linear.png'));
  await symlink('linear.png', join(appDir, '.DirIcon'));

  const [tool, runtime] = await Promise.all([fetchAppImageTool(cacheDir), fetchRuntime(appImageArch, cacheDir)]);
  await chmod(tool, 0o755);
  log('packing the AppImage');
  // APPIMAGE_EXTRACT_AND_RUN: appimagetool is itself an AppImage; this way it
  // runs without FUSE.
  await run(tool, ['-n', '--runtime-file', runtime, appDir, output], {
    env: { ARCH: appImageArch, APPIMAGE_EXTRACT_AND_RUN: '1' },
  });
}
