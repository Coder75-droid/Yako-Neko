const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Config
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (cfg) => ipcRenderer.send('save-config', cfg),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    // Pet window control (movement.js / nameplate.js)
    moveWindow: (x, y) => ipcRenderer.send('move-window', { x, y }),
    // Authoritative position for movement.js's post-pause resync - renderer
    // window.screenX can lag behind nap.js's run-home, main always knows.
    getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
    resizeWindow: (w, h) => ipcRenderer.send('resize-window', { width: w, height: h }),
    setClickThrough: (ignore) => ipcRenderer.send('set-click-through', !!ignore),

    // App control (settings topbar)
    togglePause: () => ipcRenderer.send('toggle-pause'),
    quitApp: () => ipcRenderer.send('quit-app'),
    restartApp: () => ipcRenderer.send('restart-app'),
    catchBlock: () => ipcRenderer.send('catch-block'),

    // Perf: renderer tells main when the machine is struggling
    reportPerf: (level) => ipcRenderer.send('perf-mode', level),

    // Live updates from main
    onFxUpdate: (cb) => ipcRenderer.on('fx-update', (e, cat) => cb(cat)),
    onStateChange: (cb) => ipcRenderer.on('state-change', (e, s) => cb(s)),

    // Login gate
    loginDone: () => ipcRenderer.send('login-done'),
    openLogin: () => ipcRenderer.send('open-login'),
    onLoginPrefill: (cb) => ipcRenderer.on('login-prefill', (e, name) => cb(name))
});