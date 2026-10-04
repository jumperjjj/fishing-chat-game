const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  copyOverlayUrl: () => ipcRenderer.invoke('copy-overlay-url'),
  completeTwitchDeviceAuth: (payload) => ipcRenderer.invoke('twitch-complete-device-auth', payload)
});
