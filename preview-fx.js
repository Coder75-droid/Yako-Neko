// preview-fx.js: Live preview of cat trail and skin in the settings page.
(function () {
    document.querySelectorAll('.np-flyer').forEach((el, i) => { if (i > 0) el.remove(); });
    document.querySelectorAll('#np-name').forEach((el, i) => { if (i > 0) el.remove(); });
    document.querySelectorAll('#np-cat').forEach((el, i) => { if (i > 0) el.remove(); });
    document.querySelectorAll('#np-fx').forEach((el, i) => { if (i > 0) el.remove(); });

    const canvas = document.getElementById('np-fx');
    const stage = document.getElementById('np-stage');
    const flyer = document.querySelector('.np-flyer');
    const catEl = document.getElementById('np-cat');
    const nameEl = document.getElementById('np-name');
    if (!canvas || !stage) return;
    const ctx = canvas.getContext('2d');

    const RAINBOW = [
        [255, 0, 0],
        [255, 165, 0],
        [255, 255, 0],
        [50, 205, 50],
        [0, 191, 255],
        [148, 0, 211]
    ];
    
    // Limits for Optimized Mode in Preview
    const OPT_MAX_TRAIL = 60;
    const OPT_MAX_STARS = 24;

    const BAND = 5;
    const SP = 7;
    const AMP = 6;
    const TICK = 50;
    const PREVIEW_H = 64;
    const PREVIEW_GAP = 3;

    let catCfg = { density: 55, trailDepth: 20, trailEnabled: true, skin: 'nyan' };
    let TRAIL = RAINBOW;
    // Pre-rendered fill colours (same trick as the pet window): build the
    // strings once per skin and animate globalAlpha instead of allocating a
    // fresh rgba() string for every rect every frame.
    let TRAIL_CSS = [];
    let TRAIL_TW = [];
    function buildTrailStyles() {
        TRAIL_CSS = TRAIL.map((c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')');
        TRAIL_TW = TRAIL.map((c) => {
            const shades = [];
            for (let k = 0; k < 7; k++) {
                const t = 1 + k * 0.1;
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
    let spawnAcc = 0;
    let starAcc = 0;
    const pos = { x: 0, y: 0, init: false };

    let previewW = 85;
    let previewPlug = 0;
    let skinNoTrail = false;
    let previewProbeToken = 0;
    let skinId = '';
    let previewSkin = null;
    let skinFrames = 4;
    let skinCols = 4;
    let skinRows = 1;
    let skinFrameMs = 50;
    let skinFrameIndex = 0;
    let skinTimer = null;
    let cropMetrics = null;
    let wasPaused = false;
    let autoCropPx = null;
    let artPx = null;
    let trailWeld = false;
    let previewProbe = null;
    let previewFw = 0;
    let previewFh = 0;
    
    // Track optimized setting for preview
    let userOpt = false;
    function isDegraded() { return userOpt; }

    function frameColRow(i) {
        const skin = previewSkin || {};
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

    function setSkinFrame(i) {
        if (!catEl) return;
        const fr = frameColRow(i);
        if (autoCropPx && previewProbe) {
            const S = PREVIEW_H / autoCropPx.h;
            catEl.style.backgroundSize =
                Math.round(previewProbe.naturalWidth * S) + 'px ' +
                Math.round(previewProbe.naturalHeight * S) + 'px';
            const ox = -Math.round((fr.col * previewFw + autoCropPx.x) * S);
            const oy = -Math.round((fr.row * previewFh + autoCropPx.y) * S);
            catEl.style.backgroundPosition = ox + 'px ' + oy + 'px';
            return;
        }
        const px = fr.cols > 1 ? (fr.col * 100) / (fr.cols - 1) : 0;
        const py = fr.rows > 1 ? (fr.row * 100) / (fr.rows - 1) : 0;
        catEl.style.backgroundSize = (fr.cols * 100) + '% ' + (fr.rows * 100) + '%';
        catEl.style.backgroundPosition = px + '% ' + py + '%';
    }

    function nameForFull() {
        if (!nameEl) return;
        const skin = previewSkin || {};
        const sinkPrev = Math.round((skin.plateSink || 0) * (PREVIEW_H / 90));
        nameEl.style.marginBottom = (PREVIEW_GAP - sinkPrev) + 'px';
        const pxr = (typeof skin.plateX === 'number') ? skin.plateX : 0.5;
        nameEl.style.transform = 'translateX(' + Math.round((pxr - 0.5) * previewW) + 'px)';
    }

    function nameForCrop() {
        if (!nameEl) return;
        nameEl.style.marginBottom = PREVIEW_GAP + 'px';
        nameEl.style.transform = 'none';
    }

    function applyCropVisual() {
        if (!catEl || !cropMetrics) return;
        catEl.style.width = cropMetrics.w + 'px';
        catEl.style.height = cropMetrics.h + 'px';
        catEl.style.backgroundSize = cropMetrics.size;
        catEl.style.backgroundPosition = cropMetrics.pos;
        nameForCrop();
    }

    function applyFullVisual() {
        if (!catEl) return;
        catEl.style.width = previewW + 'px';
        catEl.style.height = PREVIEW_H + 'px';
        catEl.style.backgroundSize = (skinCols * 100) + '% ' + (skinRows * 100) + '%';
        setSkinFrame(skinFrameIndex);
        nameForFull();
    }

    function skinTick() {
        if (document.hidden) return; // no point animating a window nobody sees
        const paused = stage.classList.contains('paused');
        if (paused !== wasPaused) {
            wasPaused = paused;
            if (paused && cropMetrics) applyCropVisual();
            else if (!paused) applyFullVisual();
        }
        if (paused) {
            if (!cropMetrics) setSkinFrame(0);
            return;
        }
        skinFrameIndex = (skinFrameIndex + 1) % skinFrames;
        setSkinFrame(skinFrameIndex);
    }

    function applyPreviewSkin(id) {
        const reg = window.SKINS || {};
        const skin = reg[id] || reg.nyan;
        if (!skin || !catEl) return;
        skinId = skin.id;
        previewSkin = skin;
        skinFrames = Math.max(1, skin.frames || 4);
        skinCols = Math.max(1, skin.cols || skinFrames);
        skinRows = Math.max(1, skin.rows || 1);
        skinFrameMs = Math.max(16, skin.frameMs || 50);
        previewPlug = skin.trailPlug || 0;
        trailWeld = !!skin.trailWeld;
        TRAIL = skin.trail || RAINBOW;
        buildTrailStyles();
        skinNoTrail = !!skin.noTrail;
        if (skinNoTrail) trail = [];
        cropMetrics = null;

        catEl.style.backgroundImage = "url('" + skin.sheet + "')";
        catEl.style.animation = 'none';
        skinFrameIndex = 0;
        if (skinTimer) clearInterval(skinTimer);
        skinTimer = setInterval(skinTick, skinFrameMs);

        const probe = new Image();
        const token = ++previewProbeToken;
        probe.onload = () => {
            if (token !== previewProbeToken) return;
            const fw = probe.naturalWidth / skinCols;
            const fh = (probe.naturalHeight / skinRows) || 1;
            previewProbe = probe;
            previewFw = fw;
            previewFh = fh;
            artPx = null;
            try {
                const cc = document.createElement('canvas');
                cc.width = Math.max(1, Math.round(fw));
                cc.height = Math.max(1, Math.round(fh));
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
                if (maxX >= 0) artPx = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
            } catch (error) { artPx = null; }
            autoCropPx = skin.autoCrop ? artPx : null;
            if (autoCropPx) {
                previewW = Math.max(40, Math.round(PREVIEW_H * (autoCropPx.w / autoCropPx.h)));
            } else {
                previewW = Math.max(40, Math.round(PREVIEW_H * (fw / fh)));
            }

            const crop = skin.thumbCrop || null;
            if (crop) {
                const cw = fw * crop.w;
                const ch = fh * crop.h;
                const cs = PREVIEW_H / ch;
                const p0 = window.skinFramePos ? window.skinFramePos(skin, 0) : { px: 0, py: 0 };
                const ox = (p0.px <= 50 ? -1 : 1) * Math.round((p0.px <= 50 ? crop.x : (1 - crop.x - crop.w)) * fw * cs);
                const oy = (p0.py <= 50 ? -1 : 1) * Math.round((p0.py <= 50 ? crop.y : (1 - crop.y - crop.h)) * fh * cs);
                cropMetrics = {
                    w: Math.round(cw * cs),
                    h: PREVIEW_H,
                    size: Math.round(probe.naturalWidth * cs) + 'px ' + Math.round(probe.naturalHeight * cs) + 'px',
                    pos: 'calc(' + p0.px + '% + ' + ox + 'px) calc(' + p0.py + '% + ' + oy + 'px)'
                };
            } else {
                cropMetrics = null;
            }

            if (stage.classList.contains('paused') && cropMetrics) applyCropVisual();
            else applyFullVisual();
        };
        probe.src = skin.sheet;
        applyFullVisual();
    }
    window.applyPreviewSkin = applyPreviewSkin;
    applyPreviewSkin('nyan');

    function readCfg() {
        if (!window.api || typeof window.api.getConfig !== 'function') return;
        window.api.getConfig().then((c) => {
            if (c && c.cat) {
                catCfg = Object.assign({}, catCfg, c.cat);
                const id = c.cat.skin || 'nyan';
                if (id !== skinId) applyPreviewSkin(id);
            }
            // Sync optimized toggle for preview
            if (c && typeof c.optimized !== 'undefined') {
                userOpt = !!c.optimized;
            }
        }).catch(() => {});
    }
    readCfg();
    // 2s is plenty: the preview only needs to notice a skin change made from a
    // different window. Halving the IPC churn is free performance.
    setInterval(readCfg, 2000);

    function resize() {
        const w = Math.max(1, stage.clientWidth);
        const h = Math.max(1, stage.clientHeight);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    }
    resize();
    window.addEventListener('resize', resize);

    // Only animate while the preview is actually visible. The rAF loop used to
    // run forever - even when the stage was hidden behind another settings page
    // or the window was minimised - which kept a weak CPU permanently busy.
    let onScreen = true;
    if (typeof IntersectionObserver === 'function') {
        try {
            const io = new IntersectionObserver((entries) => {
                onScreen = entries.some((e) => e.isIntersecting);
            }, { threshold: 0 });
            io.observe(stage);
        } catch (error) { onScreen = true; }
    }
    function previewVisible() { return onScreen && !document.hidden; }

    function target(paused) {
        return paused
            ? { x: canvas.width * 0.5, y: canvas.height * 0.5 }
            : { x: canvas.width - previewW - 10, y: canvas.height * 0.5 };
    }

    // Memoised for the current frame. Reading layout (getBoundingClientRect)
    // forces a synchronous reflow, and anchor() was being called several times
    // per frame (stepParticles + draw + bandH). We now measure once, then reuse
    // the result until the next frame clears it - a big win on weak CPUs.
    let anchorMemo = null;

    function anchor() {
        if (anchorMemo) return anchorMemo;
        let out;
        if (catEl) {
            const c = catEl.getBoundingClientRect();
            const s = canvas.getBoundingClientRect();
            let x = c.left - s.left - 10 + c.width * previewPlug;
            let y = c.top - s.top;
            let h = c.height || PREVIEW_H;
            if (trailWeld && artPx && previewFw && previewFh && !cropMetrics && !autoCropPx) {
                const S = (c.height || PREVIEW_H) / previewFh;
                y = c.top - s.top + artPx.y * S;
                h = Math.max(8, artPx.h * S);
                x = c.left - s.left + artPx.x * S - 2 + c.width * previewPlug;
            }
            out = { x: x, y: y, h: h };
        } else {
            out = {
                x: pos.x - previewW * 0.5 - 10 + previewW * previewPlug,
                y: pos.y - PREVIEW_H / 2,
                h: PREVIEW_H
            };
        }
        anchorMemo = out;
        return out;
    }

    function bandH(a) {
        return Math.max(2, Math.round((a.h || PREVIEW_H) / TRAIL.length));
    }

    function stepParticles(k) {
        const a = anchor();
        const d = Math.max(0, Number(catCfg.density) || 0);

        // Optimized Mode Star Logic
        let starThreshold = d / 260;
        if (isDegraded()) {
            starThreshold = d / 340;
            if (stars.length >= OPT_MAX_STARS) starThreshold = 0;
        }

        starAcc += starThreshold * k;
        while (starAcc >= 1) {
            starAcc -= 1;
            if (!isDegraded() || stars.length < OPT_MAX_STARS) {
                stars.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    life: 20,
                    speed: 2 + Math.random() * 2
                });
            }
        }
        for (const p of stars) { p.x -= p.speed * k; p.life -= k; }
        stars = stars.filter(p => p.life > 0 && p.x > -4);

        const depth = Math.max(2, Math.round(Number(catCfg.trailDepth) || 20));
        const tailWidth = Math.max(80, depth * SP + 40);
        
        if (!skinNoTrail) {
            // Optimized Mode Spawn Logic
            let spawnRate = d / 26;
            if (isDegraded()) spawnRate = d / 30;
            
            spawnAcc += Math.max(1, Math.floor(spawnRate)) * k;
            const n = Math.floor(spawnAcc);
            spawnAcc -= n;
            
            for (let i = 0; i < n; i++) {
                if (isDegraded() && trail.length >= OPT_MAX_TRAIL) break;
                
                const band = Math.floor(Math.random() * TRAIL.length);
                const dist = 6 + Math.random() * tailWidth;
                trail.push({
                    x: a.x - dist,
                    y: a.y + band * bandH(a) + (-3 + Math.random() * 8),
                    z: Math.random() * 120 + (dist / tailWidth) * 80,
                    vz: -0.8 + Math.random() * 2,
                    speed: 1.5 + Math.random() * 3.5,
                    size: 1 + Math.floor(Math.random() * 3),
                    life: 20 + Math.floor(Math.random() * 32),
                    twinkle: Math.random() * Math.PI * 2,
                    color: TRAIL[band],
                    css: TRAIL_CSS[band] || '#ffffff',
                    cssTw: TRAIL_TW[band] || null
                });
            }
        }
        for (const p of trail) {
            p.x -= p.speed * k;
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
    }

    function draw() {
        const a = anchor();
        const depth = Math.max(2, Math.round(Number(catCfg.trailDepth) || 20));
        const bh = bandH(a);

        if (!skinNoTrail) {
            const invDepth = 1 / Math.max(1, depth);
            for (let i = 0; i < depth; i++) {
                const x = a.x - i * SP;
                if (x < -SP) break;
                const yOff = Math.round(Math.sin((wave + i) * 0.5) * AMP);
                ctx.globalAlpha = (150 / 255) * Math.max(0.18, 1 - i * invDepth * 0.55);
                for (let c = 0; c < TRAIL.length; c++) {
                    ctx.fillStyle = TRAIL_CSS[c] || '#ffffff';
                    ctx.fillRect(Math.round(x), Math.round(a.y + c * bh + yOff), SP + 1, bh);
                }
            }

            // Sort in place (no per-frame copy).
            trail.sort((p, q) => p.z - q.z);
            for (const p of trail) {
                if (p.x < 2 || p.x > a.x + previewW) continue;
                const scale = 170 / (170 + p.z);
                const size = Math.max(1, Math.round(p.size * scale));
                const alpha = 210 * Math.min(1, p.life / 30);
                ctx.fillStyle = p.css || '#ffffff';
                ctx.globalAlpha = Math.max(35, alpha / 3) / 255;
                ctx.fillRect(Math.round(p.x - size), Math.round(p.y - size), size * 3, size * 3);
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
    }

    let last = performance.now();

    function frame(now) {
        requestAnimationFrame(frame);
        let dt = now - last;

        // Skip all work while the preview is off screen (another settings page,
        // minimised window, occluded). Previously the loop ran forever.
        if (!previewVisible()) { last = now; return; }
        // Optimized mode no longer throttles the preview frame rate either -
        // the visibility gate above is what keeps a hidden preview free, so the
        // live preview stays a smooth 60fps when you are looking at it.

        last = now;
        if (dt > 100) dt = 100;
        const k = dt / TICK;

        anchorMemo = null; // measure layout fresh, once, for this frame
        resize();
        const paused = stage.classList.contains('paused');
        canvas.style.opacity = paused ? '0' : '1';

        const t = target(paused);
        if (!pos.init) { pos.x = t.x; pos.y = t.y; pos.init = true; }
        const ease = Math.min(1, 0.10 * k);
        pos.x += (t.x - pos.x) * ease;
        pos.y += (t.y - pos.y) * ease;
        if (flyer) {
            flyer.style.left = pos.x + 'px';
            flyer.style.top = pos.y + 'px';
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!catCfg.trailEnabled) {
            trail = [];
            stars = [];
            return;
        }

        if (!paused) {
            wave += 2 * k;
            stepParticles(k);
        }
        draw();
    }
    requestAnimationFrame(frame);
})();