// Prompt: create the three-option Electron app.
// Reason: expose only the launcher actions to the isolated page.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('techkes', {
  scan: input => ipcRenderer.invoke('scan', input),
  order: () => ipcRenderer.invoke('order'),
  close: () => ipcRenderer.invoke('close'),
  onLog: callback => ipcRenderer.on('scan-log', (_event, text) => callback(text)),
  // Prompt: display big-order progress. Reason: surface cart failures to the operator.
  onOrderLog: callback => ipcRenderer.on('order-log', (_event, text) => callback(text)),
  // Prompt: grow the launcher when the scan panel opens.
  // Reason: the scan form is taller than the compact 300px window, so the
  // Start scan button would otherwise sit below the fold.
  setScanPanelOpen: open => ipcRenderer.invoke('scan-panel', !!open),
  // Prompt: drive the progress bars and menu preview from parsed events.
  // Reason: structured scan progress cannot be drawn from raw log text.
  onProgress: callback => ipcRenderer.on('scan-progress', (_event, update) => callback(update))
});
