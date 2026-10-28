// The only bridge into the page: it can report what's playing, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('baesDesktop', {
  setNowPlaying: (np) => ipcRenderer.send('now-playing', np),
});
