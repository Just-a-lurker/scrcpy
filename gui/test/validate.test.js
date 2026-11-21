const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/validate.js');

test('device selectors', () => {
  assert.ok(V.isValidSelector([]));
  assert.ok(V.isValidSelector(['-d']));
  assert.ok(V.isValidSelector(['-s', '0a1b2c3d4e5f6789']));
  assert.ok(V.isValidSelector(['-s', '192.168.1.50:33443']));
  assert.ok(V.isValidSelector(['-s', 'adb-0a1b2c3d4e5f6789-AbC123._adb-tls-connect._tcp']));
  assert.ok(!V.isValidSelector(['-s', '-d']));
  assert.ok(!V.isValidSelector(['-s', 'a;reboot']));
  assert.ok(!V.isValidSelector(['-s', 'a b']));
  assert.ok(!V.isValidSelector(['--x']));
  assert.ok(!V.isValidSelector('-d'));
});

test('pairing inputs', () => {
  assert.strictEqual(V.checkHost('192.168.1.23'), null);
  assert.ok(V.checkHost('-h'));
  assert.ok(V.checkHost('1.2.3.4;ls'));
  assert.strictEqual(V.checkPort('37199'), null);
  assert.ok(V.checkPort('0'));
  assert.ok(V.checkPort('70000'));
  assert.strictEqual(V.checkPairCode('123456'), null);
  assert.ok(V.checkPairCode('12345'));
});

test('restore records are cleaned before reaching adb shell', () => {
  const evil = { size: '1x1;reboot', density: '440; rm -rf /', rotation: { accel: '1;id', user: '9' } };
  assert.deepStrictEqual(V.restoreArgs(evil), [
    ['shell', 'wm', 'size', 'reset'],
    ['shell', 'wm', 'density', 'reset'],
    ['shell', 'settings', 'delete', 'system', 'accelerometer_rotation'],
    ['shell', 'settings', 'delete', 'system', 'user_rotation'],
  ]);
  assert.deepStrictEqual(V.restoreArgs({ size: '1080x2400', density: 400, rotation: { accel: '1', user: '0' } }), [
    ['shell', 'wm', 'size', '1080x2400'],
    ['shell', 'wm', 'density', '400'],
    ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1'],
    ['shell', 'settings', 'put', 'system', 'user_rotation', '0'],
  ]);
  // Records saved by older versions have no rotation.
  assert.strictEqual(V.restoreArgs({ size: null, density: null }).length, 2);
});

test('the renderer can only write its own settings', () => {
  const out = V.filterSettingsPatch({
    lastState: { fullscreen: { on: true } },
    profiles: { a: {} },
    lastProfile: 'a',
    lastPairHost: '192.168.1.60',
    theme: 'dark',
    scrcpyPath: 'C:/evil.exe',
    pendingRestore: { x: {} },
    bounds: {},
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ['lastPairHost', 'lastProfile', 'lastState', 'profiles', 'theme']);
  assert.deepStrictEqual(V.filterSettingsPatch({ theme: 'neon', lastState: [] }), {});
});

test('adb output parsers', () => {
  const devices = V.parseDevices([
    'List of devices attached',
    '* daemon started successfully',
    '0a1b2c3d4e5f6789       device product:ares model:M2012K10C device:ares transport_id:7',
    '192.168.1.50:33443     device product:ares model:M2012K10C transport_id:8',
    'ZX1G22                 unauthorized usb:1-1 transport_id:9',
    '',
  ].join('\r\n'));
  assert.deepStrictEqual(devices.map((d) => [d.serial, d.state, d.transport, d.model]), [
    ['0a1b2c3d4e5f6789', 'device', 'usb', 'M2012K10C'],
    ['192.168.1.50:33443', 'device', 'tcpip', 'M2012K10C'],
    ['ZX1G22', 'unauthorized', 'usb', ''],
  ]);

  const mdns = V.parseMdns('List of discovered mdns services\nadb-0a1b2c3d4e5f6789-AbC123\t_adb-tls-connect._tcp\t192.168.1.50:33443\n');
  assert.deepStrictEqual(mdns, [{ name: 'adb-0a1b2c3d4e5f6789-AbC123', kind: 'connect', host: '192.168.1.50', port: '33443' }]);

  const wm = V.parseWm('Physical size: 1080x2400\nOverride size: 1080x1920', 'Physical density: 440');
  assert.deepStrictEqual(wm, {
    ok: true,
    size: { physical: { width: 1080, height: 2400 }, override: { width: 1080, height: 1920 } },
    density: { physical: 440, override: null },
  });
});

test('saved window bounds must overlap a display', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  assert.ok(V.boundsVisible({ x: 100, y: 100, width: 1280, height: 840 }, areas));
  assert.ok(!V.boundsVisible({ x: 2500, y: 100, width: 1280, height: 840 }, areas), 'on an unplugged second monitor');
  assert.ok(!V.boundsVisible({ x: 100, y: -900, width: 1280, height: 840 }, areas), 'title bar above the screen');
  assert.ok(!V.boundsVisible(undefined, areas));
});
