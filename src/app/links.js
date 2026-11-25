'use strict';

// "Open Linear links in this app": switches the linear-links handler (see
// packaging/linear-links) on and off. That script owns the logic; this module
// only runs it and remembers the state for the menu.
//
// Linear's own "open in desktop app" setting can't be used: it is stored per
// browser (in that browser's local storage) and linear.app only acts on it on
// macOS and Windows.

const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { childEnv } = require('./env.js');

// The script ships next to the app binary, also inside an AppImage.
const SCRIPT = path.join(path.dirname(process.execPath), 'linear-links');
// What the handler should start: the AppImage if running from one (its
// mounted path changes on every start), otherwise this binary.
const APP_COMMAND = process.env.APPIMAGE || process.execPath;

let on = false;

// Reads the current state. Synchronous so the first menu is already right;
// it runs once at startup and takes a few milliseconds.
function refresh() {
  try {
    on = execFileSync(SCRIPT, ['--status'], { env: childEnv(), encoding: 'utf8', timeout: 5000 }).trim() === 'on';
  } catch {
    on = false;
  }
  return on;
}

function isOn() {
  return on;
}

// Resolves to the new state; rejects with the script's message on failure.
function setOn(enable) {
  const args = enable ? ['--enable', APP_COMMAND] : ['--disable'];
  return new Promise((resolve, reject) => {
    execFile(SCRIPT, args, { env: childEnv(), encoding: 'utf8', timeout: 15000 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(refresh());
    });
  });
}

module.exports = { refresh, isOn, setOn };
