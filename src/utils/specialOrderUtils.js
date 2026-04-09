export const SPECIAL_ORDER_STATUS = {
  pending_order: 'pending_order',
  ordered: 'ordered',
  waiting_arrival: 'waiting_arrival',
  ready_for_pickup: 'ready_for_pickup',
  delivered: 'delivered',
  canceled: 'canceled'
};

export const SPECIAL_ORDER_PAYMENT_STATUS = {
  unpaid: 'unpaid',
  partially_paid: 'partially_paid',
  paid: 'paid',
  refunded: 'refunded',
  partially_refunded: 'partially_refunded'
};

export const SPECIAL_ORDER_PAYMENT_KIND = {
  deposit: 'deposit',
  payment: 'payment',
  refund: 'refund'
};

export const SPECIAL_ORDER_STATUS_OPTIONS = [
  { value: SPECIAL_ORDER_STATUS.pending_order, label: 'Pendiente de ordenar' },
  { value: SPECIAL_ORDER_STATUS.ordered, label: 'Ordenado al suplidor' },
  { value: SPECIAL_ORDER_STATUS.waiting_arrival, label: 'En espera' },
  { value: SPECIAL_ORDER_STATUS.ready_for_pickup, label: 'Listo para entregar' },
  { value: SPECIAL_ORDER_STATUS.delivered, label: 'Entregado' },
  { value: SPECIAL_ORDER_STATUS.canceled, label: 'Cancelado' }
];

export const SPECIAL_ORDER_PAYMENT_STATUS_OPTIONS = [
  { value: SPECIAL_ORDER_PAYMENT_STATUS.unpaid, label: 'Sin pagos' },
  { value: SPECIAL_ORDER_PAYMENT_STATUS.partially_paid, label: 'Parcialmente pagado' },
  { value: SPECIAL_ORDER_PAYMENT_STATUS.paid, label: 'Pagado' },
  { value: SPECIAL_ORDER_PAYMENT_STATUS.refunded, label: 'Reembolsado' },
  { value: SPECIAL_ORDER_PAYMENT_STATUS.partially_refunded, label: 'Reembolso parcial' }
];

const DEFAULT_ITEM = {
  id: '',
  productId: '',
  name: '',
  description: '',
  sku: '',
  quantity: 1,
  unitCost: 0,
  unitPrice: 0,
  subtotal: 0
};

const generateLocalId = (prefix = 'id') =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const formatSpecialOrderNumber = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const stamp = `${year}${month}${day}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PE-${stamp}-${suffix}`;
};

export const normalizeSpecialOrderItem = (item = {}) => {
  const quantity = Math.max(1, Number(item.quantity || 1));
  const unitCost = Number(item.unitCost || 0);
  const unitPrice = Number(item.unitPrice || 0);

  return {
    ...DEFAULT_ITEM,
    ...item,
    id: item.id || generateLocalId('special_order_item'),
    quantity,
    unitCost,
    unitPrice,
    subtotal: Math.round(quantity * unitPrice * 100) / 100
  };
};

export const normalizeSpecialOrderPayment = (payment = {}) => ({
  id: payment.id || generateLocalId('special_order_payment'),
  specialOrderId: payment.specialOrderId || payment.special_order_id || '',
  kind: payment.kind || SPECIAL_ORDER_PAYMENT_KIND.payment,
  method: payment.method || 'cash',
  amount: Math.round(Number(payment.amount || 0) * 100) / 100,
  processor: payment.processor || null,
  reference: payment.reference || null,
  notes: payment.notes || '',
  confirmedBy: payment.confirmedBy || payment.confirmed_by || '',
  confirmedById: payment.confirmedById || payment.confirmed_by_id || '',
  createdAt: payment.createdAt || payment.created_at || new Date().toISOString()
});

export const calculateSpecialOrderPaymentSummary = (payments = [], totalAmount = 0) => {
  const normalizedPayments = payments.map(normalizeSpecialOrderPayment);

  const totals = normalizedPayments.reduce((summary, payment) => {
    if (payment.kind === SPECIAL_ORDER_PAYMENT_KIND.refund) {
      summary.refunded += payment.amount;
      return summary;
    }

    summary.collected += payment.amount;
    if (payment.kind === SPECIAL_ORDER_PAYMENT_KIND.deposit) {
      summary.deposit += payment.amount;
    }
    if (payment.kind === SPECIAL_ORDER_PAYMENT_KIND.payment) {
      summary.finalPayments += payment.amount;
    }
    return summary;
  }, {
    deposit: 0,
    collected: 0,
    refunded: 0,
    finalPayments: 0
  });

  const netPaid = Math.max(0, totals.collected - totals.refunded);
  const balanceDue = Math.max(0, Math.round((Number(totalAmount || 0) - netPaid) * 100) / 100);

  let paymentStatus = SPECIAL_ORDER_PAYMENT_STATUS.unpaid;
  if (netPaid > 0 && balanceDue > 0) {
    paymentStatus = SPECIAL_ORDER_PAYMENT_STATUS.partially_paid;
  } else if (balanceDue === 0 && Number(totalAmount || 0) > 0) {
    paymentStatus = SPECIAL_ORDER_PAYMENT_STATUS.paid;
  }

  if (totals.refunded > 0 && netPaid === 0) {
    paymentStatus = SPECIAL_ORDER_PAYMENT_STATUS.refunded;
  } else if (totals.refunded > 0) {
    paymentStatus = SPECIAL_ORDER_PAYMENT_STATUS.partially_refunded;
  }

  return {
    ...totals,
    netPaid: Math.round(netPaid * 100) / 100,
    balanceDue,
    paymentStatus
  };
};

export const normalizeSpecialOrderStatus = (status) =>
  Object.values(SPECIAL_ORDER_STATUS).includes(status)
    ? status
    : SPECIAL_ORDER_STATUS.pending_order;

export const normalizeSpecialOrder = (order = {}) => {
  const items = Array.isArray(order.items) ? order.items.map(normalizeSpecialOrderItem) : [];
  const totalAmount = Math.round(
    (order.totalAmount ?? order.total_amount ?? items.reduce((sum, item) => sum + item.subtotal, 0)) * 100
  ) / 100;
  const payments = Array.isArray(order.payments) ? order.payments.map(normalizeSpecialOrderPayment) : [];
  const paymentSummary = calculateSpecialOrderPaymentSummary(payments, totalAmount);

  return {
    id: order.id || generateLocalId('special_order'),
    orderNumber: order.orderNumber || order.order_number || formatSpecialOrderNumber(),
    customerId: order.customerId || order.customer_id || '',
    customerName: order.customerName || order.customer_name || '',
    customerPhone: order.customerPhone || order.customer_phone || '',
    customerEmail: order.customerEmail || order.customer_email || '',
    items,
    totalAmount,
    depositAmount: Number(order.depositAmount || order.deposit_amount || paymentSummary.deposit || 0),
    amountPaid: Number(order.amountPaid || order.amount_paid || paymentSummary.netPaid || 0),
    balanceDue: Number(order.balanceDue || order.balance_due || paymentSummary.balanceDue || 0),
    orderStatus: normalizeSpecialOrderStatus(order.orderStatus || order.order_status),
    paymentStatus: order.paymentStatus || order.payment_status || paymentSummary.paymentStatus,
    expectedDate: order.expectedDate || order.expected_date || '',
    orderedAt: order.orderedAt || order.ordered_at || '',
    receivedAt: order.receivedAt || order.received_at || '',
    readyAt: order.readyAt || order.ready_at || '',
    deliveredAt: order.deliveredAt || order.delivered_at || '',
    canceledAt: order.canceledAt || order.canceled_at || '',
    canceledReason: order.canceledReason || order.canceled_reason || '',
    internalNotes: order.internalNotes || order.internal_notes || '',
    statusNotes: order.statusNotes || order.status_notes || '',
    sourceSaleId: order.sourceSaleId || order.source_sale_id || '',
    createdBy: order.createdBy || order.created_by || '',
    createdById: order.createdById || order.created_by_id || '',
    updatedBy: order.updatedBy || order.updated_by || '',
    updatedById: order.updatedById || order.updated_by_id || '',
    createdAt: order.createdAt || order.created_at || new Date().toISOString(),
    updatedAt: order.updatedAt || order.updated_at || new Date().toISOString(),
    payments
  };
};

export const getSpecialOrderStatusLabel = (status) => {
  const match = SPECIAL_ORDER_STATUS_OPTIONS.find((option) => option.value === status);
  return match?.label || 'Pendiente de ordenar';
};

export const getSpecialOrderPaymentStatusLabel = (status) => {
  const match = SPECIAL_ORDER_PAYMENT_STATUS_OPTIONS.find((option) => option.value === status);
  return match?.label || 'Sin pagos';
};

export const getSpecialOrderStatusBadge = (status) => {
  switch (status) {
    case SPECIAL_ORDER_STATUS.ready_for_pickup:
      return 'badge-success';
    case SPECIAL_ORDER_STATUS.canceled:
      return 'badge-danger';
    case SPECIAL_ORDER_STATUS.delivered:
      return 'badge-info';
    default:
      return 'badge-warning';
  }
};

export const getSpecialOrderPaymentStatusBadge = (status) => {
  switch (status) {
    case SPECIAL_ORDER_PAYMENT_STATUS.paid:
      return 'badge-success';
    case SPECIAL_ORDER_PAYMENT_STATUS.refunded:
      return 'badge-danger';
    case SPECIAL_ORDER_PAYMENT_STATUS.partially_refunded:
      return 'badge-danger';
    case SPECIAL_ORDER_PAYMENT_STATUS.partially_paid:
      return 'badge-warning';
    default:
      return 'badge-info';
  }
};

export const canDeliverSpecialOrder = (order) =>
  normalizeSpecialOrderStatus(order.orderStatus) === SPECIAL_ORDER_STATUS.ready_for_pickup &&
  Number(order.balanceDue || 0) <= 0 &&
  order.paymentStatus === SPECIAL_ORDER_PAYMENT_STATUS.paid;

export const buildSpecialOrderAuditEntry = ({
  entityId,
  action,
  performedBy,
  performedById,
  description,
  metadata = {}
}) => ({
  id: generateLocalId('audit'),
  entityType: 'special_order',
  entityId,
  action,
  description,
  metadata,
  performedBy,
  performedById,
  createdAt: new Date().toISOString()
});
