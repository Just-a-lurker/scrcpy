// Parse `scrcpy --list-encoders` output, e.g.
//   --video-codec=h265 --video-encoder=c2.mtk.hevc.encoder            (hw) [vendor]
//   --video-codec=h265 --video-encoder=OMX.MTK.VIDEO.ENCODER.HEVC     (hw) [vendor] (alias for c2.mtk.hevc.encoder)
//   --audio-codec=opus --audio-encoder=c2.android.opus.encoder        (sw)
(function (root) {
  const LINE = /--(video|audio)-codec=(\S+)\s+--\1-encoder=(\S+)(.*)$/;

  function parseEncoders(text) {
    const out = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
      const m = LINE.exec(line);
      if (!m) continue;
      const rest = m[4];
      const alias = /\(alias for ([^)]+)\)/.exec(rest);
      out.push({
        kind: m[1],
        codec: m[2],
        name: m[3],
        hw: /\(hw\)/.test(rest) ? true : /\(sw\)/.test(rest) ? false : null,
        vendor: /\[vendor\]/.test(rest),
        alias: alias ? alias[1].trim() : null,
      });
    }
    return out;
  }

  // Encoders worth offering for one codec: real names first (hardware before
  // software), aliases left out because they name the same encoder.
  function choices(list, kind, codec) {
    return list
      .filter((e) => e.kind === kind && e.codec === codec && !e.alias)
      .sort((a, b) => (b.hw === true) - (a.hw === true));
  }

  const api = { parseEncoders, choices };
  root.ScrcpyEncoders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
