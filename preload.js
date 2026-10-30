const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rq', {
  onSnapshot: (cb) => ipcRenderer.on('snapshot', (_e, s) => cb(s)),
  interactive: (on) => ipcRenderer.send('overlay:interactive', on),
  dragStart: () => ipcRenderer.send('overlay:drag-start'),
  drag: (dx, dy) => ipcRenderer.send('overlay:drag', dx, dy),
  dragEnd: () => ipcRenderer.send('overlay:drag-end'),
  action: (name) => ipcRenderer.send('overlay:action', name),
  onCalibInit: (cb) => ipcRenderer.on('calib:init', (_e, d) => cb(d)),
  calibDone: (rect) => ipcRenderer.send('calib:done', rect),
  calibCancel: () => ipcRenderer.send('calib:cancel'),
});
