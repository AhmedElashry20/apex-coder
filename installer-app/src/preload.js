const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('installer', {
    startInstall: () => ipcRenderer.invoke('start-install'),
    openApex: () => ipcRenderer.invoke('open-apex'),
    onProgress: (cb) => ipcRenderer.on('install-progress', (_, data) => cb(data)),
    onLog: (cb) => ipcRenderer.on('install-log', (_, msg) => cb(msg))
});
