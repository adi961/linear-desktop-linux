'use strict';

// Unread badge on Linux. Called from Linear's badge function (see the
// badge-linux patch) with the badge string Linear sends: an unread count, or a
// non-numeric marker such as a dot.

function badgeCount(value) {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 1 : Math.max(0, n);
}

// Electron sends the com.canonical.Unity.LauncherEntry signal for
// application://<desktopName>; KDE Plasma, Dash-to-Dock and Ubuntu Dock show it.
function setBadge(value) {
  require('electron').app.setBadgeCount(badgeCount(value));
}

module.exports = { badgeCount, setBadge };
