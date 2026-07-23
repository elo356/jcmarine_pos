import { commitSaleTransaction } from './checkoutService';
import { applyProductStockDelta, addInventoryLog } from './inventoryService';
import { refundSale, registerSaleExchange } from './salesService';

const STORAGE_KEY = 'posPendingSyncQueue';
const QUEUE_EVENT = 'pos-pending-sync-changed';

const readQueue = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error reading pending sync queue:', error);
    return [];
  }
};

const writeQueue = (queue) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: queue }));
};

export const getPendingSyncQueue = () => readQueue();

export const subscribePendingSyncQueue = (onChange) => {
  const handler = (event) => onChange(event.detail || readQueue());
  const storageHandler = (event) => {
    if (event.key === STORAGE_KEY) onChange(readQueue());
  };
  window.addEventListener(QUEUE_EVENT, handler);
  window.addEventListener('storage', storageHandler);
  onChange(readQueue());
  return () => {
    window.removeEventListener(QUEUE_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
};

export const queuePendingSale = ({ sale, paymentEntries, cartItems, updatedBy }) => {
  const queue = readQueue();
  queue.push({
    kind: 'sale',
    id: `sale_${sale.id}`,
    label: `Venta ${sale.id}`,
    payload: { sale, paymentEntries, cartItems, updatedBy },
    failedAt: new Date().toISOString(),
    attempts: 0
  });
  writeQueue(queue);
};

export const queuePendingStockAdjustment = ({ productId, productName, delta, log }) => {
  const queue = readQueue();
  queue.push({
    kind: 'stockAdjustment',
    id: `stock_${log.id}`,
    label: `Ajuste de inventario: ${productName || productId}`,
    payload: { productId, delta, log },
    failedAt: new Date().toISOString(),
    attempts: 0
  });
  writeQueue(queue);
};

export const queuePendingRefund = ({ sale, refundRecord }) => {
  const queue = readQueue();
  queue.push({
    kind: 'refund',
    id: `refund_${refundRecord.id || sale.id}_${Date.now()}`,
    label: `Reembolso venta ${sale.id}`,
    payload: { sale, refundRecord },
    failedAt: new Date().toISOString(),
    attempts: 0
  });
  writeQueue(queue);
};

export const queuePendingExchange = ({
  originalSale,
  nextSale,
  adjustmentSale = null,
  adjustmentPayments = [],
  stockChanges = []
}) => {
  const queue = readQueue();
  queue.push({
    kind: 'exchange',
    id: `exchange_${nextSale.id}_${Date.now()}`,
    label: `Cambio venta ${nextSale.id}`,
    payload: { originalSale, nextSale, adjustmentSale, adjustmentPayments, stockChanges },
    failedAt: new Date().toISOString(),
    attempts: 0
  });
  writeQueue(queue);
};

let syncing = false;

const runEntry = async (entry) => {
  if (entry.kind === 'sale') {
    const { sale, paymentEntries, cartItems, updatedBy } = entry.payload;
    await commitSaleTransaction({ sale, paymentEntries, cartItems, updatedBy });
    return;
  }
  if (entry.kind === 'stockAdjustment') {
    const { productId, delta, log } = entry.payload;
    await applyProductStockDelta(productId, delta);
    await addInventoryLog(log);
    return;
  }
  if (entry.kind === 'refund') {
    const { sale, refundRecord } = entry.payload;
    await refundSale(sale, refundRecord);
    return;
  }
  if (entry.kind === 'exchange') {
    const { originalSale, nextSale, adjustmentSale, adjustmentPayments, stockChanges } = entry.payload;
    await registerSaleExchange({ originalSale, nextSale, adjustmentSale, adjustmentPayments, stockChanges });
    return;
  }
  throw new Error(`Tipo de sincronizacion pendiente desconocido: ${entry.kind}`);
};

// Reintenta cada operacion pendiente (ventas, ajustes de inventario, reembolsos) que
// fallo al escribir en Firestore. Se invoca al reconectar y al abrir la app para que el
// stock remoto no quede desincronizado del que ve el cajero en este equipo.
export const syncPendingQueue = async () => {
  if (syncing) return { synced: 0, stillPending: readQueue().length, skipped: true };
  syncing = true;

  try {
    const queue = readQueue();
    if (queue.length === 0) return { synced: 0, stillPending: 0 };

    const remaining = [];
    let synced = 0;

    for (const entry of queue) {
      try {
        await runEntry(entry);
        synced += 1;
      } catch (error) {
        remaining.push({
          ...entry,
          attempts: (entry.attempts || 0) + 1,
          lastError: error?.message || String(error)
        });
      }
    }

    writeQueue(remaining);
    return { synced, stillPending: remaining.length };
  } finally {
    syncing = false;
  }
};
