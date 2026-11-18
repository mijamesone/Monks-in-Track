/**
 * MonksTracker for Windows.
 *
 * Starts the MonksTracker server (the same one `pnpm start` runs) as a background utility process,
 * then shows the web app in its own window. Closing the window keeps MonksTracker in the tray, so
 * reminders and the lunch chime still fire; Quit in the tray menu stops it.
 *
 * Data stays where the server always keeps it: %LOCALAPPDATA%\MonksTracker.
 */
import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, shell, Tray, utilityProcess, type UtilityProcess } from 'electron';
import { accessSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import updater from 'electron-updater';

const PORT = 4545;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP_ID = 'app.monkstracker.desktop'; // must match appId in electron-builder.yml (Windows notifications use it)
const dataDir = process.env.MONKSTRACKER_DATA ?? join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'MonksTracker');
const logFile = join(dataDir, 'desktop.log');
const startHidden = process.argv.includes('--hidden');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: UtilityProcess | null = null;
let quitting = false;
let toldAboutTray = false;
let updateReady = false;

function log(line: string) {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never stop the app */
  }
}

const resources = () => (app.isPackaged ? join(process.resourcesPath, 'app') : join(__dirname, '..'));
const icon = () => nativeImage.createFromPath(join(resources(), 'build', 'icon.png'));

// One MonksTracker at a time: opening it again brings the existing window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId(APP_ID);
  void app.whenReady().then(start);
}

async function start() {
  Menu.setApplicationMenu(null);
  firstRunSetup();
  createTray();
  const ready = await startServer();
  if (!ready) return;
  createWindow();
  checkForUpdates();
}

/** On the very first run, start with Windows (minimised to the tray). It can be turned off in the tray menu. */
function firstRunSetup() {
  if (!app.isPackaged) return;
  const marker = join(app.getPath('userData'), 'first-run-done');
  try {
    accessSync(marker);
  } catch {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(marker, new Date().toISOString());
  }
}

function startServer(): Promise<boolean> {
  return new Promise((resolve) => {
    let output = '';
    server = utilityProcess.fork(join(resources(), 'server', 'server.mjs'), [], {
      serviceName: 'MonksTracker server',
      stdio: 'pipe',
      env: {
        ...process.env,
        MONKSTRACKER_DATA: dataDir,
        MONKSTRACKER_PORT: String(PORT),
        MONKSTRACKER_WEB: join(resources(), 'web'),
      },
    });
    const capture = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log(`[server] ${text.trim()}`);
    };
    server.stdout?.on('data', capture);
    server.stderr?.on('data', capture);
    server.on('exit', (code) => {
      log(`server exited with code ${code}`);
      server = null;
      if (quitting) return;
      const inUse = /already in use/i.test(output);
      dialog.showErrorBox(
        'MonksTracker could not start',
        inUse
          ? `Something else is already using port ${PORT}. If you installed MonksTracker the manual way before, stop that copy first (end the "node" process in Task Manager), then open MonksTracker again.`
          : `The MonksTracker server stopped unexpectedly (code ${code}).\n\nDetails are in ${logFile}`,
      );
      quitting = true;
      app.quit();
      resolve(false);
    });

    // Ready when the server answers.
    const startedAt = Date.now();
    const poll = async () => {
      if (!server) return;
      try {
        const res = await fetch(`${ORIGIN}/api/health`);
        if (res.ok) return resolve(true);
      } catch {
        /* not up yet */
      }
      if (Date.now() - startedAt > 20_000) {
        dialog.showErrorBox('MonksTracker could not start', `The server did not answer within 20 seconds.\n\nDetails are in ${logFile}`);
        quitting = true;
        app.quit();
        return resolve(false);
      }
      setTimeout(() => void poll(), 150);
    };
    void poll();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MonksTracker',
    icon: icon(),
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep timers, the lunch chime and reminders on time while the window is hidden in the tray.
      backgroundThrottling: false,
      // The lunch chime and alarm may play without a click first.
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: true,
    },
  });

  // Huly and other outside links open in your normal browser; the window only ever shows MonksTracker.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(ORIGIN)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  // Keyboard shortcuts a browser would give: reload, zoom, and developer tools for troubleshooting.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !win) return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
      win.webContents.reload();
      event.preventDefault();
    } else if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (ctrl && (input.key === '=' || input.key === '+')) {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
      event.preventDefault();
    } else if (ctrl && input.key === '-') {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
      event.preventDefault();
    } else if (ctrl && input.key === '0') {
      win.webContents.setZoomLevel(0);
      event.preventDefault();
    }
  });

  win.once('ready-to-show', () => {
    if (!startHidden) win?.show();
  });
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
    if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true;
      new Notification({ title: 'MonksTracker is still running', body: 'Reminders keep working. Open it again from the tray icon, or choose Quit there.', icon: icon() }).show();
    }
  });
  void win.loadURL(ORIGIN);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(icon().resize({ width: 16, height: 16 }));
  tray.setToolTip('MonksTracker');
  tray.on('click', showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings({ args: ['--hidden'] });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open MonksTracker', click: showWindow },
      ...(updateReady ? [{ label: 'Restart to update', click: () => installUpdate() }] : []),
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: login.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
          refreshTrayMenu();
        },
      },
      { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit MonksTracker', click: () => quit() },
    ]),
  );
}

/** New versions come from the GitHub releases of this repository, download quietly, and install on the next restart. */
function checkForUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m: unknown) => log(`[update] ${m}`), warn: (m: unknown) => log(`[update] ${m}`), error: (m: unknown) => log(`[update] ${m}`), debug: () => {} };
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    refreshTrayMenu();
    if (Notification.isSupported()) {
      const n = new Notification({ title: `MonksTracker ${info.version} is ready`, body: 'It installs the next time MonksTracker restarts. Click to restart now.', icon: icon() });
      n.on('click', () => installUpdate());
      n.show();
    }
  });
  const check = () => void autoUpdater.checkForUpdates().catch((e: unknown) => log(`[update] check failed: ${String(e)}`));
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    const timer = setTimeout(() => {
      s.kill();
      resolve();
    }, 3000);
    s.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    s.postMessage('shutdown');
  });
}

async function installUpdate() {
  quitting = true;
  await stopServer();
  updater.autoUpdater.quitAndInstall(true, true);
}

async function quit() {
  quitting = true;
  await stopServer();
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  /* stay in the tray */
});
