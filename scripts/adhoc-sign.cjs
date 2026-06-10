// afterPack: ad-hoc sign the assembled bundle. `identity: null` skips signing,
// but packaging invalidates Electron's original seal — and TCC cannot persist
// permission grants for an app without a valid signature (mic prompt loops
// forever). An ad-hoc seal gives TCC a stable identity on a given machine;
// grants still reset across updates until we have a Developer ID cert.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Arch } = require('electron-builder');

exports.default = function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // Per-arch packs get lipo-merged into the universal app; signing them early
  // makes their CodeResources differ and the merge rejects the bundle.
  if (context.arch !== Arch.universal) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
