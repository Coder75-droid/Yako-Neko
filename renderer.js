// renderer.js: sprite frames + trail + particles for the live pet.
// NOTE: this used to read getElementById('Cat') - the real element id in
// index.html is "block", so `block` was always null: the mousedown handler
// below threw (aborting the rest of this script) and state-change could
// never apply warning/blocked classes.
const block = document.getElementById('block');
const sprite = document.getElementById('sprite');
const catbox = document.getElementById('catbox');
const fx = document.getElementById('fx');
const ctx = fx.getContext('2d');

function fitCanvas() {
    fx.width = window.innerWidth;
    fx.height = window.innerHeight;
}

fitCanvas();
window.addEventListener('resize', () => {
    fitCanvas();
    applyScale();
});

let catCfg = { scale: 100, density: 55, trailDepth: 20, trailEnabled: true, speed: 100, skin: 'nyan' };

const RAINBOW = [
    [255, 0, 0],
    [255, 165, 0],
    [255, 255, 0],
    [50, 205, 50],
    [0, 191, 255],
    [148, 0, 211]
];

let TRAIL = RAINBOW;
let trailPlug = 0;
let skinNoTrail = false;

// Pre-rendered fill colours. The old draw() built an `rgba(...)` string (with
// toFixed) for every single rect every frame - hundreds of throwaway strings a
// second, which made the GC hitch and the trail appear to "buffer". We now
// build these once per skin and only animate globalAlpha (a number: no
// allocation, no GC).
let TRAIL_CSS = [];
let TRAIL_TW = [];
function buildTrailStyles() {
    TRAIL_CSS = TRAIL.map((c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')');
    TRAIL_TW = TRAIL.map((c) => {
        const shades = [];
        for (let k = 0; k < 7; k++) {
            const t = 1 + k * 0.1;   // twinkle brightens the core by up to +60%
            shades.push('rgb(' +
                Math.min(255, Math.round(c[0] * t)) + ',' +
                Math.min(255, Math.round(c[1] * t)) + ',' +
                Math.min(255, Math.round(c[2] * t)) + ')');
        }
        return shades;
    });
}
buildTrailStyles();

let wave = 0;
let stars = [];
let trail = [];
let burst = [];

// --- OPTIMIZED PERFORMANCE MODE LOGIC ---

// Hard limits ONLY used when Optimized Mode is ON
const OPT_MAX_TRAIL = 60;
const OPT_MAX_STARS = 24;
const OPT_MAX_BURST = 60;
// Generous safety cap for normal mode so a heavy density setting can never
// snowball the particle count (and the CPU) without bound.
const MAX_TRAIL = 140;

let userOpt = false; // The manual "Optimised performance" toggle from settings

// Degraded (low quality) mode is driven ONLY by the user's Optimised
// performance toggle. The old auto-lag detector could flip quality on its own,
// changing the visuals under the user with no warning, so it is gone.
function isDegraded() { 
    return userOpt; 
}

// Tell main (and movement.js) how the machine is doing.
function reportPerfState() {
    const low = !!userOpt;
    window.__yakoPerfLow = low;
    try {
        if (window.api && typeof window.api.reportPerf === 'function') {
            window.api.reportPerf(low ? 'low' : 'normal');
        }
    } catch (error) { /* ignore */ }
}

// Calculate density based on mode
function effDensity() { 
    if (isDegraded()) {
        // Optimized mode: a light trim, not a gutting - the old 0.4x/50 cap
        // made the trail look sparse and choppy.
        return Math.max(0, Math.min(Math.round(catCfg.density * 0.65), 75)); 
    }
    // Normal mode: Use config, but soft cap at 90 to prevent insanity
    return Math.min(catCfg.density, 90); 
}

// Calculate depth based on mode
function effDepth() { 
    if (isDegraded()) {
        // Optimized mode: keep most of the ribbon so the tail stays smooth.
        return Math.max(6, Math.round(catCfg.trailDepth * 0.7)); 
    }
    // Normal mode: Use config, cap at 30
    return Math.min(catCfg.trailDepth, 30); 
}

// ----------------------------------------

let frameW = 120;
let frameH = 90;

let frameCount = 4;
let skinCols = 4;
let skinRows = 1;
let frameMs = 50;
let currentSkinId = '';
let currentSkin = null;
let animState = 'idle';

const sheet = new Image();
const sheetMetrics = {};
let sheetLoadToken = 0;
let artCrop = null; 

const BODY_REF_H = 90;

function computeArtCrop(im, cols, rows) {
    try {
        const fw = Math.max(1, Math.round(im.naturalWidth / cols));
        const fh = Math.max(1, Math.round(im.naturalHeight / rows));
        const c = document.createElement('canvas');
        c.width = fw;
        c.height = fh;
        const cx = c.getContext('2d');
        cx.drawImage(im, 0, 0, fw, fh, 0, 0, fw, fh);
        const d = cx.getImageData(0, 0, fw, fh).data;
        let minX = fw, minY = fh, maxX = -1, maxY = -1;
        for (let y = 0; y < fh; y++) {
            for (let x = 0; x < fw; x++) {
                if (d[(y * fw + x) * 4 + 3] > 10) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    } catch (error) {
        return null;
    }
}

function applySkin(id) {
    const reg = window.SKINS || {};
    const skin = reg[id] || reg.nyan;
    if (!skin) return;
    currentSkinId = skin.id;
    currentSkin = skin;
    frameCount = Math.max(1, skin.frames || 4);
    skinCols = Math.max(1, skin.cols || frameCount);
    skinRows = Math.max(1, skin.rows || 1);
    frameMs = Math.max(16, skin.frameMs || 50);
    TRAIL = skin.trail || RAINBOW;
    buildTrailStyles();
    trailPlug = skin.trailPlug || 0;
    skinNoTrail = !!skin.noTrail;
    if (skinNoTrail) trail = [];
    frameIndex = 0;
    sprite.style.backgroundImage = "url('" + skin.sheet + "')";
    artCrop = null;
    try {
        document.dispatchEvent(new CustomEvent('yako-skin', { detail: skin.id }));
    } catch (error) { /* ignore */ }

    const cached = sheetMetrics[skin.id];
    if (cached) {
        frameW = cached.w;
        frameH = cached.h;
        if (cached.crop !== undefined) artCrop = cached.crop;
        applyScale();
    }
    const token = ++sheetLoadToken;
    sheet.onload = () => {
        if (token !== sheetLoadToken) return;
        frameW = Math.round(sheet.naturalWidth / Math.max(1, skinCols));
        frameH = Math.round(sheet.naturalHeight / Math.max(1, skinRows));
        let crop = null;
        if (skin.autoCrop) crop = computeArtCrop(sheet, skinCols, skinRows);
        sheetMetrics[skin.id] = { w: frameW, h: frameH, crop: crop };
        artCrop = crop;
        sheetReady = true;
        applyScale();
        refreshAnimSpeed();
    };
    sheet.onerror = () => {
        if (token !== sheetLoadToken) return;
        console.error('skin sheet failed to load:', skin.id);
        sheetReady = true;
        if (skin.id !== 'nyan') applySkin('nyan');
        refreshAnimSpeed();
    };
    sheet.src = skin.sheet;
    refreshAnimSpeed();
}

function syncSkin() {
    const id = catCfg.skin || 'nyan';
    if (id !== currentSkinId) applySkin(id);
}

function catSize() {
    const scale = catCfg.scale / 100;
    const h0 = BODY_REF_H;
    let ratio;
    if (currentSkin && currentSkin.autoCrop && artCrop) {
        ratio = artCrop.w / Math.max(1, artCrop.h);
    } else {
        ratio = frameW / Math.max(1, frameH);
    }
    const w0 = Math.max(1, Math.round(h0 * ratio));
    return {
        w: Math.max(40, Math.round(w0 * scale)),
        h: Math.max(30, Math.round(h0 * scale))
    };
}

function catRect() {
    const size = catSize();
    return {
        x: fx.width - size.w - 20,
        y: fx.height - size.h - 6,
        w: size.w,
        h: size.h
    };
}

function frameColRow(i) {
    const skin = currentSkin || {};
    const cols = Math.max(1, skin.cols || skin.frames || skinCols);
    const rows = Math.max(1, skin.rows || skinRows);
    const total = Math.max(1, skin.frames || cols * rows);
    const idx = ((i % total) + total) % total;
    const row = Math.floor(idx / cols);
    const inRow = idx % cols;
    const colsInRow = Math.min(cols, total - row * cols);
    const col = (skin.order === 'rtl') ? (colsInRow - 1 - inRow) : inRow;
    return { col, row, cols, rows };
}

function setFrameVisual() {
    const { col, row, cols, rows } = frameColRow(frameIndex);
    if (currentSkin && currentSkin.autoCrop && artCrop) {
        const r = catRect();
        const S = r.h / artCrop.h;
        sprite.style.backgroundSize =
            Math.round(sheet.naturalWidth * S) + 'px ' +
            Math.round(sheet.naturalHeight * S) + 'px';
        const ox = -Math.round((col * frameW + artCrop.x) * S);
        const oy = -Math.round((row * frameH + artCrop.y) * S);
        sprite.style.backgroundPosition = ox + 'px ' + oy + 'px';
    } else {
        sprite.style.backgroundSize = (cols * 100) + '% ' + (rows * 100) + '%';
        const px = cols > 1 ? (col * 100) / (cols - 1) : 0;
        const py = rows > 1 ? (row * 100) / (rows - 1) : 0;
        sprite.style.backgroundPosition = px + '% ' + py + '%';
    }

    const f0 = frameColRow(0);
    if (currentSkin && currentSkin.autoCrop && artCrop) {
        const r0 = catRect();
        const S0 = r0.h / artCrop.h;
        const ox0 = -Math.round((f0.col * frameW + artCrop.x) * S0);
        const oy0 = -Math.round((f0.row * frameH + artCrop.y) * S0);
        window.__petFrame0Pos = ox0 + 'px ' + oy0 + 'px';
    } else {
        const px0 = f0.cols > 1 ? (f0.col * 100) / (f0.cols - 1) : 0;
        const py0 = f0.rows > 1 ? (f0.row * 100) / (f0.rows - 1) : 0;
        window.__petFrame0Pos = px0 + '% ' + py0 + '%';
    }
    if (window.__petPaused && !window.__petHoming) {
        const freezeEl = document.getElementById('napFreeze');
        if (freezeEl) {
            freezeEl.textContent = '#sprite { background-position: ' + window.__petFrame0Pos + ' !important; }';
        }
        sprite.style.setProperty('background-position', window.__petFrame0Pos);
    }
}

let lastPlaced = { w: -1, h: -1, y: -1 };
function placeCat() {
    const r = catRect();
    if (r.w === lastPlaced.w && r.h === lastPlaced.h && r.y === lastPlaced.y) return;
    lastPlaced = { w: r.w, h: r.h, y: r.y };
    catbox.style.width = r.w + 'px';
    catbox.style.height = r.h + 'px';
    catbox.style.top = r.y + 'px';
    catbox.style.right = '20px';
}

function applyScale() {
    placeCat();
    setFrameVisual();
}

let frameIndex = 0;
let animTimer = null;

function nextFrame() {
    frameIndex = (frameIndex + 1) % frameCount;
    setFrameVisual();
}

function setAnimSpeed(ms) {
    if (animTimer) clearInterval(animTimer);
    animTimer = setInterval(nextFrame, ms);
}

function animMs() {
    if (animState === 'warning' || animState === 'blocked') return Math.max(16, Math.round(frameMs * 0.7));
    if (animState === 'cooldown') return Math.round(frameMs * 2.4);
    return frameMs;
}

// The sprite sheet is loaded asynchronously below. Animating before it decodes
// makes setFrameVisual() work from sheet.naturalWidth === 0 (the auto-crop
// skins would get wrong frame sizes), then snap when the image arrived - which
// showed up as a visible jump on load.
let sheetReady = false;
function refreshAnimSpeed() {
    if (!sheetReady) return;
    setAnimSpeed(animMs());
}

function seg() {
    const r = catRect();
    return {
        w: Math.max(14, Math.round(18 * catCfg.scale / 100)),
        h: Math.max(2, Math.round(r.h / TRAIL.length))
    };
}

function trailTailWidth() {
    const s = seg();
    return Math.max(180, effDepth() * s.w + 110);
}

// Fractional spawn budgets: the old fixed 50ms tick pushed a whole batch per
// call, which only keeps a constant rate at exactly 20fps. Accumulating
// rate * k lets the rAF loop spawn the same amount per second at any fps.
let starAcc = 0;
let spawnAcc = 0;

function spawnTrailParticles(k) {
    const d = effDensity();
    const maxTrail = isDegraded() ? OPT_MAX_TRAIL : MAX_TRAIL;
    if (skinNoTrail || !catCfg.trailEnabled || d <= 0) { spawnAcc = 0; return; }

    // Hard cap: the Optimized ceiling when trimmed, otherwise a generous safety
    // ceiling so a heavy density setting can never snowball the count.
    if (trail.length >= maxTrail) { spawnAcc = 0; return; }

    const r = catRect();
    const s = seg();
    const tailWidth = trailTailWidth();
    
    // Spawn slightly fewer particles per tick in optimized mode.
    // Same rate the old fixed 50ms tick used - max(1, floor(d / divisor))
    // particles per 50ms of simulated time - accumulated fractionally so any
    // frame rate keeps that exact spawn rate.
    const divisor = isDegraded() ? 24 : 18;
    spawnAcc += Math.max(1, Math.floor(d / divisor)) * k;
    const count = Math.floor(spawnAcc);
    if (count <= 0) return;
    spawnAcc -= count;

    for (let i = 0; i < count; i++) {
        // Safety break for optimized mode
        if (trail.length >= maxTrail) { spawnAcc = 0; break; }

        const band = Math.floor(Math.random() * TRAIL.length);
        const dist = 10 + Math.random() * tailWidth;
        const depth = dist / Math.max(1, tailWidth);

        trail.push({
            x: r.x + Math.round(r.w * trailPlug) - dist,
            y: r.y + band * s.h + (-5 + Math.random() * 13),
            z: Math.random() * 120 + depth * 80,
            vz: -0.8 + Math.random() * 2,
            speed: 2.5 + Math.random() * 6.5,
            size: 2 + Math.floor(Math.random() * 5),
            life: 20 + Math.floor(Math.random() * 32),
            phase: Math.random() * 20,
            drift: 0.3 + Math.random() * 2.4,
            twinkle: Math.random() * Math.PI * 2,
            color: TRAIL[band],
            css: TRAIL_CSS[band] || '#ffffff',
            cssTw: TRAIL_TW[band] || null
        });
    }
}

function stepParticles(k) {
    const d = effDensity();

    // Star spawning logic
    let starChance = d / 180;
    if (isDegraded()) {
        starChance = d / 320; // Lighter reduction in optimized mode
        if (stars.length >= OPT_MAX_STARS) starChance = 0; // Hard cap
    }

    starAcc += d > 0 ? starChance * k : 0;
    while (starAcc >= 1) {
        starAcc -= 1;
        if (!isDegraded() || stars.length < OPT_MAX_STARS) {
            stars.push({
                x: Math.random() * fx.width,
                y: Math.random() * fx.height,
                life: 20,
                speed: 2 + Math.random() * 3
            });
        }
    }

    for (const p of stars) {
        p.x -= p.speed * k;
        p.life -= k;
    }
    // Compact in place - filter() built a fresh array every frame (GC churn).
    let si = 0;
    for (let i = 0; i < stars.length; i++) {
        const p = stars[i];
        if (p.life > 0 && p.x > -4) stars[si++] = p;
    }
    stars.length = si;

    spawnTrailParticles(k);

    for (const p of trail) {
        p.x -= p.speed * k;
        p.y += Math.sin((wave + p.phase) * 0.15) * p.drift * k;
        p.z += p.vz * k;
        p.life -= k;
        p.twinkle += 0.25 * k;
    }
    let ti = 0;
    for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        if (p.life > 0 && p.x > 2) trail[ti++] = p;
    }
    trail.length = ti;

    for (const p of burst) {
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.z += p.vz * k;
        p.vy += 0.5 * k;
        p.life -= k;
    }
    let bi = 0;
    for (let i = 0; i < burst.length; i++) {
        const p = burst[i];
        if (p.life > 0 && p.z > 0.1) burst[bi++] = p;
    }
    burst.length = bi;
}

function draw() {
    ctx.clearRect(0, 0, fx.width, fx.height);

    const r = catRect();
    const s = seg();
    const depth = effDepth();

    if (catCfg.trailEnabled && !skinNoTrail) {
        const plugX = r.x + Math.round(r.w * trailPlug);
        const amp = Math.max(3, r.h * 0.08);
        const invDepth = 1 / Math.max(1, depth);
        for (let i = 0; i < depth; i++) {
            const x = plugX - i * s.w;
            if (x < -s.w) break;

            const yOff = Math.round(Math.sin((wave + i) * 0.5) * amp);
            // Only the alpha changes per column - a plain number, no allocation.
            ctx.globalAlpha = (150 / 255) * Math.max(0.18, 1 - i * invDepth * 0.55);

            for (let c = 0; c < TRAIL.length; c++) {
                ctx.fillStyle = TRAIL_CSS[c] || '#ffffff';
                ctx.fillRect(x, r.y + c * s.h + yOff, s.w, s.h);
            }
        }

        // Sort in place: the order is not used anywhere else, so the per-frame
        // slice()+sort() copy was pure allocation/GC pressure on low-end boxes.
        trail.sort((a, b) => a.z - b.z);
        for (const p of trail) {
            if (p.x < 2 || p.x > r.x + r.w) continue;

            const scale = 170 / (170 + p.z);
            const size = Math.max(1, Math.round(p.size * scale));
            const alpha = 210 * Math.min(1, p.life / 30);

            ctx.fillStyle = p.css || '#ffffff';
            ctx.globalAlpha = Math.max(35, alpha / 3) / 255;
            ctx.fillRect(
                Math.round(p.x - size),
                Math.round(p.y - size),
                size * 3,
                size * 3
            );

            // Twinkle brightens the core; pick a precomputed shade (0..6).
            const twIdx = Math.max(0, Math.min(6, Math.round(Math.sin(p.twinkle) * 3) + 3));
            ctx.fillStyle = (p.cssTw && p.cssTw[twIdx]) || p.css || '#ffffff';
            ctx.globalAlpha = alpha / 255;
            ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
        }
    }

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1;
    for (const p of stars) {
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }

    for (const p of burst) {
        const scale = 200 / (200 + p.z);
        const size = Math.max(1, Math.round(5 * scale));
        ctx.fillStyle = p.css || '#ffffff';
        ctx.globalAlpha = Math.min(1, p.life / 20);
        ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
    }
    ctx.globalAlpha = 1;
}

function spawnBurst(x, y) {
    // Cap burst particles based on mode
    let n = 8 + Math.floor(effDensity() / 2);
    if (isDegraded()) {
        n = Math.min(OPT_MAX_BURST, n);
    }

    for (let i = 0; i < n; i++) {
        const band = Math.floor(Math.random() * TRAIL.length);
        burst.push({
            x,
            y,
            z: 0,
            vx: -5 + Math.random() * 10,
            vy: -5 + Math.random() * 10,
            vz: 1 + Math.random() * 9,
            life: 40,
            color: TRAIL[band],
            css: TRAIL_CSS[band] || '#ffffff'
        });
    }
}

let loopsStarted = false;

function startLoops() {
    if (loopsStarted) return;
    loopsStarted = true;
    refreshAnimSpeed();

    let renderLast = performance.now();
    let lastCb = performance.now();
    let fallbackFrameAt = 0;
    let frameNo = 0;
    let slowStreak = 0;
    let fastStreak = 0;
    let halfRate = false;

    // requestAnimationFrame instead of setInterval(..., 50): the old 20fps
    // tick with whole-step particle motion is exactly the "buffer-y" trail.
    // The physics is dt-scaled (same pattern preview-fx.js already uses for
    // the settings preview), so motion is smooth at any frame rate.
    function frame(now) {
        requestAnimationFrame(frame);

        const rawDt = now - lastCb;
        lastCb = now;

        // Nothing is on screen to paint: skip the whole frame. The pet keeps
        // flying (movement.js owns the window position) but we stop burning
        // CPU/GPU frames on a window the OS is not showing.
        if (document.hidden) { renderLast = now; return; }

        // Napping: nap.js fades the trail canvas out, so there is no point
        // computing particles for an invisible canvas. Homing still draws.
        if (window.__petPaused && !window.__petHoming) { renderLast = now; return; }

        // Health signal from raw callback spacing (a frame we deliberately
        // skip must not count as "slow" - we judge the browser's cadence).
        // Fast to degrade (~1-2s of struggle), slow to recover (~8s healthy),
        // so a borderline machine settles instead of flip-flopping.
        if (rawDt > 50) {
            slowStreak += 1;
            fastStreak = 0;
            if (!halfRate && slowStreak >= 30) halfRate = true;
        } else if (rawDt < 40) {
            fastStreak += 1;
            slowStreak = Math.max(0, slowStreak - 1);
            if (halfRate && fastStreak >= 480) {
                halfRate = false;
                slowStreak = 0;
                fastStreak = 0;
            }
        }

        // Explicit Optimised-performance toggle (or the safety valve above):
        // paint every other frame. This only changes WHEN we paint, never
        // WHAT - particle counts stay under the user's control - and because
        // renderLast advances only on painted frames, the dt accumulation
        // keeps particle speeds exact: nothing detaches, nothing slows.
        // Publish paint health: movement.js reads this so that when WE are
        // struggling (GPU/vsync-bound - invisible to its own timer) it eases
        // off forcing ~60Hz window recomposites too.
        window.__yakoFrameSlow = halfRate;

        frameNo += 1;
        if ((window.__yakoPerfLow || halfRate) && (frameNo & 1)) return;

        let dt = now - renderLast;
        renderLast = now;
        if (dt > 150) dt = 150;
        const k = dt / 50; // particle speeds are tuned to a 50ms reference step

        if (fx.width !== window.innerWidth || fx.height !== window.innerHeight) {
            fitCanvas();
            applyScale();
        }

        // Low quality is now controlled solely by the "Optimised performance"
        // toggle (see isDegraded) - there is no automatic quality switching.

        wave += 2 * k;

        stepParticles(k);

        placeCat();
        draw();

        // Fallback frame cycling only until the sprite sheet decodes and
        // refreshAnimSpeed() installs the real timer - keep the original
        // 50ms cadence so it does not spin at 60fps in the meantime.
        if (!animTimer && now - fallbackFrameAt >= 50) {
            fallbackFrameAt = now;
            frameIndex = (frameIndex + 1) % frameCount;
            setFrameVisual();
        }
    }
    requestAnimationFrame(frame);

    setInterval(pollConfig, 2000);
}

async function pollConfig() {
    try {
        const cfg = await window.api.getConfig();
        if (cfg && cfg.cat) {
            const hadTrail = catCfg.trailEnabled;
            catCfg = Object.assign({}, catCfg, cfg.cat);
            if (hadTrail && !catCfg.trailEnabled) trail = [];
            
            // UPDATE THE TOGGLE STATE HERE
            userOpt = !!cfg.optimized;
            reportPerfState();
            
            syncSkin();
        }
    } catch (error) {
        // Keep last known config
    }
    applyScale();
}

async function loadFx() {
    try {
        const cfg = await window.api.getConfig();
        if (cfg && cfg.cat) {
            catCfg = Object.assign({}, catCfg, cfg.cat);
            if (!catCfg.trailEnabled) trail = [];
            userOpt = !!cfg.optimized;
            reportPerfState();
        }
    } catch (error) {
        console.error('renderer config load failed:', error);
    }
    // The loops must start even if skin setup blows up - a frozen pet is worse
    // than one with a slightly-off sprite.
    try {
        syncSkin();
        applyScale();
    } finally {
        waitForLayoutThenStart();
    }
}

// nameplate.js resizes the pet window once it has measured the plate, so the
// canvas must not be fitted (or the loop started) before that lands - otherwise
// the canvas is built for one height, resized mid-flight, and the first second
// visibly jumps. Signal from nameplate.js, but never wait indefinitely: the pet
// must always come up even if that signal never arrives.
let layoutTimer = 0;
function waitForLayoutThenStart() {
    if (window.__petLayoutReady) {
        startLoops();
        return;
    }
    const go = () => {
        if (layoutTimer) {
            clearTimeout(layoutTimer);
            layoutTimer = 0;
        }
        window.removeEventListener('pet-layout-ready', go);
        startLoops();
    };
    window.addEventListener('pet-layout-ready', go);
    layoutTimer = setTimeout(go, 1500);
}

loadFx();

window.api.onFxUpdate((cat) => {
    const hadTrail = catCfg.trailEnabled;
    catCfg = Object.assign({}, catCfg, cat);
    if (hadTrail && !catCfg.trailEnabled) trail = [];
    
    // Update toggle state on live update
    if (typeof cat.optimized !== 'undefined') {
        userOpt = !!cat.optimized;
    }
    reportPerfState();
    
    syncSkin();
    applyScale();
});

window.api.onStateChange((state) => {
    animState = state;
    block.className = state;
    refreshAnimSpeed();
});

block.addEventListener('mousedown', () => {
    if (block.classList.contains('warning')) {
        const r = catRect();
        spawnBurst(r.x + r.w / 2, r.y + r.h / 2);
        window.api.catchBlock();
    }
});

applyScale();