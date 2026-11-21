// Parses `scrcpy --list-apps` output and resolves a --start-app value to a
// package name. Shared by the renderer and Node tests.
//
// The server prints (LogUtils.buildAppListMessage):
//   [server] INFO: List of apps:
//    * System App Name               com.android.settings
//    - User App                      org.mozilla.firefox
//    - A name of 30 characters or more
//                                    com.example.longname
// '*' marks system apps, '-' user apps. Names shorter than 30 characters are
// padded so at least two spaces separate them from the package name.
(function (root) {
  const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

  // A log line from the client or the server ends the list.
  const LOG_LINE = /^(\[server\] )?(VERBOSE|DEBUG|INFO|WARN|ERROR|FATAL):/;
  // "<name part>  <package>": the package is the last token, after at least
  // two spaces (the padding). The name part may be empty (indented line).
  const WITH_PKG = /^(.*?)\s{2,}(\S+)$/;

  function parseAppList(text) {
    const apps = [];
    let pending = null; // entry whose package has not been seen yet
    let inList = false;
    for (const raw of String(text).split(/\r?\n/)) {
      if (!inList) {
        if (/List of apps:/.test(raw)) inList = true;
        continue;
      }
      if (LOG_LINE.test(raw)) break;
      const line = raw.replace(/\s+$/, '');
      if (!line) continue;

      const start = /^ ([*-]) (.*)$/.exec(line);
      if (start) {
        const system = start[1] === '*';
        const m = WITH_PKG.exec(start[2]);
        if (m && PKG.test(m[2])) {
          apps.push({ name: m[1].trim(), pkg: m[2], system });
          pending = null;
        } else {
          // Name of 30+ characters, or a name containing a line break: the
          // package follows on a later line.
          pending = { name: start[2].trim(), system };
        }
        continue;
      }

      if (!pending) continue;
      const m = WITH_PKG.exec(line);
      if (m && PKG.test(m[2])) {
        const rest = m[1].trim();
        apps.push({ ...pending, name: rest ? `${pending.name} ${rest}` : pending.name, pkg: m[2] });
        pending = null;
      } else {
        pending.name += ' ' + line.trim();
      }
    }
    return apps;
  }

  // Returns { pkg } or { error }. Mirrors scrcpy's --start-app syntax:
  // optional '+' (force-stop first), optional '?' (match by app name prefix,
  // case-insensitive).
  function resolveStartApp(value, apps) {
    let v = String(value ?? '').trim();
    if (!v) return { error: 'Start app is not set.' };
    if (v.startsWith('+')) v = v.slice(1);
    if (!v.startsWith('?')) {
      return PKG.test(v) ? { pkg: v } : { error: `"${v}" is not a package name.` };
    }
    const q = v.slice(1).toLowerCase();
    if (!apps || !apps.length) return { error: `"${v}" is a name search. Browse apps once so the launcher knows which package it means.` };
    const hits = apps.filter((a) => a.name.toLowerCase().startsWith(q));
    if (hits.length === 1) return { pkg: hits[0].pkg };
    if (!hits.length) return { error: `No app name starts with "${v.slice(1)}".` };
    return { error: `"${v.slice(1)}" matches ${hits.length} apps. Pick one with Browse apps.` };
  }

  const api = { parseAppList, resolveStartApp, PKG };
  root.ScrcpyApps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
