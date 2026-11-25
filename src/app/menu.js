'use strict';

// Linux additions to Linear's application menu. Linear rebuilds the menu
// from a template whenever its state changes; the menu-linux patch passes
// that template through addLinuxItems (see scripts/lib/patches.mjs).

const links = require('./links.js');

const LINKS_LABEL = 'Open Linear Links in This App';

function linksItem() {
  return {
    label: LINKS_LABEL,
    type: 'checkbox',
    checked: links.isOn(),
    // Electron flips `checked` before calling this.
    click: (item) => {
      links.setOn(item.checked).then(
        (state) => (item.checked = state),
        (error) => {
          item.checked = links.isOn();
          require('electron').dialog.showErrorBox("Couldn't change how links open", error.message);
        },
      );
    },
  };
}

// Adds the items to the File menu (the first menu if Linear renames it).
function addLinuxItems(template) {
  const menu = template.find((m) => m.label === 'File' && Array.isArray(m.submenu)) ?? template.find((m) => Array.isArray(m.submenu));
  menu?.submenu.push({ type: 'separator' }, linksItem());
  return template;
}

module.exports = { addLinuxItems, LINKS_LABEL };
