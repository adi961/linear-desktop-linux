'use strict';

// Replaces Linear's in-app updater, which the build switches off on Linux: it
// can't replace a repackaged install, and Linear publishes no latest-linux.yml.
// This checks the official feed instead and shows a desktop notification once
// per new version, telling the user to rebuild or upgrade the package.

const fs = require('node:fs');
const path = require('node:path');
const { app, net, Notification, shell } = require('electron');
const { FEED_URL, parseLatestYml, compareVersions } = require('./release-feed.js');

const FIRST_CHECK_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const notifiedFile = () => path.join(app.getPath('userData'), 'linux-update-notified');

function alreadyNotified(version) {
  try {
    return fs.readFileSync(notifiedFile(), 'utf8') === version;
  } catch {
    return false;
  }
}

async function check(iconPath) {
  const response = await net.fetch(`${FEED_URL}latest.yml`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const latest = parseLatestYml(await response.text()).version;
  const current = app.getVersion();
  if (compareVersions(latest, current) <= 0 || alreadyNotified(latest) || !Notification.isSupported()) return;

  const notification = new Notification({
    title: `Linear ${latest} is available`,
    body: `You're running ${current}. Rebuild or upgrade the linear-desktop-linux package to update.`,
    icon: iconPath,
  });
  notification.on('click', () => shell.openExternal('https://linear.app/changelog'));
  notification.show();
  fs.writeFileSync(notifiedFile(), latest);
}

function startUpdateCheck(iconPath) {
  if (process.env.LINEAR_LINUX_UPDATE_CHECK === '0') return;
  const run = () => check(iconPath).catch((error) => console.info(`linux-update-check: ${error}`));
  setTimeout(run, FIRST_CHECK_DELAY_MS);
  setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = { startUpdateCheck };
