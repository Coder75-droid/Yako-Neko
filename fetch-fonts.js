// Keep the Google fonts even when offline
const fs = require('fs');
const path = require('path');
const https = require('https');

const FONTS = [
    {
        file: 'PressStart2P.ttf',
        url: 'https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf'
    },
    {
        file: 'VT323.ttf',
        url: 'https://github.com/google/fonts/raw/main/ofl/vt323/VT323-Regular.ttf'
    }
];

const dir = path.join(__dirname, 'assets', 'fonts');
fs.mkdirSync(dir, { recursive: true });

function get(url, dest, redirects) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
                res.resume();
                return resolve(get(res.headers.location, dest, redirects - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
            }
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => out.close(() => resolve(dest)));
            out.on('error', reject);
        }).on('error', reject);
    });
}

(async () => {
    for (const f of FONTS) {
        const dest = path.join(dir, f.file);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
            console.log('skip (already there):', f.file);
            continue;
        }
        try {
            await get(f.url, dest, 5);
            console.log('saved:', dest);
        } catch (e) {
            console.error('FAILED:', f.file, '-', e.message);
        }
    }
    console.log('Done. If anything FAILED, download it manually into assets/fonts/.');
})();