// Output copied from scrcpy 5.0.1 on a Redmi M2012K10C (Android 16).
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/encoders.js');

const OUTPUT = `[server] INFO: Device: [Xiaomi] Redmi M2012K10C (Android 16)
[server] INFO: List of video encoders:
    --video-codec=h264 --video-encoder=c2.mtk.avc.encoder             (hw) [vendor]
    --video-codec=h264 --video-encoder=c2.android.avc.encoder         (sw)
    --video-codec=h264 --video-encoder=OMX.MTK.VIDEO.ENCODER.AVC      (hw) [vendor] (alias for c2.mtk.avc.encoder)
    --video-codec=h264 --video-encoder=OMX.google.h264.encoder        (sw) (alias for c2.android.avc.encoder)
    --video-codec=h265 --video-encoder=c2.android.hevc.encoder        (sw)
    --video-codec=h265 --video-encoder=c2.mtk.hevc.encoder            (hw) [vendor]
    --video-codec=h265 --video-encoder=OMX.MTK.VIDEO.ENCODER.HEVC     (hw) [vendor] (alias for c2.mtk.hevc.encoder)
    --video-codec=av1 --video-encoder=c2.android.av1.encoder          (sw)
[server] INFO: List of audio encoders:
    --audio-codec=opus --audio-encoder=c2.android.opus.encoder        (sw)
    --audio-codec=aac --audio-encoder=c2.android.aac.encoder          (sw)
`;

test('every encoder line is parsed', () => {
  const list = E.parseEncoders(OUTPUT);
  assert.strictEqual(list.length, 10);
  assert.deepStrictEqual(list[0], { kind: 'video', codec: 'h264', name: 'c2.mtk.avc.encoder', hw: true, vendor: true, alias: null });
  assert.deepStrictEqual(list[3], { kind: 'video', codec: 'h264', name: 'OMX.google.h264.encoder', hw: false, vendor: false, alias: 'c2.android.avc.encoder' });
  assert.deepStrictEqual(list[8], { kind: 'audio', codec: 'opus', name: 'c2.android.opus.encoder', hw: false, vendor: false, alias: null });
});

test('choices: one codec, aliases dropped, hardware first', () => {
  const list = E.parseEncoders(OUTPUT);
  assert.deepStrictEqual(E.choices(list, 'video', 'h265').map((e) => e.name), ['c2.mtk.hevc.encoder', 'c2.android.hevc.encoder']);
  assert.deepStrictEqual(E.choices(list, 'video', 'vp9'), []);
});

test('other output is ignored', () => {
  assert.deepStrictEqual(E.parseEncoders('ERROR: Could not find any ADB device\n'), []);
});
