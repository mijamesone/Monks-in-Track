# Install MonksTracker on your Windows PC

About 10 minutes, once. After this, MonksTracker starts by itself every time you log in, and lives at
**http://127.0.0.1:4545** in Chrome. Your data stays on your PC in `%LOCALAPPDATA%\MonksTracker`.

## 1. Install the two tools (one time)

1. **Node.js 22 LTS**: download the Windows installer from https://nodejs.org and keep the default options.
2. **Git for Windows**: download from https://git-scm.com/download/win and keep the default options.

## 2. Get MonksTracker

Open **PowerShell** (Start menu → type "PowerShell") and run these one at a time:

```powershell
npm install -g pnpm
```

```powershell
cd $HOME\Documents
```

```powershell
git clone https://github.com/mijamesone/Monks-in-Track.git
```

The repository is private, so Git opens a GitHub sign-in window the first time. Sign in as `mijamesone`.

```powershell
cd Monks-in-Track
```

```powershell
pnpm install
```

```powershell
pnpm build
```

## 3. Start it, and make it start with Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
```

You should see "MonksTracker is running at http://127.0.0.1:4545". Open that address in Chrome.
Tip: in Chrome's menu choose **Cast, save and share → Install page as app** to give MonksTracker its own window and taskbar icon.

## 4. Two things to set right after installing

1. **Backups.** Settings → Backups → choose a folder, ideally one inside OneDrive or Google Drive, for example
   `C:\Users\you\OneDrive\MonksTracker Backups`. Press **Save**, then **Back up now**. Until a folder is chosen, no daily backups are made.
2. **PIN (optional).** Settings → Security (PIN). Without a PIN, anyone using your Windows account can open MonksTracker.

Then do the three checks from `docs/ACCEPTANCE.md` that need a real PC: put the PC to sleep with a timer running and wake it,
make sure a backup file appears in your folder, and open the app with Wi-Fi off.

## Updating to a new version

```powershell
cd $HOME\Documents\Monks-in-Track
```

```powershell
git pull
```

```powershell
pnpm install
```

```powershell
pnpm build
```

Then restart Windows, or end the `node` process in Task Manager and run `scripts\windows\start-monkstracker.vbs` by double-clicking it.

## If something goes wrong

- **The page does not open:** check `%LOCALAPPDATA%\MonksTracker\server.log`. If it says the port is in use, MonksTracker is already running.
- **`pnpm install` fails while building `better-sqlite3`:** Node.js could not download a ready-made database driver. Re-run the Node.js installer and tick
  **"Automatically install the necessary tools"**, then run `pnpm install` again.
- **Stop it starting with Windows:** `powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall-autostart.ps1` (your data is kept).
