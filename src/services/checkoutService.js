import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

const SHARED_POS_CART_COLLECTION = 'posCarts';
const SHARED_POS_CART_ID = 'shared_active';

const groupCartItemsByProduct = (cartItems = []) => {
  const grouped = new Map();

  cartItems.forEach((item) => {
    const productId = item?.id;
    if (!productId) return;

    const currentQuantity = grouped.get(productId) || 0;
    grouped.set(productId, currentQuantity + Number(item.quantity || 0));
  });

  return grouped;
};

const reduceProductSizeStocks = (sizeStocks = [], cartItems = []) =>
  sizeStocks.map((entry) => {
    const soldForSize = cartItems.reduce((sum, item) => (
      item.selectedSize === entry.size ? sum + Number(item.quantity || 0) : sum
    ), 0);

    return {
      ...entry,
      stock: Math.max(0, Number(entry.stock || 0) - soldForSize)
    };
  });

export const commitSaleTransaction = async ({
  sale,
  paymentEntries = [],
  cartItems = [],
  updatedBy = {}
}) => {
  if (!sale?.id) {
    throw new Error('La venta no tiene identificador.');
  }

  if (!Array.isArray(paymentEntries) || paymentEntries.length === 0) {
    throw new Error('La venta no tiene pagos para registrar.');
  }

  const groupedCartItems = groupCartItemsByProduct(cartItems);

  await runTransaction(db, async (transaction) => {
    transaction.set(doc(db, 'sales', sale.id), sale, { merge: true });

    paymentEntries.forEach((payment) => {
      transaction.set(doc(db, 'payments', payment.id), payment, { merge: true });
    });

    for (const [productId, quantity] of groupedCartItems.entries()) {
      const productRef = doc(db, 'products', productId);
      const productSnapshot = await transaction.get(productRef);

      if (!productSnapshot.exists()) {
        console.warn(`Skipping Firestore stock update for missing product ${productId}.`);
        continue;
      }

      const product = productSnapshot.data();
      const currentStock = Number(product.stock || 0);
      const nextStock = Math.max(0, currentStock - quantity);
      const productCartItems = cartItems.filter((item) => item.id === productId);

      const payload = {
        stock: nextStock,
        updatedAt: new Date().toISOString()
      };

      if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0) {
        payload.sizeStocks = reduceProductSizeStocks(product.sizeStocks, productCartItems);
      }

      transaction.update(productRef, payload);
    }

    transaction.set(
      doc(db, SHARED_POS_CART_COLLECTION, SHARED_POS_CART_ID),
      {
        items: [],
        terminalId: updatedBy?.terminalId || '',
        updatedByName: updatedBy?.name || '',
        updatedByUid: updatedBy?.uid || '',
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  return sale;
};
