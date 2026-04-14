export const PAYMENT_METHODS = {
  cash: 'cash',
  card: 'card',
  athMovil: 'ath_movil',
  split: 'split'
};

const LEGACY_PAYMENT_METHODS = {
  mobile: PAYMENT_METHODS.athMovil
};

export const normalizePaymentMethod = (method) => {
  if (!method) return '';
  return LEGACY_PAYMENT_METHODS[method] || method;
};

export const getPaymentMethodLabel = (method) => {
  switch (normalizePaymentMethod(method)) {
    case PAYMENT_METHODS.cash:
      return 'Efectivo';
    case PAYMENT_METHODS.card:
      return 'Tarjeta';
    case PAYMENT_METHODS.athMovil:
      return 'ATH Móvil';
    case PAYMENT_METHODS.split:
      return 'Split';
    default:
      return method;
  }
};

export const getPaymentProcessor = (method) => {
  switch (normalizePaymentMethod(method)) {
    case PAYMENT_METHODS.card:
      return 'clover';
    default:
      return '';
  }
};

export const buildTransactionRecord = ({
  saleId,
  cart,
  subtotal,
  discountAmount,
  tax,
  taxSummary,
  total,
  cashier,
  cashierId,
  paymentEntries
}) => {
  const createdAt = new Date().toISOString();
  const primaryPayment = paymentEntries[0] || {};
  const normalizedMethod = paymentEntries.length > 1
    ? PAYMENT_METHODS.split
    : normalizePaymentMethod(primaryPayment.method);

  return {
    id: saleId,
    transaction_id: saleId,
    date: createdAt,
    created_at: createdAt,
    items: cart.map((item) => ({
      productId: item.id,
      name: item.name,
      quantity: item.quantity,
      unitType: item.unitType || 'unit',
      selectedSize: item.selectedSize || '',
      price: item.price,
      subtotal: item.price * item.quantity,
      discountType: item.discount?.type || 'percentage',
      discountValue: Number(item.discount?.value || 0),
      discountAmount: Number(item.pricing?.discountAmount || 0),
      taxableSubtotal: Number(item.pricing?.taxableSubtotal || (item.price * item.quantity)),
      ivuStateEnabled: item.ivuStateEnabled !== false,
      ivuMunicipalEnabled: item.ivuMunicipalEnabled !== false
    })),
    subtotal,
    tax: Math.round(tax * 100) / 100,
    taxBreakdown: {
      state: Math.round(taxSummary.state * 100) / 100,
      municipal: Math.round(taxSummary.municipal * 100) / 100
    },
    discount: discountAmount,
    total: Math.round(total * 100) / 100,
    status: 'paid',
    paymentStatus: 'paid',
    paymentMethod: normalizedMethod,
    payment_method: normalizedMethod,
    payments: paymentEntries,
    cashier,
    cashierId
  };
};

export const buildPaymentEntry = ({
  transactionId,
  method,
  amount,
  confirmedBy,
  reference = '',
  amountReceived = null,
  changeDue = null
}) => {
  const normalizedMethod = normalizePaymentMethod(method);

  return {
    id: `payment_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    transaction_id: transactionId,
    method: normalizedMethod,
    amount: Math.round(amount * 100) / 100,
    processor: getPaymentProcessor(normalizedMethod) || null,
    reference: reference || null,
    confirmed_by: confirmedBy,
    confirmed_at: new Date().toISOString(),
    status: 'paid',
    amount_received: amountReceived !== null ? Math.round(amountReceived * 100) / 100 : null,
    change_due: changeDue !== null ? Math.round(changeDue * 100) / 100 : null
  };
};
