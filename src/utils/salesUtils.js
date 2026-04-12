export const SALE_STATUS = {
  paid: 'paid',
  partially_refunded: 'partially_refunded',
  refunded: 'refunded'
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
