// nap.js: single owner of pause and resume.

const spriteEl = document.getElementById('sprite');
const fxEl = document.getElementById('fx');

const HOME_STEP = 18;   // max px per homing tick (run speed knob)
const HOME_TICK = 16;   // ms per homing tick
const FRAME_ONE = '0% 0';

let homing = null;
let homingTicks = 0;
let homingForPause = false;
let freezeStyle = null;
// Homing watchdog state (see stepHome): freeze, resume and the movement
// release all hang off arriveHome(), so a run that never lands must be
// force-settled instead of latching __petHoming/__petPaused forever.
let homingStartedAt = 0;
let homingStalledAt = 0;
let homingLastX = 0;
let homingLastY = 0;

// Gate the renderer's frame writes as a first layer: blocked while
// napping, open while running home or fully resumed.
try {
    const proto = Object.getPrototypeOf(spriteEl.style);
    const desc = Object.getOwnPropertyDescriptor(proto, 'backgroundPosition') ||
        Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'backgroundPosition');

    if (desc && desc.set && desc.get) {
        Object.defineProperty(spriteEl.style, 'backgroundPosition', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) {
                if (!window.__petPaused || window.__petHoming) desc.set.call(this, v);
            }
        });
    }
} catch (error) { /* the !important rule below still guarantees the freeze */ }

// Unconditional frame lock: an !important stylesheet rule outranks every
function freezeFrame(on) {
    if (on && !freezeStyle) {
        freezeStyle = document.createElement('style');
        freezeStyle.id = 'napFreeze';
        const p0 = window.__petFrame0Pos || FRAME_ONE;
        freezeStyle.textContent = '#sprite { background-position: ' + p0 + ' !important; }';
        document.head.appendChild(freezeStyle);
    } else if (!on && freezeStyle) {
        freezeStyle.remove();
        freezeStyle = null;
    }
}

// Same corner main.js spawns the window at, clamped for tall windows
function homePos() {
    const winH = window.outerHeight || 150;
    const x = window.screen.availWidth - 820;
    const yMax = Math.max(0, window.screen.availHeight - winH);
    const y = Math.min(yMax, Math.max(0, window.screen.availHeight - 170));
    return { x, y };
}

function atHome() {
    const h = homePos();
    return Math.abs(window.screenX - h.x) <= 4 && Math.abs(window.screenY - h.y) <= 4;
}

function holdMovement() { window.__petPaused = true; }
function releaseMovement() { window.__petPaused = false; }

function setLook(napping) {
    if (fxEl) {
        fxEl.style.transition = 'opacity 400ms';
        fxEl.style.opacity = napping ? '0' : '1';
    }
    if (spriteEl) {
        spriteEl.style.transition = 'filter 400ms';
        spriteEl.style.filter = napping ? 'grayscale(0.6) brightness(0.9)' : '';
    }
}

function startHoming(forPause) {
    homingForPause = forPause;
    if (homing !== null) return;
    homingTicks = 0;
    const t = Date.now();
    homingStartedAt = t;
    homingStalledAt = t;
    homingLastX = window.screenX;
    homingLastY = window.screenY;
    window.__petHoming = true;
    homing = setInterval(stepHome, HOME_TICK);
}

// Smooth run: ease-in over the first ticks, cruise, then ease-out as the
// corner approaches, so there is no cut at either end.
function stepHome() {
    const h = homePos();
    const x = window.screenX;
    const y = window.screenY;
    const dx = h.x - x;
    const dy = h.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= 4) {
        window.api.moveWindow(h.x, h.y);
        arriveHome();
        return;
    }

    // Watchdog: homing must never run forever - if the window stops
    // reporting motion (stale screenX, OS refusing the move) or home is
    // unreachable, force the settle now instead of deadlocking the whole
    // pause/resume cycle (frozen pet, movement never released).
    const now = Date.now();
    if (Math.abs(x - homingLastX) > 0.5 || Math.abs(y - homingLastY) > 0.5) {
        homingLastX = x;
        homingLastY = y;
        homingStalledAt = now;
    }
    if (now - homingStartedAt > 8000 || now - homingStalledAt > 700) {
        try { window.api.moveWindow(h.x, h.y); } catch (error) { /* ignore */ }
        arriveHome();
        return;
    }

    homingTicks += 1;
    const ramp = Math.min(1, homingTicks / 12);          // ease-in ~200ms
    const ease = Math.max(0.08, Math.min(1, dist / 240)); // ease-out near home
    const step = Math.max(1.5, HOME_STEP * ramp * ease);

    const ux = dx / dist;
    const uy = dy / dist;
    window.api.moveWindow(Math.round(x + ux * step), Math.round(y + uy * step));
}

function arriveHome() {
    if (homing !== null) {
        clearInterval(homing);
        homing = null;
    }
    window.__petHoming = false;

    if (homingForPause) {
        setLook(true);
        spriteEl.style.setProperty('background-position', window.__petFrame0Pos || FRAME_ONE);
        freezeFrame(true);
    } else {
        releaseMovement();
    }
}

let lastPaused = false;
window.api.onFxUpdate((cat) => {
    if (!cat || typeof cat.paused === 'undefined') return;
    const paused = !!cat.paused;

    // Only react to a real pause<->resume transition. A redundant update that
    // merely restates the current state (e.g. a settings/config push) must not
    // trigger the run-home - otherwise the cat teleports to spawn on any tweak.
    if (paused === lastPaused) return;
    lastPaused = paused;

    if (paused) {
        holdMovement();
        homingForPause = true;
        if (!atHome()) {
            // Keep color and trail during the run so it reads as one
            // continuous motion, not a cut
            startHoming(true);
        } else {
            arriveHome(); // already home: settle and freeze frame 1 now
        }
    } else {
        setLook(false);
        freezeFrame(false); // legs free again the moment we resume
        if (!atHome()) {
            holdMovement();       // finish the run home first
            startHoming(false);
        } else {
            if (homing !== null) {
                clearInterval(homing);
                homing = null;
                window.__petHoming = false;
            }
            releaseMovement();    // launch from the spawn coordinates
        }
    }
});