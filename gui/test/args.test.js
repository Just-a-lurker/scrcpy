const test = require('node:test');
const assert = require('node:assert');
const options = require('../src/options.json');
const meta = require('../src/meta.js');
const A = require('../src/args.js');

const find = (k) => options.find((o) => A.keyOf(o) === k);

test('boolean, required and optional flags use the attached form', () => {
  const state = {
    'always-on-top': { on: true },
    'max-size': { value: '1024' },
    'new-display': { on: true, value: '1920x1080/420' },
    tcpip: { on: true, value: '' },
    '-K': { on: true },
  };
  const args = A.buildArgs(options, state);
  assert.ok(args.includes('--always-on-top'));
  assert.ok(args.includes('--max-size=1024'));
  assert.ok(args.includes('--new-display=1920x1080/420'));
  assert.ok(args.includes('--tcpip'));
  assert.ok(args.includes('-K'));
  assert.strictEqual(args.length, 5);
});

test('unset and empty entries produce nothing', () => {
  const args = A.buildArgs(options, {
    'always-on-top': { on: false },
    'max-size': { value: '   ' },
    'new-display': { on: false, value: '1280x720' },
  });
  assert.deepStrictEqual(args, []);
});

test('excluded keys are skipped', () => {
  const args = A.buildArgs(options, { 'list-apps': { on: true }, fullscreen: { on: true } }, meta.actions);
  assert.deepStrictEqual(args, ['--fullscreen']);
});

test('optional-argument options are exactly the ones in cli.c', () => {
  const optional = options.filter((o) => o.arg === 'optional').map((o) => o.name).sort();
  assert.deepStrictEqual(optional, ['new-display', 'pause-on-exit', 'tcpip']);
});

test('every option is categorised or is an action', () => {
  for (const o of options) {
    const k = A.keyOf(o);
    assert.ok(meta.category[k] || meta.actions.includes(k), `uncategorised: ${k}`);
  }
});

test('enum metadata only refers to options taking an argument', () => {
  for (const k of Object.keys(meta.enums)) assert.notStrictEqual(find(k)?.arg ?? 'none', 'none', k);
});

test('Windows quoting', () => {
  assert.strictEqual(A.quoteArg('--record=C:\\My Videos\\a.mp4'), '"--record=C:\\My Videos\\a.mp4"');
  assert.strictEqual(A.quoteArg('--window-title=say "hi"'), '"--window-title=say \\"hi\\""');
  assert.strictEqual(A.quoteArg('--max-size=1024'), '--max-size=1024');
  assert.strictEqual(A.quoteArg('C:\\dir\\'), 'C:\\dir\\');
  assert.strictEqual(A.quoteArg('C:\\a b\\'), '"C:\\a b\\\\"');
});
