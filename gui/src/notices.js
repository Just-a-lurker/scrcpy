// scrcpy error lines translated into what to do about them. The patterns
// match the exact messages in app/src/adb/adb.c and the server's Ln.e calls;
// test/notices.test.js checks them against those strings.
//
// match(line, ctx) returns { text, actions } or null. `actions` are ids the
// renderer maps to buttons: 'pair', 'device', 'fit', 'quick', 'log',
// 'encoder', 'codecopts'.
(function (root) {
  const RULES = [
    // adb.c: "Device is unauthorized:"
    { re: /unauthorized/i,
      text: 'The phone has not allowed this PC yet. Unlock it, accept "Allow USB debugging?", then start again.' },
    // adb.c: "Device could not be connected (state=offline)"
    { re: /Device could not be connected \(state=([\w-]+)\)/,
      text: (m) => `The phone is ${m[1]}. Check the cable or Wi-Fi, then start again.` },
    // adb.c: "Could not find ADB device <serial>:"
    { re: /Could not find ADB device \S+:/,
      text: 'The phone chosen under Device is not connected. Reconnect it or choose another.',
      actions: ['device'] },
    // adb.c: "Could not find any ADB device" (also "... over USB:" / "over TCP/IP:")
    { re: /Could not find any ADB device/,
      text: 'No phone found. Plug it in with USB debugging on, or pair it over Wi-Fi.',
      actions: ['pair'] },
    // adb.c: "Multiple (2) ADB devices:" and variants
    { re: /Multiple \(\d+\) ADB devices/,
      text: 'More than one phone is connected. Choose one under Device.',
      actions: ['device'] },
    // server: "Could not create VirtualDisplay" / "Could not create display"
    { re: /Could not create (VirtualDisplay|display)/,
      text: (m, ctx) => (ctx.newDisplay
        ? 'This phone could not create a virtual display. Use Resize the phone screen instead.'
        : 'The phone could not start screen capture. Unlock it and start again.'),
      actions: (ctx) => (ctx.newDisplay ? ['fit'] : []) },
    // server: "Capture/encoding error: ...", "Could not create video encoder '...'",
    // "Could not create default video encoder for ...", "MediaCodec error"
    { re: /Capture\/encoding error|Could not create (default )?video encoder|MediaCodec error|CodecException/,
      text: "The phone's video encoder refused these settings. Lower the video bit rate or resolution, or turn off Exact video size.",
      actions: ['quick'] },
    // server: "Video encoder 'x' for h265 not found" (a value that is not an
    // encoder name, such as a codec option typed into the wrong field)
    { re: /Video encoder '(.*)' for (\w+) not found/,
      text: (m) => `"${m[1]}" is not a ${m[2]} encoder on this phone. Video encoder takes an encoder name; settings such as bitrate-mode go in Video codec options. Clear Video encoder to let scrcpy choose.`,
      actions: ['encoder'] },
    // FFmpeg on the PC: the stream from the phone is not valid video. Seen
    // when the encoder is given an option it handles badly (bitrate-mode=2
    // on a MediaTek HEVC encoder).
    { re: /No start code is found|Error splitting the input into NAL units/,
      text: "The phone's encoder sent video this PC cannot decode. A Video codec option usually causes this: remove the last one you added.",
      actions: ['codecopts'] },
    // server: "Audio encoding error", "Could not create (default) audio encoder"
    { re: /Audio encoding error|Could not create (default )?audio encoder/,
      text: 'The phone could not encode audio. Choose another audio codec, or turn on No audio.' },
    // server: "Camera mirroring is not supported before Android 12",
    // "New virtual display is not supported before Android 10", ...
    { re: /^(.+?) is not supported before Android (\d+)/,
      text: (m) => `${m[1]} needs Android ${m[2]} or newer. Turn that option off for this phone.` },
  ];

  function match(line, ctx = {}) {
    // Drop scrcpy's "[server] ERROR: " style prefix.
    const msg = String(line).replace(/^(\[server\] )?(VERBOSE|DEBUG|INFO|WARN|ERROR|FATAL):\s*/, '');
    for (const r of RULES) {
      const m = r.re.exec(msg);
      if (!m) continue;
      return {
        text: typeof r.text === 'function' ? r.text(m, ctx) : r.text,
        actions: typeof r.actions === 'function' ? r.actions(ctx) : (r.actions ?? []),
      };
    }
    return null;
  }

  const api = { match };
  root.ScrcpyNotices = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
