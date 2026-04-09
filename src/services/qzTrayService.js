const QZ_BRIDGE_GLOBAL = 'qz';

const getQz = () => (typeof window !== 'undefined' ? window[QZ_BRIDGE_GLOBAL] : null);

const configureQzSecurity = (qz) => {
  if (!qz || configureQzSecurity.configured) return;

  if (typeof qz.security?.setCertificatePromise === 'function') {
    qz.security.setCertificatePromise(() => Promise.resolve(null));
  }

  if (typeof qz.security?.setSignaturePromise === 'function') {
    qz.security.setSignaturePromise(() => Promise.resolve(''));
  }

  configureQzSecurity.configured = true;
};

configureQzSecurity.configured = false;

export const isQzTrayAvailable = () => Boolean(getQz());

export const ensureQzTrayConnection = async () => {
  const qz = getQz();
  if (!qz) {
    throw new Error('QZ Tray no está disponible en esta sesión.');
  }

  configureQzSecurity(qz);

  if (typeof qz.websocket?.isActive === 'function' && qz.websocket.isActive()) {
    return qz;
  }

  await qz.websocket.connect();
  return qz;
};

export const listSystemPrinters = async () => {
  const qz = await ensureQzTrayConnection();
  const printers = await qz.printers.find();
  const printerList = Array.isArray(printers) ? printers : [printers];

  return printerList
    .map((printerName) => ({
      id: `system_${String(printerName).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name: printerName,
      systemName: printerName,
      source: 'qz',
      active: true
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

export const printHtmlWithQzTray = async ({ printerName, html, title }) => {
  const qz = await ensureQzTrayConnection();
  const config = qz.configs.create(printerName, {
    jobName: title || 'POS Print'
  });

  await qz.print(config, [
    {
      type: 'html',
      format: 'plain',
      data: html
    }
  ]);
};
