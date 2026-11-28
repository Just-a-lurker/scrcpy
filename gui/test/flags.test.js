const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/flags.js');
const A = require('../src/args.js');
const options = require('../src/options.json');

const args = (state) => A.buildArgs(options, state);

test('virtual display, fullscreen, monitor size', () => {
  const s = F.applyFit({}, { card: 'vd', res: { width: 1920, height: 1080 }, fullscreen: true, orient: '' });
  assert.deepStrictEqual(args(s).sort(), ['--fullscreen', '--ignore-video-encoder-constraints', '--new-display=1920x1080']);
});

test('virtual display keeps a /dpi suffix and drops a capture lock', () => {
  const s = { 'new-display': { on: true, value: '1600x900/320' }, 'capture-orientation': { on: false, value: '@270' } };
  F.applyFit(s, { card: 'vd', res: { width: 1280, height: 720 }, fullscreen: false, orient: '' });
  assert.deepStrictEqual(args(s).sort(), ['--new-display=1280x720/320', '--window-height=720', '--window-width=1280']);
});

test('resize card, windowed, landscape from the start', () => {
  const s = F.applyFit({ fullscreen: { on: true } }, { card: 'wm', res: { width: 1600, height: 900 }, fullscreen: false, orient: 'landscape' });
  assert.deepStrictEqual(args(s).sort(), [
    '--capture-orientation=@270', '--ignore-video-encoder-constraints', '--window-height=900', '--window-width=1600',
  ]);
});

test('multiples of 16 do not need the exact-size flag', () => {
  const s = F.applyFit({}, { card: 'wm', res: { width: 1280, height: 720 }, fullscreen: true, orient: '' });
  assert.ok(!args(s).includes('--ignore-video-encoder-constraints'));
});

test('turning a card off removes what it wrote, but not a user capture lock', () => {
  const s = F.applyFit({}, { card: 'wm', res: { width: 1600, height: 900 }, fullscreen: false, orient: 'landscape-flipped' });
  F.disableFit(s, 'wm');
  assert.deepStrictEqual(args(s), ['--ignore-video-encoder-constraints']);
  const mine = { 'capture-orientation': { on: false, value: '90' } };
  F.disableFit(mine, 'wm');
  assert.deepStrictEqual(args(mine), ['--capture-orientation=90']);
});

test('virtual display conflicts are cleared', () => {
  const s = { 'display-id': { value: '2' }, crop: { value: '1:1:0:0' }, 'video-source': { value: 'camera' }, 'no-video': { on: true } };
  const isSet = (k) => A.isActive(options.find((o) => o.name === k), s[k]);
  assert.deepStrictEqual(F.clearVirtualDisplayConflicts(s, isSet).sort(), ['--crop', '--display-id', '--no-video', '--video-source']);
  assert.deepStrictEqual(args(s), []);
});

test('adb selector follows the connection options', () => {
  assert.deepStrictEqual(F.adbSelector({}), []);
  assert.deepStrictEqual(F.adbSelector({ serial: { value: ' abc ' } }), ['-s', 'abc']);
  assert.deepStrictEqual(F.adbSelector({ 'select-usb': { on: true } }), ['-d']);
  assert.deepStrictEqual(F.adbSelector({ tcpip: { on: true, value: '+192.168.1.5' } }), ['-s', '192.168.1.5:5555']);
});

test('close-app plan', () => {
  assert.strictEqual(F.closeAppPlan({}, []), null);
  const on = { '@close-app-on-exit': { on: true } };
  assert.strictEqual(F.closeAppPlan(on, []).error, 'set Start app');
  const s = { ...on, 'start-app': { value: '+com.proximabeta.nikke' }, serial: { value: 'x1' } };
  assert.deepStrictEqual(F.closeAppPlan(s, []), { selector: ['-s', 'x1'], pkg: 'com.proximabeta.nikke', error: null });
});

test('stable JSON ignores key order', () => {
  assert.strictEqual(F.stableJson({ b: 1, a: { d: 2, c: [1, { y: 1, x: 2 }] } }), F.stableJson({ a: { c: [1, { x: 2, y: 1 }], d: 2 }, b: 1 }));
  assert.notStrictEqual(F.stableJson({ a: 1 }), F.stableJson({ a: 2 }));
});

test('codec options: read, set and remove one key, keep the rest as written', () => {
  const s = 'profile=1,video-qp-max:int=34,vendor.x:string=a\\,b';
  assert.deepStrictEqual(F.splitCodecOptions(s), ['profile=1', 'video-qp-max:int=34', 'vendor.x:string=a\\,b']);
  assert.strictEqual(F.getCodecOption(s, 'video-qp-max'), '34');
  assert.strictEqual(F.getCodecOption(s, 'i-frame-interval'), null);
  assert.strictEqual(F.setCodecOption(s, 'video-qp-max', '30'), 'profile=1,video-qp-max=30,vendor.x:string=a\\,b');
  assert.strictEqual(F.setCodecOption(s, 'i-frame-interval', '2'), s + ',i-frame-interval=2');
  assert.strictEqual(F.setCodecOption(s, 'video-qp-max', null), 'profile=1,vendor.x:string=a\\,b');
  assert.strictEqual(F.setCodecOption('', 'video-qp-max', '30'), 'video-qp-max=30');
  assert.strictEqual(F.setCodecOption('video-qp-max=30', 'video-qp-max', ''), '');
  assert.strictEqual(F.setCodecOption(undefined, 'i-frame-interval', null), '');
});

test('codec options: duplicates collapse to one entry, last value wins on read', () => {
  const s = 'i-frame-interval=5, video-qp-max=30 ,i-frame-interval=2';
  assert.strictEqual(F.getCodecOption(s, 'i-frame-interval'), '2');
  assert.strictEqual(F.setCodecOption(s, 'i-frame-interval', '3'), 'i-frame-interval=3,video-qp-max=30');
});

test('codec option rows reach the scrcpy command', () => {
  let v = F.setCodecOption('', 'video-qp-max', '30');
  v = F.setCodecOption(v, 'i-frame-interval', '2');
  assert.deepStrictEqual(args({ 'video-codec-options': { value: v } }), ['--video-codec-options=video-qp-max=30,i-frame-interval=2']);
});

test('a profile leaves out the Play on monitor and its window corner', () => {
  const s = { fullscreen: { on: true }, '@monitor': { on: true, value: '17' },
    'window-x': { on: false, value: '-1880' }, 'window-y': { on: false, value: '736' } };
  assert.deepStrictEqual(F.withoutMonitor(s), { fullscreen: { on: true } });
  assert.ok(s['@monitor'], 'the state itself is not changed');
});

test('a hand-set window corner stays in a profile when no monitor is chosen', () => {
  const s = { 'window-x': { on: false, value: '40' } };
  assert.deepStrictEqual(F.withoutMonitor(s), s);
});

test('loading a profile keeps the current monitor choice', () => {
  const current = { '@monitor': { on: true, value: '17' },
    'window-x': { on: false, value: '-1880' }, 'window-y': { on: false, value: '736' } };
  const profile = { fullscreen: { on: true }, 'window-x': { on: false, value: '40' } };
  assert.deepStrictEqual(F.keepMonitor(profile, current), { fullscreen: { on: true }, ...current });
  assert.deepStrictEqual(F.keepMonitor(profile, { fullscreen: { on: true } }), profile);
  const old = { '@monitor': { on: true, value: '99' }, 'window-x': { on: false, value: '0' }, 'window-y': { on: false, value: '0' } };
  assert.deepStrictEqual(F.keepMonitor(old, {}), {});
});
