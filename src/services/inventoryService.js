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
import { getPrimaryProductBarcode, normalizeProductTaxConfig } from '../data/demoData';

const productsCol = collection(db, 'products');
const logsCol = collection(db, 'inventoryLogs');
const FIRESTORE_BATCH_LIMIT = 450;

const normalizeProduct = (product) => {
  const normalized = normalizeProductTaxConfig(product);
  return {
    ...normalized,
    sku: normalized.sku || getPrimaryProductBarcode(normalized) || normalized.id,
    linkedProductIds: Array.isArray(normalized.linkedProductIds) ? normalized.linkedProductIds : []
  };
};

const buildProductPayload = (product) => {
  const normalized = normalizeProduct(product);
  const payload = {
    ...normalized,
    sku: normalized.sku || getPrimaryProductBarcode(normalized) || normalized.id,
    barcode: getPrimaryProductBarcode(normalized),
    ivuStateEnabled: normalized.ivuStateEnabled !== false,
    ivuMunicipalEnabled: normalized.ivuMunicipalEnabled !== false,
    linkedProductIds: Array.isArray(normalized.linkedProductIds) ? normalized.linkedProductIds : [],
    updatedAt: new Date().toISOString()
  };

  delete payload.image;
  delete payload.photo;
  delete payload.productImage;

  return payload;
};

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

export const saveProductsSnapshot = async (products, deletedIds = [], options = {}) => {
  const safeProducts = Array.isArray(products) ? products.filter((product) => product?.id) : [];
  const safeDeletedIds = Array.isArray(deletedIds) ? deletedIds.filter(Boolean) : [];

  if (safeProducts.length === 0 && safeDeletedIds.length === 0) {
    return;
  }

  if (safeProducts.length === 0 && safeDeletedIds.length > 0 && options.allowEmptyProducts !== true) {
    throw new Error('Proteccion de inventario: no se permite guardar un inventario vacio sin confirmacion explicita.');
  }

  const operations = [
    ...safeProducts.map((product) => ({
      type: 'set',
      id: product.id,
      payload: buildProductPayload(product)
    })),
    ...safeDeletedIds.map((id) => ({
      type: 'delete',
      id
    }))
  ];

  for (let index = 0; index < operations.length; index += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    operations.slice(index, index + FIRESTORE_BATCH_LIMIT).forEach((operation) => {
      const productRef = doc(db, 'products', operation.id);
      if (operation.type === 'delete') {
        batch.delete(productRef);
        return;
      }

      batch.set(productRef, operation.payload, { merge: true });
    });
    await batch.commit();
  }
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
