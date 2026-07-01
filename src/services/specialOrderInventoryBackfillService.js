import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { normalizeSpecialOrder, SPECIAL_ORDER_STATUS } from '../utils/specialOrderUtils';

// Corrige pedidos especiales entregados antes de que el descuento de inventario existiera.
// Corre una sola vez por base de datos (marcador en _meta) y es seguro re-ejecutar:
// solo toca pedidos entregados que aun no tengan stockDeducted = true.
const BACKFILL_VERSION = 'v1';
const BATCH_LIMIT = 450;

const chunk = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

export const backfillSpecialOrderInventoryIfNeeded = async () => {
  const markerRef = doc(db, '_meta', 'special_order_inventory_backfill_marker');
  const markerSnap = await getDoc(markerRef);

  if (markerSnap.exists() && markerSnap.data()?.version === BACKFILL_VERSION) {
    return null;
  }

  const ordersSnapshot = await getDocs(collection(db, 'specialOrders'));
  const orders = ordersSnapshot.docs.map((docSnap) => normalizeSpecialOrder({ id: docSnap.id, ...docSnap.data() }));
  const pendingOrders = orders.filter((order) =>
    (order.deliveredAt || order.orderStatus === SPECIAL_ORDER_STATUS.delivered) && !order.stockDeducted
  );

  const quantityByProduct = new Map();
  pendingOrders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const productId = item?.productId;
      const quantity = Number(item?.quantity || 0);
      if (!productId || !quantity) return;
      quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + quantity);
    });
  });

  const skippedProducts = [];
  const productUpdates = [];

  if (quantityByProduct.size > 0) {
    const productsSnapshot = await getDocs(collection(db, 'products'));
    const productsById = new Map(productsSnapshot.docs.map((docSnap) => [docSnap.id, docSnap.data()]));

    quantityByProduct.forEach((quantity, productId) => {
      const product = productsById.get(productId);
      if (!product) {
        skippedProducts.push(productId);
        return;
      }
      const currentStock = Number(product.stock || 0);
      const nextStock = Math.max(0, currentStock - quantity);
      productUpdates.push({ productId, quantity, currentStock, nextStock });
    });

    for (const batchItems of chunk(productUpdates, BATCH_LIMIT)) {
      const batch = writeBatch(db);
      batchItems.forEach(({ productId, nextStock }) => {
        batch.update(doc(db, 'products', productId), {
          stock: nextStock,
          updatedAt: new Date().toISOString()
        });
      });
      await batch.commit();
    }
  }

  for (const batchItems of chunk(pendingOrders, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    batchItems.forEach((order) => {
      batch.update(doc(db, 'specialOrders', order.id), {
        stockDeducted: true,
        updatedAt: new Date().toISOString()
      });
    });
    await batch.commit();
  }

  const summary = {
    ordersUpdated: pendingOrders.length,
    productsAdjusted: productUpdates.length,
    skippedProducts,
    details: productUpdates
  };

  await setDoc(markerRef, {
    version: BACKFILL_VERSION,
    completedAt: new Date().toISOString(),
    ...summary,
    details: undefined
  }, { merge: true });

  console.info('[specialOrderInventoryBackfill] Backfill completado:', summary);
  return summary;
};
