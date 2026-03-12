const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apexSetup', {
    runStep: (data) => ipcRenderer.invoke('run-setup-step', data),
    onLog: (callback) => ipcRenderer.on('setup-log', (_, msg) => callback(msg)),
    launchApp: () => ipcRenderer.invoke('setup-complete-launch')
});
