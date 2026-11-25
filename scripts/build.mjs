#!/usr/bin/env node
// Builds a Linux version of the official Linear desktop app:
//
//   1. Download Linear's Windows installer (SHA-512 verified) and extract
//      Linear.exe and app.asar. app.asar is the whole app; its UI is loaded
//      from linear.app.
//   2. Read the Electron version from Linear.exe and download that Electron for
//      Linux (SHA-256 verified), in parallel with step 3.
//   3. Patch the main process (lib/patches.mjs), add the Linux modules
//      (src/app → /linux) and repack app.asar.
//   4. Put app.asar into the Electron runtime, set the fuses, and add the
//      desktop entry, icons, install.sh and a tarball.
//
// The result is assembled in a staging directory and swapped into place, so
// a failed build never leaves a half-written output behind.

import { cp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createPackage, extractAll } from '@electron/asar';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { applyPatches } from './lib/patches.mjs';
import { detectElectronVersion, fetchElectron, fetchInstaller } from './lib/sources.mjs';
import { BuildError, log, run } from './lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'linear';
const NSIS_PAYLOADS = { x64: 'app-64.7z', arm64: 'app-arm64.7z' };

const USAGE = `Usage: node scripts/build.mjs [options]

  --arch <x64|arm64>    Target architecture (default: this machine)
  --version <x.y.z>     Linear version (default: latest)
  --sha512 <base64>     Installer SHA-512; required for versions older than the latest
  --out <dir>           Output directory (default: ./dist)
  --cache <dir>         Download cache (default: ./.cache)
  --no-tarball          Skip creating the .tar.gz
  -h, --help            Show this help`;

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      arch: { type: 'string', default: process.arch === 'arm64' ? 'arm64' : 'x64' },
      version: { type: 'string' },
      sha512: { type: 'string' },
      out: { type: 'string', default: join(ROOT, 'dist') },
      cache: { type: 'string', default: join(ROOT, '.cache') },
      'no-tarball': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (!values.help && !NSIS_PAYLOADS[values.arch]) throw new Error(`Unsupported --arch ${values.arch}`);
  return {
    arch: values.arch,
    version: values.version,
    sha512: values.sha512,
    out: resolve(values.out),
    cache: resolve(values.cache),
    tarball: !values['no-tarball'],
    help: values.help,
  };
}

const sevenZip = (...args) => run('7z', ['-y', '-bso0', '-bsp0', ...args]);

// The NSIS installer holds one 7z per architecture with the installed files.
async function extractWindowsApp(installer, arch, dir) {
  const payload = NSIS_PAYLOADS[arch];
  await sevenZip('x', `-o${dir}`, installer, `$PLUGINSDIR/${payload}`);
  await sevenZip('x', `-o${dir}`, join(dir, '$PLUGINSDIR', payload), 'Linear.exe', 'resources/app.asar');
  return { exe: join(dir, 'Linear.exe'), asar: join(dir, 'resources', 'app.asar') };
}

// Linear.exe's icon resources are square PNGs. Returns { [size]: path }.
async function extractIcons(exe, dir) {
  await sevenZip('e', `-o${dir}`, exe, '.rsrc/*/ICON/*', '-r');
  const icons = {};
  for (const name of await readdir(dir)) {
    const png = await readFile(join(dir, name));
    if (png.toString('latin1', 1, 4) === 'PNG') icons[png.readUInt32BE(16)] = join(dir, name);
  }
  if (!icons[256]) throw new BuildError('No 256px icon found in Linear.exe');
  return icons;
}

// Patches Linear's app.asar and adds the Linux modules. Returns the applied
// patch ids.
async function buildAppAsar({ source, icon, version, dir, output }) {
  extractAll(source, dir);
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  if (pkg.name !== '@linear/desktop' || pkg.main !== './out/main/index.js' || pkg.version !== version) {
    throw new BuildError(`Unexpected app.asar (name=${pkg.name}, main=${pkg.main}, version=${pkg.version})`);
  }

  const mainPath = join(dir, 'out', 'main', 'index.js');
  const { source: patched, applied } = applyPatches(await readFile(mainPath, 'utf8'));
  await writeFile(mainPath, patched);
  log(`applied ${applied.length} patches: ${applied.join(', ')}`);

  await cp(join(ROOT, 'src', 'app'), join(dir, 'linux'), { recursive: true, filter: (f) => !f.endsWith('package.json') });
  await cp(icon, join(dir, 'linux', 'icon.png'));
  // desktopName: Electron's Wayland app_id, the xdg-settings protocol handler
  // and the launcher badge (application://linear.desktop) all use it.
  await writeFile(pkgPath, JSON.stringify({ ...pkg, main: './linux/bootstrap.js', desktopName: `${APP_ID}.desktop` }, null, 2));
  await createPackage(dir, output);
  return applied;
}

// Fuses match Linear's own build (no ELECTRON_RUN_AS_NODE, NODE_OPTIONS or
// --inspect), plus OnlyLoadAppFromAsar.
async function assembleRuntime({ electronZip, appAsar, dir }) {
  await sevenZip('x', `-o${dir}`, electronZip);
  await rm(join(dir, 'resources', 'default_app.asar'), { force: true });
  await rename(join(dir, 'electron'), join(dir, APP_ID));
  await rename(appAsar, join(dir, 'resources', 'app.asar'));
  await flipFuses(join(dir, APP_ID), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });
}

async function writeDesktopFiles({ icons, dir }) {
  for (const [size, file] of Object.entries(icons)) {
    await cp(file, join(dir, 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps', `${APP_ID}.png`));
  }
  await cp(join(ROOT, 'packaging', `${APP_ID}.desktop`), join(dir, 'share', 'applications', `${APP_ID}.desktop`));
  await cp(join(ROOT, 'packaging', 'install.sh'), join(dir, 'install.sh'));
}

// Like Promise.all, but waits for every task to settle before failing, so the
// work directory isn't deleted while another task is still writing to it.
async function allOrFirstError(tasks) {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map((r) => r.value);
}

async function build(opts) {
  const installer = await fetchInstaller({ version: opts.version, sha512: opts.sha512, cacheDir: opts.cache });
  const name = `linear-${installer.version}-linux-${opts.arch}`;
  const work = join(opts.out, `.${name}.partial`);
  const stage = join(work, name);
  await rm(work, { recursive: true, force: true });

  try {
    log('extracting the Windows app');
    const win = await extractWindowsApp(installer.file, opts.arch, join(work, 'win'));
    const electronVersion = await detectElectronVersion(win.exe);
    log(`Linear ${installer.version} ships Electron ${electronVersion}`);

    const appAsar = join(work, 'app.asar');
    const prepareApp = async () => {
      const icons = await extractIcons(win.exe, join(work, 'icons'));
      const patches = await buildAppAsar({
        source: win.asar,
        icon: icons[256],
        version: installer.version,
        dir: join(work, 'asar'),
        output: appAsar,
      });
      return { icons, patches };
    };
    const [electronZip, { icons, patches }] = await allOrFirstError([
      fetchElectron({ version: electronVersion, arch: opts.arch, cacheDir: opts.cache }),
      prepareApp(),
    ]);

    log('assembling the Linux app');
    await assembleRuntime({ electronZip, appAsar, dir: join(stage, 'app') });
    await writeDesktopFiles({ icons, dir: stage });
    const info = { linearVersion: installer.version, electronVersion, arch: opts.arch, patches };
    await writeFile(join(stage, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n');

    const dist = join(opts.out, name);
    const tarball = opts.tarball ? `${dist}.tar.gz` : undefined;
    await rm(dist, { recursive: true, force: true });
    await rm(`${dist}.tar.gz`, { force: true }); // never leave a stale tarball beside a new build
    await rename(stage, dist);
    if (tarball) await run('tar', ['-czf', tarball, '-C', opts.out, name]);
    log(`done: ${dist}`);
    return { ...info, dist, tarball };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

let opts;
try {
  opts = parseCli(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n\n${USAGE}`);
  process.exit(2);
}
if (opts.help) {
  console.log(USAGE);
} else {
  build(opts).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(`\n[linear-linux] build failed: ${error instanceof BuildError ? error.message : error.stack}`);
      process.exit(1);
    },
  );
}
