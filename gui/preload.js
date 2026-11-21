// Narrow bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (fn) => {
  const h = (_e, msg) => fn(msg);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('scrcpy', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setSettingsNow: (patch) => ipcRenderer.sendSync('settings:setSync', patch),
  locate: () => ipcRenderer.invoke('scrcpy:locate'),
  pick: () => ipcRenderer.invoke('scrcpy:pick'),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  devices: () => ipcRenderer.invoke('adb:devices'),
  pair: (host, port, code) => ipcRenderer.invoke('adb:pair', { host, port, code }),
  connect: (host, port) => ipcRenderer.invoke('adb:connect', { host, port }),
  mdns: () => ipcRenderer.invoke('adb:mdns'),
  forceStop: (selector, pkg) => ipcRenderer.invoke('adb:forceStop', { selector, pkg }),
  wmRead: (selector) => ipcRenderer.invoke('adb:wmRead', { selector }),
  fitApply: (selector, size, density, rotation = null) => ipcRenderer.invoke('adb:fitApply', { selector, size, density, rotation }),
  fitRestore: (selector) => ipcRenderer.invoke('adb:fitRestore', { selector }),
  screenSize: () => ipcRenderer.invoke('screen:current'),
  run: (args) => ipcRenderer.invoke('scrcpy:run', args),
  stop: (id) => ipcRenderer.invoke('scrcpy:stop', id),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onOutput: listen('scrcpy:output'),
  onExit: listen('scrcpy:exit'),
  onDevicesChanged: listen('adb:devices-changed'),
});
