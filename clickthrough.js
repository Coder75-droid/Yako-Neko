// clickthrough.js: the cat window passes clicks through to everything
// underneath (text, scrollbars, buttons in other apps) except when the
// cursor is directly over the cat body, so catching still works.
(function () {
    const catbox = document.getElementById('catbox');
    if (!catbox || !window.api || typeof window.api.setClickThrough !== 'function') return;

    let overCat = false;

    function setIgnore(ignore) {
        window.api.setClickThrough(ignore);
    }

    function isInsideCat(e) {
        const r = catbox.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right &&
               e.clientY >= r.top && e.clientY <= r.bottom;
    }

    // Forwarded mouse moves arrive even while the window ignores the
    // mouse, which is what lets us wake up when the cursor touches cat
    document.addEventListener('mousemove', (e) => {
        const inside = isInsideCat(e);
        if (inside !== overCat) {
            overCat = inside;
            setIgnore(!inside);
        }
    });

    // Cursor left the window entirely: back to full click-through
    document.addEventListener('mouseleave', () => {
        if (overCat) {
            overCat = false;
            setIgnore(true);
        }
    });

    // Boot state: fully click-through
    overCat = false;
    setIgnore(true);
})();