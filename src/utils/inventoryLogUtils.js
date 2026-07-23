export const INVENTORY_MOVEMENT_TYPES = {
  sale: 'sale',
  refund: 'refund',
  exchangeIn: 'exchange_in',
  exchangeOut: 'exchange_out',
  adjustmentIn: 'adjustment_in',
  adjustmentOut: 'adjustment_out',
  specialOrderDelivery: 'special_order_delivery',
  specialOrderRevert: 'special_order_revert',
  reconciliation: 'reconciliation'
};

export const INVENTORY_MOVEMENT_LABELS = {
  sale: 'Venta',
  refund: 'Reembolso',
  exchange_in: 'Cambio - pieza recibida',
  exchange_out: 'Cambio - pieza entregada',
  adjustment_in: 'Ajuste manual (entrada)',
  adjustment_out: 'Ajuste manual (salida)',
  special_order_delivery: 'Entrega pedido especial',
  special_order_revert: 'Reversion pedido especial',
  reconciliation: 'Correccion / reconciliacion'
};

export const buildInventoryLogEntry = ({
  id,
  productId,
  productName,
  type,
  quantity,
  oldStock,
  newStock,
  reason = '',
  performedBy = '',
  performedById = '',
  reference = ''
}) => ({
  id,
  productId,
  productName,
  type,
  quantity,
  oldStock,
  newStock,
  reason,
  performedBy,
  performedById,
  reference,
  date: new Date().toISOString()
});
