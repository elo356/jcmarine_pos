import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { loadData, saveData, generateId } from '../data/demoData';
import { buildInventoryLogEntry, INVENTORY_MOVEMENT_TYPES } from '../utils/inventoryLogUtils';

// Ventas que quedaron guardadas solo en este navegador porque la transaccion de cobro
// fallo en su momento (antes de que existiera la cola de reintento): el stock de esa
// venta nunca se descarto de Firestore, aunque el producto ya se vendio fisicamente.
export const findOrphanedLocalSales = async () => {
  const localData = loadData();
  const localSales = Array.isArray(localData.sales) ? localData.sales : [];
  if (localSales.length === 0) {
    return { orphanedSales: [], affectedProducts: [] };
  }

  const salesSnapshot = await getDocs(collection(db, 'sales'));
  const remoteSaleIds = new Set(salesSnapshot.docs.map((docSnap) => docSnap.id));

  const orphanedSales = localSales.filter((sale) => (
    sale?.id && !remoteSaleIds.has(sale.id) && !sale.reconciledAt
  ));

  const quantityByProduct = new Map();
  orphanedSales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      const productId = item?.productId || item?.id;
      const quantity = Number(item?.quantity || 0);
      if (!productId || !quantity) return;
      const current = quantityByProduct.get(productId) || { quantity: 0, name: item.name || productId };
      current.quantity += quantity;
      quantityByProduct.set(productId, current);
    });
  });

  if (quantityByProduct.size === 0) {
    return { orphanedSales, affectedProducts: [] };
  }

  const productsSnapshot = await getDocs(collection(db, 'products'));
  const productsById = new Map(
    productsSnapshot.docs.map((docSnap) => [docSnap.id, { id: docSnap.id, ...docSnap.data() }])
  );

  const affectedProducts = [...quantityByProduct.entries()].map(([productId, info]) => {
    const product = productsById.get(productId);
    const firestoreStock = product ? Number(product.stock || 0) : null;
    return {
      productId,
      name: product?.name || info.name,
      unsyncedQuantitySold: info.quantity,
      firestoreStock,
      estimatedRealStock: firestoreStock === null ? null : Math.max(0, firestoreStock - info.quantity),
      productExists: Boolean(product)
    };
  }).sort((a, b) => b.unsyncedQuantitySold - a.unsyncedQuantitySold);

  return { orphanedSales, affectedProducts };
};

// Aplica la correccion: descuenta en Firestore el stock que corresponde a las ventas
// huerfanas confirmadas y las marca como reconciliadas para no volver a descontarlas.
export const reconcileOrphanedLocalSales = async (orphanedSales, performedBy = 'Sistema') => {
  const quantityByProduct = new Map();
  orphanedSales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      const productId = item?.productId || item?.id;
      const quantity = Number(item?.quantity || 0);
      if (!productId || !quantity) return;
      quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + quantity);
    });
  });

  if (quantityByProduct.size > 0) {
    await runTransaction(db, async (transaction) => {
      const snapshots = await Promise.all(
        [...quantityByProduct.keys()].map((productId) => {
          const productRef = doc(db, 'products', productId);
          return transaction.get(productRef).then((snapshot) => ({ productId, productRef, snapshot }));
        })
      );

      const logEntries = [];

      snapshots.forEach(({ productId, productRef, snapshot }) => {
        if (!snapshot.exists()) return;
        const product = snapshot.data();
        const quantity = quantityByProduct.get(productId);
        const currentStock = Number(product.stock || 0);
        const nextStock = Math.max(0, currentStock - quantity);
        transaction.update(productRef, { stock: nextStock, updatedAt: new Date().toISOString() });
        logEntries.push(buildInventoryLogEntry({
          id: generateId('invlog'),
          productId,
          productName: product.name || productId,
          type: INVENTORY_MOVEMENT_TYPES.reconciliation,
          quantity: -quantity,
          oldStock: currentStock,
          newStock: nextStock,
          reason: 'Correccion de ventas no sincronizadas (auditoria de inventario)',
          performedBy
        }));
      });

      logEntries.forEach((log) => {
        transaction.set(doc(db, 'inventoryLogs', log.id), log);
      });
    });
  }

  const reconciledIds = new Set(orphanedSales.map((sale) => sale.id));
  const localData = loadData();
  const updatedSales = (localData.sales || []).map((sale) => (
    reconciledIds.has(sale.id) ? { ...sale, reconciledAt: new Date().toISOString() } : sale
  ));
  saveData({ ...localData, sales: updatedSales });

  return { reconciledCount: orphanedSales.length, productsAdjusted: quantityByProduct.size };
};
