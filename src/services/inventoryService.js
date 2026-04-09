import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { normalizeProductTaxConfig } from '../data/demoData';

const productsCol = collection(db, 'products');
const logsCol = collection(db, 'inventoryLogs');

const normalizeProduct = (product) => ({
  ...normalizeProductTaxConfig(product),
  sku: product.sku || product.barcode || product.id,
  linkedProductIds: Array.isArray(product.linkedProductIds) ? product.linkedProductIds : []
});

export const listProducts = async () => {
  const snapshot = await getDocs(productsCol);
  return snapshot.docs.map((d) => normalizeProduct({ id: d.id, ...d.data() }));
};

export const subscribeProducts = (onData, onError) => {
  return onSnapshot(
    productsCol,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => normalizeProduct({ id: d.id, ...d.data() }));
      onData(rows);
    },
    onError
  );
};

export const saveProductsSnapshot = async (products, deletedIds = []) => {
  const batch = writeBatch(db);

  products.forEach((product) => {
    batch.set(
      doc(db, 'products', product.id),
      {
        ...product,
        sku: product.sku || product.barcode || product.id,
        ivuStateEnabled: product.ivuStateEnabled !== false,
        ivuMunicipalEnabled: product.ivuMunicipalEnabled !== false,
        linkedProductIds: Array.isArray(product.linkedProductIds) ? product.linkedProductIds : [],
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  });

  deletedIds.forEach((id) => {
    batch.delete(doc(db, 'products', id));
  });

  await batch.commit();
};

export const updateProductStock = async (productId, newStock) => {
  await updateDoc(doc(db, 'products', productId), {
    stock: newStock,
    updatedAt: new Date().toISOString()
  });
};

export const decrementStockForSale = async (cartItems) => {
  const updates = await Promise.all(
    cartItems.map(async (item) => {
      const productRef = doc(db, 'products', item.id);
      const snap = await getDoc(productRef);
      if (!snap.exists()) return null;

      const product = snap.data();
      const currentStock = Number(product.stock || 0);
      const nextStock = Math.max(0, currentStock - Number(item.quantity || 0));
      return { productRef, nextStock };
    })
  );

  const batch = writeBatch(db);
  updates.filter(Boolean).forEach(({ productRef, nextStock }) => {
    batch.update(productRef, {
      stock: nextStock,
      updatedAt: new Date().toISOString()
    });
  });

  await batch.commit();
};

export const listInventoryLogs = async () => {
  const snapshot = await getDocs(query(logsCol, orderBy('date', 'desc')));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const subscribeInventoryLogs = (onData, onError) => {
  const q = query(logsCol, orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(rows);
    },
    onError
  );
};

export const addInventoryLog = async (log) => {
  await setDoc(doc(db, 'inventoryLogs', log.id), log, { merge: true });
};
