const getReceiptApiBaseUrl = () => {
  const configuredUrl = process.env.REACT_APP_RECEIPTS_API_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');
  return 'http://localhost:4001';
};

export const sendReceiptEmail = async (payload) => {
  if (typeof window !== 'undefined' && typeof window.cjmarineElectron?.sendReceiptEmail === 'function') {
    return window.cjmarineElectron.sendReceiptEmail(payload);
  }

  const response = await fetch(`${getReceiptApiBaseUrl()}/send-receipt-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok === false) {
    throw new Error(result?.error || 'No se pudo enviar el recibo por email.');
  }

  return result;
};

export const canSendReceiptEmail = () => true;
