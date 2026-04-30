import { collection, doc, onSnapshot, orderBy, query, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getNetSaleTotal, normalizeSaleRefund, normalizeSaleStatus } from '../utils/salesUtils';
import { mergeWeeklyCachedSales, syncWeeklySalesCache, upsertWeeklyCachedSale } from './weeklySalesCacheService';

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

  return saveSale({
    ...sale,
    refunds,
    status,
    paymentStatus: status,
    refunded_at: refundRecord.refundedAt,
    refunded_by: refundRecord.refundedBy,
    refundedAmount: Math.round((Number(sale.total || 0) - getNetSaleTotal({ ...sale, refunds })) * 100) / 100
  });
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

    for (const change of stockChanges) {
      if (!change?.productId || !Number.isFinite(Number(change.quantityDelta))) continue;

      const productRef = doc(db, 'products', change.productId);
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists()) continue;

      const product = productSnapshot.data();
      const quantityDelta = Number(change.quantityDelta || 0);
      const payload = {
        stock: Math.max(0, Number(product.stock || 0) + quantityDelta),
        updatedAt: new Date().toISOString()
      };

      if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0) {
        payload.sizeStocks = applyStockChangeToSizeStocks(
          product.sizeStocks,
          change.selectedSize || '',
          quantityDelta
        );
      }

      productUpdates.push({
        productRef,
        payload: sanitizeFirestoreValue(payload)
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
