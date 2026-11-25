// Source patches for Linear's bundled main process (out/main/index.js).
//
// Each patch is a literal before/after pair of minified code. `{{name}}`
// stands for a minified identifier, which changes between releases; a name
// used twice must be the same identifier both times, and `after` reuses the
// identifiers `before` matched. Every patch must match exactly once, so a
// Linear release that changes patched code fails the build instead of
// shipping a half-patched app. macOS and Windows behaviour is unchanged.
//
// Linux code lives in src/app and is packed at /linux in app.asar, so it's
// `require("../../linux/...")` from out/main/index.js.

export const MAIN_PATCHES = [
  {
    id: 'terminal-allow-linux',
    description: 'Allow the coding-tool terminal launcher on Linux',
    before: 'if(process.platform!==`darwin`&&process.platform!==`win32`)return{success:!1,error:`Terminal commands are only supported',
    after: 'if(process.platform!==`darwin`&&process.platform!==`win32`&&process.platform!==`linux`)return{success:!1,error:`Terminal commands are only supported',
  },
  {
    id: 'terminal-linux-uses-posix-launcher',
    description: 'Use the POSIX (macOS) launcher class on Linux',
    before: 'if(process.platform===`darwin`)return new {{Posix}}({{a}},{{b}});throw Error(`Unsupported platform for terminal launch',
    after: 'if(process.platform===`darwin`||process.platform===`linux`)return new {{Posix}}({{a}},{{b}});throw Error(`Unsupported platform for terminal launch',
  },
  {
    id: 'terminal-linux-installed-apps',
    description: 'List installed Linux terminal emulators',
    before: 'static getInstalledTerminalApps(){return process.platform===`darwin`?',
    after: 'static getInstalledTerminalApps(){if(process.platform===`linux`)return require("../../linux/terminal.js").getInstalledTerminalApps();return process.platform===`darwin`?',
  },
  {
    id: 'terminal-linux-open-script',
    description: 'Open the generated script in a Linux terminal instead of `open -a`',
    before: 'static openScript({{script}},{{app}}){return new Promise({{r}}=>{(0,{{cp}}.execFile)(`open`',
    after: 'static openScript({{script}},{{app}}){if(process.platform===`linux`)return require("../../linux/terminal.js").openScript({{script}},{{app}});return new Promise({{r}}=>{(0,{{cp}}.execFile)(`open`',
  },
  {
    id: 'badge-linux',
    description: 'Show the unread badge in the Linux launcher',
    before: 'function {{fn}}({{badge}}){if(process.platform===`darwin`){{electron}}.app.dock?.setBadge(',
    after: 'function {{fn}}({{badge}}){if(process.platform===`linux`){require("../../linux/badge.js").setBadge({{badge}});return}if(process.platform===`darwin`){{electron}}.app.dock?.setBadge(',
  },
  {
    id: 'menu-linux',
    description: 'Add the Linux items (e.g. "Open Linear Links in This App") to the application menu',
    before: '{{electron}}.Menu.setApplicationMenu({{electron}}.Menu.buildFromTemplate({{template}}({{electron}}.app,{{state}})))',
    after: '{{electron}}.Menu.setApplicationMenu({{electron}}.Menu.buildFromTemplate((process.platform===`linux`?require("../../linux/menu.js").addLinuxItems:(t=>t))({{template}}({{electron}}.app,{{state}}))))',
  },
  {
    id: 'updater-disable-linux',
    description: 'Disable the auto-updater on Linux (linux/update-check.js replaces it)',
    before: 'get autoUpdateDisabled(){return ',
    after: 'get autoUpdateDisabled(){if(process.platform===`linux`)return!0;return ',
  },
  {
    id: 'window-lifecycle-like-windows',
    description: 'Closing the last window quits and restores it next launch, as on Windows',
    before: '{{isMac}}=process.platform===`darwin`,{{isWindows}}=process.platform===`win32`,{{width}}=1280,',
    after: '{{isMac}}=process.platform===`darwin`,{{isWindows}}=process.platform===`win32`||process.platform===`linux`,{{width}}=1280,',
  },
];

const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const IDENTIFIER = '[\\w$]+';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `before` → RegExp: literal text, a named group per placeholder, and a
// backreference when a placeholder repeats.
function compile(before) {
  const seen = new Set();
  let pattern = '';
  let last = 0;
  for (const match of before.matchAll(PLACEHOLDER)) {
    const name = match[1];
    pattern += escapeRegExp(before.slice(last, match.index));
    pattern += seen.has(name) ? `\\k<${name}>` : `(?<${name}>${IDENTIFIER})`;
    seen.add(name);
    last = match.index + match[0].length;
  }
  return new RegExp(pattern + escapeRegExp(before.slice(last)), 'g');
}

export class PatchError extends Error {}

export function applyPatches(source, patches = MAIN_PATCHES) {
  let out = source;
  for (const patch of patches) {
    const matches = [...out.matchAll(compile(patch.before))];
    if (matches.length !== 1) {
      throw new PatchError(
        `Patch "${patch.id}" (${patch.description}) matched ${matches.length} times, expected 1. ` +
          'Linear probably changed this code; update scripts/lib/patches.mjs.',
      );
    }
    const [match] = matches;
    const replacement = patch.after.replace(PLACEHOLDER, (_m, name) => {
      if (!(name in (match.groups ?? {}))) throw new PatchError(`Patch "${patch.id}": {{${name}}} is not in "before"`);
      return match.groups[name];
    });
    out = out.slice(0, match.index) + replacement + out.slice(match.index + match[0].length);
  }
  return { source: out, applied: patches.map((p) => p.id) };
}
