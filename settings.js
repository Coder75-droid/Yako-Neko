// settings.js: yako neko settings, page based, wired to config.json.

const DEFAULTS = {
    name: '',
    sites: ['instagram', 'youtube', 'tiktok', 'twitter', 'reddit', 'facebook'],
    games: ['roblox', 'steam', 'minecraft', 'epicgameslauncher', 'valorant'],
    safeApps: [],
    cat: { scale: 100, density: 55, trailDepth: 20, trailEnabled: true, speed: 100, skin: 'nyan' },
    nameplate: {text: '#ffffff', outline: '#000000'},
    startup: false,
    optimized: false
};

let cfg = JSON.parse(JSON.stringify(DEFAULTS));

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- theme ----------
const THEME_KEY = 'yakoNekoTheme';
function applyTheme(t) { document.body.dataset.theme = t; }
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
$('theme-toggle').addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
});

// ---------- pages ----------
const PAGE_META = {
    focus: { label: 'Filters', title: '' },
    cat: { label: 'Customizations', title: '' },
    name: { label: 'Nameplate', title: '' }
};
function switchPage(key) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = $('page-' + key);
    if (page) page.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === key));
    const meta = PAGE_META[key] || PAGE_META.focus;
    const crumb = $('breadcrumb-current');
    if (crumb) crumb.textContent = meta.label;
    const title = $('topbar-title');
    if (title) title.textContent = meta.title;
}

// ---------- nav wiring ----------
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        if (page) switchPage(page);
    });
});

// ---------- save pipeline ----------
let pushTimer = null;
function push(immediate) {
    clearTimeout(pushTimer);
    if (immediate) { window.api.saveConfig(clone(cfg)); return; }
    pushTimer = setTimeout(() => window.api.saveConfig(clone(cfg)), 150);
}

// ---------- nameplate preview ----------
function updateNameplatePreview() {
    const nameEl = $('np-name');
    if (!nameEl) return;
    nameEl.textContent = cfg.name || '';
    nameEl.style.color = cfg.nameplate.text;
}
function setHello(name) {
    const el = $('nameplate-hello');
    if (el) el.textContent = 'Say hello, ' + (name || '');
}
function setPreviewPaused(p) {
    const st = $('np-stage');
    if (st) st.classList.toggle('paused', !!p);
}

// ---------- render ----------
function setCheck(id, on) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('checked', !!on);
    const box = el.querySelector('.checkbox');
    if (box) box.innerHTML = on ? '<svg class="ic sm"><use href="#i-check"/></svg>' : '';
}
function renderList(elId, items, onRemove) {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = '';
    items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        const label = document.createElement('span');
        label.textContent = item;
        const btn = document.createElement('button');
        btn.className = 'remove-button';
        btn.innerHTML = '<svg class="ic sm"><use href="#i-x"/></svg>Remove';
        btn.addEventListener('click', () => onRemove(item));
        row.appendChild(label);
        row.appendChild(btn);
        el.appendChild(row);
    });
}

// Zoomed in version of sprite for the skin menu
function renderAll() {
    renderList('site-list', cfg.sites, (v) => { cfg.sites = cfg.sites.filter(x => x !== v); renderAll(); push(); });
    renderList('game-list', cfg.games, (v) => { cfg.games = cfg.games.filter(x => x !== v); renderAll(); push(); });
    renderList('safe-list', cfg.safeApps, (v) => { cfg.safeApps = cfg.safeApps.filter(x => x !== v); renderAll(); push(); });

    const sc = $('site-count'); if (sc) sc.textContent = String(cfg.sites.length).padStart(2, '0');
    const gc = $('game-count'); if (gc) gc.textContent = String(cfg.games.length).padStart(2, '0');
    const ac = $('safe-count'); if (ac) ac.textContent = String(cfg.safeApps.length).padStart(2, '0');

    const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
    const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };

    setVal('cat-scale', cfg.cat.scale);
    setTxt('cat-scale-val', cfg.cat.scale + '%');
    setVal('trail-depth', cfg.cat.trailDepth);
    setTxt('trail-depth-val', cfg.cat.trailDepth);
    setVal('cat-speed', cfg.cat.speed != null ? cfg.cat.speed : 100);
    setTxt('cat-speed-val', (cfg.cat.speed != null ? cfg.cat.speed : 100) + '%');

    setCheck('trail-toggle', cfg.cat.trailEnabled);
    setCheck('particles-toggle', (Number(cfg.cat.density) || 0) > 0);
    setCheck('startup-toggle', !!cfg.startup);
    setCheck('optimized-toggle', !!cfg.optimized);

    setVal('pet-name', cfg.name);
    setVal('np-text', cfg.nameplate.text);
    setVal('np-outline', cfg.nameplate.outline);

    updateNameplatePreview();
    renderSkins();
}

// ---------- lists ----------
function wireAdd(inputId, buttonId, get, set) {
    const input = $(inputId);
    const button = $(buttonId);
    if (!input || !button) return;
    const commit = () => {
        const v = input.value.trim().toLowerCase();
        input.value = '';
        if (!v) return;
        const list = get();
        if (list.includes(v)) return;
        set(list.concat([v]));
        renderAll();
        push();
    };
    button.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
}
wireAdd('new-site', 'add-site', () => cfg.sites, (v) => { cfg.sites = v; });
wireAdd('new-game', 'add-game', () => cfg.games, (v) => { cfg.games = v; });
wireAdd('new-safe', 'add-safe', () => cfg.safeApps, (v) => { cfg.safeApps = v; });

// ---------- sliders ----------
const slider = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('input', (e) => { fn(Number(e.target.value)); push(); });
};
slider('cat-scale', (v) => { cfg.cat.scale = v; const t = $('cat-scale-val'); if (t) t.textContent = v + '%'; });
slider('trail-depth', (v) => { cfg.cat.trailDepth = v; const t = $('trail-depth-val'); if (t) t.textContent = v; });
slider('cat-speed', (v) => { cfg.cat.speed = v; const t = $('cat-speed-val'); if (t) t.textContent = v + '%'; });

// ---------- toggles ----------
const trailToggle = $('trail-toggle');
if (trailToggle) trailToggle.addEventListener('click', () => {
    cfg.cat.trailEnabled = !cfg.cat.trailEnabled;
    setCheck('trail-toggle', cfg.cat.trailEnabled);
    push();
});

// Particles is a Trail-style button now, not a free slider: ON stores the
// default density, OFF stores 0 (the pet renderer and the preview both
// treat density 0 as "no particles"), so the user never picks a number.
const particlesToggle = $('particles-toggle');
const DEFAULT_DENSITY = (DEFAULTS.cat && DEFAULTS.cat.density) || 55;
if (particlesToggle) particlesToggle.addEventListener('click', () => {
    cfg.cat.density = (Number(cfg.cat.density) || 0) > 0 ? 0 : DEFAULT_DENSITY;
    setCheck('particles-toggle', cfg.cat.density > 0);
    push();
});

const startupToggle = $('startup-toggle');
if (startupToggle) startupToggle.addEventListener('click', () => {
    cfg.startup = !cfg.startup;
    setCheck('startup-toggle', !!cfg.startup);
    push();
});

const optimizedToggle = $('optimized-toggle');
if (optimizedToggle) optimizedToggle.addEventListener('click', () => {
    cfg.optimized = !cfg.optimized;
    setCheck('optimized-toggle', !!cfg.optimized);
    push();
});

// ---------- nameplate inputs ----------
const nameInput = $('pet-name');
if (nameInput) nameInput.addEventListener('input', (e) => { cfg.name = e.target.value; updateNameplatePreview(); push(); });
const textInput = $('np-text');
if (textInput) textInput.addEventListener('input', (e) => { cfg.nameplate.text = e.target.value; updateNameplatePreview(); push(); });
const outlineInput = $('np-outline');
if (outlineInput) outlineInput.addEventListener('input', (e) => { cfg.nameplate.outline = e.target.value; updateNameplatePreview(); push(); });

// ---------- save and reset ----------
let savedTimer = null;
const saveBtn = $('save-button');
if (saveBtn) saveBtn.addEventListener('click', () => {
    push(true);
    setHello(cfg.name);
    saveBtn.classList.add('saved');
    const label = $('save-label');
    if (label) label.textContent = 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
        saveBtn.classList.remove('saved');
        if (label) label.textContent = 'Save';
    }, 2200);
});
const resetBtn = $('reset-button');
if (resetBtn) resetBtn.addEventListener('click', () => {
    cfg = clone(DEFAULTS);
    renderAll();
    setHello(cfg.name);
    push(true);
});

// ---------- topbar buttons ----------
const pauseBtn = $('pause-toggle');
function setPauseButton(paused) {
    if (!pauseBtn) return;
    pauseBtn.classList.toggle('paused', !!paused);
    pauseBtn.setAttribute('aria-label', paused ? 'Resume the cat' : 'Pause the cat');
}
if (pauseBtn) pauseBtn.addEventListener('click', () => {
    if (window.api && typeof window.api.togglePause === 'function') window.api.togglePause();
});
const quitBtn = $('quit-button');
if (quitBtn) quitBtn.addEventListener('click', () => {
    if (window.api && typeof window.api.quitApp === 'function') window.api.quitApp();
});
const restartBtn = $('restart-button');
if (restartBtn) restartBtn.addEventListener('click', () => {
    if (window.api && typeof window.api.restartApp === 'function') window.api.restartApp();
});

try {
    window.api.onFxUpdate((cat) => {
        if (cat && typeof cat.paused !== 'undefined') {
            setPreviewPaused(cat.paused);
            setPauseButton(cat.paused);
        }
    });
} catch (error) { /* ignore */ }
if (window.api && typeof window.api.getConfig === 'function') {
    window.api.getConfig().then((c) => {
        const p = !!(c && c.paused);
        setPreviewPaused(p);
        setPauseButton(p);
    }).catch(() => {});
}

// ---------- skins picker ----------
let skinsBuilt = false;
function renderSkins() {
    const grid = $('skin-grid');
    if (!grid) return;
    if (!window.SKINS) {
        setTimeout(renderSkins, 200);
        return;
    }

    if (!skinsBuilt) {
        try {
            grid.innerHTML = '';
            (window.SKIN_LIST || Object.keys(window.SKINS)).forEach((id) => {
                const skin = window.SKINS[id];
                if (!skin) return;
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'skin-card';
                card.dataset.skin = skin.id;
                const thumb = document.createElement('div');
                thumb.className = 'skin-thumb';
                const probe = new Image();
                probe.onload = () => {
                    const cols = Math.max(1, skin.cols || skin.frames || 4);
                    const rows = Math.max(1, skin.rows || 1);
                    const fw = probe.naturalWidth / cols;
                    const fh = (probe.naturalHeight / rows) || 1;
                    const H = Math.max(24, Math.round(64 * (skin.cardScale || 1)));
                    let crop = skin.thumbCrop || null;
                    if (!crop && skin.autoCrop) {
                        try {
                            const cc = document.createElement('canvas');
                            cc.width = Math.max(1, Math.round(fw / 2));
                            cc.height = Math.max(1, Math.round(fh / 2));
                            const ccx = cc.getContext('2d');
                            ccx.drawImage(probe, 0, 0, fw, fh, 0, 0, cc.width, cc.height);
                            const dd = ccx.getImageData(0, 0, cc.width, cc.height).data;
                            let minX = cc.width, minY = cc.height, maxX = -1, maxY = -1;
                            for (let y = 0; y < cc.height; y++) {
                                for (let x = 0; x < cc.width; x++) {
                                    if (dd[(y * cc.width + x) * 4 + 3] > 10) {
                                        if (x < minX) minX = x;
                                        if (x > maxX) maxX = x;
                                        if (y < minY) minY = y;
                                        if (y > maxY) maxY = y;
                                    }
                                }
                            }
                            if (maxX >= 0) {
                                crop = {
                                    x: minX / cc.width,
                                    y: minY / cc.height,
                                    w: (maxX - minX + 1) / cc.width,
                                    h: (maxY - minY + 1) / cc.height
                                };
                            }
                        } catch (error) { crop = null; }
                    }
                    if (!crop) crop = { x: 0, y: 0, w: 1, h: 1 };
                    const cw = fw * crop.w;
                    const ch = fh * crop.h;
                    const scale = H / ch;
                    thumb.style.width = Math.round(cw * scale) + 'px';
                    thumb.style.backgroundImage = "url('" + skin.sheet + "')";
                    thumb.style.backgroundSize = Math.round(probe.naturalWidth * scale) + 'px ' + Math.round(probe.naturalHeight * scale) + 'px';
                    const p0 = window.skinFramePos ? window.skinFramePos(skin, 0) : { px: 0, py: 0 };
                    const ox = (p0.px <= 50 ? -1 : 1) * Math.round((p0.px <= 50 ? crop.x : (1 - crop.x - crop.w)) * fw * scale);
                    const oy = (p0.py <= 50 ? -1 : 1) * Math.round((p0.py <= 50 ? crop.y : (1 - crop.y - crop.h)) * fh * scale);
                    thumb.style.backgroundPosition = 'calc(' + p0.px + '% + ' + ox + 'px) calc(' + p0.py + '% + ' + oy + 'px)';
                };
                setTimeout(() => { probe.src = skin.sheet; }, (window.__skinProbeQueue = (window.__skinProbeQueue || 0) + 1) * 120);
                const name = document.createElement('span');
                name.className = 'skin-name';
                name.textContent = skin.name;
                card.appendChild(thumb);
                card.appendChild(name);
                card.addEventListener('mousedown', (e) => e.preventDefault());
                card.addEventListener('click', () => {
                    cfg.cat.skin = skin.id;
                    renderSkins();
                    if (window.applyPreviewSkin) window.applyPreviewSkin(skin.id);
                    push();
                });
                grid.appendChild(card);
            });
            skinsBuilt = true;
        } catch (error) {
            console.error('skin cards build failed:', error);
            skinsBuilt = false;
            setTimeout(renderSkins, 500);
        }
    }

    grid.querySelectorAll('.skin-card').forEach((card) => {
        card.classList.toggle('selected', card.dataset.skin === (cfg.cat.skin || 'nyan'));
    });
}

// ---------- boot ----------
renderAll();
switchPage('focus');
setHello(cfg.name);

function hydrateFromMain() {
    if (!window.api || typeof window.api.getConfig !== 'function') return;
    window.api.getConfig().then((src) => {
        if (!src) return;
        cfg.name = src.name || cfg.name;
        if (src.sites) cfg.sites = src.sites.slice();
        if (src.games) cfg.games = src.games.slice();
        if (src.safeApps) cfg.safeApps = src.safeApps.slice();
        if (src.cat) cfg.cat = Object.assign({}, cfg.cat, src.cat);
        if (src.nameplate) cfg.nameplate = Object.assign({}, cfg.nameplate, src.nameplate);
        cfg.startup = !!src.startup;
        cfg.optimized = !!src.optimized;
        renderAll();
        setHello(cfg.name);
        if (window.applyPreviewSkin) window.applyPreviewSkin(cfg.cat.skin || 'nyan');
    }).catch(() => {});
}
hydrateFromMain();
setTimeout(hydrateFromMain, 800);
window.addEventListener('focus', hydrateFromMain);

(function ensureSkins() {
    const iv = setInterval(() => {
        const grid = $('skin-grid');
        if (grid && grid.querySelector('.skin-card')) {
            clearInterval(iv);
            return;
        }
        renderSkins();
    }, 500);
    setTimeout(() => clearInterval(iv), 10000);
})();

(function overrideReset() {
    const old = document.getElementById('reset-button');
    if (!old) return;
    const fresh = old.cloneNode(true);
    old.parentNode.replaceChild(fresh, old);

    fresh.addEventListener('click', () => {
        cfg.cat = Object.assign({}, cfg.cat, {
            scale: (DEFAULTS.cat && DEFAULTS.cat.scale) || 100,
            density: (DEFAULTS.cat && DEFAULTS.cat.density) || 55,
            trailDepth: (DEFAULTS.cat && DEFAULTS.cat.trailDepth) || 20,
            speed: (DEFAULTS.cat && DEFAULTS.cat.speed) || 100,
            trailEnabled: (DEFAULTS.cat && DEFAULTS.cat.trailEnabled !== false),
            skin: (DEFAULTS.cat && DEFAULTS.cat.skin) || 'nyan'
        });
        cfg.nameplate = Object.assign({}, cfg.nameplate, {
            text: (DEFAULTS.nameplate && DEFAULTS.nameplate.text) || '#ffffff',
            outline: (DEFAULTS.nameplate && DEFAULTS.nameplate.outline) || '#000000'
        });
        renderAll();
        if (typeof updateNameplatePreview === 'function') updateNameplatePreview();
        if (typeof ensureSkins === 'function') ensureSkins();
        push();
    });
})();

// Rename cat: reopen the login card over the running pet
(function () {
    const btn = document.getElementById('rename-button');
    if (!btn || btn.dataset._renameWired) return;
    btn.dataset._renameWired = '1';
    btn.addEventListener('click', () => {
        if (window.api && typeof window.api.openLogin === 'function') window.api.openLogin();
    });
})();

// Credits breadcrumb label 
(function fixCreditsCrumb() {
    const btn = document.querySelector('.nav-item[data-page="credits"]');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const crumb = document.getElementById('breadcrumb-current');
        if (crumb) crumb.textContent = 'Credits';
    });
})();

// Hide the Reset footer on Credits
(function forceFooterHideOnCredits() {
    const tick = () => {
        const btn = document.getElementById('reset-button');
        const credits = document.getElementById('page-credits');
        if (!btn || !credits) return;
        btn.style.display = credits.classList.contains('active') ? 'none' : '';
    };
    tick();
    setInterval(tick, 200);
})();

// Build the "Optimised performance" toggle by cloning the startup row, so it
// inherits the exact markup, classes, checkbox styling and placement of its
// sibling - guaranteed to look identical and sit directly below it.
(function buildOptimizedToggle() {
    const startupBtn = document.getElementById('startup-toggle');
    if (!startupBtn || document.getElementById('optimized-toggle')) return;
    const row = startupBtn.parentElement;
    if (!row || !row.parentElement) return;

    const clone = row.cloneNode(true);
    const btn = clone.querySelector('button');
    if (!btn) return;
    btn.id = 'optimized-toggle';
    btn.classList.remove('checked');
    btn.setAttribute('aria-checked', 'false');
    const box = btn.querySelector('.checkbox');
    if (box) box.innerHTML = '';

    // Relabel: every non-button direct child holds the row's text
    Array.from(clone.children).forEach((child) => {
        if (child.tagName !== 'BUTTON') child.textContent = 'Optimised performance';
    });

    // Insert directly below the startup row
    row.parentElement.insertBefore(clone, row.nextSibling);

    btn.addEventListener('click', () => {
        cfg.optimized = !cfg.optimized;
        setCheck('optimized-toggle', !!cfg.optimized);
        push();
    });
    setCheck('optimized-toggle', !!cfg.optimized);
})();