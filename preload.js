'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  search: items => ipcRenderer.invoke('search', items),
  open: (url, browser) => ipcRenderer.invoke('open', url, browser),
  exportCsv: csv => ipcRenderer.invoke('export', csv),
  download: (url, name) => ipcRenderer.invoke('dl', url, name),
  diag: () => ipcRenderer.invoke('diag'),
  verifyGoogle: () => ipcRenderer.invoke('verifyGoogle'),
  onNotice: cb => ipcRenderer.on('notice', (_, t) => cb(t)),
  copy: text => ipcRenderer.invoke('copy', text),
  pickDir: () => ipcRenderer.invoke('pickdir'),
  onEvent: cb => ipcRenderer.on('evt', (_, e) => cb(e)),
});
