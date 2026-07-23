import { collection, doc, onSnapshot, orderBy, query, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getNetSaleTotal, normalizeSaleRefund, normalizeSaleStatus } from '../utils/salesUtils';
import { mergeWeeklyCachedSales, syncWeeklySalesCache, upsertWeeklyCachedSale } from './weeklySalesCacheService';
import { generateId } from '../data/demoData';
import { buildInventoryLogEntry, INVENTORY_MOVEMENT_TYPES } from '../utils/inventoryLogUtils';

const salesCol = collection(db, 'sales');

export const subscribeSales = (onData, onError) => {
  const q = query(salesCol, orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      syncWeeklySalesCache(rows);
      onData(mergeWeeklyCachedSales(rows));
    },
    (error) => {
      onData(mergeWeeklyCachedSales([]));
      if (onError) onError(error);
    }
  );
};

export const saveSale = async (sale) => {
  await setDoc(doc(db, 'sales', sale.id), sale, { merge: true });
  upsertWeeklyCachedSale(sale);
  return sale;
};

export const refundSale = async (sale, refundInput) => {
  const refundRecord = normalizeSaleRefund(refundInput);
  const refunds = [...(Array.isArray(sale.refunds) ? sale.refunds : []), refundRecord];
  const status = normalizeSaleStatus(sale.status, {
    ...sale,
    refunds
  });

  const nextSale = {
    ...sale,
    refunds,
    status,
    paymentStatus: status,
    refunded_at: refundRecord.refundedAt,
    refunded_by: refundRecord.refundedBy,
    refundedAmount: Math.round((Number(sale.total || 0) - getNetSaleTotal({ ...sale, refunds })) * 100) / 100
  };

  // Solo se restituye stock cuando el reembolso esta atado a un producto especifico
  // (item + cantidad); un reembolso de monto general sin item asociado no toca inventario.
  const restockItems = (refundRecord.items || []).filter(
    (item) => item?.productId && Number(item.quantity) > 0
  );

  await runTransaction(db, async (transaction) => {
    const productUpdates = [];
    const logEntries = [];

    for (const item of restockItems) {
      const productRef = doc(db, 'products', item.productId);
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists()) continue;

      const product = productSnapshot.data();
      const quantity = Number(item.quantity || 0);
      const currentStock = Number(product.stock || 0);
      const nextStock = currentStock + quantity;
      const payload = {
        stock: nextStock,
        updatedAt: new Date().toISOString()
      };

      if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0 && item.selectedSize) {
        payload.sizeStocks = applyStockChangeToSizeStocks(product.sizeStocks, item.selectedSize, quantity);
      }

      productUpdates.push({ productRef, payload: sanitizeFirestoreValue(payload) });
      logEntries.push(buildInventoryLogEntry({
        id: generateId('invlog'),
        productId: item.productId,
        productName: product.name || item.productId,
        type: INVENTORY_MOVEMENT_TYPES.refund,
        quantity,
        oldStock: currentStock,
        newStock: nextStock,
        reason: `Reembolso venta ${sale.id}`,
        performedBy: refundRecord.refundedBy,
        reference: sale.id
      }));
    }

    transaction.set(doc(db, 'sales', nextSale.id), sanitizeFirestoreValue(nextSale), { merge: true });
    productUpdates.forEach(({ productRef, payload }) => {
      transaction.update(productRef, payload);
    });
    logEntries.forEach((log) => {
      transaction.set(doc(db, 'inventoryLogs', log.id), log);
    });
  });

  upsertWeeklyCachedSale(nextSale);
  return nextSale;
};

const applyStockChangeToSizeStocks = (sizeStocks = [], selectedSize = '', quantityDelta = 0) => {
  if (!Array.isArray(sizeStocks) || sizeStocks.length === 0 || !selectedSize) {
    return sizeStocks;
  }

  return sizeStocks.map((entry) => (
    entry.size === selectedSize
      ? { ...entry, stock: Math.max(0, Number(entry.stock || 0) + quantityDelta) }
      : entry
  ));
};

const sanitizeFirestoreValue = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFirestoreValue(entry));
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, entry]) => {
      acc[key] = sanitizeFirestoreValue(entry);
      return acc;
    }, {});
  }
  return value;
};

export const registerSaleExchange = async ({
  originalSale,
  nextSale,
  adjustmentSale = null,
  adjustmentPayments = [],
  stockChanges = []
}) => {
  if (!originalSale?.id || !nextSale?.id) {
    throw new Error('No se encontro la venta original para registrar el cambio.');
  }

  await runTransaction(db, async (transaction) => {
    const productUpdates = [];
    const logEntries = [];

    const changesByProduct = stockChanges.reduce((map, change) => {
      if (!change?.productId || !Number.isFinite(Number(change.quantityDelta))) return map;
      const rows = map.get(change.productId) || [];
      rows.push(change);
      map.set(change.productId, rows);
      return map;
    }, new Map());

    for (const [productId, productChanges] of changesByProduct.entries()) {
      const productRef = doc(db, 'products', productId);
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists()) {
        throw new Error(`No se encontro el producto ${productId} para actualizar inventario del cambio.`);
      }

      const product = productSnapshot.data();
      const quantityDelta = productChanges.reduce((sum, change) => sum + Number(change.quantityDelta || 0), 0);
      const currentStock = Number(product.stock || 0);
      const nextStock = currentStock + quantityDelta;

      if (nextStock < 0) {
        throw new Error(`No hay stock suficiente de ${product.name || productId} para completar el cambio.`);
      }

      const payload = {
        stock: nextStock,
        updatedAt: new Date().toISOString()
      };

      if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0) {
        const sizeDeltas = productChanges.reduce((map, change) => {
          const selectedSize = change.selectedSize || '';
          if (!selectedSize) return map;
          map.set(selectedSize, (map.get(selectedSize) || 0) + Number(change.quantityDelta || 0));
          return map;
        }, new Map());

        for (const [selectedSize, sizeDelta] of sizeDeltas.entries()) {
          const sizeEntry = product.sizeStocks.find((entry) => entry.size === selectedSize);

          if (!sizeEntry) {
            throw new Error(`No se encontro la talla ${selectedSize} de ${product.name || productId}.`);
          }

          if (Number(sizeEntry.stock || 0) + sizeDelta < 0) {
            throw new Error(`No hay stock suficiente de ${product.name || productId} en talla ${selectedSize}.`);
          }
        }

        payload.sizeStocks = [...sizeDeltas.entries()].reduce(
          (rows, [selectedSize, sizeDelta]) => applyStockChangeToSizeStocks(rows, selectedSize, sizeDelta),
          product.sizeStocks
        );
      }

      productUpdates.push({
        productRef,
        payload: sanitizeFirestoreValue(payload)
      });

      let runningStock = currentStock;
      productChanges.forEach((change) => {
        const changeDelta = Number(change.quantityDelta || 0);
        const afterChangeStock = runningStock + changeDelta;
        logEntries.push(buildInventoryLogEntry({
          id: generateId('invlog'),
          productId,
          productName: product.name || change.productName || productId,
          type: changeDelta > 0 ? INVENTORY_MOVEMENT_TYPES.exchangeIn : INVENTORY_MOVEMENT_TYPES.exchangeOut,
          quantity: Math.abs(changeDelta),
          oldStock: runningStock,
          newStock: afterChangeStock,
          reason: change.reason || `Cambio venta ${originalSale.id}`,
          performedBy: change.performedBy || nextSale.chargedBy || nextSale.cashier || 'Sistema',
          performedById: change.performedById || nextSale.chargedById || nextSale.cashierId || '',
          reference: change.reference || nextSale.id
        }));
        runningStock = afterChangeStock;
      });
    }

    transaction.set(doc(db, 'sales', nextSale.id), sanitizeFirestoreValue(nextSale), { merge: true });

    if (adjustmentSale?.id) {
      transaction.set(doc(db, 'sales', adjustmentSale.id), sanitizeFirestoreValue(adjustmentSale), { merge: true });
    }

    adjustmentPayments.forEach((payment) => {
      if (!payment?.id) return;
      transaction.set(doc(db, 'payments', payment.id), sanitizeFirestoreValue(payment), { merge: true });
    });

    productUpdates.forEach(({ productRef, payload }) => {
      transaction.update(productRef, payload);
    });

    logEntries.forEach((log) => {
      transaction.set(doc(db, 'inventoryLogs', log.id), log);
    });
  });

  upsertWeeklyCachedSale(nextSale);
  if (adjustmentSale?.id) {
    upsertWeeklyCachedSale(adjustmentSale);
  }

  return {
    sale: nextSale,
    adjustmentSale
  };
};

export const resetAllSaleExchangesSync = async ({
  salesToUpsert = [],
  saleIdsToDelete = [],
  paymentIdsToDelete = [],
  productsToUpsert = []
}) => {
  const batch = writeBatch(db);

  salesToUpsert.forEach((sale) => {
    if (!sale?.id) return;
    batch.set(doc(db, 'sales', sale.id), sanitizeFirestoreValue(sale), { merge: true });
  });

  saleIdsToDelete.forEach((saleId) => {
    if (!saleId) return;
    batch.delete(doc(db, 'sales', saleId));
  });

  paymentIdsToDelete.forEach((paymentId) => {
    if (!paymentId) return;
    batch.delete(doc(db, 'payments', paymentId));
  });

  productsToUpsert.forEach((product) => {
    if (!product?.id) return;
    batch.set(doc(db, 'products', product.id), sanitizeFirestoreValue(product), { merge: true });
  });

  await batch.commit();

  salesToUpsert.forEach((sale) => upsertWeeklyCachedSale(sale));

  return {
    updatedSales: salesToUpsert.length,
    deletedSales: saleIdsToDelete.length,
    deletedPayments: paymentIdsToDelete.length,
    updatedProducts: productsToUpsert.length
  };
};
