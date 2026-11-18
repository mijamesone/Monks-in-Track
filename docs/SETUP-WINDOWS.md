# Install MonksTracker on your Windows PC

One download, one double-click. No Node.js, Git or PowerShell needed.

## 1. Install

1. Download **`MonksTracker-Setup-<version>.exe`** (from the GitHub release, or the file sent to you).
2. Double-click it.
3. Windows may show **"Windows protected your PC"**, because the app is not code-signed (a signing certificate costs money every year).
   Click **More info**, then **Run anyway**. You only see this once.
4. It installs in a few seconds and opens MonksTracker. There is now a **MonksTracker** icon on the desktop and in the Start menu.

That's it. MonksTracker:

- opens in its own window (it is still the same web app, just without a browser around it);
- **starts with Windows**, quietly in the tray (the icon next to the clock), so lunch reminders and the chime work without you opening it;
- keeps running in the tray when you close the window. Click the tray icon to open it again; right-click it for **Quit**,
  **Start with Windows** (on/off), **Open data folder**, and the version number;
- **updates itself**: when a new version is published, it downloads in the background and installs the next time MonksTracker restarts
  (or right away from the notification or the tray's **Restart to update**). Your data is never touched by an update;
- opens Huly and other links in your normal browser.

Keyboard: **Ctrl+R** or **F5** reloads, **Ctrl + / Ctrl −** zooms, **Ctrl+0** resets the zoom.

## 2. Two things to set right after installing

1. **Backups.** Settings → Backups → choose a folder, ideally one inside OneDrive or Google Drive, for example
   `C:\Users\you\OneDrive\MonksTracker Backups`. Press **Save**, then **Back up now**. Until a folder is chosen, no daily backups are made.
2. **PIN (optional).** Settings → Security. Without a PIN, anyone using your Windows account can open MonksTracker.

Then do the three checks from `docs/ACCEPTANCE.md` that need a real PC: put the PC to sleep with a timer running and wake it,
make sure a backup file appears in your folder, and open the app with Wi-Fi off.

## Where things are

| What | Where |
| --- | --- |
| Your data (database) | `%LOCALAPPDATA%\MonksTracker\monkstracker.sqlite` |
| App log (if something goes wrong) | `%LOCALAPPDATA%\MonksTracker\desktop.log` |
| The app itself | `%LOCALAPPDATA%\Programs\MonksTracker` |

Uninstall from **Settings → Apps → MonksTracker → Uninstall**. Uninstalling removes the app only; your data folder stays,
so reinstalling brings everything back.

## If something goes wrong

- **"MonksTracker could not start … port 4545"**: another program is using that port. Most likely an older manual install of
  MonksTracker (see below); end the `node` process in Task Manager, remove its auto-start
  (`scripts\windows\uninstall-autostart.ps1`), then open MonksTracker again.
- **Anything else**: send me `%LOCALAPPDATA%\MonksTracker\desktop.log` (type that path into the File Explorer address bar).

---

## For development: building the installer

From the repository, on any OS (Windows, macOS or Linux):

```bash
pnpm install
pnpm dist:win      # builds the server and web app, then apps/desktop/release/MonksTracker-Setup-<version>.exe
```

Run the desktop app from source with `pnpm build` and then `pnpm --filter @monkstracker/desktop start`.

To publish an update that installed copies pick up by themselves: raise `version` in `apps/desktop/package.json`, build, and
upload `MonksTracker-Setup-<version>.exe`, its `.blockmap` and `latest.yml` to a GitHub release on `mijamesone/Monks-in-Track`
(`node apps/desktop/build-win.cjs --publish` does this when a `GH_TOKEN` is set).

## The manual way (no installer)

Still works, and uses the same data folder, so you can switch between the two (never run both at once).

1. Install **Node.js 22.16 or newer** (https://nodejs.org) and **Git for Windows** (https://git-scm.com/download/win).
2. In PowerShell:

```powershell
npm install -g pnpm
```

```powershell
cd $HOME\Documents
```

```powershell
git clone https://github.com/mijamesone/Monks-in-Track.git
```

```powershell
cd Monks-in-Track
```

```powershell
pnpm install
```

```powershell
pnpm build
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
```

Then open http://127.0.0.1:4545 in Chrome. Remove the auto-start with `scripts\windows\uninstall-autostart.ps1` (your data is kept).
To update: `git pull`, `pnpm install`, `pnpm build`, then restart Windows.
