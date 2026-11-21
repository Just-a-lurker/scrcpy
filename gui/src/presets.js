// Picture presets for the Quick setup "Picture" card. A preset writes real
// scrcpy flags into the launcher state (codec, bit rate, video buffer and two
// entries inside --video-codec-options); which preset is active is read back
// from those flags, so any hand edit shows as Custom.
(function (root) {
  const Flags = root.ScrcpyFlags || (typeof require !== 'undefined' ? require('./flags.js') : null);

  // Values as the user would type them; '' means "leave scrcpy's default".
  const PRESETS = [
    {
      id: 'usb', label: 'USB sharp',
      values: { codec: 'h265', bitRate: '24M', qpMax: '30', refresh: '2', buffer: '' },
      note: 'Sharp right after scene changes. Sends bursts of data, which USB handles easily.',
    },
    {
      id: 'wifi', label: 'Wi-Fi smooth',
      values: { codec: 'h265', bitRate: '16M', qpMax: '34', refresh: '5', buffer: '50' },
      note: 'Smaller bursts and a 50 ms buffer, so Wi-Fi does not stutter. A starting point: adjust under Details.',
    },
    {
      id: 'default', label: 'scrcpy default',
      values: { codec: '', bitRate: '', qpMax: '', refresh: '', buffer: '' },
      note: 'H.264 at 8 Mbps with no encoder tuning.',
    },
  ];

  const DEFAULTS = { codec: 'h264', bitRate: 8000000, buffer: 0 };

  // "24M" -> 24000000, "500K" -> 500000; null when not a rate.
  function parseRate(s) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/.exec(String(s ?? ''));
    if (!m) return null;
    const mult = { '': 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()];
    return Math.round(Number(m[1]) * mult);
  }

  const val = (state, key) => (state[key]?.value ?? '').trim();

  // The picture settings as written in the state.
  function read(state) {
    const opts = state['video-codec-options']?.value;
    return {
      codec: val(state, 'video-codec'),
      bitRate: val(state, 'video-bit-rate'),
      qpMax: Flags.getCodecOption(opts, 'video-qp-max') ?? '',
      refresh: Flags.getCodecOption(opts, 'i-frame-interval') ?? '',
      buffer: val(state, 'video-buffer'),
    };
  }

  // Comparable form: scrcpy's defaults filled in, rates in bits/s.
  function normalize(v) {
    return {
      codec: v.codec || DEFAULTS.codec,
      bitRate: v.bitRate ? parseRate(v.bitRate) : DEFAULTS.bitRate,
      qpMax: v.qpMax === '' ? null : Number(v.qpMax),
      refresh: v.refresh === '' ? null : Number(v.refresh),
      buffer: v.buffer ? Number(v.buffer) : DEFAULTS.buffer,
    };
  }

  function same(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    return Object.keys(x).every((k) => x[k] === y[k]);
  }

  // The active preset id, or 'custom'.
  function current(state) {
    const v = read(state);
    return PRESETS.find((p) => same(v, p.values))?.id ?? 'custom';
  }

  function setFlag(state, key, value) {
    if (value === '') delete state[key];
    else state[key] = { on: false, value };
  }

  // Write a preset's flags. Other codec options are kept. Mutates and
  // returns `state`.
  function apply(state, id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return state;
    const v = p.values;
    setFlag(state, 'video-codec', v.codec);
    setFlag(state, 'video-bit-rate', v.bitRate);
    setFlag(state, 'video-buffer', v.buffer);
    let opts = state['video-codec-options']?.value;
    opts = Flags.setCodecOption(opts, 'video-qp-max', v.qpMax || null);
    opts = Flags.setCodecOption(opts, 'i-frame-interval', v.refresh || null);
    setFlag(state, 'video-codec-options', opts);
    return state;
  }

  const CODEC_NAMES = { h264: 'H.264', h265: 'H.265', av1: 'AV1', vp8: 'VP8', vp9: 'VP9' };

  // One line describing the settings, e.g.
  // "H.265 · 24 Mbps · blockiness cap 30 · full refresh every 2 s".
  function summary(state) {
    const n = normalize(read(state));
    const rate = n.bitRate == null ? '? Mbps' : `${+(n.bitRate / 1e6).toFixed(2)} Mbps`;
    const parts = [CODEC_NAMES[n.codec] ?? n.codec, rate];
    if (n.qpMax != null) parts.push(`blockiness cap ${n.qpMax}`);
    if (n.refresh != null) parts.push(`full refresh every ${n.refresh} s`);
    if (n.buffer) parts.push(`${n.buffer} ms buffer`);
    return parts.join(' · ');
  }

  const api = { PRESETS, parseRate, read, current, apply, summary };
  root.ScrcpyPresets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
