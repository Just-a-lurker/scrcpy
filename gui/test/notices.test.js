// Each case is a message exactly as scrcpy 5.0.1 prints it (app/src/adb/adb.c
// and the server's Ln.e calls), with the log prefix scrcpy adds.
const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/notices.js');

const cases = [
  ['ERROR: Device is unauthorized:', /not allowed this PC/],
  ['ERROR: Device could not be connected (state=offline)', /phone is offline/],
  ['ERROR: Could not find ADB device 0a1b2c3d4e5f6789:', /chosen under Device is not connected/],
  ['ERROR: Could not find any ADB device', /No phone found/],
  ['ERROR: Could not find any ADB device over USB:', /No phone found/],
  ['ERROR: Multiple (2) ADB devices:', /More than one phone/],
  ['ERROR: Multiple (2) ADB devices over TCP/IP:', /More than one phone/],
  ['[server] ERROR: Capture/encoding error: android.media.MediaCodec$CodecException: Error 0xfffffff4', /video encoder refused/],
  ["[server] ERROR: Could not create video encoder 'c2.mtk.hevc.encoder'", /video encoder refused/],
  ['[server] ERROR: Audio encoding error', /could not encode audio/],
  ['[server] ERROR: New virtual display is not supported before Android 10', /^New virtual display needs Android 10 or newer/],
  ['[server] ERROR: Camera mirroring is not supported before Android 12', /^Camera mirroring needs Android 12/],
];

for (const [line, expected] of cases) {
  test(line, () => {
    const n = N.match(line);
    assert.ok(n, 'no notice for: ' + line);
    assert.match(n.text, expected);
  });
}

test('display creation failure depends on whether a virtual display was asked for', () => {
  assert.match(N.match('[server] ERROR: Could not create VirtualDisplay', { newDisplay: true }).text, /virtual display/);
  assert.deepStrictEqual(N.match('[server] ERROR: Could not create VirtualDisplay', { newDisplay: true }).actions, ['fit']);
  assert.match(N.match('[server] ERROR: Could not create display', { newDisplay: false }).text, /could not start screen capture/);
});

test('ordinary output is left alone', () => {
  for (const line of ['INFO: ADB device found:', 'INFO: Renderer: direct3d11', 'INFO: 60 fps', '[server] INFO: Device: [Xiaomi] Redmi M2012K10C (Android 16)', 'WARN: Killing the server...']) {
    assert.strictEqual(N.match(line), null, line);
  }
});
