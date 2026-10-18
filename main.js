const { app, BrowserWindow, Tray, screen, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const fs = require('fs');
const readline = require('readline');

const closer = require('./closer.js');

process.on('uncaughtException', (error) => {
    console.error('Uncaught (kept alive):', error && error.stack || error);
});

// --- Rendering / performance ---------------------------------------------
// Keep hardware acceleration ON by default. Forcing CPU (software) rasterization
// put the WHOLE app - including the heavy Settings window and the transparent
// pet window - onto a CPU core. On low-end machines that is exactly what made
// movement stutter and the UI "break" (stale, trailing pixels left over other
// windows, because the pet window could not repaint fast enough).
//
// A transparent 800x150 window is trivial even for an integrated GPU, so the
// GPU is the right place to composite it. A small number of older Windows
// drivers smear transparent always-on-top windows even on the GPU; if that
// happens on a specific machine, launch with the escape hatch below to fall
// back to the old CPU behaviour:
//     set YAKO_DISABLE_GPU=1 && npm start
const FORCE_CPU = String(process.env.YAKO_DISABLE_GPU || '') === '1';
if (FORCE_CPU) {
    app.disableHardwareAcceleration();
}

// Only one instance of the app may run at a time.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}
app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
    openSettings();
});

const execPromise = util.promisify(exec);

const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera',];
const CHECK_INTERVAL = 250;      // detection cadence (was 100) - still instant, 2.5x cheaper
const CHECK_INTERVAL_LOW = 700;  // low-end mode: 700ms cadence, still imperceptible
const WARNING_DURATION = 50;     // unused now, closes are instant
const COOLDOWN_DURATION = 1000;  // catch cooldown, dormant but kept
const TAB_RESCAN_MS = 5000;      // base tab rescan; adapts upward on slow machines
const CLOSE_COOLDOWN = 2000;     // brief quiet after any close, no spam
const TARGET_COOLDOWN = 10000;   // same target immune for 10s only

// Hardcoded Whitelisted services
const PROTECTED_PROCS = ['whatsapp', 'spotify', 'code', 'winword', 'excel', 'powerpoint', 'notepad', 'teams', 'zoom', 'explorer'];

// Config lives in the per-user data dir so packaged (asar) builds can write it
function configPath() {
    return path.join(app.getPath('userData'), 'config.json');
}

const DEFAULT_CONFIG = {
    name: '',
    sites: ['instagram', 'youtube', 'tiktok', 'twitter', 'reddit', 'facebook'],
    games: ['roblox', 'steam', 'minecraft', 'epicgameslauncher', 'valorant'],
    safeApps: [],
    cat: { scale: 100, density: 55, trailDepth: 20, trailEnabled: true, speed: 100 },
    nameplate: { text: '#ffffff', outline: '#000000'},
    startup: false,
    optimized: false
};

function readConfigFromDisk() {
    try {
        const loaded = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
        return Object.assign({}, DEFAULT_CONFIG, loaded, {
            cat: Object.assign({}, DEFAULT_CONFIG.cat, loaded.cat || {}),
            nameplate: Object.assign({}, DEFAULT_CONFIG.nameplate, loaded.nameplate || {}),
            sites: Array.isArray(loaded.sites) ? loaded.sites : DEFAULT_CONFIG.sites.slice(),
            games: Array.isArray(loaded.games) ? loaded.games : DEFAULT_CONFIG.games.slice(),
            safeApps: Array.isArray(loaded.safeApps) ? loaded.safeApps : []
        });
    } catch (error) {
        return null;
    }
}

let configLoadFailed = false;

function loadConfig() {
    // Single read, no blocking retry. The old version busy-waited up to 600ms
    // here (4 x 150ms synchronous spin) which froze the whole app at launch on
    // a slow or temporarily-locked disk - a big part of the "have to restart it
    // a couple of times" flakiness. If the read fails we flag it and let
    // get-config / save-config heal it on the next IPC instead.
    const cfg = readConfigFromDisk();
    if (cfg) return cfg;
    configLoadFailed = true;
    return {
        name: DEFAULT_CONFIG.name,
        sites: DEFAULT_CONFIG.sites.slice(),
        games: DEFAULT_CONFIG.games.slice(),
        safeApps: [],
        cat: Object.assign({}, DEFAULT_CONFIG.cat),
        nameplate: Object.assign({}, DEFAULT_CONFIG.nameplate),
        startup: false,
        optimized: false
    };
}

let config = loadConfig();

function saveConfig() {
    const cp = configPath();
    const tmp = cp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    try {
        fs.renameSync(tmp, cp);
    } catch (error) {
        try {
            fs.copyFileSync(tmp, cp);
            fs.unlinkSync(tmp);
        } catch (error2) { /* ignore */ }
    }
}

// Add Yako neko to start up apps
function applyLoginItem() {
    try {
        app.setLoginItemSettings({
            openAtLogin: !!config.startup,
            openAsHidden: false,
            path: process.execPath,
            args: app.isPackaged ? [] : [app.getAppPath()]
        });
    } catch (error) {
        console.error('Login item update failed:', error.message);
    }
}

function gameList() {
    return Array.isArray(config.games) ? config.games : [];
}

function protectedList() {
    return PROTECTED_PROCS.concat(Array.isArray(config.safeApps) ? config.safeApps : []);
}

let mainWindow;
let settingsWindow = null;
let loginWindow = null;
let tray;
let isPaused = false;
let state = 'idle';
let cooldownUntil = 0;
let lastSafeTitle = '';
let warningTimeout = null;
let checking = false;
let allowQuit = false;

// ---------- Persistent window watcher ----------
let watchSleepMs = 400;
function buildWatchCode(sleepMs) {
    return `Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    // A window's pid never changes process for its lifetime, so cache the
    // name. Without this we did Process.GetProcessById (which opens a real
    // process handle) for EVERY visible window on EVERY poll - by far the
    // biggest cost in the whole app, and why it burned CPU while idle.
    static System.Collections.Generic.Dictionary<uint, string> _procCache =
        new System.Collections.Generic.Dictionary<uint, string>();
    static StringBuilder _title = new StringBuilder(256);

    public static string ProcName(uint pid) {
        string v;
        if (_procCache.TryGetValue(pid, out v)) return v;
        try { v = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
        catch { v = ""; }
        if (_procCache.Count > 512) _procCache.Clear();
        _procCache[pid] = v;
        return v;
    }
    public static string ListWindows() {
        StringBuilder sb = new StringBuilder(1024);
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0) {
                _title.Length = 0;
                GetWindowText(hWnd, _title, 256);
                uint pid; GetWindowThreadProcessId(hWnd, out pid);
                sb.AppendLine("WIN\\t" + _title.ToString() + "\\t" + ProcName(pid) + "\\t" + pid);
            }
            return true;
        }, IntPtr.Zero);
        return sb.ToString();
    }
}
"@
$fgSb = New-Object System.Text.StringBuilder 256
while ($true) {
    $fg = [Win32]::GetForegroundWindow()
    $fgText = ''
    $fgProc = ''
    $fgPid = 0
    if ($fg -ne [IntPtr]::Zero) {
        $fgSb.Length = 0
        [Win32]::GetWindowText($fg, $fgSb, 256) | Out-Null
        $fgText = $fgSb.ToString()
        [Win32]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
        $fgProc = [Win32]::ProcName($fgPid)
    }
    Write-Output ("FG\`t" + $fgText + "\`t" + $fgProc + "\`t" + $fgPid)
    Write-Output '==='
    Write-Output ([Win32]::ListWindows())
    Write-Output '===END==='
    Start-Sleep -Milliseconds ${sleepMs}
}
`;
}

const ps1Code = buildWatchCode(watchSleepMs).replace(/while \(\$true\) \{[\s\S]*$/, `
$fg = [Win32]::GetForegroundWindow()
$fgText = ''
$fgProc = ''
$fgPid = 0
if ($fg -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 256
    [Win32]::GetWindowText($fg, $sb, 256) | Out-Null
    $fgText = $sb.ToString()
    [Win32]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
    $fgProc = [Win32]::ProcName($fgPid)
}
Write-Output ("FG\`t" + $fgText + "\`t" + $fgProc + "\`t" + $fgPid)
Write-Output '==='
Write-Output ([Win32]::ListWindows())
`);

const tabsPs1Code = `$out = @()
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -match 'chrome|msedge|brave|vivaldi|opera') }
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $winCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    $tabCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    foreach ($bp in $procs) {
        try {
            $pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$bp.Id)
            $andCond = New-Object System.Windows.Automation.AndCondition($pidCond, $winCond)
            $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $andCond)
            foreach ($w in $wins) {
                $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
                foreach ($t in $tabs) {
                    $nm = $t.Current.Name
                    if ($nm) { $out += ("TAB\`t" + $nm + "\`t" + $bp.Id) }
                }
                $edits = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
                foreach ($e in $edits) {
                    $enm = $e.Current.Name
                    if ($enm -match 'address|search|url') {
                        try {
                            $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                            $val = $vp.Current.Value
                            if ($val) { $out += ("TABURL\`t" + $bp.Id + "\`t" + $val); break }
                        } catch { }
                    }
                }
            }
        } catch { }
    }
} catch { }
($out -join "\`n")
`;

let watchPs1Path = '';
let ps1Path = '';
let tabsPs1Path = '';

function writeHelperScripts() {
    try {
        const dir = app.getPath('userData');
        fs.mkdirSync(dir, { recursive: true });
        watchPs1Path = path.join(dir, 'watch_windows.ps1');
        ps1Path = path.join(dir, 'get_title.ps1');
        tabsPs1Path = path.join(dir, 'get_tabs.ps1');
        fs.writeFileSync(watchPs1Path, buildWatchCode(watchSleepMs));
        fs.writeFileSync(ps1Path, ps1Code);
        fs.writeFileSync(tabsPs1Path, tabsPs1Code);
    } catch (error) {
        console.error('helper script write failed:', error.message);
    }
}

let watcherChild = null;
let watcherStartedAt = 0;
let watcherFailCount = 0;
let watcherRestartTimer = null;
let watchDogInterval = null;
let winBuffer = { fg: null, wins: [], at: 0 };
let winPending = { fg: null, wins: [] };
// Tracks how long the foreground window has been unchanged. The detector only
// ever acts on a CHANGE of foreground window, so a long idle run means there is
// genuinely nothing to detect and we can back the polling right off.
let foregroundUnchangedSince = Date.now();

function restartWindowWatcher() {
    watchSleepMs = perfLow ? 900 : 400;
    try {
        if (watchPs1Path) fs.writeFileSync(watchPs1Path, buildWatchCode(watchSleepMs));
    } catch (error) { /* ignore */ }
    if (watcherChild) {
        // its exit handler respawns it at the new cadence
        try { watcherChild.kill(); } catch (error) { /* ignore */ }
        watcherChild = null;
    } else {
        startWindowWatcher();
    }
}

let perfLow = false;
ipcMain.on('perf-mode', (event, level) => {
    const low = String(level) === 'low';
    if (low === perfLow) return;
    perfLow = low;
    restartMonitorTimer();
    restartWindowWatcher();
});

// The detector only acts on a CHANGE of foreground window, so while the user
// sits on one app there is nothing to do - back the main-process poll off
// instead of spinning it every 250ms for no reason.
function monitorIntervalMs() {
    if (perfLow) return CHECK_INTERVAL_LOW;
    const idle = Date.now() - foregroundUnchangedSince;
    if (idle > 120000) return 1500;
    if (idle > 30000) return 700;
    return CHECK_INTERVAL;
}

let appliedMonitorMs = 0;
function monitorTick() {
    // Re-evaluate each tick: the cadence depends on how long the user has been
    // idle, and it flips straight back the instant they switch windows.
    const want = monitorIntervalMs();
    if (want !== appliedMonitorMs) {
        appliedMonitorMs = want;
        clearInterval(monitorInterval);
        monitorInterval = setInterval(monitorTick, want);
        return;
    }
    checkActiveWindow();
}

function restartMonitorTimer() {
    if (monitorInterval) clearInterval(monitorInterval);
    appliedMonitorMs = monitorIntervalMs();
    monitorInterval = setInterval(monitorTick, appliedMonitorMs);
}

// Exponential backoff on failure: a watcher that dies instantly (blocked
// script, constrained-language PowerShell, AV quarantine) used to be
// respawned every 2s FOREVER - and each attempt recompiles its C# via
// Add-Type, pegging weak machines and freezing the whole app.
// 2s, 4s, 8s, 16s, 32s, capped at 60s; resets after any healthy run.
function scheduleWatcherRestart() {
    if (watcherRestartTimer) return;
    const delay = Math.min(2000 * Math.pow(2, Math.min(watcherFailCount, 5)), 60000);
    watcherRestartTimer = setTimeout(() => {
        watcherRestartTimer = null;
        startWindowWatcher();
    }, delay);
}

function startWindowWatcher() {
    if (watcherChild) return;
    if (!watchPs1Path) return;
    let child;
    try {
        child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', watchPs1Path], { windowsHide: true });
    } catch (error) {
        console.error('window watcher spawn failed:', error.message);
        scheduleWatcherRestart();
        return;
    }
    watcherChild = child;
    watcherStartedAt = Date.now();
    const startedAt = watcherStartedAt;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        if (!line.trim()) return;
        if (line === '===END===') {
            winBuffer = {
                fg: winPending.fg || winBuffer.fg,
                wins: winPending.wins.length ? winPending.wins : winBuffer.wins,
                at: Date.now()
            };
            winPending = { fg: null, wins: [] };
            return;
        }
        if (line === '===') return;
        const p = line.split('\t');
        if (p[0] === 'FG') {
            const fg = { kind: 'fg', title: p[1] || '', process: (p[2] || '').toLowerCase(), pid: p[3] || '' };
            const prev = winPending.fg || (winBuffer && winBuffer.fg);
            if (!prev || prev.title !== fg.title || prev.pid !== fg.pid) {
                foregroundUnchangedSince = Date.now();
            }
            winPending.fg = fg;
        } else if (p[0] === 'WIN') {
            winPending.wins.push({ kind: 'window', title: p[1] || '', process: (p[2] || '').toLowerCase(), pid: p[3] || '' });
        }
    });

    child.on('error', (error) => {
        console.error('window watcher process error:', error.message);
        if (watcherChild === child) {
            watcherChild = null;
            watcherFailCount += 1;
            scheduleWatcherRestart();
        }
    });

    let errTail = '';
    child.stderr.on('data', (d) => { errTail = (errTail + String(d)).slice(-1500); });

    child.on('exit', (code) => {
        // Only clear the slot if THIS child still owns it - after a watchdog
        // recycle the old child's exit event arrives late and must not null
        // out (or restart behind) the freshly spawned one.
        const owned = watcherChild === child;
        if (owned) watcherChild = null;

        const lived = Date.now() - startedAt;
        if (lived < 5000) {
            watcherFailCount += 1;
            // Leave a breadcrumb so failures on other machines are diagnosable
            // instead of silent (this used to be an invisible 2s loop).
            const note = new Date().toISOString() + ' watcher died in ' + lived +
                'ms (exit ' + code + '): ' + errTail.replace(/\s+/g, ' ').slice(0, 400) + '\n';
            try {
                fs.appendFileSync(path.join(app.getPath('userData'), 'watcher.log'), note);
            } catch (error) { /* ignore */ }
            console.error('window watcher died quickly:', note.trim());
        } else {
            watcherFailCount = 0;
        }
        if (!watcherChild) scheduleWatcherRestart();
    });
}

ipcMain.on('catch-block', () => {
    handleCatch();
});

ipcMain.on('quit-app', () => {
    allowQuit = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    app.quit();
});

let restarting = false;
ipcMain.on('restart-app', () => {
    // Full PROCESS relaunch instead of in-place window juggling. Rebuilding
    // windows inside one long-lived process let state pile up across restart
    // spam (stale timers/window refs = random freezes a short time later),
    // and it never re-read main.js from disk - so watcher/perf fixes never
    // loaded until a manual quit. Fresh process = fresh state, and the
    // will-quit handler still tears the PowerShell watcher down cleanly.
    if (restarting) return;
    restarting = true;
    allowQuit = true;
    app.relaunch();
    app.quit();
});

ipcMain.on('set-click-through', (event, ignore) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
    }
});

ipcMain.on('toggle-pause', () => {
    isPaused = !isPaused;

    if (isPaused && warningTimeout) {
        clearTimeout(warningTimeout);
        warningTimeout = null;
    }

    const payload = Object.assign({}, config.cat, { paused: isPaused });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fx-update', payload);
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('fx-update', payload);
});

// Bridges for movement.js
let lastMove = { x: null, y: null };
ipcMain.on('move-window', (event, arg) => {
    try {
        const a = (arg && typeof arg === 'object') ? arg : {};
        let x = Math.round(Number(a.x));
        let y = Math.round(Number(a.y));
        if (!isFinite(x) || !isFinite(y)) return;

        // Keep the pet reachable. A desynced position (pause/resume races,
        // stale renderer screenX, a bad homing step) could otherwise park the
        // window fully off-screen - the "cat went out of view" bug. The lower
        // X bound still allows the intentional warp past the left edge.
        if (mainWindow && !mainWindow.isDestroyed()) {
            const b = mainWindow.getBounds();
            const wa = screen.getDisplayMatching(b).workArea;
            const yMax = Math.max(wa.y, wa.y + wa.height - b.height);
            x = Math.min(Math.max(x, -b.width - 2), wa.x + wa.width);
            y = Math.min(Math.max(y, wa.y), yMax);
        }

        if (x === lastMove.x && y === lastMove.y) return; // unchanged: skip the DWM hit
        lastMove = { x, y };
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setPosition(x, y);
        }
    } catch (error) {
        console.error('move-window payload dropped:', error.message);
    }
});

// Authoritative window position for movement.js's post-pause resync.
// Renderer-side window.screenX can lag behind a rapid run-home; the main
// process always knows where the window really is.
ipcMain.handle('get-window-position', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const [x, y] = mainWindow.getPosition();
    return [x, y];
});

let petH = 150;
ipcMain.on('resize-window', (event, arg) => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const a = (arg && typeof arg === 'object') ? arg : {};
        const rawW = Number(a.width != null ? a.width : a.w);
        const rawH = Number(a.height != null ? a.height : a.h);
        const w = Math.max(200, Math.round(isFinite(rawW) && rawW > 0 ? rawW : 800));
        const h = Math.max(150, Math.round(isFinite(rawH) && rawH > 0 ? rawH : 150));
        const [x, y] = mainWindow.getPosition();
        const bottom = y + petH;
        mainWindow.setSize(w, h);
        mainWindow.setPosition(Math.round(x), Math.round(bottom - h));
        petH = h;
    } catch (error) {
        console.error('resize-window payload dropped:', error.message);
    }
});

ipcMain.handle('get-config', () => {
    if (configLoadFailed) {
        const disk = readConfigFromDisk();
        if (disk) {
            config = disk;
            configLoadFailed = false;
        }
    }
    return {
        name: config.name,
        sites: Array.isArray(config.sites) ? config.sites.slice() : [],
        games: Array.isArray(config.games) ? config.games.slice() : [],
        safeApps: Array.isArray(config.safeApps) ? config.safeApps.slice() : [],
        cat: Object.assign({}, config.cat),
        nameplate: Object.assign({}, config.nameplate),
        startup: !!config.startup,
        optimized: !!config.optimized,
        paused: isPaused
    };
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.on('save-config', (event, cfg) => {
    if (configLoadFailed) {
        const disk = readConfigFromDisk();
        if (disk) {
            config = disk;
            configLoadFailed = false;
        }
    }

    config.name = String(cfg.name || '').slice(0, 140);

    config.sites = Array.isArray(cfg.sites)
        ? cfg.sites.map(s => String(s).toLowerCase().trim()).filter(Boolean)
        : config.sites;

    config.games = Array.isArray(cfg.games)
        ? cfg.games.map(g => String(g).toLowerCase().trim()).filter(Boolean)
        : config.games;

    config.safeApps = Array.isArray(cfg.safeApps)
        ? cfg.safeApps.map(s => String(s).toLowerCase().trim()).filter(Boolean)
        : config.safeApps;

    if (cfg && cfg.cat) config.cat = Object.assign({}, config.cat, cfg.cat);
    if (cfg && cfg.nameplate) config.nameplate = Object.assign({}, config.nameplate, cfg.nameplate);

    const wantStartup = !!cfg.startup;
    if (wantStartup !== !!config.startup) {
        config.startup = wantStartup;
        applyLoginItem();
    }

    config.optimized = !!cfg.optimized;
    tabRescanMs = config.optimized ? 8000 : TAB_RESCAN_MS;

    saveConfig();

    if (tray) tray.setToolTip(config.name);
    if (mainWindow && !mainWindow.isDestroyed()) {
        // Ship the name + nameplate colours with the live update too, so a
        // rename/recolour is applied instantly instead of waiting for the
        // nameplate's periodic poll. Consumers merge this object, so the
        // existing cat.* fields (speed, scale...) still work.
        //
        // NOTE: deliberately NO `paused` here. save-config fires on every
        // settings change (picking a skin, moving a slider...); including the
        // pause flag made nap.js treat each tweak as a resume and fly the cat
        // back to its spawn corner. Pause state rides the toggle-pause channel.
        const fx = Object.assign({}, config.cat, {
            name: config.name,
            nameplate: Object.assign({}, config.nameplate),
            optimized: !!config.optimized
        });
        mainWindow.webContents.send('fx-update', fx);
    }
});

function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 1180,
        height: 750,
        resizable: false,
        // Paint the dark theme immediately so slow machines never flash white
        // while the page is parsing/loading.
        backgroundColor: '#0d0e1a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    settingsWindow.setMenu(null);
    const self = settingsWindow;
    settingsWindow.on('closed', () => {
        if (settingsWindow === self) settingsWindow = null;
    });
    settingsWindow.loadFile('settings.html', { query: { v: Date.now() } });
}

function openLogin() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.focus();
        return;
    }
    loginWindow = new BrowserWindow({
        width: 480,
        height: 420,
        resizable: false,
        frame: false,
        alwaysOnTop: true,
        backgroundColor: '#0d1220',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    loginWindow.setMenu(null);
    const self = loginWindow;
    loginWindow.on('closed', () => {
        if (loginWindow === self) loginWindow = null;
    });
    loginWindow.loadFile('login.html');
    loginWindow.webContents.once('did-finish-load', () => {
        try {
            loginWindow.webContents.send('login-prefill', String(config.name || ''));
        } catch (error) { /* ignore */ }
    });
}

ipcMain.on('login-done', () => {
    globalThis.__yakoBooting = true;
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    // Stagger Settings: opening two BrowserWindows back-to-back (each with a
    // canvas, image decode and getImageData scan) while the pet window is still
    // starting up was another one-second CPU spike on launch. The pet goes first.
    setTimeout(() => openSettings(), 700);
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
    setTimeout(() => { globalThis.__yakoBooting = false; }, 2000);
});

ipcMain.on('open-login', () => openLogin());

function loadTrayIcon() {
    try {
        const custom = nativeImage.createFromPath(path.join(__dirname, 'assets', 'app_icon.png'));
        if (!custom.isEmpty()) {
            const icon = custom.resize({ width: 32, height: 32 });
            if (!icon.isEmpty()) return icon;
        }
    } catch (error) { /* fall through */ }
    try {
        const sheet = nativeImage.createFromPath(path.join(__dirname, 'assets', 'nyan_sheet.png'));
        if (!sheet.isEmpty()) {
            const size = sheet.getSize();
            const frame = sheet.crop({
                x: 0,
                y: 0,
                width: Math.max(1, Math.round(size.width / 4)),
                height: Math.max(1, Math.round(size.height / 3))
            });
            const icon = frame.resize({ width: 32 });
            if (!icon.isEmpty()) return icon;
        }
    } catch (error) {
        // fallback below
    }

    return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAE0lEQVQ4T2NkYGD4z0AFwMgwasCoAwBOIhH/lb+hEAAAAABJRU5ErkJggg==');
}

function createTray() {
    tray = new Tray(loadTrayIcon());
    tray.setToolTip(config.name);
    tray.on('click', () => openSettings());
}

function createWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        allowQuit = true;
        mainWindow.destroy();
        allowQuit = false;
    }
    mainWindow = new BrowserWindow({
        width: 800,
        height: 150,
        frame: false,
        transparent: true,
        // Explicit fully-transparent background + no shadow. This is the fix for
        // the GPU compositor leaving stale trails behind the moving pet window
        // on Windows - the exact smearing/ghosting seen on low-end machines.
        backgroundColor: '#00000000',
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });

    petH = 150;

    mainWindow.on('close', (e) => {
        if (!allowQuit) e.preventDefault();
    });

    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    mainWindow.setPosition(width - 820, height - 170);

    mainWindow.loadFile('index.html');

    createTray();

    // Bring the detection engine up AFTER the pet has actually rendered.
    // startMonitoring() spawns the PowerShell window-watcher (which compiles its
    // C# via Add-Type on every launch) plus a second PowerShell for the browser
    // tab scan. Firing both while Chromium is still decoding the pet window was
    // stealing CPU exactly when the pet appears - that was the startup hitch.
    // scheduling guard for THIS window instance
    let monitoringScheduled = false;
    const beginMonitoring = () => {
        if (monitoringScheduled) return;
        if (!mainWindow || mainWindow.isDestroyed()) return;
        monitoringScheduled = true;
        startMonitoring(); // has its own module-level once-guard
    };
    mainWindow.webContents.once('did-finish-load', () => setTimeout(beginMonitoring, 600));
    // Safety net so the blocker can never stay dead if the load event is missed.
    setTimeout(beginMonitoring, 4000);
}

function setState(newState) {
    state = newState;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('state-change', state);
    }
}

function closeTarget(target, safeTitle) {
    closer.closeTarget(target, safeTitle, {
        BROWSERS,
        protectedNames: protectedList(),
        getBuffer: () => winBuffer
    });
}

function handleCatch() {
    if (state === 'warning') {
        clearTimeout(warningTimeout);
        cooldownUntil = Date.now() + COOLDOWN_DURATION;
        setState('cooldown');
        setTimeout(() => setState('idle'), 2000);
    }
}

// Opera (and any browser whose tabs UIA can't see): close the flagged tab
// by activating its window and pressing Ctrl+W.
async function sendCtrlW(target) {
    let script;
    if (target && (target.isFg || target.kind === 'fg')) {
        script = `try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^w') } catch { }`;
    } else if (target && target.pid) {
        script = `try { Add-Type -AssemblyName Microsoft.VisualBasic; Add-Type -AssemblyName System.Windows.Forms; [Microsoft.VisualBasic.Interaction]::AppActivate(${String(target.pid)}) | Out-Null; Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('^w') } catch { }`;
    } else {
        const title = String((target && target.title) || '').replace(/'/g, "''");
        script = `try { Add-Type -AssemblyName Microsoft.VisualBasic; Add-Type -AssemblyName System.Windows.Forms; [Microsoft.VisualBasic.Interaction]::AppActivate('${title}') | Out-Null; Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('^w') } catch { }`;
    }
    try {
        await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`, { windowsHide: true, timeout: 4000 });
    } catch (error) { /* ignore */ }
}

let lastFallbackExec = 0;
async function getWindowsFast() {
    if (winBuffer.at && Date.now() - winBuffer.at < 3000) {
        return {
            fg: winBuffer.fg || { kind: 'fg', title: '', process: '', pid: '' },
            wins: winBuffer.wins
        };
    }

    // Rate-limit the PowerShell fallback: if the watcher is sick we still
    // refuse to spawn more than one fallback every 1.5s (no exec storms).
    const now = Date.now();
    if (now - lastFallbackExec < 1500) {
        return {
            fg: winBuffer.fg || { kind: 'fg', title: '', process: '', pid: '' },
            wins: winBuffer.wins
        };
    }
    lastFallbackExec = now;

    try {
        const { stdout } = await execPromise(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}"`,
            { windowsHide: true, timeout: 6000 }
        );

        let fg = { kind: 'fg', title: '', process: '', pid: '' };
        const wins = [];

        for (const line of stdout.split(/\r?\n/)) {
            if (!line.trim() || line === '===') continue;
            const p = line.split('\t');

            if (p[0] === 'FG') {
                fg = { kind: 'fg', title: p[1] || '', process: (p[2] || '').toLowerCase(), pid: p[3] || '' };
            } else if (p[0] === 'WIN') {
                wins.push({ kind: 'window', title: p[1] || '', process: (p[2] || '').toLowerCase(), pid: p[3] || '' });
            }
        }

        return { fg, wins };
    } catch (error) {
        return { fg: { kind: 'fg', title: '', process: '', pid: '' }, wins: [] };
    }
}

let tabCache = [];
let tabUrls = [];
let tabCacheAt = 0;
let tabRefreshing = false;
let tabRescanMs = TAB_RESCAN_MS;

function refreshTabs() {
    if (tabRefreshing) return;
    if (isPaused) return;
    // Right after we close something the cached tab list is stale, but the UIA
    // scan is expensive - let it settle for the close cooldown instead of
    // re-scanning on the very next detection tick.
    if (Date.now() < closedUntil) return;

    // No browser running = no tabs to find. Skip the expensive UIA scan
    // entirely instead of spawning PowerShell for nothing.
    const browserAlive = (winBuffer.wins || []).some(w =>
        BROWSERS.some(b => (w.process || '').includes(b))
    );
    if (!browserAlive) {
        tabCache = [];
        tabUrls = [];
        tabCacheAt = Date.now();
        return;
    }

    tabRefreshing = true;
    const t0 = Date.now();

    execPromise(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tabsPs1Path}"`,
        { windowsHide: true, timeout: 8000 }
    ).then(({ stdout }) => {
        
        const dur = Date.now() - t0;
        const base = config.optimized ? 8000 : TAB_RESCAN_MS;
        if (dur > 1500) tabRescanMs = Math.min(12000, tabRescanMs * 2);
        else if (dur < 400) tabRescanMs = Math.max(base, Math.round(tabRescanMs * 0.7));

        const tabs = [];
        const urls = [];
        for (const line of stdout.split(/\r?\n/)) {
            if (line.startsWith('TAB\t')) {
                const p = line.split('\t');
                tabs.push({ kind: 'tab', title: p[1] || '', pid: p[2] || '' });
            } else if (line.startsWith('TABURL\t')) {
                const p = line.split('\t');
                urls.push({ pid: p[1] || '', url: p[2] || '' });
            }
        }
        tabCache = tabs;
        tabUrls = urls;
        tabCacheAt = Date.now();
    }).catch(() => {
        // Keep old cache on failure
    }).finally(() => {
        tabRefreshing = false;
    });
}

function getTabs() {
    const limit = perfLow ? Math.max(tabRescanMs, 8000) : tabRescanMs;
    if (Date.now() - tabCacheAt > limit) refreshTabs();
    return tabCache;
}

function getTabUrls() {
    return tabUrls;
}

function normKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isBlockedTitle(title) {
    const titleLower = String(title || '').toLowerCase();
    const titleNorm = normKey(title);
    return Array.isArray(config.sites) && config.sites.some(keyword => {
        const k = String(keyword || '').toLowerCase();
        if (!k) return false;
        if (titleLower.includes(k)) return true;
        const kn = normKey(k);
        return kn.length > 0 && titleNorm.includes(kn);
    });
}

function isBlockedUrl(url) {
    const u = String(url || '').toLowerCase();
    if (!u) return false;
    const uNorm = normKey(url);
    return Array.isArray(config.sites) && config.sites.some(keyword => {
        const k = String(keyword || '').toLowerCase();
        if (!k) return false;
        if (u.includes(k)) return true;
        const kn = normKey(k);
        return kn.length > 0 && uNorm.includes(kn);
    });
}

function isIgnoredTitle(title) {
    if (!title) return true;
    const t = String(title).toLowerCase();
    return t.includes('desktop pet') || t === 'settings';
}

function isSelfProc(win) {
    return String(win.process || '').includes('electron');
}

function isBlockedGame(win) {
    const proc = String(win.process || '').toLowerCase();

    if (!proc || proc.includes('electron') || BROWSERS.some(b => proc.includes(b))) return false;

    const title = String(win.title || '').toLowerCase();
    const games = gameList();
    return games.some(g => g && (proc.includes(g) || title.includes(g)));
}

async function collectTarget() {
    const { fg, wins } = await getWindowsFast();
    const tabs = getTabs();

    if (!isSelfProc(fg) && isBlockedGame(fg)) {
        return {
            target: { kind: 'game', title: fg.title, process: fg.process, pid: fg.pid, isFg: true },
            fgTitle: fg.title
        };
    }

    if (!isSelfProc(fg) && !isIgnoredTitle(fg.title) && isBlockedTitle(fg.title)) {
        return {
            target: { kind: 'fg', title: fg.title, process: fg.process, pid: fg.pid },
            fgTitle: fg.title
        };
    }

    const bgGame = wins.find(w => !isSelfProc(w) && w.title !== fg.title && isBlockedGame(w));
    if (bgGame) {
        return {
            target: { kind: 'game', title: bgGame.title, process: bgGame.process, pid: bgGame.pid, isFg: false },
            fgTitle: fg.title
        };
    }

    const blockedTab = tabs.find(t =>
        !isIgnoredTitle(t.title) &&
        isBlockedTitle(t.title) &&
        t.title !== fg.title
    );
    if (blockedTab) return { target: blockedTab, fgTitle: fg.title };

    const urlHit = getTabUrls().find(u => u.url && isBlockedUrl(u.url));
    if (urlHit) {
        return {
            target: { kind: 'sweep', title: urlHit.url, process: '', pid: urlHit.pid },
            fgTitle: fg.title
        };
    }

    const blockedWin = wins.find(w =>
        !isSelfProc(w) &&
        !isIgnoredTitle(w.title) &&
        isBlockedTitle(w.title) &&
        w.title !== fg.title
    );
    if (blockedWin) return { target: blockedWin, fgTitle: fg.title };

    return { target: null, fgTitle: fg.title };
}

let closedUntil = 0;
const targetCooldowns = new Map();

function targetId(t) {
    return t.kind + '|' + (t.process || '') + '|' + (t.title || '') + '|' + (t.pid || '');
}

function isCoolingTarget(t) {
    const until = targetCooldowns.get(targetId(t)) || 0;
    return Date.now() < until;
}

function pruneCooldowns() {
    if (targetCooldowns.size < 50) return;
    const now = Date.now();
    for (const [key, until] of targetCooldowns) {
        if (until < now) targetCooldowns.delete(key);
    }
}

async function checkActiveWindow() {
    if (checking || isPaused || state === 'blocked') return;
    if (Date.now() < cooldownUntil) return;
    if (Date.now() < closedUntil) return;

    checking = true;

    try {
        pruneCooldowns();
        const { target, fgTitle } = await collectTarget();

        if (target && !isCoolingTarget(target)) {
            console.log('Flagged:', target.title || target.process, '| kind:', target.kind);

            let safe = (target.kind === 'fg' || target.isFg) ? lastSafeTitle : fgTitle;
            if (isIgnoredTitle(safe) || isBlockedTitle(safe)) safe = lastSafeTitle;

            const isBrowserProc = BROWSERS.some(b => String(target.process || '').includes(b));
            const tabish = target.kind === 'tab' || target.kind === 'sweep' || (target.kind === 'fg' && isBrowserProc);

            const ids = [targetId(target)];
            if (tabish) {
                const seen = {};
                const batch = getTabs().filter(t => {
                    if (!t.pid) return false;
                    if (isIgnoredTitle(t.title) || !isBlockedTitle(t.title)) return false;
                    const key = t.pid + '|' + t.title;
                    if (seen[key]) return false;
                    seen[key] = 1;
                    return true;
                });
                batch.forEach(t => ids.push(targetId(t)));
            }

            const now = Date.now();
            ids.forEach(id => targetCooldowns.set(id, now + TARGET_COOLDOWN));
            closedUntil = now + CLOSE_COOLDOWN;

            if (tabish) {
                closer.closeAllFlaggedTabs(safe, {
                    BROWSERS,
                    protectedNames: protectedList(),
                    getBuffer: () => winBuffer,
                    sites: config.sites
                });
            } else {
                closeTarget(target, safe);
            }

            setTimeout(async () => {
                try {
                    const re = await collectTarget();
                    if (re.target && ids.includes(targetId(re.target))) {
                        ids.forEach(id => targetCooldowns.delete(id));
                        closedUntil = 0;
                        console.log('Close missed, retry armed for:', re.target.title || re.target.process);
                    }
                } catch (error) { /* ignore */ }
            }, 3000);
        } else {
            if (!isIgnoredTitle(fgTitle) && !isBlockedTitle(fgTitle)) {
                lastSafeTitle = fgTitle;
            }
            if (state !== 'idle') setState('idle');
        }
    } catch (error) {
        console.error('Detection error:', error.message);
    } finally {
        checking = false;
    }
}

let monitorInterval = null;
// One-shot guard so the detector is only ever brought up once, no matter how
// many times createWindow() runs.
let monitoringStarted = false;
function startMonitoring() {
    if (monitoringStarted) return;
    monitoringStarted = true;
    startWindowWatcher();
    refreshTabs();
    if (!monitorInterval) {
        restartMonitorTimer();
    }
    // Watchdog: if the watcher goes silent for 5s, recycle it immediately
    // instead of letting the fallback exec path take the load.
    if (!watchDogInterval) {
        watchDogInterval = setInterval(() => {
            if (!watcherChild) return;
            // Grace period: a freshly spawned watcher must boot PowerShell AND
            // compile its C# via Add-Type, which takes SECONDS on a slow
            // machine. Recycling it before the first output arrived created an
            // endless kill/respawn loop (fresh powershell.exe + C# compile
            // every 2s = constant CPU = the whole app freezing). Warm-up
            // time first, then judge silence.
            if (Date.now() - watcherStartedAt < 25000) return;
            const silent = winBuffer.at
                ? Date.now() - winBuffer.at > 5000
                : Date.now() - watcherStartedAt > 60000;
            if (!silent) return;
            console.error('window watcher silent for too long - recycling');
            try { watcherChild.kill(); } catch (error) { /* ignore */ }
            watcherChild = null;
            startWindowWatcher();
        }, 2000);
    }
}

// Download google fonts
function ensureLocalFonts() {
    // Packaged builds ship the TTFs inside the app bundle (read-only),
    if (app.isPackaged) return;
    const https = require('https');
    const dir = path.join(__dirname, 'assets', 'fonts');
    const want = [
        { file: 'PressStart2P.ttf', url: 'https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf' },
        { file: 'VT323.ttf', url: 'https://github.com/google/fonts/raw/main/ofl/vt323/VT323-Regular.ttf' }
    ];
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return; }

    const grab = (url, dest, hops) => new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
                res.resume();
                return resolve(grab(res.headers.location, dest, hops - 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => out.close(() => resolve()));
            out.on('error', reject);
        }).on('error', reject);
    });

    want.forEach((f) => {
        const dest = path.join(dir, f.file);
        try {
            if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) return; // already good
        } catch (e) { /* fall through to download */ }
        grab(f.url, dest, 5)
            .then(() => console.log('Font saved:', f.file))
            .catch((e) => console.log('Font fetch pending (will retry next boot):', f.file, e.message));
    });
}

app.whenReady().then(() => {
    writeHelperScripts();
    openLogin();
    // ensureLocalFonts() does TLS + disk I/O for missing fonts. Keep it off the
    // first-paint path so the login window renders before any network work.
    setTimeout(ensureLocalFonts, 1200);
});

app.on('window-all-closed', () => {
    if (globalThis.__yakoBooting) return;
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    try {
        if (watcherChild) watcherChild.kill();
    } catch (error) { /* ignore */ }
});