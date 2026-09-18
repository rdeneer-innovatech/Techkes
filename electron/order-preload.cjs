// Prompt: show GitHub-order navigation progress in the order browser.
// Reason: keep the third-party restaurant page isolated from Electron APIs.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('techkesOrder', {
  progress: event => ipcRenderer.send('order-progress', event)
});
