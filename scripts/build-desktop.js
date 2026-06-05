#!/usr/bin/env node
/**
 * Builds the Electron desktop app for Windows.
 *
 * electron-builder packages the app into dist/win-unpacked but may fail
 * at the "asar integrity" step if Windows Developer Mode is disabled
 * (it needs symlink permissions to extract winCodeSign tools).
 *
 * This script runs the packager, ignores that specific error, then manually
 * applies the custom icon via rcedit (already in the electron-builder cache),
 * and finally creates the distributable ZIP from dist/win-unpacked.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const UNPACKED = path.join(DIST, 'win-unpacked');
const ZIP_OUT = path.join(DIST, 'CJ-Marine-POS-win64.zip');
const PNG_ICON = path.join(ROOT, 'public', 'logo3-removebg-preview.png');
const ICO_OUT = path.join(DIST, 'icon.ico');

function log(msg) { console.log(`\n[build-desktop] ${msg}`); }
function warn(msg) { console.warn(`[build-desktop] WARNING: ${msg}`); }
function die(msg) { console.error(`[build-desktop] ERROR: ${msg}`); process.exit(1); }

// ── 1. Ensure React build exists ────────────────────────────────────────────
log('Building React app...');
execSync('npm run build:web', { cwd: ROOT, stdio: 'inherit' });

// ── 2. Run electron-builder to package ──────────────────────────────────────
log('Packaging with electron-builder...');
spawnSync(
  'npx',
  ['electron-builder', '--win', '--x64', '--dir'],
  { cwd: ROOT, stdio: 'inherit', shell: true }
);

if (!fs.existsSync(UNPACKED)) {
  die('dist/win-unpacked was not created. Check the electron-builder output above.');
}
log('win-unpacked created successfully.');

// ── 3. Apply custom icon via rcedit ─────────────────────────────────────────
// electron-builder's winCodeSign step fails on Windows without Developer Mode
// (symlink extraction error), so rcedit never runs and the .exe keeps the
// default Electron icon. We call rcedit-x64.exe directly from the cache.
(async () => {
  const exePath = path.join(UNPACKED, 'CJ Marine POS.exe');

  // Find any rcedit-x64.exe in the electron-builder winCodeSign cache
  const winCodeSignCache = path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    'electron-builder', 'Cache', 'winCodeSign'
  );
  let rceditExe = null;
  if (fs.existsSync(winCodeSignCache)) {
    for (const entry of fs.readdirSync(winCodeSignCache)) {
      const candidate = path.join(winCodeSignCache, entry, 'rcedit-x64.exe');
      if (fs.existsSync(candidate)) { rceditExe = candidate; break; }
    }
  }

  if (!rceditExe) {
    warn('rcedit-x64.exe not found in cache — icon will remain default Electron icon.');
    warn('Run the build once so electron-builder downloads winCodeSign, then retry.');
  } else {
    // Convert PNG → ICO (required by rcedit)
    log('Converting PNG icon to ICO...');
    const { default: pngToIco } = require('png-to-ico');
    const icoData = await pngToIco(PNG_ICON);
    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(ICO_OUT, icoData);

    log('Applying custom icon to .exe...');
    const rcResult = spawnSync(
      rceditExe,
      [exePath, '--set-icon', ICO_OUT],
      { stdio: 'inherit', shell: false }
    );
    if (rcResult.status !== 0) {
      warn('rcedit exited with an error — icon may not have been applied.');
    } else {
      log('Custom icon applied successfully.');
    }
  }

  // ── 4. Create ZIP from win-unpacked ───────────────────────────────────────
  log(`Creating ZIP: ${path.basename(ZIP_OUT)}`);
  const zipResult = spawnSync(
    'powershell',
    [
      '-NoProfile', '-Command',
      `if (Test-Path '${ZIP_OUT}') { Remove-Item '${ZIP_OUT}' }; ` +
      `Compress-Archive -Path '${UNPACKED}\\*' -DestinationPath '${ZIP_OUT}' -CompressionLevel Optimal`,
    ],
    { stdio: 'inherit', shell: false }
  );

  if (zipResult.status !== 0 || !fs.existsSync(ZIP_OUT)) {
    die('Failed to create ZIP.');
  }

  const sizeMB = (fs.statSync(ZIP_OUT).size / (1024 * 1024)).toFixed(1);
  log(`Done! ${path.basename(ZIP_OUT)} (${sizeMB} MB)`);
  log('Distribution:');
  log('  - Portable: dist/win-unpacked/CJ Marine POS.exe  (run directly)');
  log('  - ZIP:      dist/CJ-Marine-POS-win64.zip          (extract and run)');
  log('');
  log('To get a proper installer (.exe setup):');
  log('  Enable Developer Mode in Windows Settings → Privacy & Security → For Developers');
  log('  Then run:  npm run electron:build:installer');
})().catch(e => { die(e.message); });
