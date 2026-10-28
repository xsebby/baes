const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DiscordPresence } = require('./discord.cjs');

const APP_URL = process.env.BAES_URL ?? 'https://music.sebby.dev';
// Application ID from discord.com/developers (not a secret). Its name is what
// Discord shows after "Listening to"; the image is the song's cover.
const DISCORD_CLIENT_ID = process.env.BAES_DISCORD_CLIENT_ID ?? '1565138664474808350';

// ---- settings (userData/settings.json) ----

const DEFAULT_SETTINGS = { discord: true, openAtLogin: true };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
let settings = { ...DEFAULT_SETTINGS };

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
    // Discord fetches https images itself; without a cover it shows the app icon.
    assets:
      typeof np.artUrl === 'string' && np.artUrl.startsWith('https://')
        ? { large_image: np.artUrl, large_text: field(np.album || np.title) }
        : undefined,
    instance: false,
  };
}

ipcMain.on('now-playing', (event, np) => {
  // Only the bæs page may set presence.
  if (!event.senderFrame?.url.startsWith(APP_URL)) return;
  if (presence && settings.discord) presence.set(toActivity(np));
});

// ---- window: closing hides it, so music (and presence) keep going ----

let win = null;
let quitting = false;

function createWindow({ show = true } = {}) {
  win = new BrowserWindow({
    show,
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
      // Hidden windows keep full-speed timers, so playback and the queue
      // behave the same in the background.
      backgroundThrottling: false,
    },
  });

  win.loadURL(APP_URL);

  // Like Spotify: the red button (and Cmd+W) hides the window; Cmd+Q quits.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    win = null;
  });

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

function showWindow() {
  if (win) win.show();
  else createWindow();
}

app.whenReady().then(() => {
  settings = loadSettings();
  // Kept in sync with the setting each launch (the system list can be edited
  // in System Settings → General → Login Items too).
  // Only the installed app: a dev run would register the bare Electron binary.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
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
          {
            label: 'Open at Login',
            type: 'checkbox',
            checked: settings.openAtLogin,
            enabled: app.isPackaged,
            click: (item) => {
              settings.openAtLogin = item.checked;
              saveSettings(settings);
              app.setLoginItemSettings({ openAtLogin: item.checked });
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
  // Started by login: load in the background, no window in your face.
  createWindow({ show: !app.getLoginItemSettings().wasOpenedAtLogin });
  // Clicking the Dock icon brings the window back.
  app.on('activate', showWindow);
});

app.on('before-quit', () => {
  quitting = true;
  presence?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
