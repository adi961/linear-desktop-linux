'use strict';

// Environment for programs the app starts on the user's behalf (terminals,
// xdg-mime). Electron's own variables would leak into them and change how
// they behave, and Electron replaces XDG_CURRENT_DESKTOP, which desktop
// tools such as xdg-mime rely on.
function childEnv(env = process.env) {
  const out = { ...env };
  if (out.ORIGINAL_XDG_CURRENT_DESKTOP) out.XDG_CURRENT_DESKTOP = out.ORIGINAL_XDG_CURRENT_DESKTOP;
  for (const key of Object.keys(out)) {
    if (key.startsWith('ELECTRON_') || key === 'ORIGINAL_XDG_CURRENT_DESKTOP' || key === 'CHROME_DESKTOP') delete out[key];
  }
  return out;
}

module.exports = { childEnv };
