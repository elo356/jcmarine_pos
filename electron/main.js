const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const nodemailer = require('nodemailer');

const RECEIPT_SENDER_EMAIL = process.env.CJMARINE_RECEIPTS_EMAIL || '3li.35426@gmail.com';
const RECEIPT_SENDER_NAME = process.env.CJMARINE_RECEIPTS_NAME || 'CJ Marine';
const RECEIPT_APP_PASSWORD = process.env.CJMARINE_RECEIPTS_APP_PASSWORD || '';

const createReceiptTransport = () => {
  if (!RECEIPT_APP_PASSWORD) {
    throw new Error(
      'Falta configurar CJMARINE_RECEIPTS_APP_PASSWORD para enviar recibos por email.'
    );
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: RECEIPT_SENDER_EMAIL,
      pass: RECEIPT_APP_PASSWORD
    }
  });
};

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const startUrl = process.env.ELECTRON_START_URL;

  if (startUrl) {
    mainWindow.loadURL(startUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'build', 'index.html'));
}

ipcMain.handle('receipts:send-email', async (_event, payload = {}) => {
  const {
    to = '',
    subject = 'Recibo CJ Marine',
    html = '',
    text = ''
  } = payload;

  if (!to.trim()) {
    throw new Error('Debes indicar un email destino.');
  }

  const transport = createReceiptTransport();

  await transport.sendMail({
    from: `"${RECEIPT_SENDER_NAME}" <${RECEIPT_SENDER_EMAIL}>`,
    to: to.trim(),
    subject,
    html,
    text
  });

  return {
    ok: true,
    from: RECEIPT_SENDER_EMAIL,
    to: to.trim()
  };
});

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
