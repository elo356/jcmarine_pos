export const SALE_STATUS = {
  paid: 'paid',
  refunded: 'refunded'
};

export const normalizeSaleStatus = (status) => {
  if (!status) return SALE_STATUS.paid;
  return status === SALE_STATUS.refunded ? SALE_STATUS.refunded : SALE_STATUS.paid;
};

export const isRefundedSale = (sale = {}) => normalizeSaleStatus(sale.status) === SALE_STATUS.refunded;

export const isReportableSale = (sale = {}) => !isRefundedSale(sale);

export const getSaleStatusLabel = (status) => {
  switch (normalizeSaleStatus(status)) {
    case SALE_STATUS.refunded:
      return 'Reembolsada';
    case SALE_STATUS.paid:
    default:
      return 'Pagada';
  }
};
