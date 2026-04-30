import { IVU_MUNICIPAL_RATE, IVU_STATE_RATE, roundMoney } from './cartPricing';
import { normalizePaymentMethod } from './paymentUtils';

export const SALE_STATUS = {
  paid: 'paid',
  partially_refunded: 'partially_refunded',
  refunded: 'refunded'
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getSaleItemFinancials = (item = {}) => {
  const quantity = Math.max(0, toNumber(item.quantity, 0));
  const unitPrice = toNumber(item.price ?? item.unitPrice, 0);
  const subtotal = roundMoney(item.subtotal ?? (unitPrice * quantity));
  const discountType = item.discountType === 'fixed' || item.discount?.type === 'fixed' ? 'fixed' : 'percentage';
  const discountValue = Math.max(0, toNumber(item.discountValue ?? item.discount?.value, 0));
  const storedDiscountAmount = item.discountAmount;
  const computedDiscountAmount = discountType === 'percentage'
    ? subtotal * (discountValue / 100)
    : discountValue;
  const discountAmount = roundMoney(Math.min(
    subtotal,
    Math.max(0, toNumber(storedDiscountAmount, computedDiscountAmount))
  ));
  const taxableSubtotal = roundMoney(
    item.taxableSubtotal ?? Math.max(0, subtotal - discountAmount)
  );
  const stateTax = roundMoney(
    item.taxBreakdown?.state ??
    item.stateTax ??
    ((item.ivuStateEnabled !== false) ? taxableSubtotal * IVU_STATE_RATE : 0)
  );
  const municipalTax = roundMoney(
    item.taxBreakdown?.municipal ??
    item.municipalTax ??
    ((item.ivuMunicipalEnabled !== false) ? taxableSubtotal * IVU_MUNICIPAL_RATE : 0)
  );

  return {
    ...item,
    quantity,
    price: unitPrice,
    subtotal,
    discountType,
    discountValue,
    discountAmount,
    taxableSubtotal,
    taxBreakdown: {
      state: stateTax,
      municipal: municipalTax
    },
    tax: roundMoney(stateTax + municipalTax),
    total: roundMoney(item.total ?? (taxableSubtotal + stateTax + municipalTax))
  };
};

export const getSaleFinancialSummary = (sale = {}) => {
  const items = Array.isArray(sale.items) ? sale.items.map(getSaleItemFinancials) : [];
  const subtotal = roundMoney(
    sale.subtotal ?? items.reduce((sum, item) => sum + item.subtotal, 0)
  );
  const discount = roundMoney(
    sale.discount ?? items.reduce((sum, item) => sum + item.discountAmount, 0)
  );
  const itemStateTax = roundMoney(items.reduce((sum, item) => sum + item.taxBreakdown.state, 0));
  const itemMunicipalTax = roundMoney(items.reduce((sum, item) => sum + item.taxBreakdown.municipal, 0));
  const taxBreakdown = {
    state: roundMoney(sale.taxBreakdown?.state ?? sale.tax_state ?? itemStateTax),
    municipal: roundMoney(sale.taxBreakdown?.municipal ?? sale.tax_municipal ?? itemMunicipalTax)
  };
  const tax = roundMoney(
    sale.tax ?? sale.taxAmount ?? sale.tax_amount ?? (taxBreakdown.state + taxBreakdown.municipal)
  );
  const total = roundMoney(
    sale.total ?? Math.max(0, subtotal - discount) + tax
  );

  return {
    items,
    subtotal,
    discount,
    tax,
    taxBreakdown,
    total
  };
};

export const normalizeSaleRefund = (refund = {}) => ({
  id: refund.id || `refund_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  amount: Math.round(Number(refund.amount || 0) * 100) / 100,
  method: refund.method || refund.paymentMethod || 'cash',
  reason: refund.reason || '',
  notes: refund.notes || '',
  refundedAt: refund.refundedAt || refund.refunded_at || new Date().toISOString(),
  refundedBy: refund.refundedBy || refund.refunded_by || ''
});

export const getSaleRefunds = (sale = {}) =>
  Array.isArray(sale.refunds) ? sale.refunds.map(normalizeSaleRefund) : [];

export const getSaleRefundTotal = (sale = {}) =>
  getSaleRefunds(sale).reduce((sum, refund) => sum + Number(refund.amount || 0), 0);

export const getSaleRefundTotalFrom = (sale = {}, fromTime = 0, method = '') => {
  const targetMethod = normalizePaymentMethod(method);
  const fromMs = Number(fromTime || 0);

  return roundMoney(getSaleRefunds(sale).reduce((sum, refund) => {
    const refundedAtMs = new Date(refund.refundedAt || refund.refunded_at || sale.refunded_at || sale.date).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(refundedAtMs) && refundedAtMs < fromMs) return sum;
    if (targetMethod && normalizePaymentMethod(refund.method || refund.paymentMethod) !== targetMethod) return sum;
    return sum + Number(refund.amount || 0);
  }, 0));
};

export const getSaleTenderTotalByMethod = (sale = {}, method = '') => {
  const targetMethod = normalizePaymentMethod(method);
  const payments = Array.isArray(sale.payments) ? sale.payments : [];

  if (payments.length > 0) {
    return roundMoney(payments.reduce((sum, payment) => (
      normalizePaymentMethod(payment.method || payment.paymentMethod) === targetMethod
        ? sum + Number(payment.amount || 0)
        : sum
    ), 0));
  }

  return normalizePaymentMethod(sale.paymentMethod || sale.payment_method) === targetMethod
    ? roundMoney(Number(sale.total || 0))
    : 0;
};

export const getNetSaleTotal = (sale = {}) =>
  Math.max(0, Math.round((Number(sale.total || 0) - getSaleRefundTotal(sale)) * 100) / 100);

export const normalizeSaleStatus = (status, sale = {}) => {
  const refundTotal = getSaleRefundTotal(sale);
  const saleTotal = Number(sale.total || 0);

  if (status === SALE_STATUS.refunded || (saleTotal > 0 && refundTotal >= saleTotal)) {
    return SALE_STATUS.refunded;
  }

  if (status === SALE_STATUS.partially_refunded || refundTotal > 0) {
    return SALE_STATUS.partially_refunded;
  }

  return SALE_STATUS.paid;
};

export const isRefundedSale = (sale = {}) => normalizeSaleStatus(sale.status, sale) === SALE_STATUS.refunded;

export const isPartiallyRefundedSale = (sale = {}) =>
  normalizeSaleStatus(sale.status, sale) === SALE_STATUS.partially_refunded;

export const isReportableSale = (sale = {}) => getNetSaleTotal(sale) > 0;

export const isSpecialOrderPaymentSale = (sale = {}) => sale.saleType === 'special_order_payment';

export const getSaleStatusLabel = (status) => {
  switch (status) {
    case SALE_STATUS.partially_refunded:
      return 'Reembolso parcial';
    case SALE_STATUS.refunded:
      return 'Reembolsada';
    case SALE_STATUS.paid:
    default:
      return 'Pagada';
  }
};
