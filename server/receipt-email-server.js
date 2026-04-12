const http = require('http');
const nodemailer = require('nodemailer');

const PORT = Number(process.env.RECEIPTS_PORT || 4001);
const SENDER_EMAIL = process.env.CJMARINE_RECEIPTS_EMAIL || 'cjmarinepr@gmail.com';
const SENDER_NAME = process.env.CJMARINE_RECEIPTS_NAME || 'CJ Marine';
const APP_PASSWORD = process.env.CJMARINE_RECEIPTS_APP_PASSWORD || '';
const ALLOWED_ORIGIN = process.env.RECEIPTS_ALLOWED_ORIGIN || '*';

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
};

const getTransport = () => {
  if (!APP_PASSWORD) {
    throw new Error('Falta CJMARINE_RECEIPTS_APP_PASSWORD para enviar correos.');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SENDER_EMAIL,
      pass: APP_PASSWORD
    }
  });
};

const parseJsonBody = (req) => new Promise((resolve, reject) => {
  let raw = '';

  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1024 * 1024) {
      reject(new Error('Payload demasiado grande.'));
      req.destroy();
    }
  });

  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch (error) {
      reject(new Error('JSON inválido.'));
    }
  });

  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, service: 'receipt-email-server' });
    return;
  }

  if (req.method === 'POST' && req.url === '/send-receipt-email') {
    try {
      const body = await parseJsonBody(req);
      const to = String(body.to || '').trim();
      const subject = String(body.subject || 'Recibo CJ Marine').trim();
      const html = String(body.html || '');
      const text = String(body.text || '');

      if (!to) {
        sendJson(res, 400, { ok: false, error: 'Debes indicar un email destino.' });
        return;
      }

      const transport = getTransport();
      await transport.sendMail({
        from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
        to,
        subject,
        html,
        text
      });

      sendJson(res, 200, { ok: true, to, from: SENDER_EMAIL });
    } catch (error) {
      console.error('Error sending receipt email:', error);
      sendJson(res, 500, { ok: false, error: error.message || 'No se pudo enviar el correo.' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Ruta no encontrada.' });
});

server.listen(PORT, () => {
  console.log(`Receipt email server running on http://localhost:${PORT}`);
});
