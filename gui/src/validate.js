// Input checks and output parsers for the main process. Everything that
// reaches adb as an argument passes through here first. Kept free of
// Electron so it can be unit-tested with plain Node.
'use strict';

const SIZE_RE = /^\d{3,5}x\d{3,5}$/;
const HOST_RE = /^(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:.%A-Za-z]+\])$/;
const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const SERIAL_RE = /^[A-Za-z0-9._:\[\]%-]+$/;

// adb's own device selection: [], ['-d'], ['-e'] or ['-s', serial].
function isValidSelector(selector) {
  return (
    Array.isArray(selector) &&
    (selector.length === 0 ||
      (selector.length === 1 && (selector[0] === '-d' || selector[0] === '-e')) ||
      (selector.length === 2 && selector[0] === '-s' && typeof selector[1] === 'string' &&
        SERIAL_RE.test(selector[1]) && !selector[1].startsWith('-')))
  );
}

function checkHost(host) {
  return typeof host === 'string' && HOST_RE.test(host) ? null : 'Enter the IP address shown on the phone, e.g. 192.168.1.23.';
}

function checkPort(port) {
  const n = Number(port);
  return /^\d{1,5}$/.test(String(port)) && n >= 1 && n <= 65535 ? null : 'Enter a port between 1 and 65535.';
}

function checkPairCode(code) {
  return /^\d{6}$/.test(String(code)) ? null : 'The pairing code is the 6 digits shown on the phone.';
}

function isPackage(pkg) {
  return typeof pkg === 'string' && PKG_RE.test(pkg);
}

function isDensity(d) {
  return Number.isInteger(d) && d >= 72 && d <= 1200;
}

// A saved "how the phone was before" record comes back from settings.json,
// which anything on disk could have edited. Its values end up in
// `adb shell ...`, so keep only values of the expected shape.
function sanitizeRestoreRecord(record) {
  const r = record && typeof record === 'object' ? record : {};
  const out = {
    size: typeof r.size === 'string' && SIZE_RE.test(r.size) ? r.size : null,
    density: isDensity(r.density) ? r.density : null,
  };
  if (r.rotation && typeof r.rotation === 'object') {
    out.rotation = {
      accel: /^[01]$/.test(String(r.rotation.accel ?? '')) ? String(r.rotation.accel) : null,
      user: /^[0-3]$/.test(String(r.rotation.user ?? '')) ? String(r.rotation.user) : null,
    };
  }
  return out;
}

// adb arguments that put the phone back. A null setting did not exist
// before, so it is deleted rather than set.
function restoreArgs(record) {
  const r = sanitizeRestoreRecord(record);
  const steps = [
    ['shell', 'wm', 'size', r.size ?? 'reset'],
    ['shell', 'wm', 'density', r.density != null ? String(r.density) : 'reset'],
  ];
  if (r.rotation) {
    for (const [name, value] of [['accelerometer_rotation', r.rotation.accel], ['user_rotation', r.rotation.user]]) {
      steps.push(value == null
        ? ['shell', 'settings', 'delete', 'system', name]
        : ['shell', 'settings', 'put', 'system', name, value]);
    }
  }
  return steps;
}

// The renderer may only change these settings, each with the right type.
// scrcpyPath and pendingRestore are owned by the main process.
const THEMES = ['system', 'light', 'dark'];
function filterSettingsPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if ('lastState' in patch && isPlainObject(patch.lastState)) out.lastState = patch.lastState;
  if ('profiles' in patch && isPlainObject(patch.profiles)) out.profiles = patch.profiles;
  if ('lastProfile' in patch && typeof patch.lastProfile === 'string' && patch.lastProfile.length <= 200) out.lastProfile = patch.lastProfile;
  if ('lastPairHost' in patch && typeof patch.lastPairHost === 'string' && (patch.lastPairHost === '' || HOST_RE.test(patch.lastPairHost))) {
    out.lastPairHost = patch.lastPairHost;
  }
  if ('theme' in patch && THEMES.includes(patch.theme)) out.theme = patch.theme;
  return out;
}

// `adb devices -l`
function parseDevices(stdout) {
  const devices = [];
  for (const line of String(stdout).split(/\r?\n/).slice(1)) {
    const m = /^(\S+)\s+(\S+)\s*(.*)$/.exec(line.trim());
    if (!m || m[1].startsWith('*')) continue;
    const props = Object.fromEntries(
      m[3].split(/\s+/).filter((p) => p.includes(':')).map((p) => {
        const i = p.indexOf(':');
        return [p.slice(0, i), p.slice(i + 1)];
      }),
    );
    devices.push({
      serial: m[1],
      state: m[2],
      model: (props.model || '').replace(/_/g, ' '),
      product: props.product || '',
      transport: /:\d+$/.test(m[1]) || m[1].includes('._adb-tls-connect') ? 'tcpip' : 'usb',
    });
  }
  return devices;
}

// `adb mdns services`
function parseMdns(output) {
  const services = [];
  for (const line of String(output).split(/\r?\n/)) {
    const m = /^(\S+)\s+(_adb-tls-(pairing|connect)\._tcp)\.?\s+(\S+):(\d+)\s*$/.exec(line.trim());
    if (m) services.push({ name: m[1], kind: m[3], host: m[4], port: m[5] });
  }
  return services;
}

// `adb shell wm size` + `adb shell wm density`
function parseWm(sizeOut, densityOut) {
  const ps = /Physical size:\s*(\d+)x(\d+)/.exec(sizeOut);
  const os = /Override size:\s*(\d+)x(\d+)/.exec(sizeOut);
  const pd = /Physical density:\s*(\d+)/.exec(densityOut);
  const od = /Override density:\s*(\d+)/.exec(densityOut);
  return {
    ok: !!(ps && pd),
    size: {
      physical: ps ? { width: +ps[1], height: +ps[2] } : null,
      override: os ? { width: +os[1], height: +os[2] } : null,
    },
    density: { physical: pd ? +pd[1] : null, override: od ? +od[1] : null },
  };
}

// Saved window bounds are only reused if they still overlap a display.
function boundsVisible(bounds, workAreas) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  return workAreas.some((a) =>
    bounds.x < a.x + a.width - 80 && bounds.x + bounds.width > a.x + 80 &&
    bounds.y < a.y + a.height - 40 && bounds.y + 30 > a.y);
}

module.exports = {
  SIZE_RE, isValidSelector, checkHost, checkPort, checkPairCode, isPackage, isDensity,
  sanitizeRestoreRecord, restoreArgs, filterSettingsPatch, THEMES,
  parseDevices, parseMdns, parseWm, boundsVisible,
};
