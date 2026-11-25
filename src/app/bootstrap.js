'use strict';

// Entry point of the repackaged app (package.json "main"). Sets up the Linux
// desktop integration that doesn't need to hook into Linear's code, then
// starts Linear's main process. The hooks into Linear's code (terminal
// launcher, unread badge) are build-time patches; see scripts/lib/patches.mjs.

const path = require('node:path');
const { app } = require('electron');
const { startUpdateCheck } = require('./update-check.js');

const ICON_PATH = path.join(__dirname, 'icon.png');

// Client-side window decorations on Wayland compositors that need them
// (GNOME), and the XDG GlobalShortcuts portal for the global command menu.
// Merged into any --enable-features the user passed.
const features = new Set(app.commandLine.getSwitchValue('enable-features').split(',').filter(Boolean));
features.add('WaylandWindowDecorations').add('GlobalShortcutsPortal');
app.commandLine.appendSwitch('enable-features', [...features].join(','));

// Wayland takes the icon from the desktop entry; X11 needs it on the window.
app.on('browser-window-created', (_event, win) => win.setIcon(ICON_PATH));
app.whenReady().then(() => startUpdateCheck(ICON_PATH));

require('../out/main/index.js');
