'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  backup: {
    save: (json, filename, folder) =>
      ipcRenderer.invoke('backup:save', json, filename, folder),
    chooseFolder: () => ipcRenderer.invoke('backup:choose-folder'),
  },
});
