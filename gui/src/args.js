// Builds the scrcpy argument vector from the GUI state.
// Shared by the renderer (plain <script>) and Node tests (require).
//
// state: { [key]: { on?: boolean, value?: string } }
//   key is the long option name, or "-X" for short-only flags.
//
// Flags are always emitted in the attached form (--name=value). getopt_long
// only reads the value of an optional-argument option when it is attached
// with '=', and the attached form is unambiguous for required ones too.
(function (root) {
  function keyOf(opt) {
    return opt.name || '-' + opt.short;
  }

  function flagOf(opt) {
    return opt.name ? '--' + opt.name : '-' + opt.short;
  }

  function isActive(opt, entry) {
    if (!entry) return false;
    const value = (entry.value ?? '').trim();
    if (opt.arg === 'none') return !!entry.on;
    if (opt.arg === 'required') return value !== '';
    return !!entry.on; // optional: on/off, value may be empty
  }

  function argFor(opt, entry) {
    const flag = flagOf(opt);
    const value = (entry.value ?? '').trim();
    if (opt.arg === 'none') return flag;
    if (opt.arg === 'optional' && value === '') return flag;
    return flag + '=' + value;
  }

  // `exclude` is a list of keys to leave out (e.g. the list-* actions).
  function buildArgs(options, state, exclude = []) {
    const args = [];
    for (const opt of options) {
      const key = keyOf(opt);
      if (exclude.includes(key)) continue;
      const entry = state[key];
      if (isActive(opt, entry)) args.push(argFor(opt, entry));
    }
    return args;
  }

  // Quote one argument the way the Windows C runtime parses a command line,
  // so the preview can be pasted into cmd or PowerShell.
  function quoteArg(arg) {
    if (arg !== '' && !/[\s"]/.test(arg)) return arg;
    let out = '"';
    let backslashes = 0;
    for (const ch of arg) {
      if (ch === '\\') { backslashes++; continue; }
      if (ch === '"') { out += '\\'.repeat(backslashes * 2 + 1) + '"'; backslashes = 0; continue; }
      out += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
    return out + '\\'.repeat(backslashes * 2) + '"';
  }

  function commandLine(exe, args) {
    return [exe, ...args].map(quoteArg).join(' ');
  }

  const api = { keyOf, flagOf, isActive, buildArgs, quoteArg, commandLine };
  root.ScrcpyArgs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
