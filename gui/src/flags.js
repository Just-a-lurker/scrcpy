// Pure state logic shared by the renderer and the tests: which scrcpy flags
// the "Fill the monitor" cards write, how the launcher addresses the device
// with adb, and what "Close the app when mirroring stops" will run.
//
// `state` is the launcher's option state: { [key]: { on, value } }, where key
// is a scrcpy long option name, or an '@' key for launcher-only settings.
(function (root) {
  const Apps = root.ScrcpyApps || (typeof require !== 'undefined' ? require('./apps.js') : null);

  const EXACT = 'ignore-video-encoder-constraints';

  // "Landscape from the start": display rotation 1 (ROTATION_90) is captured
  // upright with @270 and rotation 3 with @90 (Orientation.fromRotation in
  // the server).
  const ORIENT = {
    landscape: { capture: '@270', rotation: 1 },
    'landscape-flipped': { capture: '@90', rotation: 3 },
  };

  // Only remove a capture lock a card would have set.
  function clearCaptureLock(state) {
    const v = state['capture-orientation']?.value?.trim();
    if (v === '@90' || v === '@270') delete state['capture-orientation'];
  }

  function setWindowFlags(state, res, fullscreen) {
    if (fullscreen) {
      state.fullscreen = { on: true, value: '' };
      delete state['window-width'];
      delete state['window-height'];
    } else {
      delete state.fullscreen;
      state['window-width'] = { on: false, value: String(res.width) };
      state['window-height'] = { on: false, value: String(res.height) };
    }
  }

  function clearWindowFlags(state) {
    delete state.fullscreen;
    delete state['window-width'];
    delete state['window-height'];
  }

  // Write the flags for the active card. Mutates and returns `state`.
  //   card: 'vd' (virtual display) or 'wm' (resize the phone screen)
  //   res: { width, height }; fullscreen: boolean; orient: key of ORIENT or ''
  function applyFit(state, { card, res, fullscreen, orient }) {
    if (card === 'vd') {
      const dpi = /\/\d+$/.exec(state['new-display']?.value ?? '')?.[0] ?? '';
      state['new-display'] = { on: true, value: `${res.width}x${res.height}${dpi}` };
      clearCaptureLock(state); // a virtual display is landscape already
    } else {
      const o = ORIENT[orient];
      if (o) state['capture-orientation'] = { on: false, value: o.capture };
      else clearCaptureLock(state);
    }
    // Encoders often require multiples of 16; scrcpy would then rescale e.g.
    // 1080 rows into 1072, softening every frame. Send the exact size.
    if (res.width % 16 || res.height % 16) state[EXACT] = { on: true, value: '' };
    setWindowFlags(state, res, fullscreen);
    return state;
  }

  // Turn a card off: remove what it wrote. Mutates and returns `state`.
  function disableFit(state, card) {
    if (card === 'vd') delete state['new-display'];
    else clearCaptureLock(state);
    clearWindowFlags(state);
    return state;
  }

  // Flags scrcpy refuses to combine with --new-display (cli.c), plus --crop,
  // which would cut into the new display. Returns the flags it removed.
  function clearVirtualDisplayConflicts(state, isSet) {
    const cleared = [];
    for (const k of ['display-id', 'no-video', 'crop']) {
      if (isSet(k)) { delete state[k]; cleared.push('--' + k); }
    }
    if (isSet('video-source') && state['video-source'].value !== 'display') {
      delete state['video-source'];
      cleared.push('--video-source');
    }
    return cleared;
  }

  // The device scrcpy will use, in adb's terms.
  function adbSelector(state) {
    const serial = state.serial?.value?.trim();
    if (serial) return ['-s', serial];
    if (state['select-usb']?.on) return ['-d'];
    if (state['select-tcpip']?.on) return ['-e'];
    const tcp = state.tcpip?.on ? (state.tcpip.value ?? '').trim().replace(/^\+/, '') : '';
    if (tcp) return ['-s', /:\d+$/.test(tcp) ? tcp : tcp + ':5555'];
    return [];
  }

  // "Close the app when mirroring stops": { selector, pkg } or { error }.
  function closeAppPlan(state, apps) {
    if (!state['@close-app-on-exit']?.on) return null;
    const value = state['start-app']?.value?.trim();
    if (!value) return { selector: adbSelector(state), pkg: null, error: 'set Start app' };
    const r = Apps.resolveStartApp(value, apps);
    return { selector: adbSelector(state), pkg: r.pkg ?? null, error: r.error ?? null };
  }

  // --video-codec-options is a comma list of key[:type]=value, where a
  // backslash escapes the next character (CodecOption.parse in the server).
  // Items are kept exactly as written, so changing one key leaves the others
  // untouched.
  function splitCodecOptions(s) {
    const items = [];
    let buf = '';
    let esc = false;
    for (const c of String(s ?? '')) {
      if (esc) { buf += c; esc = false; continue; }
      if (c === '\\') { buf += c; esc = true; continue; }
      if (c === ',') { items.push(buf); buf = ''; continue; }
      buf += c;
    }
    items.push(buf);
    return items.map((x) => x.trim()).filter(Boolean);
  }

  const codecKeyOf = (item) => /^[^:=]*/.exec(item)[0].trim();

  // The value written for `key` (the last one wins, as in MediaFormat), or null.
  function getCodecOption(s, key) {
    let value = null;
    for (const item of splitCodecOptions(s)) {
      const eq = item.indexOf('=');
      if (eq > 0 && codecKeyOf(item) === key) value = item.slice(eq + 1).trim();
    }
    return value;
  }

  // Set `key` to `value`, or remove it when value is null or ''. Keeps the
  // position of an existing entry; a new one goes last.
  function setCodecOption(s, key, value) {
    const set = value != null && String(value).trim() !== '';
    const out = [];
    let placed = false;
    for (const item of splitCodecOptions(s)) {
      if (codecKeyOf(item) !== key) { out.push(item); continue; }
      if (set && !placed) { out.push(`${key}=${String(value).trim()}`); placed = true; }
    }
    if (set && !placed) out.push(`${key}=${String(value).trim()}`);
    return out.join(',');
  }

  // JSON with sorted keys, so two equal states compare equal regardless of
  // the order their keys were added in.
  function stableJson(v) {
    if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  const api = {
    EXACT, ORIENT, applyFit, disableFit, clearCaptureLock, clearVirtualDisplayConflicts,
    adbSelector, closeAppPlan, stableJson, splitCodecOptions, getCodecOption, setCodecOption,
  };
  root.ScrcpyFlags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
