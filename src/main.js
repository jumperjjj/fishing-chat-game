const path = require('path');
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { GameDatabase } = require('./database');
const { FishingEngine } = require('./fishing-engine');
const { LocalServer } = require('./local-server');
const { TwitchClient } = require('./twitch-client');

let mainWindow;
let db;
let server;
let engine;
let twitch;
let hourlyTokenValidation = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0b1117',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadURL('http://127.0.0.1:8766/index.html');
}

async function bootstrap() {
  db = new GameDatabase(app.getPath('userData'));
  server = new LocalServer({ database: db, port: 8766 });
  engine = new FishingEngine(db, (data) => server.broadcast(data));
  twitch = new TwitchClient(db);
  server.setEngine(engine);
  server.setTwitch(twitch);

  twitch.on('chatMessage', async ({ text, user }) => {
    const settings = db.getSettings();
    const command = String(settings.command || '!pescar').trim().toLowerCase();
    if (text.trim().toLowerCase() !== command) return;

    const result = await engine.fish({
      channelId: settings.active_channel_id,
      user
    });

    if (!result.ok && result.reason === 'cooldown') {
      server.broadcast({ type: 'fishing:cooldown', user, remainingSeconds: result.remainingSeconds });
    }
  });

  twitch.on('connected', (identity) => {
    server.broadcast({ type: 'twitch:connected', identity });
  });
  twitch.on('disconnected', () => server.broadcast({ type: 'twitch:disconnected' }));
  twitch.on('error', (error) => server.broadcast({ type: 'twitch:error', message: error.message || String(error) }));

  await server.start();
  createWindow();
}

app.whenReady().then(bootstrap);

ipcMain.handle('open-external', (_event, url) => shell.openExternal(url));
ipcMain.handle('copy-overlay-url', async () => {
  const { clipboard } = require('electron');
  const url = 'http://127.0.0.1:8766/overlay.html';
  clipboard.writeText(url);
  return url;
});
ipcMain.handle('twitch-complete-device-auth', async (_event, payload) => {
  const { clientId, deviceCode, interval, expiresIn } = payload;
  const token = await twitch.pollDeviceToken(clientId, deviceCode, interval, expiresIn);
  const identity = await twitch.connect({ clientId, accessToken: token.access_token });
  // TODO v0.2: armazenar refresh token com proteção do SO (safeStorage).
  return { identity, tokenExpiresIn: token.expires_in };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (hourlyTokenValidation) clearInterval(hourlyTokenValidation);
  try { twitch?.disconnect(); } catch {}
  try { await server?.stop(); } catch {}
  try { db?.close(); } catch {}
});
