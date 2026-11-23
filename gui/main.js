// Electron main process: owns the window, the settings file, adb and the
// scrcpy child processes. The renderer only reaches these through the narrow
// API in preload.js, and every value it sends is checked in src/validate.js.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const { spawn, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const V = require('./src/validate.js');

// ---------- Settings (atomic writes, one backup) ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function parseFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readSettings() {
  // A damaged file falls back to the last good copy instead of to nothing,
  // so profiles and the phone-restore record survive.
  return parseFile(settingsFile()) ?? parseFile(settingsFile() + '.bak') ?? {};
}

function writeSettings(patch) {
  const file = settingsFile();
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  if (fs.existsSync(file) && parseFile(file)) fs.copyFileSync(file, file + '.bak');
  fs.renameSync(tmp, file); // replaces the old file in one step
  return next;
}

// ---------- Locating scrcpy and adb ----------

const exeName = process.platform === 'win32' ? 'scrcpy.exe' : 'scrcpy';
const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';

function isFile(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch { return false; }
}

function whereOnPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && isFile(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

// Saved path first, then a scrcpy.exe beside the launcher (or beside the
// portable .exe, which runs from a temp folder) or in the repo build
// folders, then PATH.
function locateScrcpy() {
  const saved = readSettings().scrcpyPath;
  if (isFile(saved)) return saved;
  const dirs = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    path.dirname(app.getPath('exe')),
    path.join(__dirname, '..'),
    path.join(__dirname, '..', 'build', 'app'),
    path.join(__dirname, '..', 'build-win64', 'app'),
  ].filter(Boolean);
  for (const d of dirs) if (isFile(path.join(d, exeName))) return path.join(d, exeName);
  return whereOnPath(exeName);
}

// The Windows release ships adb.exe next to scrcpy.exe, and scrcpy uses that
// one; using the same copy avoids adb server version fights.
function locateAdb(scrcpyPath) {
  if (process.env.ADB && isFile(process.env.ADB)) return process.env.ADB;
  if (scrcpyPath && isFile(path.join(path.dirname(scrcpyPath), adbName))) return path.join(path.dirname(scrcpyPath), adbName);
  return whereOnPath(adbName);
}

// The executable path lives here and is never taken from the renderer, so
// the renderer can only launch the scrcpy the user located.
let scrcpyExe = null;

// ---------- Window ----------

let win;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const s = readSettings();
  nativeTheme.themeSource = V.THEMES.includes(s.theme) ? s.theme : 'system';
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const bounds = V.boundsVisible(s.bounds, areas) ? s.bounds : { width: s.bounds?.width, height: s.bounds?.height };

  win = new BrowserWindow({
    width: bounds.width ?? 1280,
    height: bounds.height ?? 840,
    x: bounds.x,
    y: bounds.y,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'scrcpy Launcher',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0b' : '#ffffff',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  if (s.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open web links in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', () => {
    writeSettings({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
  });

  if (!app.isPackaged) installSnapshotHook();
}

// Development aid (never in a packaged build):
//   SCRCPY_LAUNCHER_SNAPSHOT=out.png captures the window once it has
//   rendered, prints renderer errors, and quits.
//   SCRCPY_LAUNCHER_SNAPSHOT_CLICK=<selector>[;;<selector>...] clicks each in
//   turn first. Use with --user-data-dir=<temp folder> so the clicks do not
//   touch the real settings.
function installSnapshotHook() {
  const snapshot = process.env.SCRCPY_LAUNCHER_SNAPSHOT;
  if (!snapshot) return;
  win.webContents.on('console-message', (...args) => {
    // Electron 35+ passes one event object; older versions passed (event, level, message).
    const e = args[0];
    const level = typeof e?.level === 'string' ? e.level : args[1];
    const message = e?.message ?? args[2];
    if (level === 'error' || level === 'warning' || level >= 2) console.error('[renderer]', message);
  });
  win.webContents.once('did-finish-load', () => {
    win.show();
    win.focus();
    const attempt = async (n) => {
      const image = await win.webContents.capturePage();
      if (image.isEmpty() && n > 0) return setTimeout(() => attempt(n - 1), 1000);
      fs.writeFileSync(snapshot, image.toPNG());
      app.exit(0);
    };
    const clicks = (process.env.SCRCPY_LAUNCHER_SNAPSHOT_CLICK || '').split(';;').map((s) => s.trim()).filter(Boolean);
    clicks.forEach((sel, i) => {
      setTimeout(() => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)})?.click()`), 1500 + i * 400);
    });
    setTimeout(() => attempt(10), Number(process.env.SCRCPY_LAUNCHER_SNAPSHOT_DELAY) || 2500);
  });
}

// ---------- Settings IPC ----------

ipcMain.handle('settings:get', () => {
  const s = readSettings();
  return { lastState: s.lastState, profiles: s.profiles, lastProfile: s.lastProfile, lastPairHost: s.lastPairHost, theme: s.theme };
});

function applySettingsPatch(patch) {
  const clean = V.filterSettingsPatch(patch);
  if ('theme' in clean) nativeTheme.themeSource = clean.theme;
  if (Object.keys(clean).length) writeSettings(clean);
  return true;
}
ipcMain.handle('settings:set', (_e, patch) => applySettingsPatch(patch));
// Synchronous variant, used once when the window closes so the last change
// is not lost.
ipcMain.on('settings:setSync', (e, patch) => {
  try { applySettingsPatch(patch); } catch {}
  e.returnValue = true;
});

// ---------- scrcpy executable ----------

ipcMain.handle('scrcpy:locate', () => {
  scrcpyExe = locateScrcpy();
  startDeviceTracker();
  return { exe: scrcpyExe, adb: locateAdb(scrcpyExe) };
});

ipcMain.handle('scrcpy:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Locate scrcpy',
    properties: ['openFile'],
    filters: process.platform === 'win32' ? [{ name: 'scrcpy', extensions: ['exe'] }] : [],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  scrcpyExe = r.filePaths[0];
  writeSettings({ scrcpyPath: scrcpyExe });
  startDeviceTracker();
  return { exe: scrcpyExe, adb: locateAdb(scrcpyExe) };
});

ipcMain.handle('dialog:save', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, {
    title: typeof opts?.title === 'string' ? opts.title : 'Save',
    defaultPath: typeof opts?.defaultPath === 'string' ? opts.defaultPath : undefined,
    filters: [
      { name: 'Video', extensions: ['mp4', 'mkv'] },
      { name: 'Audio', extensions: ['m4a', 'mka', 'opus', 'aac', 'flac', 'wav'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePath;
});

// ---------- adb ----------

function runAdb(args, timeout = 20000) {
  const adb = locateAdb(scrcpyExe);
  if (!adb) return Promise.resolve({ ok: false, output: 'adb was not found next to scrcpy or on PATH.' });
  return new Promise((resolve) => {
    execFile(adb, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('').trim();
      resolve({
        ok: !err,
        output: err && err.killed ? `adb ${args[0]} timed out after ${timeout / 1000} s.` : output || err?.message || '',
      });
    });
  });
}

// `adb track-devices` prints a block whenever a device appears, disappears
// or changes state. Each block only triggers a refresh in the renderer,
// which then asks for the full `adb devices -l` list.
let tracker = null;
let trackerRetry = null;
function startDeviceTracker() {
  stopDeviceTracker();
  const adb = locateAdb(scrcpyExe);
  if (!adb) return;
  const child = spawn(adb, ['track-devices'], { windowsHide: true });
  tracker = child;
  let debounce = null;
  child.stdout.on('data', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => send('adb:devices-changed'), 400);
  });
  child.on('error', () => {});
  child.on('close', () => {
    if (tracker !== child) return; // stopped on purpose
    tracker = null;
    trackerRetry = setTimeout(startDeviceTracker, 3000); // adb server restarted
  });
}
function stopDeviceTracker() {
  clearTimeout(trackerRetry);
  if (tracker) {
    const t = tracker;
    tracker = null;
    t.kill();
  }
}

ipcMain.handle('adb:devices', async () => {
  const adb = locateAdb(scrcpyExe);
  if (!adb) return { error: 'adb was not found next to scrcpy or on PATH.', devices: [] };
  const r = await runAdb(['devices', '-l'], 15000);
  if (!r.ok) return { error: r.output, devices: [] };
  return { devices: V.parseDevices(r.output) };
});

ipcMain.handle('adb:pair', async (_e, { host, port, code } = {}) => {
  const error = V.checkHost(host) || V.checkPort(port) || V.checkPairCode(code);
  if (error) return { ok: false, output: error };
  const target = `${host}:${port}`;
  const r = await runAdb(['pair', target, String(code)], 30000);
  // adb may exit with 0 on failure, so trust the message.
  return { ok: /Successfully paired/i.test(r.output), output: r.output, target };
});

ipcMain.handle('adb:connect', async (_e, { host, port } = {}) => {
  const error = V.checkHost(host) || V.checkPort(port);
  if (error) return { ok: false, output: error };
  const target = `${host}:${port}`;
  const r = await runAdb(['connect', target]);
  return { ok: /^(already )?connected to/im.test(r.output), output: r.output, target };
});

ipcMain.handle('adb:mdns', async () => {
  const r = await runAdb(['mdns', 'services'], 10000);
  return { ok: r.ok, services: V.parseMdns(r.output), output: r.output };
});

// "Close the app when mirroring stops"
ipcMain.handle('adb:forceStop', async (_e, { selector, pkg } = {}) => {
  if (!V.isValidSelector(selector)) return { ok: false, output: 'Invalid device selection.' };
  if (!V.isPackage(pkg)) return { ok: false, output: `"${pkg}" is not a package name.` };
  return runAdb([...selector, 'shell', 'am', 'force-stop', pkg]);
});

// ---------- Resize the phone screen ----------
//
// Before the first change to a phone, its current size, density and
// rotation settings are saved in settings.json (pendingRestore), so they can
// be put back exactly, even after a crash. A blind `wm density reset` would
// wipe a display-size setting the user chose on the phone.

async function wmRead(selector) {
  const s = await runAdb([...selector, 'shell', 'wm', 'size']);
  const d = await runAdb([...selector, 'shell', 'wm', 'density']);
  return { ...V.parseWm(s.output, d.output), output: [s.output, d.output].join('\n').trim() };
}

async function readSystemSetting(selector, name) {
  const r = await runAdb([...selector, 'shell', 'settings', 'get', 'system', name]);
  const v = r.output.trim();
  return /^-?\d+$/.test(v) ? v : null; // "null" when the setting does not exist
}

const pendingRestore = () => readSettings().pendingRestore ?? {};

ipcMain.handle('adb:wmRead', async (_e, { selector } = {}) => {
  if (!V.isValidSelector(selector)) return { ok: false, output: 'Invalid device selection.' };
  const r = await wmRead(selector);
  r.pending = !!pendingRestore()[JSON.stringify(selector)];
  return r;
});

// rotation: null to leave it alone, or 1 / 3 to lock the phone in landscape
// (Surface.ROTATION_90 / ROTATION_270) with auto-rotate off.
ipcMain.handle('adb:fitApply', async (_e, { selector, size, density, rotation } = {}) => {
  if (!V.isValidSelector(selector)) return { ok: false, output: 'Invalid device selection.' };
  if (!V.SIZE_RE.test(String(size))) return { ok: false, output: `"${size}" is not a WxH size.` };
  if (density != null && !V.isDensity(density)) return { ok: false, output: `"${density}" is not a usable density.` };
  if (rotation != null && rotation !== 1 && rotation !== 3) return { ok: false, output: 'Invalid rotation.' };

  const key = JSON.stringify(selector);
  const pending = pendingRestore();
  if (!pending[key]) {
    const cur = await wmRead(selector);
    if (!cur.ok) return { ok: false, output: cur.output || 'Could not read the phone screen size.' };
    const o = cur.size.override;
    pending[key] = V.sanitizeRestoreRecord({
      size: o ? `${o.width}x${o.height}` : null,
      density: cur.density.override,
      rotation: {
        accel: await readSystemSetting(selector, 'accelerometer_rotation'),
        user: await readSystemSetting(selector, 'user_rotation'),
      },
    });
    writeSettings({ pendingRestore: pending });
  }

  const outputs = [];
  const step = async (args) => {
    const r = await runAdb([...selector, 'shell', ...args]);
    if (r.output) outputs.push(r.output);
    return r.ok && !/error|exception/i.test(r.output);
  };
  let ok = true;
  if (rotation != null) {
    ok = (await step(['settings', 'put', 'system', 'accelerometer_rotation', '0']))
      && (await step(['settings', 'put', 'system', 'user_rotation', String(rotation)]));
  }
  ok = ok && (await step(['wm', 'size', size]));
  if (ok && density != null) ok = await step(['wm', 'density', String(density)]);
  return { ok, output: outputs.join('\n') };
});

// Put back what was saved. Without a saved record (nothing was changed by
// the launcher), only the size override is reset.
ipcMain.handle('adb:fitRestore', async (_e, { selector } = {}) => {
  if (!V.isValidSelector(selector)) return { ok: false, output: 'Invalid device selection.' };
  const key = JSON.stringify(selector);
  const pending = pendingRestore();
  const record = pending[key];
  const steps = record ? V.restoreArgs(record) : [['shell', 'wm', 'size', 'reset']];
  const outputs = [];
  let ok = true;
  for (const args of steps) {
    const r = await runAdb([...selector, ...args]);
    outputs.push(`adb ${args.join(' ')}${r.output ? ': ' + r.output : ''}`);
    ok = ok && r.ok && !/error|exception/i.test(r.output);
  }
  if (ok && record) {
    delete pending[key];
    writeSettings({ pendingRestore: pending });
  }
  return { ok, output: outputs.join('\n'), restored: record ?? null };
});

// Size of the monitor the launcher window is on, in real pixels.
ipcMain.handle('screen:current', () => {
  const d = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  return {
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    scaleFactor: d.scaleFactor,
  };
});

// Every monitor, in real pixels, with its top-left corner in the virtual
// desktop (what scrcpy --window-x/--window-y use).
ipcMain.handle('screen:list', () => {
  const primary = screen.getPrimaryDisplay().id;
  const current = (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).id;
  return screen.getAllDisplays().map((d) => {
    const o = process.platform === 'win32'
      ? screen.dipToScreenPoint({ x: d.bounds.x, y: d.bounds.y })
      : { x: d.bounds.x * d.scaleFactor, y: d.bounds.y * d.scaleFactor };
    return {
      id: String(d.id),
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      x: Math.round(o.x),
      y: Math.round(o.y),
      scaleFactor: d.scaleFactor,
      primary: d.id === primary,
      current: d.id === current,
    };
  });
});

// ---------- scrcpy processes ----------

const children = new Map(); // id -> ChildProcess
let nextId = 1;

ipcMain.handle('scrcpy:run', (_e, args) => {
  const exe = scrcpyExe;
  if (!isFile(exe)) return { error: `scrcpy was not found at ${exe}` };
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return { error: 'Invalid arguments' };
  const id = nextId++;
  let child;
  try {
    child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
  } catch (err) {
    return { error: err.message };
  }
  // No input is ever sent. Closing stdin also keeps --pause-on-exit from
  // waiting forever for an Enter key that cannot come.
  child.stdin.end();
  children.set(id, child);
  const forward = (stream) => (chunk) => send('scrcpy:output', { id, stream, text: chunk.toString() });
  child.stdout.on('data', forward('stdout'));
  child.stderr.on('data', forward('stderr'));
  child.on('error', (err) => send('scrcpy:output', { id, stream: 'stderr', text: err.message + '\n' }));
  child.on('close', (code, signal) => {
    children.delete(id);
    send('scrcpy:exit', { id, code, signal });
  });
  return { id, pid: child.pid };
});

// Ask scrcpy to close like a user closing its window, so it exits through
// its normal path; force it after a grace period. On Windows, Node's kill()
// is TerminateProcess, which skips every exit step.
function stopChild(child, graceMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }, graceMs);
  child.once('close', () => clearTimeout(force));
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/PID', String(child.pid)], { windowsHide: true }, () => {});
  } else {
    child.kill('SIGTERM');
  }
}

ipcMain.handle('scrcpy:stop', (_e, id) => {
  const child = children.get(id);
  if (!child) return false;
  stopChild(child);
  return true;
});

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// ---------- Lifecycle ----------

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopDeviceTracker();
  for (const child of children.values()) {
    if (process.platform === 'win32' && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid)], { windowsHide: true, timeout: 3000, stdio: 'ignore' }); } catch {}
    }
    child.kill();
  }
  // Never leave a phone resized: put back what was saved before the change.
  const pending = pendingRestore();
  const keys = Object.keys(pending);
  const adb = keys.length ? locateAdb(scrcpyExe ?? locateScrcpy()) : null;
  if (adb) {
    for (const key of keys) {
      let ok = true;
      for (const args of V.restoreArgs(pending[key])) {
        try {
          execFileSync(adb, [...JSON.parse(key), ...args], { windowsHide: true, timeout: 8000, stdio: 'ignore' });
        } catch {
          ok = false; // phone unreachable: keep the record for next launch
        }
      }
      if (ok) delete pending[key];
    }
    writeSettings({ pendingRestore: pending });
  }
  app.quit();
});
