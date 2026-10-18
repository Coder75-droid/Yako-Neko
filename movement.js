// Inspired from https://github.com/Rafe-Lin/nyancat_deskpet
// Horizontal flight, warp, and drag detection unchanged.
// Vertical: a lane target is re-picked every few seconds and on every warp.

const BASE_SPEED = 5;      // horizontal pixels per 30ms tick at 100% speed
let MOVE_SPEED = BASE_SPEED;
const TICK_MS = 16;        // ~60Hz. The whole window (cat + trail) jumps once per
                           // tick, so 50ms ticks moved it in visible ~8px hops -
                           // the "buffer-y" look. All physics below is dt-scaled
                           // (k = dt / REF_MS), so travel speed is unchanged.
const REF_MS = 30;         // speed reference - DO NOT change without BASE_SPEED
const STEP = 0.12;         // sine phase per tick
const SLIGHT_SHIFT = 120;  // max nudge for a "slight" pick, in px

// Adaptive push cadence. Moving a transparent always-on-top window forces
// Windows/DWM to recomposite it, so every moveWindow costs GPU time. Strong
// machines eat 60 pushes/second; weak ones saturate and the whole desktop
// stutters. Timer jitter on our own loop is the load signal: back the push
// rate off when the machine struggles, climb back when it is healthy again
// (slow to recover, fast to degrade - hysteresis avoids flip-flopping).
const SEND_LEVELS = [16, 33, 50];  // ms between actual setPosition pushes
let sendLevel = 0;
let lastPush = 0;
let lagStreak = 0;
let healthyMs = 0;

let posX = window.screenX;
let posY = window.screenY;
let sentX = Math.round(posX);
let sentY = Math.round(posY);
let timeStep = 0;
let attacking = false;
let pauseUntil = 0;
let wasPaused = false;

// Flight speed from settings (percent, 100 = default)
function applySpeed(percent) {
    const pct = Number(percent);
    if (isFinite(pct) && pct > 0) MOVE_SPEED = BASE_SPEED * (pct / 100);
}

try {
    window.api.getConfig().then((c) => {
        if (c && c.cat) applySpeed(c.cat.speed);
    }).catch(() => {});
    window.api.onFxUpdate((cat) => {
        if (cat && typeof cat.speed !== 'undefined') applySpeed(cat.speed);
    });
} catch (error) { /* keep default speed */ }

// Vertical lane state
let laneY = window.screenY;
let laneChangeAt = Date.now() + 3000 + Math.random() * 3000;

function laneBounds(screenH, winH) {
    const margin = 8;
    return { min: margin, max: Math.max(margin, screenH - winH - margin) };
}

// Slight nudge half the time, fresh anywhere-on-screen pick the other half
function pickLane(currentY, screenH, winH) {
    const b = laneBounds(screenH, winH);
    if (Math.random() < 0.5) {
        const delta = (Math.random() * 2 - 1) * SLIGHT_SHIFT;
        let y = currentY + delta;
        if (y < b.min) y = b.min;
        if (y > b.max) y = b.max;
        return y;
    }
    return b.min + Math.random() * (b.max - b.min);
}

// Keep flying during warning; only the blocked flash holds still
window.api.onStateChange((state) => {
    attacking = (state === 'blocked');
});

function sendMove(now) {
    if (now - lastPush < SEND_LEVELS[sendLevel]) return; // adaptive cadence
    const rx = Math.round(posX);
    const ry = Math.round(posY);
    if (rx === sentX && ry === sentY) return; // unchanged: skip the DWM hit of setPosition
    sentX = rx;
    sentY = ry;
    lastPush = now;
    window.api.moveWindow(rx, ry);
}

// --- Unpause resync -------------------------------------------------------
// Ask main for the window's TRUE position instead of trusting the renderer's
// window.screenX, which can still be mid-stale right after nap.js's run-home.
// Flying (and warping) from a wrong origin is what pushed the cat out of view
// after a few pause/resume cycles.
let resyncing = false;
let resyncToken = 0;

function applyResync(x, y) {
    if (isFinite(x)) posX = x;
    if (isFinite(y)) posY = y;
    sentX = Math.round(posX);
    sentY = Math.round(posY);
    laneY = posY;
    const now = Date.now();
    pauseUntil = now + 200;
    laneChangeAt = now + 3000 + Math.random() * 3000;
    resyncing = false;
}

function beginResync() {
    resyncing = true;
    const my = ++resyncToken;
    let settled = false;
    const finish = (x, y) => {
        if (settled || my !== resyncToken) return;
        settled = true;
        applyResync(x, y);
    };
    try {
        const req = window.api.getWindowPosition && window.api.getWindowPosition();
        if (req && typeof req.then === 'function') {
            req.then((pos) => {
                if (Array.isArray(pos)) finish(pos[0], pos[1]);
                else finish(window.screenX, window.screenY);
            }).catch(() => finish(window.screenX, window.screenY));
        } else {
            finish(window.screenX, window.screenY);
        }
    } catch (error) {
        finish(window.screenX, window.screenY);
    }
    // Never hang: if main does not answer within 250ms, fly from screenX.
    setTimeout(() => finish(window.screenX, window.screenY), 250);
}

let moveLast = Date.now();
setInterval(() => {
    const now = Date.now();
    let dt = now - moveLast;
    moveLast = now;
    const rawDt = dt;

    // Adaptive push pacing (see SEND_LEVELS): jitter on THIS timer means the
    // renderer main thread is starved, so ease off how often we force a DWM
    // recomposite (~0.5s of struggle to degrade, ~4s healthy to recover).
    if (rawDt > TICK_MS * 2.5) {
        lagStreak += 1;
        healthyMs = 0;
        if (lagStreak >= 6 && sendLevel < SEND_LEVELS.length - 1) {
            sendLevel += 1;
            lagStreak = 0;
        }
    } else {
        lagStreak = Math.max(0, lagStreak - 1);
        healthyMs += rawDt;
        if (healthyMs > 4000 && sendLevel > 0) {
            sendLevel -= 1;
            healthyMs = 0;
        }
    }
    // Explicit Optimised-performance toggle = "use less", and so does a
    // renderer reporting paint trouble (window.__yakoFrameSlow: GPU/vsync
    // bound machines stall composition without ever jittering OUR timer):
    // hold the gentlest push rate while either signal is set.
    if (window.__yakoPerfLow || window.__yakoFrameSlow) sendLevel = SEND_LEVELS.length - 1;

    // Optimized mode no longer halves the flight tick rate. Running the physics
    // at half speed made the cat travel in visible ~17px jumps (the "choppy
    // animation"). The render savings come from the trimmed trail/particles
    // instead, so motion stays exactly as smooth as normal mode.
    if (dt > 400) dt = 400;          // clamp huge stalls (sleep/resume)
    const k = dt / REF_MS;           // 1.0 per original 30ms of real time

    // Hard pause flag from nap.js
    if (window.__petPaused) {
        wasPaused = true;
        return;
    }

    // First tick after unpause: resync to the REAL window position (asked of
    // main - renderer screenX can still be stale right after the run-home),
    // so flight launches from exactly where the cat sits. No teleport, and no
    // flying from a wrong origin.
    if (wasPaused) {
        wasPaused = false;
        beginResync();
        return;
    }

    // Still waiting on the authoritative position: hold still for these ticks.
    if (resyncing) return;

    if (attacking || now < pauseUntil) return;

    // Drag / external-move detection: if the real window is far from where
    // we last placed it (user dragged it, OS snapped it), adopt reality.
    const realX = window.screenX;
    const realY = window.screenY;
    if (Math.abs(realX - sentX) > 60 || Math.abs(realY - sentY) > 60) {
        posX = realX;
        posY = realY;
        sentX = Math.round(posX);
        sentY = Math.round(posY);
        laneY = posY;
    }

    const screenW = window.screen.availWidth;
    const screenH = window.screen.availHeight;
    const winW = window.outerWidth;
    const winH = window.outerHeight;

    // Re-pick the lane every few seconds
    if (now >= laneChangeAt) {
        laneY = pickLane(laneY, screenH, winH);
        laneChangeAt = now + 3000 + Math.random() * 3000;
    }

    // Sine wave flight - all increments scaled by real elapsed time
    timeStep += STEP * k;
    posX += MOVE_SPEED * k;
    posY += Math.sin(timeStep) * (Math.max(3, MOVE_SPEED + 3) * 0.6) * k;

    // Glide toward the current lane (frame-rate independent easing)
    const glide = 1 - Math.pow(1 - 0.02, k);
    posY += (laneY - posY) * glide;

    // Warp -> leaves the right re-enters from left at a freshly picked height
    if (posX > screenW) {
        posX = -winW;
        laneY = pickLane(posY, screenH, winH);
        posY = laneY;
        laneChangeAt = now + 3000 + Math.random() * 3000;
    } else if (posX < -winW) {
        posX = screenW;
        laneY = pickLane(posY, screenH, winH);
        posY = laneY;
        laneChangeAt = now + 3000 + Math.random() * 3000;
    }

    // Hard clamp so the cat can never leave the screen
    const b = laneBounds(screenH, winH);
    if (posY < b.min) posY = b.min;
    if (posY > b.max) posY = b.max;

    sendMove(now);
}, TICK_MS);