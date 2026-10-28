const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DiscordPresence } = require('./discord.cjs');

const APP_URL = process.env.BAES_URL ?? 'https://music.sebby.dev';
// Application ID from discord.com/developers (not a secret). Its name is what
// Discord shows after "Listening to", and its "baes" art asset is the image.
const DISCORD_CLIENT_ID = process.env.BAES_DISCORD_CLIENT_ID ?? '';

// ---- settings (userData/settings.json) ----

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    return { discord: true, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { discord: true };
  }
}
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch {
    // not worth failing over
  }
}

// ---- Discord Rich Presence ----

let presence = null;
let settings = { discord: true };

/** Discord wants 2–128 characters per field. */
const field = (s) => {
  const t = String(s ?? '').slice(0, 128);
  return t.length >= 2 ? t : `${t}\u200b`.padEnd(2, '\u200b');
};

function toActivity(np) {
  if (!np || typeof np.title !== 'string') return null;
  const rate = Number(np.rate) > 0 ? Number(np.rate) : 1;
  const position = Math.max(0, Number(np.positionSec) || 0);
  const duration = Math.max(0, Number(np.durationSec) || 0);
  const start = Date.now() - (position / rate) * 1000;
  return {
    type: 2, // "Listening to"
    details: field(np.title),
    state: field(np.artist || 'Unknown artist'),
    timestamps: duration
      ? { start: Math.round(start), end: Math.round(start + (duration / rate) * 1000) }
      : { start: Math.round(start) },
    assets: { large_image: 'baes', large_text: field(np.album || 'bæs') },
    instance: false,
  };
}

ipcMain.on('now-playing', (event, np) => {
  // Only the bæs page may set presence.
  if (!event.senderFrame?.url.startsWith(APP_URL)) return;
  if (presence && settings.discord) presence.set(toActivity(np));
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    // Native macOS material shows through wherever the page leaves transparency.
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.loadURL(APP_URL);

  // Keep the app single-origin; external links (e.g. open.spotify.com) go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  settings = loadSettings();
  presence = new DiscordPresence(DISCORD_CLIENT_ID, (...a) => console.warn(...a));
  // Standard menu so Cmd+R / Cmd+C / Cmd+Q work; the window has no menu bar UI.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Show What I’m Playing in Discord',
            type: 'checkbox',
            checked: settings.discord,
            enabled: Boolean(DISCORD_CLIENT_ID),
            click: (item) => {
              settings.discord = item.checked;
              saveSettings(settings);
              if (!item.checked) presence.set(null);
            },
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => presence?.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
