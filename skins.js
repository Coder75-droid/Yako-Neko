// skins.js: registry of every cat skin
window.SKINS = {
    nyan: {
        id: 'nyan',
        name: 'Nyan Cat',
        sheet: 'assets/nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        trailWeld: true,
        trailPlug: 0.12
    },
    gb: {
        id: 'gb',
        name: 'GB Cat',
        sheet: 'assets/gb_nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        trail: [
            [24, 52, 58],
            [31, 75, 58],
            [75, 119, 111],
            [68, 82, 66],
            [75, 119, 66],
            [157, 186, 74]
        ],
        trailWeld: true,
        trailPlug: 0.12,
        plateSink: 0
    },
    taco: {
        id: 'taco',
        name: 'Taco dog',
        sheet: 'assets/taco_dog_nyan_sheet.png',
        frames: 11,
        cols: 4,
        rows: 3,
        frameMs: 45,
        order: 'rtl',
        trail: [
            [187, 208, 237],
            [142, 186, 237],
            [98, 157, 230],
            [38, 127, 221],
            [24, 68, 244],
            [24, 68, 244]
        ],
        trailPlug: 0.62,
        plateX: 0.82,
        plateSink: 2,
        thumbCrop: { x: 0.55, y: 0.05, w: 0.45, h: 0.95 }
    },
    doge: {
        id: 'doge',
        name: 'Doge',
        sheet: 'assets/doge_nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        trail: [
            [230, 236, 189],
            [231, 238, 14],
            [226, 217, 57],
            [224, 191, 28],
            [226, 157, 25],
            [190, 114, 14]
        ],
        plateSink: 2,
        trailPlug: 0.12,
        autoCrop: true
    },
    xmas: {
        id: 'xmas',
        name: 'Xmas Cat',
        sheet: 'assets/xmas_nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        trailPlug: 0.29,
        trail: [
            [58, 206, 26],
            [241, 251, 255],
            [241, 22, 26],
            [241, 22, 26],
            [58, 206, 26],
            [241, 251, 255]
        ],
    },
    vday: {
        id: 'vday',
        name: 'Valentines Cat',
        sheet: 'assets/vday_nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        trailPlug: 0.3,
        trail: [
            [249, 3, 4],
            [249, 77, 78],
            [249, 141, 142],
            [249, 173, 174],
            [249, 232, 233]
        ]
    },
    mexi: {
        id: 'mexi',
        name: 'Taco Cat',
        sheet: 'assets/mexi_nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        trailPlug: 0.16,
        trail: [
            [2, 146, 61],
            [231, 237, 244],
            [166, 8, 15]
        ]
    },
    dj: {
        id: 'dj',
        name: 'DJ Cat',
        sheet: 'assets/dj_nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        trailPlug: 0.3,
        noTrail: true
    },
    paddy: {
        id: 'paddy',
        name: 'Lucky Cat',
        sheet: 'assets/paddy_nyan_sheet.png',
        frames: 12,
        cols: 4,
        rows: 3,
        frameMs: 45,
        autoCrop: true,
        trailPlug: 0.16,
        trail: [
            [22, 155, 98],  
            [226, 233, 232],  
            [222, 156, 63]    
        ]
    },
};
window.SKIN_LIST = ['nyan', 'gb', 'taco', 'mexi', 'xmas', 'vday','doge' , 'dj','paddy'];

// Shared frame walker
window.skinFramePos = function (skin, i) {
    const cols = Math.max(1, skin.cols || skin.frames || 4);
    const rows = Math.max(1, skin.rows || 1);
    const total = Math.max(1, skin.frames || cols * rows);
    const idx = ((i % total) + total) % total;
    const row = Math.floor(idx / cols);
    const inRow = idx % cols;
    const colsInRow = Math.min(cols, total - row * cols);
    const col = (skin.order === 'rtl') ? (colsInRow - 1 - inRow) : inRow;
    return {
        px: cols > 1 ? (col * 100) / (cols - 1) : 0,
        py: rows > 1 ? (row * 100) / (rows - 1) : 0
    };
};