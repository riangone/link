'use strict';

// Minimal single-origin dev server for E2E tests: serves client/ as static
// files and attaches the real signaling server (server/index.js) on the
// same http.Server, mirroring how nginx's `location /server` proxy_pass
// + `location /` static root behave in docker-compose.yml — just without
// nginx, so tests don't need Docker.
//
// No new runtime dependency: static file serving is done with plain
// Node `http`/`fs`, and the ws upgrade handling is the actual
// SnapdropServer class from server/index.js (attached-server mode).

const http = require('http');
const fs = require('fs');
const path = require('path');

const { SnapdropServer } = require('../../server/index.js');

const CLIENT_ROOT = path.join(__dirname, '..', '..', 'client');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res) {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(CLIENT_ROOT, reqPath);

    // Prevent path traversal outside of client/
    if (!filePath.startsWith(CLIENT_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

/**
 * Start the combined static+signaling dev server.
 * @param {number} port
 * @returns {Promise<{server: import('http').Server, url: string, close: () => Promise<void>}>}
 */
function startDevServer(port = 0) {
    return new Promise((resolve, reject) => {
        const httpServer = http.createServer((req, res) => {
            if (req.url.startsWith('/server')) {
                // Signaling requests must arrive as WebSocket upgrades, not
                // plain HTTP; a plain GET here means something is wrong.
                res.writeHead(400);
                res.end('Expected WebSocket upgrade');
                return;
            }
            serveStatic(req, res);
        });

        new SnapdropServer(null, httpServer);

        httpServer.on('error', reject);
        httpServer.listen(port, '127.0.0.1', () => {
            const actualPort = httpServer.address().port;
            resolve({
                server: httpServer,
                url: `http://127.0.0.1:${actualPort}`,
                close: () => new Promise(res => httpServer.close(() => res()))
            });
        });
    });
}

module.exports = { startDevServer };
