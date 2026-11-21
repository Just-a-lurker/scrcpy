const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/presets.js');
const A = require('../src/args.js');
const options = require('../src/options.json');

const args = (state) => A.buildArgs(options, state).sort();

test('an empty state is the scrcpy default preset', () => {
  assert.strictEqual(P.current({}), 'default');
  assert.strictEqual(P.summary({}), 'H.264 · 8 Mbps');
});

test('explicit default values still count as the default preset', () => {
  const s = { 'video-codec': { value: 'h264' }, 'video-bit-rate': { value: '8000000' }, 'video-buffer': { value: '0' } };
  assert.strictEqual(P.current(s), 'default');
});

test('USB sharp writes real flags and reads back as itself', () => {
  const s = P.apply({}, 'usb');
  assert.deepStrictEqual(args(s), [
    '--video-bit-rate=24M', '--video-codec-options=video-qp-max=30,i-frame-interval=2', '--video-codec=h265',
  ]);
  assert.strictEqual(P.current(s), 'usb');
  assert.strictEqual(P.summary(s), 'H.265 · 24 Mbps · blockiness cap 30 · full refresh every 2 s');
});

test('the user saved settings from this session match USB sharp', () => {
  const s = {
    'video-codec': { on: false, value: 'h265' },
    'video-bit-rate': { on: false, value: '24M' },
    'video-codec-options': { on: false, value: 'video-qp-max=30,i-frame-interval=2' },
  };
  assert.strictEqual(P.current(s), 'usb');
});

test('Wi-Fi smooth adds a video buffer, and switching back removes it', () => {
  const s = P.apply({}, 'wifi');
  assert.ok(args(s).includes('--video-buffer=50'));
  assert.strictEqual(P.current(s), 'wifi');
  P.apply(s, 'usb');
  assert.ok(!args(s).some((a) => a.startsWith('--video-buffer')));
  assert.strictEqual(P.current(s), 'usb');
});

test('a preset keeps codec options it does not own', () => {
  const s = { 'video-codec-options': { value: 'profile=1,video-qp-max=40' } };
  P.apply(s, 'usb');
  assert.strictEqual(s['video-codec-options'].value, 'profile=1,video-qp-max=30,i-frame-interval=2');
  P.apply(s, 'default');
  assert.strictEqual(s['video-codec-options'].value, 'profile=1');
  assert.strictEqual(P.current(s), 'default');
});

test('the default preset removes everything it wrote', () => {
  const s = P.apply(P.apply({}, 'wifi'), 'default');
  assert.deepStrictEqual(s, {});
});

test('any hand edit shows as custom', () => {
  const s = P.apply({}, 'usb');
  s['video-bit-rate'].value = '20M';
  assert.strictEqual(P.current(s), 'custom');
  assert.strictEqual(P.summary(s), 'H.265 · 20 Mbps · blockiness cap 30 · full refresh every 2 s');
});

test('bit rates compare by value', () => {
  assert.strictEqual(P.parseRate('24M'), 24000000);
  assert.strictEqual(P.parseRate('24000k'), 24000000);
  assert.strictEqual(P.parseRate('1.5M'), 1500000);
  assert.strictEqual(P.parseRate('fast'), null);
  const s = P.apply({}, 'usb');
  s['video-bit-rate'].value = '24000000';
  assert.strictEqual(P.current(s), 'usb');
});
