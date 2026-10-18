// nameplate.js: draws the pet name above the live cat.

const BASE_SCALE = 2;
const GAP = 3;
const POLL_MS = 5000;
const POS_MS = 1000;
const FONT_PX = 16;
const MONO_FONT = FONT_PX + 'px "Press Start 2P", Consolas, "Courier New", monospace';

const NP_DEFAULTS = { text: '#ffffff', outline: '#000000', chunky: false };

// Pixel-emoji support: a 4-levels-per-channel table so smooth emoji
const QUANT = (() => {
    const levels = [0, 85, 170, 255];
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
        let best = 0, bd = 1e9;
        for (const L of levels) {
            const dd = Math.abs(v - L);
            if (dd < bd) { bd = dd; best = L; }
        }
        t[v] = best;
    }
    return t;
})();

function parseColor(c) {
    const s = String(c || '').trim();
    let m = s.match(/^#?([0-9a-f]{6})$/i);
    if (m) {
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    m = s.match(/^#?([0-9a-f]{3})$/i);
    if (m) {
        const h = m[1];
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
        const p = m[1].split(',').map(x => parseFloat(x));
        return [p[0] | 0, p[1] | 0, p[2] | 0];
    }
    return [255, 255, 255];
}

const blockEl = document.getElementById('block');
const catboxEl = document.getElementById('catbox');

const plate = document.createElement('canvas');
plate.id = 'nameplate';
plate.style.position = 'absolute';
plate.style.pointerEvents = 'none';
plate.style.zIndex = '5';
blockEl.appendChild(plate);

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

let lastName = '';
let lastNp = Object.assign({}, NP_DEFAULTS);
let catScale = 100;
let lastScale = 100;
let lastWinH = 0;
let plateXRatio = 0.5;
let plateSink = 0;

if (document.fonts && document.fonts.ready) {
    document.fonts.ready
        .then(() => { lastName = ''; poll(); })
        .catch(() => { lastName = ''; poll(); });
}

function plateScale() {
    return Math.max(1, BASE_SCALE * catScale / 100);
}

function hasResize() {
    return !!(window.api && typeof window.api.resizeWindow === 'function');
}

function plateXForSkin(id) {
    const reg = window.SKINS || {};
    const skin = reg[id];
    if (skin && typeof skin.plateX === 'number') return skin.plateX;
    return 0.5;
}

function sinkForSkin(id) {
    const reg = window.SKINS || {};
    const skin = reg[id];
    if (skin && typeof skin.plateSink === 'number') return skin.plateSink;
    return 0;
}

function skinIdFromSprite() {
    const el = document.getElementById('sprite');
    if (!el) return null;
    const bg = el.style.backgroundImage || '';
    if (!bg) return null;
    const reg = window.SKINS || {};
    for (const id in reg) {
        if (reg[id].sheet && bg.indexOf(reg[id].sheet) !== -1) return id;
    }
    return null;
}

function syncSkinPlate() {
    const id = skinIdFromSprite();
    if (id === null) return;
    const x = plateXForSkin(id);
    const s = sinkForSkin(id);
    if (x !== plateXRatio || s !== plateSink) {
        plateXRatio = x;
        plateSink = s;
        positionPlate();
    }
}

document.addEventListener('yako-skin', (e) => {
    plateXRatio = plateXForSkin(e.detail);
    plateSink = sinkForSkin(e.detail);
    positionPlate();
});

function fitWindow() {
    if (!hasResize() || !catboxEl) return;
    const catH = catboxEl.offsetHeight || 90;
    const need = Math.max(150, Math.round(catH + plate.height + GAP + 8));
    if (need !== lastWinH) {
        lastWinH = need;
        window.api.resizeWindow(800, need);
    }
}

function monoWidth(str) {
    measureCtx.font = MONO_FONT;
    return Math.ceil(measureCtx.measureText(str).width) + 3;
}

function wrapWords(text, widthOf, maxUnits) {
    const words = String(text).split(/\s+/).filter(w => w.length);
    if (!words.length) return [''];
    const lines = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? current + ' ' + word : word;
        if (!current || widthOf(candidate) <= maxUnits) {
            current = candidate;
        } else {
            lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines;
}

function renderName(name, np) {
    try {
        // Blank name = no nameplate at all
        if (!name || !name.trim()) {
            plate.style.display = 'none';
            plate.width = 1;
            plate.height = 1;
            lastName = name;
            lastNp = np;
            lastScale = catScale;
            fitWindow();
            return;
        }
        plate.style.display = '';

        const maxW = Math.max(80, window.innerWidth - 8);
        const widthOf = (line) => monoWidth(line);
        let S = plateScale();
        const linesAt = (s) => wrapWords(name, widthOf, Math.max(4, Math.floor(maxW / s)));
        let lines = linesAt(S);
        const widest = lines.reduce((m, l) => Math.max(m, widthOf(l)), 1);
        const maxUnits = Math.max(4, Math.floor(maxW / S));
        if (widest > maxUnits) {
            S = Math.max(1, S * (maxUnits / widest));
            lines = linesAt(S);
        }
        S = Math.max(1, Math.round(S));
        lines = linesAt(S);

        const lineH = FONT_PX + 2;
        const w = lines.reduce((m, l) => Math.max(m, monoWidth(l)), 1) + 3;
        const h = lines.length * lineH + 3;

        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const octx = off.getContext('2d');
        octx.font = MONO_FONT;
        octx.textBaseline = 'top';

        const strikes = (np.chunky !== false) ? [[0, 0], [1, 0]] : [[0, 0]];
        const offs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
        lines.forEach((line, i) => {
            octx.fillStyle = np.outline;
            for (const [dx, dy] of offs) {
                for (const [sx, sy] of strikes) {
                    octx.fillText(line, 2 + dx + sx, 2 + dy + sy + i * lineH);
                }
            }
            octx.fillStyle = np.text;
            for (const [sx, sy] of strikes) {
                octx.fillText(line, 2 + sx, 2 + sy + i * lineH);
            }
        });

        const img = octx.getImageData(0, 0, w, h);
        const d = img.data;
        const tC = parseColor(np.text);
        const oC = parseColor(np.outline);
        const near = (r, g, b, c) =>
            Math.abs(r - c[0]) < 12 && Math.abs(g - c[1]) < 12 && Math.abs(b - c[2]) < 12;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 110) {
                d[i + 3] = 255;
                if (!near(d[i], d[i + 1], d[i + 2], tC) &&
                    !near(d[i], d[i + 1], d[i + 2], oC)) {
                    d[i] = QUANT[d[i]];
                    d[i + 1] = QUANT[d[i + 1]];
                    d[i + 2] = QUANT[d[i + 2]];
                }
            } else {
                d[i + 3] = 0;
            }
        }
        octx.putImageData(img, 0, 0);

        plate.width = Math.max(1, Math.round(w * S));
        plate.height = Math.max(1, Math.round(h * S));
        const ctx = plate.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, plate.width, plate.height);
        ctx.drawImage(off, 0, 0, w, h, 0, 0, plate.width, plate.height);

        lastName = name;
        lastNp = np;
        lastScale = catScale;
        fitWindow();
    } catch (error) {
        console.error('nameplate render failed:', error);
    }
}

function needsRender(name, np) {
    // Force re-render if last pass produced a degenerate plate despite a real
    // name (fonts not yet loaded, measurement glitch, etc.) - the next poll
    // retries until the plate actually renders.
    if (name && name.trim() && plate.width < 10 && lastName === name) return true;
    return name !== lastName ||
        JSON.stringify(np) !== JSON.stringify(lastNp) ||
        catScale !== lastScale;
}

function positionPlate() {
    if (!catboxEl) return;
    const top = Math.max(2, catboxEl.offsetTop - GAP + plateSink - plate.height);
    const maxLeft = Math.max(2, window.innerWidth - plate.width - 4);
    let left = catboxEl.offsetLeft + Math.round(catboxEl.offsetWidth * plateXRatio - plate.width / 2);
    left = Math.max(2, Math.min(left, maxLeft));
    plate.style.top = top + 'px';
    plate.style.left = left + 'px';
}

async function poll() {
    let name = lastName || '';
    let np = Object.assign({}, NP_DEFAULTS);
    try {
        const cfg = await window.api.getConfig();
        name = String(cfg.name || '');
        np = Object.assign({}, NP_DEFAULTS, cfg.nameplate);
        catScale = Number(cfg.cat && cfg.cat.scale) || 100;
    } catch (error) {
        // keep last known values
    }
    if (!plate.height) renderName(name, np);
    syncSkinPlate();
    if (needsRender(name, np)) renderName(name, np);
    fitWindow();
    positionPlate();
    signalLayoutReady();
}

// Tell the renderer the window is now at its final height, so it can start the
// render loop against a settled layout instead of fitting the canvas to the
// 150px placeholder and resizing a moment later.
function signalLayoutReady() {
    if (window.__petLayoutReady) return;
    window.__petLayoutReady = true;
    try {
        window.dispatchEvent(new CustomEvent('pet-layout-ready'));
    } catch (error) { /* ignore */ }
}

try {
    window.api.onFxUpdate((cat) => {
        const s = Number(cat && cat.scale);
        if (s && s !== catScale) {
            catScale = s;
            renderName(lastName || '', lastNp);
        }
        // The live update now carries the name + colours too, so a rename or a
        // colour change repaints instantly instead of waiting for the 5s poll.
        if (typeof cat.name === 'string' || cat.nameplate) {
            const name = String(cat.name || '');
            const np = Object.assign({}, NP_DEFAULTS, cat.nameplate || lastNp);
            if (needsRender(name, np)) renderName(name, np);
        }
        fitWindow();
        positionPlate();
    });
} catch (error) {
    // polling alone still covers it
}

renderName('', Object.assign({}, NP_DEFAULTS));
syncSkinPlate();
positionPlate();
poll();

setInterval(poll, POLL_MS);
setInterval(positionPlate, POS_MS);
window.addEventListener('resize', () => {
    fitWindow();
    positionPlate();
});