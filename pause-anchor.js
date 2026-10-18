// A clamp to ensure cat won't leave the screen while being resized or paused
(function () {
    let paused = false;

    // nap.js owns the home position (it runs the run-home on pause). This
    // file used to carry its own slightly different formula (innerHeight+20
    // vs nap's outerHeight/170), so the two disagreed by ~20px: nap homed to
    // one spot and this yanked the window back down, forcing an extra
    // correction run on every resume. Single source of truth now.
    function home() {
        if (typeof homePos === 'function') {
            try { return homePos(); } catch (error) { /* fall through */ }
        }
        const h = window.innerHeight;
        return {
            x: window.screen.availWidth - 820,
            y: Math.max(0, window.screen.availHeight - 20 - h)
        };
    }

    try {
        window.api.onFxUpdate((cat) => {
            if (cat && typeof cat.paused !== 'undefined') paused = !!cat.paused;
        });
    } catch (error) { /* ignore */ }

    setInterval(() => {
        if (!paused) return;          // flying: never interfere
        if (window.__petHoming) return; // nap is running home: hands off

        const target = home();
        // Small tolerance so this never fights (and repeatedly re-sends
        // setPosition behind) an exact-position settle by nap.js.
        if (Math.abs(window.screenX - target.x) > 2 ||
            Math.abs(window.screenY - target.y) > 2) {
            try {
                window.api.moveWindow(target.x, target.y);
            } catch (error) { /* ignore */ }
        }
    }, 120);
})();