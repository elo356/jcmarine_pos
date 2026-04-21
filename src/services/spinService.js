const DEFAULT_SPIN_API_URL = 'https://test.spinpos.net';
const DEFAULT_TRANSACTION_PATH = '/SPIn/cgi.html?TerminalTransaction=';
const DEFAULT_PAYMENT_TYPE = 'Credit';
const DEFAULT_PRINT_RECEIPT = 'No';
const DEFAULT_SIG_CAPTURE = 'No';
const DEFAULT_OPERATIONAL_TIMEOUT = 120;
const DEFAULT_NOTIFY_CUSTOMER = true;
const SPIN_PROXY_ENDPOINT = '/spin-proxy?TerminalTransaction=';

const boolToString = (value) => (value ? 'true' : 'false');

const formatAmount = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
};

const toCents = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
};

const normalizeBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const ensureAbsoluteSpinUrl = (value = '') => {
  const normalized = normalizeBaseUrl(value);

  if (!normalized) {
    return '';
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `https://${normalized}`;
};

const buildTerminalEndpoint = (apiUrl = '') => {
  const normalized = ensureAbsoluteSpinUrl(apiUrl || DEFAULT_SPIN_API_URL);

  if (
    typeof window !== 'undefined'
    && process.env.NODE_ENV === 'development'
    && /^https?:\/\//i.test(normalized)
    && !normalized.toLowerCase().startsWith(window.location.origin.toLowerCase())
  ) {
    return SPIN_PROXY_ENDPOINT;
  }

  if (!normalized) {
    return `${DEFAULT_SPIN_API_URL}${DEFAULT_TRANSACTION_PATH}`;
  }

  if (normalized.toLowerCase().includes('cgi.html?terminaltransaction=')) {
    return normalized;
  }

  if (normalized.toLowerCase().includes('cgi.html')) {
    return normalized.endsWith('=') ? normalized : `${normalized}?TerminalTransaction=`;
  }

  return `${normalized}${DEFAULT_TRANSACTION_PATH}`;
};

const xmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const buildTag = (name, value) => {
  if (value === undefined || value === null || value === '') return '';
  return `<${name}>${xmlEscape(value)}</${name}>`;
};

const buildSelfClosingTag = (name, enabled) => (enabled ? `<${name}/>` : '');

const parseExtData = (value = '') => {
  const output = {};
  const matcher = /([^=,\n\r]+?)\s*=\s*([^,\n\r]*)/g;
  let match = matcher.exec(String(value || ''));

  while (match) {
    output[String(match[1] || '').trim()] = String(match[2] || '').trim();
    match = matcher.exec(String(value || ''));
  }

  return output;
};

const extractResponseXml = (rawText = '') => {
  const text = String(rawText || '').trim();
  const start = text.indexOf('<response>');
  const end = text.lastIndexOf('</response>');

  if (start >= 0 && end >= 0) {
    return text.slice(start, end + '</response>'.length);
  }

  return text;
};

const readXmlTag = (doc, tagName) => doc.querySelector(tagName)?.textContent?.trim() || '';

const parseSpinResponse = (rawText) => {
  const xml = extractResponseXml(rawText);
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    const bodyText = String(rawText || '').trim();
    if (/^<!doctype html|^<html/i.test(bodyText) || /<html[\s>]/i.test(bodyText)) {
      throw new Error('SPIn devolvio HTML en lugar de XML. Verifica que REACT_APP_SPIN_API_URL apunte al host correcto con https://.');
    }

    throw new Error('SPIn devolvio una respuesta XML invalida.');
  }

  const extDataRaw = readXmlTag(doc, 'ExtData');
  const response = {
    rawXml: xml,
    refId: readXmlTag(doc, 'RefId'),
    registerId: readXmlTag(doc, 'RegisterId'),
    tpn: readXmlTag(doc, 'TPN'),
    transNum: readXmlTag(doc, 'TransNum'),
    invNum: readXmlTag(doc, 'InvNum'),
    resultCode: readXmlTag(doc, 'ResultCode'),
    message: readXmlTag(doc, 'Message'),
    respMSG: readXmlTag(doc, 'RespMSG'),
    authCode: readXmlTag(doc, 'AuthCode'),
    pnRef: readXmlTag(doc, 'PNRef'),
    paymentType: readXmlTag(doc, 'PaymentType'),
    transType: readXmlTag(doc, 'TransType'),
    serialNumber: readXmlTag(doc, 'SN'),
    emvData: readXmlTag(doc, 'EMVData'),
    hostResponseCode: readXmlTag(doc, 'HostResponseCode'),
    extDataRaw,
    extData: parseExtData(extDataRaw)
  };

  return response;
};

const isApprovedResponse = (response = {}) => {
  const statusText = `${response.message || ''} ${response.respMSG || ''}`.toLowerCase();
  return String(response.resultCode || '') === '0'
    && /(approved|approval|success)/i.test(statusText);
};

const isTimeoutResponse = (response = {}) => {
  const statusText = `${response.message || ''} ${response.respMSG || ''}`.toLowerCase();
  return /timed?\s*out|timeout/.test(statusText);
};

const getSpinErrorMessage = (response = null, fallback = 'La terminal rechazo la transaccion.') => {
  if (!response || typeof response !== 'object') {
    return fallback;
  }

  const message = String(response.message || '').trim();
  const respMSG = String(response.respMSG || '').trim();
  const details = [];

  if (message && !/^(error|failed?|failure)$/i.test(message)) {
    details.push(message);
  }

  if (respMSG && respMSG.toLowerCase() !== message.toLowerCase()) {
    details.push(respMSG);
  }

  if (details.length > 0) {
    return details.join(': ');
  }

  if (message) {
    return message;
  }

  return fallback;
};

const createSpinError = (message, response = null) => {
  const error = new Error(message);
  error.name = 'SpinError';
  error.response = response;
  return error;
};

const sanitizeMerchantId = (value = '') => {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return '';
  }

  return normalized.length <= 12 ? normalized : '';
};

const normalizeAscii = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const sanitizeSpinIdentifier = (value = '', maxLength = 50) => normalizeAscii(value)
  .replace(/[^A-Za-z0-9]/g, '')
  .slice(0, maxLength);

export const getSpinConfigurationState = () => {
  const apiUrl = String(process.env.REACT_APP_SPIN_API_URL || DEFAULT_SPIN_API_URL).trim();
  const registerId = String(process.env.REACT_APP_SPIN_REGISTER_ID || '').trim();
  const authKey = String(process.env.REACT_APP_SPIN_AUTH_KEY || '').trim();
  const tpn = String(process.env.REACT_APP_SPIN_TPN || '').trim();
  const rawMerchantId = String(process.env.REACT_APP_SPIN_MERCHANT_ID || '').trim();
  const merchantId = sanitizeMerchantId(rawMerchantId);
  // Runtime behavior is controlled by system defaults and transaction context, not .env toggles.
  const paymentType = DEFAULT_PAYMENT_TYPE;
  const printReceipt = DEFAULT_PRINT_RECEIPT;
  const sigCapture = DEFAULT_SIG_CAPTURE;
  const operationalTimeout = DEFAULT_OPERATIONAL_TIMEOUT;
  const notifyCustomer = DEFAULT_NOTIFY_CUSTOMER;
  const isvId = String(process.env.REACT_APP_SPIN_ISV_ID || '').trim();
  const reconIdPrefix = String(process.env.REACT_APP_SPIN_RECON_PREFIX || '').trim();

  const missing = [];
  if (!registerId && !tpn) missing.push('REACT_APP_SPIN_REGISTER_ID o REACT_APP_SPIN_TPN');
  if (!authKey) missing.push('REACT_APP_SPIN_AUTH_KEY');

  return {
    apiUrl,
    endpoint: buildTerminalEndpoint(apiUrl),
    registerId,
    authKey,
    tpn,
    merchantId,
    merchantIdIgnored: Boolean(rawMerchantId) && !merchantId,
    paymentType,
    printReceipt,
    sigCapture,
    operationalTimeout,
    notifyCustomer,
    isvId,
    reconIdPrefix,
    missing,
    isConfigured: missing.length === 0
  };
};

const buildCartXml = ({ cartItems = [], subtotal = 0, discountAmount = 0, tax = 0, total = 0, notifyCustomer = true }) => {
  const amountRows = [
    { name: 'Discounts', value: toCents(discountAmount) },
    { name: 'Subtotal', value: toCents(subtotal) },
    { name: 'Taxes', value: toCents(tax) },
    { name: 'Total', value: toCents(total), isTotal: true }
  ];

  const itemsXml = cartItems.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.price || 0);
    const lineTotal = Number(item.pricing?.taxableSubtotal || (unitPrice * quantity) || 0);
    const additionalInfo = [
      item.selectedSize ? `Talla: ${item.selectedSize}` : '',
      Number(item.pricing?.discountAmount || 0) > 0 ? `Descuento: ${formatAmount(item.pricing.discountAmount)}` : '',
      item.unitType === 'feet' ? 'Unidad: pies' : ''
    ].filter(Boolean).join(' | ');

    return [
      '<Item>',
      buildTag('Name', item.name || 'Producto'),
      buildTag('Price', toCents(lineTotal)),
      buildTag('UnitPrice', toCents(unitPrice)),
      buildTag('Quantity', Number.isFinite(quantity) ? quantity : 1),
      buildTag('AdditionalInfo', additionalInfo),
      '</Item>'
    ].join('');
  }).join('');

  const amountsXml = amountRows.map((row) => [
    '<Amount>',
    buildTag('Name', row.name),
    buildTag('Value', row.value),
    buildSelfClosingTag('Total', row.isTotal),
    '</Amount>'
  ].join('')).join('');

  return [
    buildTag('notifyCustomer', boolToString(notifyCustomer)),
    '<Cart>',
    `<Amounts>${amountsXml}</Amounts>`,
    `<Items>${itemsXml}</Items>`,
    '</Cart>'
  ].join('');
};

const buildRequestXml = (tags = {}) => {
  const orderedTags = [
    'PaymentType',
    'TransType',
    'Amount',
    'Tip',
    'CashbackAmount',
    'Frequency',
    'CustomFee',
    'OperationalTimeout',
    'TaxAmount',
    'IsvId',
    'ReconId',
    'RefId',
    'RegisterId',
    'TPN',
    'MerchantId',
    'AuthKey',
    'PrintReceipt',
    'SigCapture',
    'PerformedBy',
    'notifyCustomer',
    'PosID'
  ];

  const xmlParts = ['<request>'];
  orderedTags.forEach((tagName) => {
    xmlParts.push(buildTag(tagName, tags[tagName]));
  });

  if (tags.CartXml) {
    xmlParts.push(tags.CartXml);
  }

  xmlParts.push('</request>');
  return xmlParts.join('');
};

const sendSpinRequest = async (requestXml, configuration) => {
  let response;

  try {
    response = await fetch(`${configuration.endpoint}${encodeURIComponent(requestXml)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/xml, text/xml, text/plain, */*'
      }
    });
  } catch (error) {
    throw createSpinError(
      'No se pudo conectar con SPIn. Verifica el proxy, la red y que la terminal este en linea.',
      { cause: error?.message || String(error) }
    );
  }

  const rawText = await response.text();

  if (!response.ok) {
    throw createSpinError(`SPIn respondio con HTTP ${response.status}.`, { rawText });
  }

  return parseSpinResponse(rawText);
};

export const runSpinStatusCheck = async ({ refId, paymentType }) => {
  const configuration = getSpinConfigurationState();
  const safeRefId = sanitizeSpinIdentifier(refId, 50);

  if (!configuration.isConfigured) {
    throw createSpinError(`Falta configurar SPIn: ${configuration.missing.join(', ')}`);
  }

  if (!safeRefId) {
    throw createSpinError('SPIn requiere un RefId valido para consultar el estado del pago.');
  }

  const requestXml = buildRequestXml({
    AuthKey: configuration.authKey,
    PaymentType: paymentType || configuration.paymentType,
    RegisterId: configuration.registerId,
    TransType: 'Status',
    RefId: safeRefId,
    PrintReceipt: configuration.printReceipt
  });

  return sendSpinRequest(requestXml, configuration);
};

const runSpinCartDisplay = async ({ cartItems, subtotal, discountAmount, tax, total }) => {
  const configuration = getSpinConfigurationState();

  if (!configuration.tpn || !Array.isArray(cartItems) || cartItems.length === 0) {
    return null;
  }

  const requestXml = buildRequestXml({
    AuthKey: configuration.authKey,
    TPN: configuration.tpn,
    PosID: configuration.registerId || configuration.tpn,
    CartXml: buildCartXml({
      cartItems,
      subtotal,
      discountAmount,
      tax,
      total,
      notifyCustomer: configuration.notifyCustomer
    })
  });

  return sendSpinRequest(requestXml, configuration);
};

export const processSpinCardPayment = async ({
  amount,
  refId,
  paymentType,
  cartItems = [],
  subtotal = 0,
  discountAmount = 0,
  tax = 0,
  total = 0
}) => {
  const configuration = getSpinConfigurationState();
  const safeRefId = sanitizeSpinIdentifier(refId, 50);

  if (!configuration.isConfigured) {
    throw createSpinError(`Falta configurar SPIn: ${configuration.missing.join(', ')}`);
  }

  if (!safeRefId) {
    throw createSpinError('SPIn requiere un RefId unico para cada pago.');
  }

  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw createSpinError('SPIn requiere un monto valido para procesar la venta.');
  }

  try {
    await runSpinCartDisplay({ cartItems, subtotal, discountAmount, tax, total });
  } catch (error) {
    console.warn('SPIn cart display skipped:', error);
  }

  const effectivePaymentType = paymentType || configuration.paymentType;
  const requestXml = buildRequestXml({
    PaymentType: effectivePaymentType,
    TransType: 'Sale',
    Amount: formatAmount(amount),
    Tip: '0.00',
    CashbackAmount: '0.00',
    Frequency: 'OneTime',
    CustomFee: '0.00',
    RefId: safeRefId,
    RegisterId: configuration.registerId,
    AuthKey: configuration.authKey,
    PrintReceipt: configuration.printReceipt,
    SigCapture: configuration.sigCapture
  });

  const initialResponse = await sendSpinRequest(requestXml, configuration);

  if (isApprovedResponse(initialResponse)) {
    return {
      ...initialResponse,
      source: 'sale'
    };
  }

  if (isTimeoutResponse(initialResponse)) {
    const statusResponse = await runSpinStatusCheck({
      refId: safeRefId,
      paymentType: effectivePaymentType
    });

    if (isApprovedResponse(statusResponse)) {
      return {
        ...statusResponse,
        source: 'status'
      };
    }

    throw createSpinError(
      getSpinErrorMessage(statusResponse, 'SPIn no pudo confirmar el estado del pago.'),
      statusResponse
    );
  }

  throw createSpinError(
    getSpinErrorMessage(initialResponse),
    initialResponse
  );
};
