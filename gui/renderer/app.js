/* global ScrcpyOptions, ScrcpyMeta, ScrcpyArgs, ScrcpyApps, ScrcpyFit, ScrcpyFlags, ScrcpyNotices */
'use strict';

const OPTIONS = ScrcpyOptions;
const META = ScrcpyMeta;
const A = ScrcpyArgs;
const F = ScrcpyFlags;
const api = window.scrcpy;

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

// ---------- State ----------
let state = {}; // key -> { on, value }
let exe = null;
let devices = [];
let session = null; // { id, pid }
const infoRuns = new Set();
let settings = {};
const rows = new Map(); // key -> { row, sync }

const optionKeys = OPTIONS.map(A.keyOf);
const byKey = new Map(OPTIONS.map((o) => [A.keyOf(o), o]));
const actionKeys = META.actions.filter((k) => byKey.has(k));

function entry(key) {
  return (state[key] ??= { on: false, value: '' });
}

// Launcher-only settings live in `state` under '@' keys. They are not scrcpy
// flags, so buildArgs never sees them (it only walks OPTIONS).
const CLOSE_APP = '@close-app-on-exit';
const FIT_WM = '@fit-phone-screen';

// Encoder tuning rows. Each one edits a single entry inside the Video codec
// options value, so the command, profiles and "Restart to apply" see it with
// no extra state. Row keys are 'codec:<key>'.
const CODEC_OPTS = 'video-codec-options';
const CODEC_ROWS = [
  {
    key: 'video-qp-max', label: 'Limit blockiness', placeholder: 'e.g. 30', suggestions: ['28', '30', '32', '34', '36'],
    min: 0, max: 51, def: null,
    first: 'Caps how coarse the phone may compress the picture (QP, 0 to 51), so scene changes stay sharper. Lower is sharper but sends bigger bursts of data.',
    rest: '\nWritten into Video codec options as video-qp-max=<n>. Empty leaves it to the encoder.' +
      '\n30 to 34 suits USB. Over Wi-Fi, 34 to 36 keeps the bursts from causing stutter.' +
      '\nNeeds Android 12+, and some encoders ignore it: if nothing changes, yours does.',
  },
  {
    key: 'i-frame-interval', label: 'Full refresh every (s)', placeholder: 'e.g. 2', suggestions: ['1', '2', '3', '5', '10'],
    min: 1, max: 60, def: '10',
    first: 'Seconds between full-picture refreshes (key frames). Shorter clears blur after a scene change sooner, at the cost of one large frame each time.',
    rest: '\nWritten into Video codec options as i-frame-interval=<n>. Empty keeps the scrcpy default of 10 s.' +
      '\nSome encoders count this in frames at 60 fps, so at 30 fps the real spacing is about twice as long.' +
      '\nOver Wi-Fi, use 3 to 5 or leave it empty.',
  },
];
const codecRowKey = (k) => 'codec:' + k;

function isSet(key) {
  if (key.startsWith('codec:')) return F.getCodecOption(state[CODEC_OPTS]?.value, key.slice(6)) != null;
  if (key.startsWith('@')) return !!state[key]?.on;
  return A.isActive(byKey.get(key), state[key]);
}

// ---------- Text helpers ----------
const ACRONYMS = {
  fps: 'FPS', id: 'ID', ip: 'IP', adb: 'adb', usb: 'USB', tcpip: 'TCP/IP', ime: 'IME', otg: 'OTG',
  aoa: 'AOA', uhid: 'UHID', ar: 'AR', vd: 'VD', v4l2: 'V4L2', sdk: 'SDK', hwdec: 'HW decoding',
};

function labelOf(opt) {
  const key = A.keyOf(opt);
  if (META.labels[key]) return META.labels[key];
  const words = opt.name.split('-').map((w) => ACRONYMS[w] ?? w);
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function defaultOf(opt) {
  const m = /Default is ([^\n]+?)\.?(?:\n|$)/.exec(opt.text);
  if (!m) return null;
  let d = m[1].replace(/^"(.*)"$/, '$1').trim();
  if (d.length > 42) d = d.slice(0, 40) + '…';
  return d;
}

function splitDescription(text) {
  const i = text.indexOf('\n');
  return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i)];
}

// ---------- Rendering ----------
function renderSections() {
  const allHost = $('#sections');
  const quickHost = $('#quick');
  allHost.replaceChildren();
  quickHost.replaceChildren();
  rows.clear();

  for (const cat of META.categories) {
    const rank = (k) => { const i = META.pinned.indexOf(k); return i < 0 ? Infinity : i; };
    const keys = optionKeys
      .filter((k) => META.category[k] === cat.id)
      .map((k, i) => [k, i])
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
      .map(([k]) => k);
    if (!keys.length) continue;
    const section = el('section', { class: 'section', id: 'sec-' + cat.id, dataset: { cat: cat.id } },
      el('header', { class: 'section-head' },
        el('h2', {}, cat.label),
        el('p', {}, cat.blurb),
      ),
    );
    for (const key of keys) {
      section.append(renderOption(byKey.get(key)));
      if (key === 'start-app') section.append(renderCloseAppRow());
      if (key === 'video-bit-rate') section.append(...CODEC_ROWS.map(renderCodecRow));
    }
    (cat.id === 'quick' ? quickHost : allHost).append(section);
  }
}

function renderOption(opt) {
  const key = A.keyOf(opt);
  const unsupported = META.unsupported[key];
  const def = defaultOf(opt);
  const [first, rest] = splitDescription(opt.text);

  const desc = el('p', { class: 'opt-desc' }, first);
  if (rest.trim()) {
    const restSpan = el('span', { class: 'rest' }, rest);
    const more = el('button', {
      class: 'more', type: 'button', 'aria-expanded': 'false',
      onclick: () => {
        const open = desc.classList.toggle('open');
        more.textContent = open ? 'Less' : 'More';
        more.setAttribute('aria-expanded', String(open));
      },
    }, 'More');
    desc.append(restSpan, more);
  }

  const title = el('div', { class: 'opt-title' },
    el('span', { class: 'opt-label' }, labelOf(opt)),
    opt.name ? el('code', { class: 'flag long' }, '--' + opt.name + (opt.argdesc ? (opt.arg === 'optional' ? '[=' + opt.argdesc + ']' : '=' + opt.argdesc) : '')) : null,
    opt.short ? el('code', { class: 'flag' }, '-' + opt.short) : null,
    def ? el('span', { class: 'default-chip' }, 'Default ' + def) : null,
    unsupported ? el('span', { class: 'note' }, unsupported) : null,
  );

  const { control, sync } = renderControl(opt, key, !!unsupported);
  const row = el('div', { class: 'opt' + (unsupported ? ' unsupported' : ''), dataset: { key } },
    el('div', { class: 'opt-text' }, title, desc),
    el('div', { class: 'opt-control' }, control),
  );

  const fullSync = () => {
    sync();
    row.classList.toggle('is-set', isSet(key));
  };
  rows.set(key, { row, sync: fullSync, search: (labelOf(opt) + ' ' + (opt.name ?? '') + ' -' + (opt.short ?? '') + ' ' + opt.text).toLowerCase() });
  fullSync();
  return row;
}

function controlId(key) {
  return 'opt-' + key.replace(/[^a-z0-9]/gi, '_');
}

function renderControl(opt, key, disabled) {
  const id = controlId(key);
  const frag = document.createDocumentFragment();

  if (opt.arg === 'none') {
    const box = el('input', {
      type: 'checkbox', class: 'switch', id, disabled,
      'aria-label': labelOf(opt),
      onchange: () => { entry(key).on = box.checked; changed(key); },
    });
    const text = el('span', { class: 'state-text' }, 'Off');
    frag.append(box, text);
    return {
      control: frag,
      sync: () => {
        box.checked = !!state[key]?.on;
        text.textContent = box.checked ? 'On' : 'Off';
      },
    };
  }

  const enumValues = META.enums[key];
  const platform = META.enumPlatform[key] || {};
  let input;
  if (enumValues) {
    input = el('select', { class: 'input', id, disabled, 'aria-label': labelOf(opt) },
      el('option', { value: '' }, opt.arg === 'optional' ? '(no value)' : 'Default'),
      enumValues.map((v) => el('option', { value: v }, platform[v] ? `${v}  (${platform[v]})` : v)),
    );
  } else {
    const listId = id + '-list';
    const sugg = key === 'serial' ? devices.map((d) => d.serial) : META.suggestions[key];
    input = el('input', {
      class: 'input mono', id, type: 'text', disabled, spellcheck: 'false', autocomplete: 'off',
      placeholder: opt.argdesc, 'aria-label': labelOf(opt),
      list: sugg?.length || key === 'serial' ? listId : null,
    });
    if (sugg?.length || key === 'serial') {
      frag.append(el('datalist', { id: listId }, (sugg ?? []).map((v) => el('option', { value: v }))));
    }
  }
  const onInput = () => {
    entry(key).value = input.value;
    if (opt.arg === 'required' && key === 'serial') syncDeviceSelect();
    changed(key);
  };
  input.addEventListener(enumValues ? 'change' : 'input', onInput);

  let toggle = null;
  if (opt.arg === 'optional') {
    toggle = el('input', {
      type: 'checkbox', class: 'switch', disabled,
      'aria-label': 'Enable ' + labelOf(opt),
      onchange: () => { entry(key).on = toggle.checked; changed(key); },
    });
    frag.append(toggle);
  }
  frag.append(input);

  if (key === 'start-app') {
    frag.append(el('button', {
      class: 'btn ghost small', type: 'button', disabled,
      title: 'List the apps on the device (scrcpy --list-apps) and pick one',
      onclick: () => openAppPicker(),
    }, 'Browse apps…'));
  }

  if (META.savePath.includes(key)) {
    frag.append(el('button', {
      class: 'btn ghost small', type: 'button', disabled,
      onclick: async () => {
        const p = await api.saveDialog({ title: 'Record to file', defaultPath: input.value || 'scrcpy-recording.mp4' });
        if (p) { input.value = p; onInput(); }
      },
    }, 'Browse…'));
  }

  const clear = el('button', {
    class: 'clear', type: 'button', title: 'Clear', 'aria-label': 'Clear ' + labelOf(opt),
    onclick: () => { state[key] = { on: false, value: '' }; changed(key); },
  }, '×');
  frag.append(clear);

  return {
    control: frag,
    sync: () => {
      const e = state[key] ?? {};
      if (input.value !== (e.value ?? '')) input.value = e.value ?? '';
      if (toggle) {
        toggle.checked = !!e.on;
        if (!disabled) input.disabled = !e.on;
      }
      clear.hidden = !(e.on || (e.value ?? '').trim());
    },
  };
}

function renderNav() {
  const list = $('#navList');
  const item = (target, label, aside) => el('li', {},
    el('a', { href: '#' + target, dataset: { target } }, el('span', {}, label), aside ?? null));
  const catItem = (cat) => {
    const keys = optionKeys.filter((k) => META.category[k] === cat.id);
    const setCount = keys.filter(isSet).length;
    return item('sec-' + cat.id, cat.label, setCount
      ? el('span', { class: 'set-count', title: `${setCount} set` }, String(setCount))
      : el('span', { class: 'count' }, String(keys.length)));
  };
  const heading = (text) => el('li', { class: 'nav-heading', 'aria-hidden': 'true' }, text);
  const quick = META.categories.find((c) => c.id === 'quick');
  list.replaceChildren(
    heading('Setup'),
    catItem(quick),
    item('sec-fit', 'Fill the monitor', activeFit() ? el('span', { class: 'set-count' }, 'On') : null),
    heading('All options'),
    ...META.categories.filter((c) => c.id !== 'quick').map(catItem),
    heading('Tools'),
    item('sec-info', 'Device info'),
  );
  markCurrentNav();
}

function renderActions() {
  const host = $('#actions');
  host.replaceChildren(...actionKeys.map((key) => {
    const opt = byKey.get(key);
    return el('button', {
      class: 'btn ghost', type: 'button', title: opt.text,
      onclick: () => runAction(key),
    }, '--' + opt.name);
  }));
}

// ---------- Command preview ----------
function sessionArgs() {
  return A.buildArgs(OPTIONS, state, actionKeys);
}

function exeLabel() {
  return exe ? (exe.includes(' ') || exe.length > 40 ? 'scrcpy' : exe) : 'scrcpy';
}

function renderCommand() {
  const args = sessionArgs();
  const code = $('#cmdLine');
  code.replaceChildren(el('span', { class: 'exe' }, exeLabel()));
  for (const a of args) {
    code.append(' ');
    const q = A.quoteArg(a);
    const eq = q.indexOf('=');
    if (a.startsWith('-') && eq > 0) {
      code.append(el('span', { class: 'tok-flag' }, q.slice(0, eq + 1)), el('span', { class: 'tok-val' }, q.slice(eq + 1)));
    } else {
      code.append(el('span', { class: 'tok-flag' }, q));
    }
  }
  if (!args.length) code.append(el('span', { class: 'exe' }, '   (no options set: scrcpy defaults)'));

  if (activeFit() === 'wm') {
    const wm = wmPlanNow();
    const steps = wm && !wm.error
      ? `adb shell wm size ${wm.size}${wm.density ? '; adb shell wm density ' + wm.density : ''}${wmOrient() ? '; lock rotation ' + wmOrient().rotation : ''}`
      : `adb shell wm size <${fitRes('wm')} in portrait>`;
    code.append(el('span', { class: 'exe' }, `\n# before: ${steps}   after: restore the phone screen`));
  }
  const plan = closeAppPlan();
  if (plan) {
    const target = plan.selector.length ? plan.selector.join(' ') + ' ' : '';
    code.append(el('span', { class: 'exe' }, `\n# when scrcpy exits: adb ${target}shell am force-stop ${plan.pkg ?? '<' + plan.error + '>'}`));
  }
}

// ---------- Change handling ----------
// One or more keys changed: tidy them, then redraw everything that depends
// on the state once.
let persistTimer = null;
function changed(...keys) {
  for (const key of keys) {
    if (state[key] && !state[key].on && !(state[key].value ?? '').trim()) delete state[key];
    rows.get(key)?.sync();
  }
  // The encoder rows read the Video codec options value.
  if (keys.includes(CODEC_OPTS)) for (const c of CODEC_ROWS) rows.get(codecRowKey(c.key))?.sync();
  syncFit();
  renderNav();
  renderCommand();
  applyFilter();
  markProfileDirty();
  updateSessionHint();
  schedulePersist();
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    api.setSettings({ lastState: state });
  }, 400);
}

// Closing the window within the delay would lose the last change.
window.addEventListener('beforeunload', () => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    api.setSettingsNow({ lastState: state });
  }
});

function syncAll() {
  for (const { sync } of rows.values()) sync();
  syncDeviceSelect();
  syncFit();
  renderNav();
  renderCommand();
  applyFilter();
}

// ---------- Search / filter ----------
function applyFilter() {
  const q = $('#search').value.trim().toLowerCase();
  const onlySet = $('#onlySet').checked;
  let visible = 0;
  for (const [key, r] of rows) {
    const show = (!q || q.split(/\s+/).every((w) => r.search.includes(w))) && (!onlySet || isSet(key));
    r.row.hidden = !show;
    if (show) visible++;
  }
  for (const section of document.querySelectorAll('.section[data-cat]')) {
    section.hidden = !section.querySelector('.opt:not([hidden])');
  }
  $('#sec-info').hidden = !!(q || onlySet);
  $('#sec-fit').hidden = !!(q || onlySet);
  const empty = $('#emptyState');
  empty.hidden = visible > 0;
  if (!visible) {
    empty.textContent = onlySet && !q
      ? 'No options are set yet. Every flag is at its scrcpy default.'
      : `No option matches "${$('#search').value.trim()}".`;
  }
}

// ---------- Nav highlighting ----------
function markCurrentNav() {
  const main = $('#main');
  const top = main.getBoundingClientRect().top + 24;
  let current = 'sec-quick';
  for (const s of main.querySelectorAll('.section:not([hidden])')) {
    if (s.getBoundingClientRect().top <= top) current = s.id;
  }
  for (const a of document.querySelectorAll('#navList a')) {
    a.classList.toggle('current', a.dataset.target === current);
  }
}

// ---------- Devices ----------
// Refreshes can be triggered by adb while one is running; run them one at a
// time and collapse the extras into one more pass.
let refreshing = null;
let refreshAgain = false;
async function refreshDevices() {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      refreshAgain = false;
      await refreshDevicesOnce();
    } while (refreshAgain);
  })();
  try {
    await refreshing;
  } finally {
    refreshing = null;
  }
}

async function refreshDevicesOnce() {
  const sel = $('#deviceSelect');
  sel.disabled = true;
  const res = await api.devices();
  devices = res.devices ?? [];
  sel.replaceChildren(el('option', { value: '' }, devices.length ? 'Any (the only connected device)' : res.error ? 'adb not available' : 'No devices found'));
  const STATE_LABEL = {
    unauthorized: 'not allowed yet: accept the prompt on the phone',
    offline: 'offline: reconnect the cable or Wi-Fi',
    authorizing: 'waiting for the phone',
  };
  for (const d of devices) {
    const name = d.model || d.product || 'Android device';
    const suffix = d.state === 'device' ? d.transport.toUpperCase() : (STATE_LABEL[d.state] ?? d.state);
    sel.append(el('option', { value: d.serial, disabled: d.state !== 'device' }, `${name} · ${d.serial} · ${suffix}`));
  }
  sel.disabled = false;
  if (res.error) log(res.error + '\n', 'l-err');
  if (devices.some((d) => d.state === 'unauthorized')) {
    showNotice('A phone is connected but has not allowed this PC yet. Unlock it and accept "Allow USB debugging?".', [], 'device');
  } else if (noticeSource === 'device') {
    clearNotice();
  }
  // Refresh the serial suggestions.
  const list = document.getElementById(controlId('serial') + '-list');
  if (list) list.replaceChildren(...devices.map((d) => el('option', { value: d.serial })));
  syncDeviceSelect();
  updateFitFacts();
}

function syncDeviceSelect() {
  const sel = $('#deviceSelect');
  const serial = state.serial?.value?.trim() ?? '';
  const known = [...sel.options].some((o) => o.value === serial);
  if (serial && !known) {
    sel.append(el('option', { value: serial }, `${serial} · not connected`));
  }
  sel.value = serial;
}

// ---------- Wireless pairing (adb pair / adb connect) ----------
function pairResult(kind, text) {
  const p = $('#pairResult');
  p.dataset.kind = kind;
  p.textContent = text;
  p.hidden = !text;
}

// Accept "192.168.1.23:37199" pasted into an IP field and split it.
function splitAddressInto(hostInput, portInput) {
  const m = /^\s*(\[[^\]]+\]|[^\s:]+):(\d{1,5})\s*$/.exec(hostInput.value);
  if (m) {
    hostInput.value = m[1];
    portInput.value = m[2];
  }
}

function openPairDialog() {
  const d = $('#pairDialog');
  pairResult('', '');
  const host = settings.lastPairHost ?? '';
  if (!$('#pairHost').value) $('#pairHost').value = host;
  if (!$('#connectHost').value) $('#connectHost').value = host;
  d.showModal();
  ($('#pairHost').value ? $('#pairPort') : $('#pairHost')).focus();
}

async function scanNetwork() {
  if (!requireExe()) return;
  const btn = $('#pairScan');
  const status = $('#pairScanStatus');
  const list = $('#pairFound');
  btn.disabled = true;
  status.textContent = 'Searching…';
  const r = await api.mdns();
  btn.disabled = false;
  list.replaceChildren();
  if (!r.services.length) {
    list.hidden = true;
    status.textContent = r.ok
      ? 'No phones found. Open the pairing screen on the phone, or type the address below.'
      : (r.output || 'adb could not search the network.');
    return;
  }
  status.textContent = `${r.services.length} found. Pick one to fill in the address.`;
  for (const s of r.services) {
    const pairing = s.kind === 'pairing';
    list.append(el('li', {}, el('button', {
      type: 'button',
      onclick: () => {
        if (pairing) {
          $('#pairHost').value = s.host;
          $('#pairPort').value = s.port;
          if (!$('#connectHost').value) $('#connectHost').value = s.host;
          $('#pairCode').focus();
        } else {
          $('#connectHost').value = s.host;
          $('#connectPort').value = s.port;
          $('#connectSubmit').focus();
        }
      },
    },
    el('span', {}, el('span', { class: 'kind' }, pairing ? 'Ready to pair' : 'Ready to connect'), '  ', s.name),
    el('span', { class: 'addr' }, `${s.host}:${s.port}`),
    )));
  }
  list.hidden = false;
}

async function pairDevice(e) {
  e.preventDefault();
  if (!requireExe()) return;
  splitAddressInto($('#pairHost'), $('#pairPort'));
  const host = $('#pairHost').value.trim();
  const port = $('#pairPort').value.trim();
  const code = $('#pairCode').value.replace(/\s/g, '');
  const btn = $('#pairSubmit');
  btn.disabled = true;
  btn.textContent = 'Pairing…';
  pairResult('', 'Pairing. Keep the pairing screen open on the phone.');
  log(`\n$ adb pair ${host}:${port} ******\n`, 'l-cmd');
  const r = await api.pair(host, port, code);
  btn.disabled = false;
  btn.textContent = 'Pair';
  log((r.output || '') + '\n', r.ok ? null : 'l-err');
  if (!r.ok) {
    pairResult('err', r.output || 'Pairing failed. Check the code and port, and that the pairing screen is still open.');
    return;
  }
  settings.lastPairHost = host;
  api.setSettings({ lastPairHost: host });
  $('#pairCode').value = '';
  $('#connectHost').value = host;
  pairResult('ok', `Paired with ${host}. Now enter the port from the Wireless debugging screen and connect.`);

  // The phone usually advertises its connect port right after pairing.
  const scan = await api.mdns();
  const svc = scan.services.find((s) => s.kind === 'connect' && s.host === host);
  if (svc) {
    $('#connectPort').value = svc.port;
    pairResult('ok', `Paired with ${host}. Found its connection port ${svc.port}; press Connect.`);
    $('#connectSubmit').focus();
  } else {
    $('#connectPort').focus();
  }
}

async function connectDevice(e) {
  e.preventDefault();
  if (!requireExe()) return;
  splitAddressInto($('#connectHost'), $('#connectPort'));
  const host = $('#connectHost').value.trim();
  const port = $('#connectPort').value.trim();
  const btn = $('#connectSubmit');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  log(`\n$ adb connect ${host}:${port}\n`, 'l-cmd');
  const r = await api.connect(host, port);
  btn.disabled = false;
  btn.textContent = 'Connect';
  log((r.output || '') + '\n', r.ok ? null : 'l-err');
  if (!r.ok) {
    pairResult('err', (r.output || 'Could not connect.') + '\nIf this phone was never paired with this PC, pair it first (step 1).');
    return;
  }
  settings.lastPairHost = host;
  api.setSettings({ lastPairHost: host });
  state.serial = { on: false, value: r.target };
  changed('serial');
  await refreshDevices();
  $('#pairDialog').close();
  toast(`Connected to ${r.target}. It is now the selected device.`);
}

// ---------- Process runs ----------
function log(text, cls) {
  const pre = $('#log');
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
  const lines = text.split(/(?<=\n)/);
  for (const line of lines) {
    let c = cls;
    if (!c) {
      if (/^(ERROR|FATAL):/.test(line)) c = 'l-err';
      else if (/^WARN:/.test(line)) c = 'l-warn';
    }
    pre.append(c ? el('span', { class: c }, line) : document.createTextNode(line));
  }
  while (pre.childNodes.length > 4000) pre.firstChild.remove();
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

function showLog(open = true) {
  $('#logPanel').hidden = !open;
  const b = $('#toggleLog');
  b.textContent = open ? 'Hide log' : 'Show log';
  b.setAttribute('aria-expanded', String(open));
}

function setStatus(stateName, text) {
  $('#status').dataset.state = stateName;
  $('#statusText').textContent = text;
}

function requireExe() {
  if (exe) return true;
  toast('Locate scrcpy.exe first.');
  $('#pickExe').focus();
  return false;
}

// ---------- Session: start / stop / restart ----------
let starting = false;

// Everything a running session was started with. When it differs from the
// current settings, the dock offers "Restart to apply".
function sessionKey() {
  return F.stableJson({
    args: sessionArgs(),
    resize: activeFit() === 'wm' ? [fitRes('wm'), state[WM_ORIENT]?.value ?? ''] : null,
    close: closeAppPlan(),
  });
}

async function start() {
  if (starting || session || !requireExe()) return;
  starting = true;
  updateStartButton();
  clearNotice();
  try {
    const args = sessionArgs();
    const key = sessionKey();
    setStatus('idle', 'Starting…');
    const resized = await resizePhoneForMonitor();
    if (resized === RESIZE_ABORT) {
      setStatus('error', 'Could not resize the phone');
      return;
    }
    log(`\n$ ${A.commandLine(exe, args)}\n`, 'l-cmd');
    const res = await api.run(args);
    if (res.error) {
      log(res.error + '\n', 'l-err');
      setStatus('error', 'Could not start');
      showNotice(res.error, [['Show log', () => showLog()]]);
      if (resized) await restorePhoneSize(resized);
      return;
    }
    session = {
      ...res, key, closeApp: closeAppPlan(), resized,
      newDisplay: isSet('new-display'), fps: null, skipped: 0, lastError: '',
    };
    setRunningStatus();
  } finally {
    starting = false;
    updateStartButton();
    updateSessionHint();
  }
}

async function stop() {
  if (!session || session.stopping) return;
  session.stopping = true;
  setStatus('idle', 'Stopping…');
  updateStartButton();
  await api.stop(session.id);
}

async function restart() {
  if (!session) return start();
  session.restartAfter = true;
  await stop();
}

function updateStartButton() {
  const b = $('#startStop');
  b.disabled = starting || !!session?.stopping;
  b.textContent = starting ? 'Starting…' : session ? (session.stopping ? 'Stopping…' : 'Stop') : 'Start mirroring';
  b.classList.toggle('stop', !!session);
  b.title = session ? 'Stop mirroring (Ctrl+Enter)' : 'Start mirroring (Ctrl+Enter)';
}

function setRunningStatus() {
  if (!session || session.stopping) return;
  let text = 'Running';
  if (session.fps != null) text += ` · ${session.fps} fps`;
  if (session.skipped) text += ` (${session.skipped} skipped)`;
  setStatus('running', text);
  $('#status').title = session.fps == null ? 'Turn on Print FPS (Video group) to see the frame rate here.' : '';
}

function updateSessionHint() {
  const dirty = !!session && !session.stopping && sessionKey() !== session.key;
  $('#restartBtn').hidden = !dirty;
}

// scrcpy error lines become a short "what to do" message (src/notices.js).
const NOTICE_ACTIONS = {
  pair: ['Pair over Wi-Fi…', () => openPairDialog()],
  device: ['Choose device', () => $('#deviceSelect').focus()],
  fit: ['Fill the monitor', () => scrollToSection('sec-fit')],
  quick: ['Quick setup', () => scrollToSection('sec-quick')],
  log: ['Show log', () => showLog()],
};

// The first matching line of `text`, as a notice. Returns true if shown.
function noticeFor(text, newDisplay) {
  for (const line of text.split(/\r?\n/)) {
    const n = ScrcpyNotices.match(line, { newDisplay });
    if (n) {
      showNotice(n.text, n.actions.map((a) => NOTICE_ACTIONS[a]).filter(Boolean));
      return true;
    }
  }
  return false;
}

let noticeSource = null;
function showNotice(text, actions = [], source = 'session') {
  noticeSource = source;
  $('#noticeText').textContent = text;
  $('#noticeActions').replaceChildren(...actions.map(([label, fn]) =>
    el('button', { class: 'btn small', type: 'button', onclick: fn }, label)));
  $('#notice').hidden = false;
}
function clearNotice() {
  noticeSource = null;
  $('#notice').hidden = true;
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

function scanSessionOutput(text) {
  for (const line of text.split(/\r?\n/)) {
    const fps = /\b(\d+) fps(?: \(\+(\d+) frames? skipped\))?/.exec(line);
    if (fps) {
      session.fps = +fps[1];
      session.skipped = fps[2] ? +fps[2] : 0;
      setRunningStatus();
      continue;
    }
    const err = /^(?:\[server\] )?(?:ERROR|FATAL):\s*(.*)$/.exec(line);
    if (err) session.lastError = err[1];
    noticeFor(line, session.newDisplay);
  }
}

async function runAction(key) {
  if (!requireExe()) return;
  const opt = byKey.get(key);
  // Keep the connection options so the right device answers, plus camera
  // options for --list-camera-sizes filters.
  const args = [...connectionArgs(), A.flagOf(opt)];
  showLog();
  log(`\n$ ${A.commandLine(exe, args)}\n`, 'l-cmd');
  const res = await api.run(args);
  if (res.error) return log(res.error + '\n', 'l-err');
  infoRuns.add(res.id);
}

// Runs whose output should not reach the log (the startup --version probe).
const quietRuns = new Set();

api.onOutput(({ id, text }) => {
  if (quietRuns.has(id)) return;
  log(text);
  if (session?.id === id) scanSessionOutput(text);
  else if (infoRuns.has(id)) noticeFor(text, false);
});

api.onExit(async ({ id, code, signal }) => {
  if (quietRuns.delete(id)) return;
  if (infoRuns.delete(id)) {
    log(`[exited with code ${code}]\n`, 'l-meta');
    return;
  }
  if (session?.id !== id) return;
  const ended = session;
  session = null;
  updateStartButton();
  updateSessionHint();
  if (ended.stopping || code === 0) {
    setStatus('idle', ended.stopping ? 'Stopped' : 'Exited');
    log(`[scrcpy ${ended.stopping ? 'stopped' : 'exited normally'}]\n`, 'l-meta');
  } else {
    setStatus('error', `Exited with code ${code ?? signal}`);
    log(`[scrcpy exited with code ${code ?? signal}]\n`, 'l-err');
    if ($('#notice').hidden) {
      showNotice(`scrcpy stopped with an error${ended.lastError ? ': ' + ended.lastError : '.'}`, [['Show log', () => showLog()]]);
    }
  }
  // Clean up on the phone before anything else touches it.
  if (ended.closeApp) await closeAppAfterExit(ended.closeApp);
  if (ended.resized) await restorePhoneSize(ended.resized);
  if (ended.restartAfter) start();
});

// Run scrcpy without logging, and resolve with its full output.
// `onStart(id)` lets the caller cancel it with api.stop(id).
async function captureRun(args, onStart) {
  const res = await api.run(args);
  if (res.error) return { code: -1, out: res.error };
  quietRuns.add(res.id);
  onStart?.(res.id);
  return new Promise((resolve) => {
    let out = '';
    const off = api.onOutput(({ id, text }) => { if (id === res.id) out += text; });
    const offExit = api.onExit(({ id, code }) => {
      if (id !== res.id) return;
      off();
      offExit();
      resolve({ code, out });
    });
  });
}

// Connection flags only, so a side run (--list-apps etc.) reaches the same
// device the session would.
function connectionArgs() {
  const keep = optionKeys.filter((k) => META.category[k] === 'connection' && k !== 'otg');
  return A.buildArgs(OPTIONS.filter((o) => keep.includes(A.keyOf(o))), state);
}

// The same device choice, in adb's own terms.
function adbSelector() {
  return F.adbSelector(state);
}

function deviceLabel() {
  const sel = adbSelector();
  if (sel[0] === '-s') {
    const d = devices.find((x) => x.serial === sel[1]);
    return d?.model ? `${d.model} (${sel[1]})` : sel[1];
  }
  if (sel[0] === '-d') return 'the USB device';
  if (sel[0] === '-e') return 'the TCP/IP device';
  const ready = devices.filter((d) => d.state === 'device');
  return ready.length === 1 ? `${ready[0].model || ready[0].serial}` : 'the connected device';
}

// ---------- Close the app when mirroring stops ----------
let appsCache = { key: null, apps: [] };

function closeAppPlan() {
  return F.closeAppPlan(state, appsCache.apps);
}

async function closeAppAfterExit(plan) {
  if (!plan.pkg) {
    log(`[did not close the app: ${plan.error}]\n`, 'l-warn');
    return;
  }
  const target = plan.selector.length ? plan.selector.join(' ') + ' ' : '';
  log(`$ adb ${target}shell am force-stop ${plan.pkg}\n`, 'l-cmd');
  const r = await api.forceStop(plan.selector, plan.pkg);
  if (r.output) log(r.output + '\n', r.ok ? null : 'l-err');
  log(r.ok ? `[closed ${plan.pkg} on the device]\n` : '[could not close the app]\n', r.ok ? 'l-meta' : 'l-err');
}

function renderCloseAppRow() {
  const key = CLOSE_APP;
  const label = 'Close the app when mirroring stops';
  const box = el('input', {
    type: 'checkbox', class: 'switch', id: controlId(key), 'aria-label': label,
    onchange: () => { entry(key).on = box.checked; changed(key); },
  });
  const text = el('span', { class: 'state-text' }, 'Off');
  const note = el('span', { class: 'note' });
  const desc = el('p', { class: 'opt-desc' },
    'When scrcpy exits, because you close the mirror window or press Stop, force-stop the app set in Start app.',
    el('span', { class: 'rest' },
      '\nThe launcher runs "adb shell am force-stop <package>" on the same device. This is not a scrcpy flag, so it is not part of the copied command.' +
      '\nWith --new-display, scrcpy already closes the apps on the virtual display when it exits, unless --no-vd-destroy-content is set.' +
      '\nA name search ("?firefox") is resolved from the app list, so pick the app with Browse apps once.'),
  );
  const more = el('button', {
    class: 'more', type: 'button', 'aria-expanded': 'false',
    onclick: () => {
      const open = desc.classList.toggle('open');
      more.textContent = open ? 'Less' : 'More';
      more.setAttribute('aria-expanded', String(open));
    },
  }, 'More');
  desc.append(more);

  const row = el('div', { class: 'opt', dataset: { key } },
    el('div', { class: 'opt-text' },
      el('div', { class: 'opt-title' },
        el('span', { class: 'opt-label' }, label),
        el('code', { class: 'flag launcher', title: 'A launcher setting, not a scrcpy flag' }, 'launcher'),
        note,
      ),
      desc,
    ),
    el('div', { class: 'opt-control' }, box, text),
  );
  const sync = () => {
    box.checked = !!state[key]?.on;
    text.textContent = box.checked ? 'On' : 'Off';
    const plan = closeAppPlan();
    note.textContent = plan && !plan.pkg ? (plan.error === 'set Start app' ? 'Set Start app above to use this.' : plan.error) : '';
    row.classList.toggle('is-set', box.checked);
  };
  rows.set(key, { row, sync, search: (label + ' close app force-stop kill exit launcher').toLowerCase() });
  sync();
  return row;
}

// ---------- Encoder tuning rows (see CODEC_ROWS) ----------
function renderCodecRow(c) {
  const key = codecRowKey(c.key);
  const id = controlId(key);
  const listId = id + '-list';
  const input = el('input', {
    class: 'input mono', id, type: 'text', inputmode: 'numeric', spellcheck: 'false', autocomplete: 'off',
    placeholder: c.placeholder, 'aria-label': c.label, list: listId,
  });
  const note = el('span', { class: 'note' });
  const write = (value) => {
    state[CODEC_OPTS] = { on: false, value: F.setCodecOption(state[CODEC_OPTS]?.value, c.key, value) };
    changed(CODEC_OPTS, key);
  };
  input.addEventListener('input', () => {
    const v = input.value.trim();
    if (v === '') { note.textContent = ''; write(null); return; }
    const n = Number(v);
    if (!/^\d+$/.test(v) || n < c.min || n > c.max) {
      note.textContent = `Use a whole number from ${c.min} to ${c.max}.`;
      return;
    }
    note.textContent = '';
    write(String(n));
  });
  const clear = el('button', {
    class: 'clear', type: 'button', title: 'Clear', 'aria-label': 'Clear ' + c.label,
    onclick: () => { input.value = ''; note.textContent = ''; write(null); },
  }, '×');

  const desc = el('p', { class: 'opt-desc' }, c.first, el('span', { class: 'rest' }, c.rest));
  const more = el('button', {
    class: 'more', type: 'button', 'aria-expanded': 'false',
    onclick: () => {
      const open = desc.classList.toggle('open');
      more.textContent = open ? 'Less' : 'More';
      more.setAttribute('aria-expanded', String(open));
    },
  }, 'More');
  desc.append(more);

  const row = el('div', { class: 'opt', dataset: { key } },
    el('div', { class: 'opt-text' },
      el('div', { class: 'opt-title' },
        el('span', { class: 'opt-label' }, c.label),
        el('code', { class: 'flag long', title: 'An entry in --video-codec-options' }, c.key + '=<n>'),
        c.def ? el('span', { class: 'default-chip' }, 'Default ' + c.def) : null,
        note,
      ),
      desc,
    ),
    el('div', { class: 'opt-control' },
      el('datalist', { id: listId }, c.suggestions.map((v) => el('option', { value: v }))),
      input, clear),
  );
  const sync = () => {
    const v = F.getCodecOption(state[CODEC_OPTS]?.value, c.key);
    // Keep an invalid entry the user is still typing.
    const typing = document.activeElement === input && note.textContent;
    if (!typing && input.value.trim() !== (v ?? '')) input.value = v ?? '';
    clear.hidden = v == null;
    row.classList.toggle('is-set', v != null);
  };
  rows.set(key, {
    row, sync,
    search: (c.label + ' ' + c.key + ' video codec options encoder quality blur blocky sharp qp key frame refresh').toLowerCase(),
  });
  sync();
  return row;
}

// ---------- App picker (--list-apps) ----------
let appRunId = null;

function openAppPicker() {
  if (!requireExe()) return;
  const d = $('#appDialog');
  const current = state['start-app']?.value?.trim() ?? '';
  $('#appRestart').checked = current.startsWith('+');
  $('#appSearch').value = '';
  $('#appDevice').textContent = `Apps on ${deviceLabel()}`;
  d.showModal();
  $('#appSearch').focus();
  const key = JSON.stringify(connectionArgs());
  if (appsCache.key === key && appsCache.apps.length) renderAppList();
  else loadApps();
}

async function loadApps() {
  const status = $('#appStatus');
  const list = $('#appList');
  const btn = $('#appRefresh');
  btn.disabled = true;
  status.dataset.kind = '';
  status.textContent = 'Reading the app list from the device. This can take a few seconds…';
  list.replaceChildren(el('li', { class: 'empty-row' }, 'Scanning…'));
  const args = [...connectionArgs(), '--list-apps'];
  const key = JSON.stringify(connectionArgs());
  const { code, out } = await captureRun(args, (id) => { appRunId = id; });
  appRunId = null;
  btn.disabled = false;
  const apps = ScrcpyApps.parseAppList(out);
  if (!apps.length) {
    const errors = out.split(/\r?\n/).filter((l) => /^(ERROR|WARN):/.test(l)).join('\n');
    status.dataset.kind = 'err';
    status.textContent = errors || (code === 0 ? 'The device returned no launchable apps.' : `scrcpy --list-apps failed (code ${code}).`);
    list.replaceChildren(el('li', { class: 'empty-row' }, 'No apps to show. Check the device connection, then Rescan.'));
    return;
  }
  appsCache = { key, apps };
  renderAppList();
  syncAll(); // a name search in Start app may now resolve
}

function renderAppList() {
  const q = $('#appSearch').value.trim().toLowerCase();
  const kind = document.querySelector('input[name="appKind"]:checked').value;
  const current = (state['start-app']?.value ?? '').trim().replace(/^\+/, '');
  const all = appsCache.apps;
  const shown = all
    .filter((a) => kind === 'all' || (kind === 'system') === a.system)
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.pkg.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const userCount = all.filter((a) => !a.system).length;
  const status = $('#appStatus');
  status.dataset.kind = '';
  status.textContent = `${all.length} launchable apps · ${userCount} installed, ${all.length - userCount} system. Showing ${shown.length}.`;

  const list = $('#appList');
  if (!shown.length) {
    list.replaceChildren(el('li', { class: 'empty-row' }, q ? `No app matches "${$('#appSearch').value.trim()}".` : 'No apps in this group.'));
    return;
  }
  list.replaceChildren(...shown.map((a) => el('li', { class: a.system ? 'system' : '' },
    el('button', {
      type: 'button',
      'aria-current': a.pkg === current ? 'true' : 'false',
      onclick: () => pickApp(a),
    },
    el('span', { class: 'app-avatar', 'aria-hidden': 'true' }, (a.name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase()),
    el('span', { class: 'app-text' }, el('span', { class: 'app-name' }, a.name), el('span', { class: 'app-pkg' }, a.pkg)),
    el('span', { class: 'app-tag' }, a.pkg === current ? 'Selected' : a.system ? 'System' : ''),
    ),
  )));
}

function pickApp(app) {
  const value = ($('#appRestart').checked ? '+' : '') + app.pkg;
  state['start-app'] = { on: false, value };
  $('#appDialog').close();
  changed('start-app');
  rows.get(CLOSE_APP)?.sync();
  toast(`Start app set to ${app.name}`);
}

// ---------- Fill the monitor ----------
// Two cards (virtual display / resize the phone screen). Each keeps its own
// resolution and fullscreen choice in launcher keys; the active card writes
// the matching scrcpy flags (--new-display, --fullscreen or
// --window-width/--window-height), so the flag list and the command stay the
// source of truth.
let monitor = null; // { width, height } in real pixels
let phoneSize = null; // physical size of the selected phone
let phoneDensity = null; // its current density (override or physical)
let phonePending = false; // still resized from an earlier session

const FIT = {
  vd: { res: '@vd-res', mode: '@vd-mode' },
  wm: { res: '@wm-res', mode: '@wm-mode' },
};

// "Landscape from the start" on the Resize card: the capture is locked to
// landscape (see F.ORIENT) and the phone is locked to the matching rotation
// while mirroring, so the window never changes shape.
const WM_ORIENT = '@wm-orient';
const RESIZE_ABORT = 'abort';

function readyDevice() {
  const sel = adbSelector();
  if (sel[0] === '-s') return devices.some((d) => d.serial === sel[1] && d.state === 'device');
  return devices.some((d) => d.state === 'device');
}

function activeFit() {
  if (isSet('new-display')) return 'vd';
  if (state[FIT_WM]?.on) return 'wm';
  return null;
}

function nativeRes() {
  return monitor ? ScrcpyFit.virtualDisplaySize(monitor) : '1920x1080';
}

function fitRes(card) {
  if (card === 'vd' && isSet('new-display')) {
    const m = /^(\d+x\d+)/.exec(state['new-display'].value ?? '');
    if (m) return m[1];
  }
  return state[FIT[card].res]?.value || nativeRes();
}

function fitFullscreen(card) {
  return (state[FIT[card].mode]?.value || 'fullscreen') === 'fullscreen';
}

// Every key the cards can touch, so one redraw covers them all.
const FIT_KEYS = ['new-display', 'fullscreen', 'window-width', 'window-height', FIT_WM,
  '@vd-res', '@vd-mode', '@wm-res', '@wm-mode', WM_ORIENT, 'capture-orientation', F.EXACT,
  'display-id', 'no-video', 'crop', 'video-source'];

function wmOrient() {
  return F.ORIENT[state[WM_ORIENT]?.value] ?? null;
}

function fitChanged() {
  changed(...FIT_KEYS);
}

// Write the scrcpy flags for the active card.
function applyFitFlags() {
  const card = activeFit();
  if (!card) return;
  const res = ScrcpyFit.parseRes(fitRes(card));
  if (!res) return;
  F.applyFit(state, { card, res, fullscreen: fitFullscreen(card), orient: state[WM_ORIENT]?.value ?? '' });
}

function enableVirtualDisplay(on) {
  if (on) {
    if (state[FIT_WM]?.on) F.disableFit(state, 'wm');
    delete state[FIT_WM];
    state['new-display'] = { on: true, value: fitRes('vd') };
    const cleared = F.clearVirtualDisplayConflicts(state, isSet);
    if (cleared.length) log(`[virtual display: cleared ${cleared.join(', ')}, which cannot be combined with it]\n`, 'l-meta');
    applyFitFlags();
  } else {
    F.disableFit(state, 'vd');
  }
  fitChanged();
  if (on && !isSet('start-app')) {
    toast('Virtual display on. Now pick the game to start.');
    openAppPicker();
  }
}

function enablePhoneResize(on) {
  if (on) {
    if (isSet('new-display')) F.disableFit(state, 'vd');
    state[FIT_WM] = { on: true, value: '' };
    applyFitFlags();
  } else {
    delete state[FIT_WM];
    F.disableFit(state, 'wm');
  }
  fitChanged();
}

function setFitRes(card, value) {
  state[FIT[card].res] = { on: false, value };
  if (activeFit() === card) applyFitFlags();
  fitChanged();
}

function setFitFullscreen(card, fullscreen) {
  state[FIT[card].mode] = { on: false, value: fullscreen ? 'fullscreen' : 'window' };
  if (activeFit() === card) applyFitFlags();
  fitChanged();
}

function wmPlanNow() {
  if (!phoneSize || !phoneDensity) return null;
  return ScrcpyFit.wmPlan(phoneSize, phoneDensity, fitRes('wm'));
}

// Card UI from state.
function renderFitCard(card) {
  const active = activeFit() === card;
  const res = fitRes(card);
  const fs = fitFullscreen(card);
  const choices = monitor ? ScrcpyFit.resolutionChoices(monitor, card === 'wm' ? phoneSize : null) : [];

  $(`#${card}On`).checked = active;
  $(`#${card}Card`).classList.toggle('active', active);

  const sel = $(`#${card}Res`);
  const known = choices.some((c) => c.value === res);
  sel.replaceChildren(
    ...choices.map((c) => el('option', { value: c.value, disabled: c.disabled }, c.label)),
    el('option', { value: 'custom' }, known ? 'Custom…' : `Custom: ${res.replace('x', ' × ')}`),
  );
  const customOpen = !known || sel.dataset.custom === '1';
  sel.value = customOpen ? 'custom' : res;
  $(`#${card}Custom`).hidden = !customOpen;
  const r = ScrcpyFit.parseRes(res);
  if (customOpen && r && document.activeElement !== $(`#${card}W`) && document.activeElement !== $(`#${card}H`)) {
    $(`#${card}W`).value = r.width;
    $(`#${card}H`).value = r.height;
  }
  $(`#${card}Fs`).checked = fs;
  if (card === 'wm') $('#wmOrient').value = state[WM_ORIENT]?.value ?? '';

  // What it will do: one "Runs" line and at most one note, most important
  // first.
  const shown = r ? `${r.width} × ${r.height}` : res;
  const o = card === 'wm' ? wmOrient() : null;
  const plan = card === 'wm' ? wmPlanNow() : null;
  const flags = [
    card === 'vd' ? `--new-display=${res}` : null,
    fs ? '--fullscreen' : r ? `--window-width=${r.width} --window-height=${r.height}` : null,
    o ? `--capture-orientation=${o.capture}` : null,
    r && (r.width % 16 || r.height % 16) ? '--ignore-video-encoder-constraints' : null,
  ].filter(Boolean).join(' ');
  const runs = [el('span', { class: 'eyebrow' }, active ? 'Runs' : 'Will run'), el('code', {}, flags)];
  if (plan && !plan.error) {
    runs.push(el('br'), el('span', { class: 'eyebrow' }, 'Phone'),
      el('code', {}, `wm size ${plan.size}${plan.density ? ', density ' + plan.density : ''}${o ? ', rotation ' + o.rotation : ''}`));
  }
  let note = null;
  if (plan?.error) note = el('span', { class: 'warn' }, plan.error);
  else if (!fs && r && monitor && (r.width >= monitor.width || r.height >= monitor.height)) {
    note = el('span', { class: 'warn' }, 'A window this big does not fit with its title bar. Use Fullscreen or a smaller size.');
  } else if (card === 'wm' && !o && !fs) {
    note = 'The window changes shape when the game turns landscape. Choose "Landscape from the start" to avoid that.';
  } else if (o) {
    note = 'If the game shows upside down, choose the other landscape.';
  } else if (fs && r && monitor && (r.width !== monitor.width || r.height !== monitor.height)) {
    note = `Fullscreen stretches ${shown} to ${monitor.width} × ${monitor.height}, so it looks softer.`;
  } else if (!fs && r) {
    note = `Opens a ${shown} window.`;
  }
  $(`#${card}Effect`).replaceChildren(...runs);
  $(`#${card}Note`).replaceChildren(...(note ? [note] : []));
  $(`#${card}Note`).hidden = !note;
}

function syncFit() {
  if (!$('#vdRes')) return;
  renderFitCard('vd');
  renderFitCard('wm');
}

async function updateFitFacts() {
  monitor = await api.screenSize();
  phoneSize = null;
  phoneDensity = null;
  phonePending = false;
  let override = null;
  if (exe && readyDevice()) {
    const r = await api.wmRead(adbSelector());
    if (r.ok) {
      phoneSize = r.size.physical;
      override = r.size.override;
      phonePending = !!r.pending;
      // Density at the physical size: while resized by the launcher, the
      // current override is ours, so the saved one does not apply here.
      phoneDensity = phonePending ? r.density.physical : (r.density.override ?? r.density.physical);
    }
  }
  const parts = [el('span', {}, 'Monitor ', el('b', {}, `${monitor.width}x${monitor.height}`), ` (${ScrcpyFit.ratioLabel(monitor)})`)];
  if (phoneSize) {
    parts.push(' · ', el('span', {}, 'Phone ', el('b', {}, `${phoneSize.width}x${phoneSize.height}`),
      ` (${ScrcpyFit.ratioLabel(phoneSize)}), ${phoneDensity} dpi`));
    const bars = ScrcpyFit.barsFor(phoneSize, monitor);
    parts.push(' · ', bars
      ? el('span', { class: 'warn' }, `Plain mirroring in landscape leaves ${bars.each} px bars ${bars.where}.`)
      : el('span', { class: 'good' }, 'Same shape as the monitor: no bars.'));
    if (phonePending) {
      parts.push(' · ', el('span', { class: 'warn' }, 'The phone is still resized from an earlier session. Use Restore phone screen now.'));
    } else if (override) {
      parts.push(' · ', el('span', {}, `The phone already has a size override of ${override.width}x${override.height}.`));
    }
  } else {
    parts.push(' · ', el('span', {}, 'Connect a device to see its size.'));
  }
  $('#fitFacts').replaceChildren(...parts);
  syncFit();
  renderCommand();
}

// Before a session: resize the phone screen if that card is on. Returns the
// selector to restore later, null when nothing changed, or RESIZE_ABORT.
async function resizePhoneForMonitor() {
  if (activeFit() !== 'wm') return null;
  const selector = adbSelector();
  let cur = await api.wmRead(selector);
  if (cur.ok && cur.pending) {
    // Left resized by an earlier session: restore first, so the plan starts
    // from the phone's real settings.
    await restorePhoneSize(selector, false);
    cur = await api.wmRead(selector);
  }
  if (!cur.ok) {
    log(`[could not read the phone screen size: ${cur.output}]\n`, 'l-err');
    showLog();
    return RESIZE_ABORT;
  }
  const base = cur.density.override ?? cur.density.physical;
  const plan = ScrcpyFit.wmPlan(cur.size.physical, base, fitRes('wm'));
  if (plan.error) {
    log(`[resize the phone screen: ${plan.error}]\n`, 'l-err');
    showLog();
    toast(plan.error);
    return RESIZE_ABORT;
  }
  const target = selector.length ? selector.join(' ') + ' ' : '';
  log(`\n$ adb ${target}shell wm size ${plan.size}\n`, 'l-cmd');
  if (plan.density) log(`$ adb ${target}shell wm density ${plan.density}\n`, 'l-cmd');
  const orient = wmOrient();
  if (orient) {
    log(`$ adb ${target}shell settings put system accelerometer_rotation 0\n`, 'l-cmd');
    log(`$ adb ${target}shell settings put system user_rotation ${orient.rotation}\n`, 'l-cmd');
  }
  const r = await api.fitApply(selector, plan.size, plan.density, orient ? orient.rotation : null);
  if (r.output) log(r.output + '\n', r.ok ? null : 'l-err');
  if (!r.ok) {
    showLog();
    await restorePhoneSize(selector, false);
    return RESIZE_ABORT;
  }
  return selector;
}

async function restorePhoneSize(selector, refresh = true) {
  const r = await api.fitRestore(selector);
  if (r.output) log(r.output + '\n', r.ok ? 'l-cmd' : 'l-err');
  log(r.ok ? '[phone screen restored]\n' : '[could not restore the phone screen]\n', r.ok ? 'l-meta' : 'l-err');
  if (refresh) updateFitFacts();
}

function wireFit() {
  $('#vdOn').addEventListener('change', (e) => enableVirtualDisplay(e.target.checked));
  $('#wmOn').addEventListener('change', (e) => enablePhoneResize(e.target.checked));
  for (const card of ['vd', 'wm']) {
    const sel = $(`#${card}Res`);
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') {
        sel.dataset.custom = '1';
        $(`#${card}Custom`).hidden = false;
        const r = ScrcpyFit.parseRes(fitRes(card));
        if (r) { $(`#${card}W`).value = r.width; $(`#${card}H`).value = r.height; }
        $(`#${card}W`).focus();
        return;
      }
      sel.dataset.custom = '';
      setFitRes(card, sel.value);
    });
    const onCustom = () => {
      const w = parseInt($(`#${card}W`).value, 10);
      const h = parseInt($(`#${card}H`).value, 10);
      if (w >= 64 && h >= 64 && w <= 7680 && h <= 4320) setFitRes(card, `${w}x${h}`);
    };
    $(`#${card}W`).addEventListener('change', onCustom);
    $(`#${card}H`).addEventListener('change', onCustom);
    $(`#${card}Fs`).addEventListener('change', (e) => setFitFullscreen(card, e.target.checked));
  }
  {
    const sel = $('#wmOrient');
    sel.addEventListener('change', () => {
      state[WM_ORIENT] = { on: false, value: sel.value };
      if (activeFit() === 'wm') applyFitFlags();
      fitChanged();
    });
  }
  $('#fitWmReset').addEventListener('click', async () => {
    if (!requireExe()) return;
    showLog();
    await restorePhoneSize(adbSelector());
  });
}

// ---------- Executable ----------
function showExe() {
  const span = $('#exePath');
  span.classList.toggle('missing', !exe);
  span.textContent = exe ?? 'Not found. Locate scrcpy.exe';
  span.title = exe ?? '';
  renderCommand();
}

// ---------- Profiles ----------
function renderProfiles() {
  const sel = $('#profileSelect');
  const names = Object.keys(settings.profiles ?? {}).sort((a, b) => a.localeCompare(b));
  sel.replaceChildren(el('option', { value: '' }, 'Unsaved'), ...names.map((n) => el('option', { value: n }, n)));
  sel.value = settings.lastProfile && names.includes(settings.lastProfile) ? settings.lastProfile : '';
  $('#deleteProfile').disabled = !sel.value;
  markProfileDirty();
}

function markProfileDirty() {
  const sel = $('#profileSelect');
  const name = sel.value;
  const opt = name && [...sel.options].find((o) => o.value === name);
  const dirty = !!opt && F.stableJson(settings.profiles?.[name] ?? {}) !== F.stableJson(state);
  if (opt) opt.textContent = dirty ? `${name} (edited)` : name;
  const save = $('#saveProfileNow');
  save.disabled = !dirty;
  save.title = opt ? `Save the changes to "${name}"` : 'Choose a profile first, or use Save as…';
}

async function saveProfile(name) {
  settings.profiles = { ...(settings.profiles ?? {}), [name]: structuredClone(state) };
  settings.lastProfile = name;
  await api.setSettings({ profiles: settings.profiles, lastProfile: name });
  renderProfiles();
  toast(`Saved profile "${name}"`);
}

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- Wiring ----------
function wire() {
  $('#search').addEventListener('input', applyFilter);
  $('#onlySet').addEventListener('change', applyFilter);
  $('#main').addEventListener('scroll', markCurrentNav, { passive: true });
  $('#navList').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.target)?.scrollIntoView({ block: 'start' });
  });

  $('#deviceSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) state.serial = { on: false, value: v };
    else delete state.serial;
    changed('serial');
  });
  $('#refreshDevices').addEventListener('click', refreshDevices);

  $('#openPair').addEventListener('click', openPairDialog);

  wireFit();

  const appDialog = $('#appDialog');
  $('#appClose').addEventListener('click', () => appDialog.close());
  appDialog.addEventListener('close', () => { if (appRunId) api.stop(appRunId); });
  appDialog.addEventListener('click', (e) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
  });
  $('#appSearch').addEventListener('input', () => { if (appsCache.apps.length) renderAppList(); });
  for (const r of document.querySelectorAll('input[name="appKind"]')) {
    r.addEventListener('change', () => { if (appsCache.apps.length) renderAppList(); });
  }
  $('#appRefresh').addEventListener('click', loadApps);
  $('#appSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#appList button')?.click();
    }
  });
  $('#pairClose').addEventListener('click', () => $('#pairDialog').close());
  $('#pairDialog').addEventListener('click', (e) => {
    // Clicks on the backdrop land on the <dialog> itself, outside its box.
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) e.currentTarget.close();
  });
  $('#pairScan').addEventListener('click', scanNetwork);
  $('#pairForm').addEventListener('submit', pairDevice);
  $('#connectForm').addEventListener('submit', connectDevice);
  $('#pairHost').addEventListener('change', () => {
    splitAddressInto($('#pairHost'), $('#pairPort'));
    if (!$('#connectHost').value) $('#connectHost').value = $('#pairHost').value.trim();
  });
  $('#connectHost').addEventListener('change', () => splitAddressInto($('#connectHost'), $('#connectPort')));
  $('#pairCode').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });

  $('#pickExe').addEventListener('click', async () => {
    const r = await api.pick();
    if (!r) return;
    exe = r.exe;
    showExe();
    loadVersion();
    refreshDevices();
  });

  $('#startStop').addEventListener('click', () => (session ? stop() : start()));
  $('#toggleLog').addEventListener('click', () => showLog($('#logPanel').hidden));
  $('#clearLog').addEventListener('click', () => $('#log').replaceChildren());
  $('#copyCmd').addEventListener('click', async () => {
    const text = A.commandLine(exe ?? 'scrcpy', sessionArgs());
    try {
      await navigator.clipboard.writeText(text);
      toast('Command copied');
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('#cmdLine'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('Press Ctrl+C to copy the selected command');
    }
  });

  $('#resetAll').addEventListener('click', () => {
    if (!Object.keys(state).length) return toast('Nothing to clear');
    const previous = state;
    state = {};
    syncAll();
    markProfileDirty();
    api.setSettings({ lastState: state });
    toastUndo('All options cleared', () => {
      state = previous;
      syncAll();
      markProfileDirty();
      api.setSettings({ lastState: state });
    });
  });

  $('#profileSelect').addEventListener('change', async (e) => {
    const name = e.target.value;
    $('#deleteProfile').disabled = !name;
    settings.lastProfile = name;
    if (name) {
      state = structuredClone(settings.profiles[name]);
      syncAll();
      toast(`Loaded profile "${name}"`);
    }
    await api.setSettings({ lastProfile: name, lastState: state });
    markProfileDirty();
  });

  const form = $('#profileForm');
  $('#saveProfile').addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) {
      $('#profileName').value = $('#profileSelect').value;
      $('#profileName').focus();
      $('#profileName').select();
    }
  });
  $('#profileCancel').addEventListener('click', () => { form.hidden = true; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#profileName').value.trim();
    if (!name) return $('#profileName').focus();
    form.hidden = true;
    await saveProfile(name);
  });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') form.hidden = true; });

  $('#saveProfileNow').addEventListener('click', () => {
    const name = $('#profileSelect').value;
    if (name) saveProfile(name);
  });

  $('#deleteProfile').addEventListener('click', async () => {
    const name = $('#profileSelect').value;
    if (!name) return;
    const removed = settings.profiles[name];
    delete settings.profiles[name];
    settings.lastProfile = '';
    await api.setSettings({ profiles: settings.profiles, lastProfile: '' });
    renderProfiles();
    // Undo puts back exactly what was deleted, not the current options.
    toastUndo(`Deleted profile "${name}"`, async () => {
      settings.profiles = { ...(settings.profiles ?? {}), [name]: removed };
      settings.lastProfile = name;
      await api.setSettings({ profiles: settings.profiles, lastProfile: name });
      renderProfiles();
      toast(`Restored profile "${name}"`);
    });
  });

  $('#restartBtn').addEventListener('click', restart);
  $('#noticeClose').addEventListener('click', clearNotice);
  $('#themeSelect').addEventListener('change', (e) => {
    settings.theme = e.target.value;
    api.setSettings({ theme: e.target.value });
  });

  // adb reports devices coming and going; keep the list current.
  let devicesTimer = null;
  api.onDevicesChanged(() => {
    clearTimeout(devicesTimer);
    devicesTimer = setTimeout(refreshDevices, 200);
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#search').focus();
      $('#search').select();
    }
    if (e.ctrlKey && e.key === 'Enter' && !$('#pairDialog').open && !$('#appDialog').open) {
      e.preventDefault();
      session ? stop() : start();
    }
  });
}

function toastUndo(msg, undo) {
  const t = $('#toast');
  t.replaceChildren(msg, ' ', el('button', {
    class: 'btn small primary', type: 'button',
    onclick: () => { t.hidden = true; undo(); },
  }, 'Undo'));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

async function loadVersion() {
  if (!exe) return;
  const { out } = await captureRun(['--version']);
  const first = out.split(/\r?\n/).find((l) => /^scrcpy\s/.test(l));
  if (first) $('#versionLine').textContent = first.replace(/<.*?>/g, '').trim();
}

async function init() {
  settings = await api.getSettings();
  state = settings.lastState ?? {};
  for (const k of Object.keys(state)) if (!byKey.has(k) && !k.startsWith('@')) delete state[k];

  renderSections();
  renderActions();
  renderProfiles();
  $('#themeSelect').value = settings.theme ?? 'system';
  wire();
  syncAll();
  updateStartButton();

  const loc = await api.locate();
  exe = loc.exe;
  showExe();
  loadVersion();
  refreshDevices();
}

init();
