const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/fit.js');

const phone = { width: 1080, height: 2400 }; // Redmi M2012K10C, 20:9
const fhd = { width: 1920, height: 1080 };

test('labels aspect ratios', () => {
  assert.strictEqual(F.ratioLabel(phone), '20:9');
  assert.strictEqual(F.ratioLabel(fhd), '16:9');
  assert.strictEqual(F.ratioLabel({ width: 2560, height: 1600 }), '16:10');
  assert.strictEqual(F.ratioLabel({ width: 3440, height: 1440 }), '21:9');
});

test('the reported case: 20:9 phone on a 1920x1080 monitor', () => {
  assert.deepStrictEqual(F.barsFor(phone, fhd), { where: 'top and bottom', each: 108 });
  assert.strictEqual(F.phoneOverride(phone, fhd), '1080x1920');
  assert.strictEqual(F.virtualDisplaySize(fhd), '1920x1080');
});

test('phone override never exceeds the physical size', () => {
  // 16:9 phone on an ultrawide 21:9 monitor: shorten the short side instead.
  const p169 = { width: 1080, height: 1920 };
  const uw = { width: 3440, height: 1440 };
  const o = F.phoneOverride(p169, uw).split('x').map(Number);
  assert.ok(o[1] <= 1920 && o[0] <= 1080, o.join('x'));
  assert.strictEqual(o[1], 1920);
  assert.strictEqual(o[0] % 2, 0);
});

test('landscape-natural devices keep their orientation', () => {
  assert.strictEqual(F.phoneOverride({ width: 2560, height: 1600 }, fhd), '2560x1440');
});

test('resolution choices fit the monitor; too-big ones are marked for the phone', () => {
  const choices = F.resolutionChoices(fhd, phone);
  assert.strictEqual(choices[0].value, '1920x1080');
  assert.ok(choices[0].label.includes('this monitor'));
  assert.ok(!choices.some((c) => c.value === '2560x1440'), 'larger than the monitor');
  assert.ok(choices.some((c) => c.value === '1280x720' && !c.disabled));
  const qhd = F.resolutionChoices({ width: 2560, height: 1440 }, phone);
  assert.ok(qhd.find((c) => c.value === '2560x1440').disabled, 'larger than a 1080x2400 phone');
});

test('wm plan: same width keeps density, smaller scales it', () => {
  assert.deepStrictEqual(F.wmPlan(phone, 440, '1920x1080'), { size: '1080x1920', density: null });
  assert.deepStrictEqual(F.wmPlan(phone, 440, '1280x720'), { size: '720x1280', density: 293 });
  assert.deepStrictEqual(F.wmPlan(phone, 440, '1600x900'), { size: '900x1600', density: 367 });
  assert.ok(F.wmPlan(phone, 440, '2560x1440').error);
  assert.ok(F.wmPlan(phone, 440, 'big').error);
  // Odd sizes are rounded to even numbers for the encoder.
  assert.deepStrictEqual(F.wmPlan(phone, 440, '1365x767').size, '768x1366');
});

test('no bars when the ratios match', () => {
  assert.strictEqual(F.barsFor({ width: 1080, height: 1920 }, fhd), null);
});
