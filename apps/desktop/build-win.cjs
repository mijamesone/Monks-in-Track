// Builds the Windows installer (release/MonksTracker-Setup-<version>.exe) on any OS.
//
// electron-builder normally runs the half-built installer under Wine on Linux to get the
// uninstaller out of it. It already has a Wine-free way (reading the uninstaller straight out
// of the installer file), which it uses on macOS; this script switches that on everywhere.
// On Windows itself nothing changes.
const path = require('node:path');

const builderDir = path.dirname(require.resolve('electron-builder/package.json'));
const libDir = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [builderDir] }));
if (process.platform !== 'win32') {
  require(path.join(libDir, 'out', 'util', 'macosVersion.js')).isMacOsCatalina = () => true;
}

const { Arch, build, Platform } = require('electron-builder');
const publish = process.argv.includes('--publish') ? 'always' : 'never';
build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish })
  .then((files) => console.log(`Built:\n  ${files.join('\n  ')}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
