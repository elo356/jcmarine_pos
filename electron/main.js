'use strict';

const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const IS_DEV = !app.isPackaged;
const BUILD_DIR = path.join(__dirname, '..', 'build');
const ICON = path.join(__dirname, '..', IS_DEV ? 'public' : 'build', 'logo3-removebg-preview.png');

// Fixed port so Firebase Auth localStorage persists across restarts
const APP_PORT = 19432;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.map': 'application/json',
};

function getMime(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

let mainWindow = null;

// ── Spin POS proxy ────────────────────────────────────────────────────────────
// Replicates src/setupProxy.js for the packaged Electron app.
// /spin-proxy → https://spinpos.net/SPIn/cgi.html
function handleSpinProxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const qsIdx = req.url.indexOf('?');
    const qs = qsIdx !== -1 ? req.url.slice(qsIdx) : '';

    const options = {
      hostname: 'spinpos.net',
      port: 443,
      path: `/SPIn/cgi.html${qs}`,
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/xml',
        'content-length': body.length,
        'accept': 'application/xml, text/xml, text/plain, */*',
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': proxyRes.headers['content-type'] || 'application/xml',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[spin-proxy]', err.message);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
}

// ── Static file server ────────────────────────────────────────────────────────
// Serves the React build/ directory with SPA fallback to index.html.
function serveStatic(req, res) {
  const pathname = req.url.split('?')[0];
  const target = path.join(BUILD_DIR, pathname === '/' ? 'index.html' : pathname);

  fs.readFile(target, (err, data) => {
    if (err) {
      // Unknown path → could be a React Router route; serve index.html
      fs.readFile(path.join(BUILD_DIR, 'index.html'), (err2, indexData) => {
        if (err2) {
          res.writeHead(500);
          res.end('Internal server error');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(indexData);
      });
      return;
    }

    const isIndex = pathname === '/' || target.endsWith('index.html');
    res.writeHead(200, {
      'Content-Type': getMime(target),
      // index.html must never be cached so the app always loads fresh
      'Cache-Control': isIndex
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  });
}

// ── Local HTTP server ─────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/spin-proxy')) {
        handleSpinProxy(req, res);
      } else {
        serveStatic(req, res);
      }
    });

    server.on('error', reject);
    server.listen(APP_PORT, '127.0.0.1', () => {
      resolve(APP_PORT);
    });
  });
}

// ── Main window ───────────────────────────────────────────────────────────────
async function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'CJ Marine POS',
    icon: ICON,
    show: false,
  });

  // Grant camera permission so barcode scanner (ZXing) works
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  let appUrl;
  if (IS_DEV) {
    // Dev: load from React dev server (npm start)
    appUrl = 'http://localhost:3000';
  } else {
    // Production: serve built files via local HTTP
    const port = await startServer();
    appUrl = `http://127.0.0.1:${port}`;
  }

  await mainWindow.loadURL(appUrl);
  mainWindow.show();

  // Allow about:blank popups (used by printService for receipt printing).
  // Send real http/https links to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('about:') || url.startsWith('data:')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setAppUserModelId('com.cjmarine.pos');

// ── Backup IPC handlers ───────────────────────────────────────────────────────
ipcMain.handle('backup:save', (_event, json, filename, folderPath) => {
  const dir = folderPath || path.join(app.getPath('documents'), 'CJMarine-Backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, json, 'utf8');
  return { success: true, savedPath: filePath };
});

ipcMain.handle('backup:choose-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Carpeta de copias de seguridad',
    buttonLabel: 'Seleccionar',
  });
  return result.canceled ? null : result.filePaths[0];
});

// Prevent multiple instances — second launch focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((err) => {
    console.error('[main] Failed to start:', err);
    app.quit();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
