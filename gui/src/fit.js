// Screen-fit math for "Fill the monitor". Shared by the renderer and tests.
(function (root) {
  const RATIOS = [
    ['16:9', 16 / 9], ['16:10', 16 / 10], ['4:3', 4 / 3], ['3:2', 3 / 2], ['18:9', 2],
    ['19:9', 19 / 9], ['19.5:9', 19.5 / 9], ['20:9', 20 / 9], ['21:9', 21 / 9], ['21:9', 64 / 27], ['21:9', 43 / 18], ['32:9', 32 / 9],
  ];

  // Common landscape resolutions offered in the pickers.
  const PRESETS = ['3840x2160', '2560x1440', '1920x1080', '1600x900', '1366x768', '1280x720', '960x540'];

  function ratio(size) {
    return Math.max(size.width, size.height) / Math.min(size.width, size.height);
  }

  function ratioLabel(size) {
    const r = ratio(size);
    const hit = RATIOS.find(([, v]) => Math.abs(v - r) / v < 0.012);
    return hit ? hit[0] : `${r.toFixed(2)}:1`;
  }

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  function parseRes(s) {
    const m = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/i.exec(String(s ?? ''));
    return m ? { width: +m[1], height: +m[2] } : null;
  }

  const fmt = (r) => `${r.width}x${r.height}`;

  // Landscape monitor size, for --new-display.
  function virtualDisplaySize(monitor) {
    const w = Math.max(monitor.width, monitor.height);
    const h = Math.min(monitor.width, monitor.height);
    return `${even(w)}x${even(h)}`;
  }

  // Resolution choices: the monitor's own size first, then the presets that
  // fit on it. `phone` (physical size) marks choices the phone cannot show
  // with wm size, because they exceed its screen.
  function resolutionChoices(monitor, phone) {
    const native = virtualDisplaySize(monitor);
    const mw = Math.max(monitor.width, monitor.height);
    const mh = Math.min(monitor.width, monitor.height);
    const list = [native, ...PRESETS.filter((p) => p !== native)]
      .map(parseRes)
      .filter((r) => r.width <= mw && r.height <= mh);
    return list.map((r) => {
      const value = fmt(r);
      const tooBig = phone ? !fitsPhone(r, phone) : false;
      return {
        value,
        label: `${r.width} × ${r.height}${value === native ? '  (this monitor)' : ''}${tooBig ? '  (larger than the phone)' : ''}`,
        disabled: tooBig,
      };
    });
  }

  function fitsPhone(res, phone) {
    const long = Math.max(phone.width, phone.height);
    const short = Math.min(phone.width, phone.height);
    return Math.max(res.width, res.height) <= long && Math.min(res.width, res.height) <= short;
  }

  // What to set on the phone so its screen becomes `res` in landscape.
  //   physical: phone physical size; density: its current density (override
  //   or physical) at the physical size.
  // Returns { size: 'WxH' in the phone's natural orientation, density | null }
  // or { error }. Density scales with the short side so the Android UI keeps
  // the same size on screen (a smaller resolution would otherwise make
  // everything huge, and below ~320 dp wide apps can break).
  function wmPlan(physical, density, res) {
    const r = typeof res === 'string' ? parseRes(res) : res;
    if (!r) return { error: 'Choose a resolution like 1920x1080.' };
    if (!fitsPhone(r, physical)) {
      return { error: `${fmt(r)} is larger than the phone's ${physical.width}x${physical.height} screen.` };
    }
    const long = even(Math.max(r.width, r.height));
    const short = even(Math.min(r.width, r.height));
    const physShort = Math.min(physical.width, physical.height);
    const size = physical.width <= physical.height ? `${short}x${long}` : `${long}x${short}`;
    const scaled = short === physShort ? null : Math.round((density * short) / physShort);
    return { size, density: scaled };
  }

  // Phone override with the monitor's shape at the phone's full width.
  function phoneOverride(physical, monitor) {
    const short = Math.min(physical.width, physical.height);
    const long = Math.max(physical.width, physical.height);
    const rr = ratio(monitor);
    let s = short;
    let l = even(short * rr);
    if (l > long) {
      l = long;
      s = even(long / rr);
    }
    return physical.width <= physical.height ? `${s}x${l}` : `${l}x${s}`;
  }

  // Does mirroring `phone` in landscape on `monitor` leave bars?
  function barsFor(phone, monitor) {
    const rp = ratio(phone);
    const rm = ratio(monitor);
    if (Math.abs(rp - rm) / rm < 0.01) return null;
    const mw = Math.max(monitor.width, monitor.height);
    const mh = Math.min(monitor.width, monitor.height);
    if (rp > rm) {
      const h = Math.round(mw / rp);
      return { where: 'top and bottom', each: Math.round((mh - h) / 2) };
    }
    const w = Math.round(mh * rp);
    return { where: 'left and right', each: Math.round((mw - w) / 2) };
  }

  // Label for the "Play on" list: "Monitor 2 · 1920 × 1080 (16:9) · main".
  function monitorLabel(d, index) {
    const tags = [d.primary ? 'main' : null, d.current ? 'this window' : null].filter(Boolean);
    return `Monitor ${index + 1} · ${d.width} × ${d.height} (${ratioLabel(d)})${tags.length ? ' · ' + tags.join(', ') : ''}`;
  }

  // Where to put the scrcpy window so it opens (and goes fullscreen) on
  // monitor `d`: just inside its top-left corner, so a rounding error can
  // never push it onto the neighbouring screen.
  function windowPosFor(d) {
    return { x: d.x + 40, y: d.y + 40 };
  }

  const api = { monitorLabel, windowPosFor, ratioLabel, parseRes, virtualDisplaySize, resolutionChoices, wmPlan, phoneOverride, barsFor, fitsPhone };
  root.ScrcpyFit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
