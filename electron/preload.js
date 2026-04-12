const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cjmarineElectron', {
  sendReceiptEmail: (payload) => ipcRenderer.invoke('receipts:send-email', payload)
});
