const test = require('node:test');
const assert = require('node:assert');
const { parseAppList, resolveStartApp } = require('../src/apps.js');

const sample = [
  'scrcpy 5.0.1 <https://github.com/Genymobile/scrcpy>',
  'INFO: ADB device found:',
  'INFO:     -->   (usb)  R58M  device  SM_G973F',
  '[server] INFO: Device: [samsung] samsung SM-G973F (Android 12)',
  '[server] INFO: List of apps:',
  ' * Settings                       com.android.settings',
  ' * Camera                         com.sec.android.app.camera',
  ' - Firefox                        org.mozilla.firefox',
  ' - A really long application name',
  '                                  com.example.long_name',
  ' - Firefox Focus                  org.mozilla.focus',
  'INFO: Server exited',
].join('\r\n');

test('parses short and long entries, system flag', () => {
  const apps = parseAppList(sample);
  assert.deepStrictEqual(apps, [
    { name: 'Settings', pkg: 'com.android.settings', system: true },
    { name: 'Camera', pkg: 'com.sec.android.app.camera', system: true },
    { name: 'Firefox', pkg: 'org.mozilla.firefox', system: false },
    { name: 'A really long application name', pkg: 'com.example.long_name', system: false },
    { name: 'Firefox Focus', pkg: 'org.mozilla.focus', system: false },
  ]);
});

test('app names containing a line break, and entries after them', () => {
  // Seen on a real device: an app label with an embedded newline.
  const out = [
    '[server] INFO: List of apps:',
    ' - Comic',
    'Screen                   com.viewer.comicscreen',
    ' - Drive                          com.google.android.apps.docs',
    ' - A really long application name',
    'with two breaks',
    '                                  com.example.long',
    ' - Messenger                      com.facebook.orca',
    'WARN: Something after the list',
    ' - Not an app                     com.not.an.app',
  ].join('\n');
  assert.deepStrictEqual(parseAppList(out), [
    { name: 'Comic Screen', pkg: 'com.viewer.comicscreen', system: false },
    { name: 'Drive', pkg: 'com.google.android.apps.docs', system: false },
    { name: 'A really long application name with two breaks', pkg: 'com.example.long', system: false },
    { name: 'Messenger', pkg: 'com.facebook.orca', system: false },
  ]);
});

test('ignores output with no app list', () => {
  assert.deepStrictEqual(parseAppList('ERROR: Could not find any ADB device'), []);
});

test('resolves start-app values', () => {
  const apps = parseAppList(sample);
  assert.deepStrictEqual(resolveStartApp('org.mozilla.firefox', apps), { pkg: 'org.mozilla.firefox' });
  assert.deepStrictEqual(resolveStartApp('+org.mozilla.firefox', []), { pkg: 'org.mozilla.firefox' });
  assert.deepStrictEqual(resolveStartApp('+?settings', apps), { pkg: 'com.android.settings' });
  assert.ok(resolveStartApp('?fire', apps).error.includes('matches 2'));
  assert.ok(resolveStartApp('?zzz', apps).error);
  assert.ok(resolveStartApp('?fire', []).error);
  assert.ok(resolveStartApp('', apps).error);
  assert.ok(resolveStartApp('not a package', apps).error);
});
