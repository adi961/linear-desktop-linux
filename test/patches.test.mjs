import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { applyPatches, MAIN_PATCHES, PatchError } from '../scripts/lib/patches.mjs';

// Synthetic stand-in for Linear's minified main process: the same code shapes
// at every patch site, with different identifiers, so the patched result can
// be executed.
const FIXTURE = [
  'const _={app:{dock:{setBadge(){throw Error(`dock used on linux`)}}},Menu:{setApplicationMenu(m){_.menu=m},buildFromTemplate(t){return t}}};',
  'function uR(a,r){return[{label:`File`,submenu:[{label:`New Window`}]}]}',
  'function kH(r){_.Menu.setApplicationMenu(_.Menu.buildFromTemplate(uR(_.app,r)))}',
  'const l={execFile(){throw Error(`macOS open used on linux`)}};',
  'var aB,TH=process.platform===`darwin`,EH=process.platform===`win32`,DH=1280,OH=800;',
  'function qH(e){if(process.platform===`darwin`)_.app.dock?.setBadge(``+(e||``));else if(process.platform===`win32`){}}',
  'class Upd{get autoUpdateDisabled(){return process.platform===`darwin`&&!1}}',
  'var BV=class{constructor(e,t){this.execution=e,this.workingDirectory=t}},',
  'VV=class e extends BV{static getInstalledTerminalApps(){return process.platform===`darwin`?[{id:`mac`}]:[]}',
  'static openScript(t,n){return new Promise(r=>{(0,l.execFile)(`open`,[t],e=>r({success:!0}))})}},',
  'UV=class extends BV{};',
  'var WV=class e{static async run(){if(process.platform!==`darwin`&&process.platform!==`win32`)return{success:!1,error:`Terminal commands are only supported on macOS and Windows`};return{success:!0}}',
  'static create(e,t){if(process.platform===`win32`)return new UV(e,t);if(process.platform===`darwin`)return new VV(e,t);throw Error(`Unsupported platform for terminal launch: ${process.platform}`)}};',
  'module.exports={TH,EH,qH,Upd,VV,UV,WV,kH,electron:_};',
].join('');

const plain = (value) => JSON.parse(JSON.stringify(value));

// Runs `source` as if it were out/main/index.js on `platform`, with mock
// Linux modules behind require("../../linux/...").
function load(source, platform) {
  const calls = [];
  const linuxModules = {
    '../../linux/badge.js': { setBadge: (v) => calls.push(['setBadge', v]) },
    '../../linux/menu.js': { addLinuxItems: (t) => (t[0].submenu.push({ label: 'linux item' }), t) },
    '../../linux/terminal.js': {
      getInstalledTerminalApps: () => [{ id: 'foot', name: 'foot' }],
      openScript: async (script, app) => (calls.push(['openScript', script, app]), { success: true }),
    },
  };
  const module = { exports: {} };
  const require = (id) => linuxModules[id] ?? assert.fail(`unexpected require(${id})`);
  vm.runInContext(source, vm.createContext({ module, require, process: { platform }, Promise, Error }));
  return { ...module.exports, calls };
}

test('every patch matches the fixture exactly once', () => {
  assert.deepEqual(applyPatches(FIXTURE).applied, MAIN_PATCHES.map((p) => p.id));
});

test('patched code takes the Linux branches on linux', async () => {
  const m = load(applyPatches(FIXTURE).source, 'linux');

  assert.equal(m.EH, true, 'window lifecycle should follow Windows');
  assert.equal(m.TH, false);
  m.qH('7');
  assert.deepEqual(m.calls.at(-1), ['setBadge', '7']);
  assert.equal(new m.Upd().autoUpdateDisabled, true);
  assert.deepEqual(plain(m.VV.getInstalledTerminalApps()), [{ id: 'foot', name: 'foot' }]);
  assert.deepEqual(plain(await m.VV.openScript('/tmp/x.command', 'foot')), { success: true });
  assert.deepEqual(m.calls.at(-1), ['openScript', '/tmp/x.command', 'foot']);
  assert.deepEqual(plain(await m.WV.run()), { success: true });
  assert.ok(m.WV.create({}, '/tmp') instanceof m.VV, 'Linux should use the POSIX launcher');
  m.kH({});
  assert.deepEqual(plain(m.electron.menu[0].submenu.map((i) => i.label)), ['New Window', 'linux item']);
});

test('patched code is unchanged on macOS and Windows', () => {
  const { source } = applyPatches(FIXTURE);
  const mac = load(source, 'darwin');
  assert.equal(mac.EH, false);
  assert.deepEqual(plain(mac.VV.getInstalledTerminalApps()), [{ id: 'mac' }]);
  assert.ok(mac.WV.create({}, '/tmp') instanceof mac.VV);
  assert.equal(new mac.Upd().autoUpdateDisabled, false);
  mac.kH({});
  assert.deepEqual(plain(mac.electron.menu[0].submenu.map((i) => i.label)), ['New Window']);

  const win = load(source, 'win32');
  assert.equal(win.EH, true);
  assert.ok(win.WV.create({}, '/tmp') instanceof win.UV);
  assert.deepEqual(plain(win.VV.getInstalledTerminalApps()), []);
  win.qH('3');
  assert.deepEqual(win.calls, [], 'Linux modules are never loaded on Windows');
});

test('unpatched code refuses Linux, so the patches are what enable it', async () => {
  const m = load(FIXTURE, 'linux');
  assert.equal((await m.WV.run()).success, false);
  assert.throws(() => m.WV.create({}, '/tmp'), /Unsupported platform/);
});

test('a placeholder used twice must match the same identifier', () => {
  const patch = { id: 'p', description: 'd', before: 'f({{a}},{{a}})', after: 'g({{a}})' };
  assert.equal(applyPatches('x;f(e,e);', [patch]).source, 'x;g(e);');
  assert.throws(() => applyPatches('x;f(e,t);', [patch]), /matched 0 times/);
});

test('regex characters in patch text are literal', () => {
  const patch = { id: 'p', description: 'd', before: 'a.b?.c(`$`)', after: 'ok' };
  assert.equal(applyPatches('a.b?.c(`$`)', [patch]).source, 'ok');
  assert.throws(() => applyPatches('aXb?.c(`$`)', [patch]), PatchError);
});

test('"after" may only use placeholders from "before"', () => {
  const patch = { id: 'p', description: 'd', before: 'f({{a}})', after: 'f({{b}})' };
  assert.throws(() => applyPatches('f(e)', [patch]), /\{\{b\}\} is not in "before"/);
});

test('a patch site that disappeared fails the build', () => {
  const broken = FIXTURE.replace('get autoUpdateDisabled(){return ', 'get autoUpdateOff(){return ');
  assert.throws(() => applyPatches(broken), (e) => e instanceof PatchError && /updater-disable-linux.*matched 0/.test(e.message));
});

test('an ambiguous patch site fails the build', () => {
  const doubled = FIXTURE + 'class Upd2{get autoUpdateDisabled(){return !1}}';
  assert.throws(() => applyPatches(doubled), (e) => e instanceof PatchError && /matched 2/.test(e.message));
});

// Optional check against Linear's real bundle:
//   LINEAR_MAIN_JS=path/to/out/main/index.js pnpm test
const real = process.env.LINEAR_MAIN_JS;
test('patches apply to the real Linear bundle', { skip: !real || !existsSync(real) }, () => {
  const { source } = applyPatches(readFileSync(real, 'utf8'));
  new vm.Script(source, { filename: 'index.js' }); // must still parse
});
