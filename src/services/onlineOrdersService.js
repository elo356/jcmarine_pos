import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const ONLINE_ORDERS_COLLECTION = 'onlineOrders';
const ONLINE_STORE_SETTINGS_COLLECTION = 'onlineStoreSettings';
const ONLINE_STORE_SETTINGS_DOC = 'config';

export const DEFAULT_ONLINE_STORE_SETTINGS = {
  storeEnabled: true,
  shippingEnabled: true,
  pickupEnabled: true,
  shippingFlatRate: 0,
  freeShippingMinimum: 0
};

const normalizeDateValue = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') {
    return new Date((value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000)).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return '';
};

const normalizeNumber = (...values) => {
  const value = values.find((entry) => entry !== undefined && entry !== null && entry !== '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (...values) => (
  String(values.find((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '') || '').trim()
);

const normalizeBoolean = (value, fallback = false) => (
  typeof value === 'boolean' ? value : fallback
);

const normalizeItems = (items) => {
  if (!Array.isArray(items)) return [];

  return items.map((item, index) => ({
    id: normalizeText(item.id, item.productId, item.sku, `item_${index}`),
    name: normalizeText(item.name, item.productName, item.title, item.description, 'Producto'),
    sku: normalizeText(item.sku, item.barcode, item.productSku),
    quantity: normalizeNumber(item.quantity, item.qty, 1),
    price: normalizeNumber(item.price, item.unitPrice, item.salePrice),
    total: normalizeNumber(item.total, item.lineTotal, normalizeNumber(item.quantity, item.qty, 1) * normalizeNumber(item.price, item.unitPrice, item.salePrice)),
    selectedSize: normalizeText(item.selectedSize, item.size),
    selectedColor: normalizeText(item.selectedColor, item.color)
  }));
};

const normalizeAddress = (address = {}) => ({
  name: normalizeText(address.name, address.fullName),
  line1: normalizeText(address.line1, address.address1, address.street),
  line2: normalizeText(address.line2, address.address2, address.apartment),
  city: normalizeText(address.city),
  state: normalizeText(address.state, address.region),
  postalCode: normalizeText(address.postalCode, address.zip, address.zipCode),
  country: normalizeText(address.country)
});

export const normalizeOnlineOrder = (order = {}) => {
  const customer = order.customer || order.customerInfo || {};
  const shipping = order.shipping || order.shippingInfo || {};
  const billing = order.billing || order.billingInfo || {};
  const shippingAddress = normalizeAddress(order.shippingAddress || shipping.address || {});
  const billingAddress = normalizeAddress(order.billingAddress || billing.address || {});
  const items = normalizeItems(order.items || order.cartItems || order.products);
  const createdAt = normalizeDateValue(order.createdAt || order.created_at || order.date);
  const updatedAt = normalizeDateValue(order.updatedAt || order.updated_at);

  return {
    ...order,
    id: normalizeText(order.id),
    orderNumber: normalizeText(order.orderNumber, order.orderNo, order.number, order.id),
    status: normalizeText(order.status, order.orderStatus, 'pending').toLowerCase(),
    paymentStatus: normalizeText(order.paymentStatus, order.payment_status, order.paid ? 'paid' : 'pending').toLowerCase(),
    fulfillmentStatus: normalizeText(order.fulfillmentStatus, order.fulfillment_status, order.deliveryStatus).toLowerCase(),
    paymentMethod: normalizeText(order.paymentMethod, order.payment_method, order.gateway),
    deliveryMethod: normalizeText(order.deliveryMethod, order.shippingMethod, shipping.method, order.pickup ? 'pickup' : ''),
    createdAt,
    updatedAt,
    customerName: normalizeText(order.customerName, customer.name, customer.fullName, shippingAddress.name, billingAddress.name, 'Cliente sin nombre'),
    customerEmail: normalizeText(order.customerEmail, customer.email, order.email),
    customerPhone: normalizeText(order.customerPhone, customer.phone, order.phone),
    items,
    itemCount: normalizeNumber(order.itemCount, order.itemsCount, items.reduce((sum, item) => sum + item.quantity, 0)),
    subtotal: normalizeNumber(order.subtotal, order.subTotal),
    tax: normalizeNumber(order.tax, order.taxes),
    shippingCost: normalizeNumber(order.shippingCost, order.shipping, shipping.cost),
    discount: normalizeNumber(order.discount, order.discountTotal),
    total: normalizeNumber(order.total, order.totalAmount, order.grandTotal, items.reduce((sum, item) => sum + item.total, 0)),
    notes: normalizeText(order.notes, order.note, order.customerNote),
    internalNotes: normalizeText(order.internalNotes, order.staffNote),
    shippingAddress,
    billingAddress,
    raw: order
  };
};

export const normalizeOnlineStoreSettings = (settings = {}) => ({
  storeEnabled: normalizeBoolean(settings.storeEnabled, DEFAULT_ONLINE_STORE_SETTINGS.storeEnabled),
  shippingEnabled: normalizeBoolean(settings.shippingEnabled, DEFAULT_ONLINE_STORE_SETTINGS.shippingEnabled),
  pickupEnabled: normalizeBoolean(settings.pickupEnabled, DEFAULT_ONLINE_STORE_SETTINGS.pickupEnabled),
  shippingFlatRate: normalizeNumber(settings.shippingFlatRate, DEFAULT_ONLINE_STORE_SETTINGS.shippingFlatRate),
  freeShippingMinimum: normalizeNumber(settings.freeShippingMinimum, DEFAULT_ONLINE_STORE_SETTINGS.freeShippingMinimum),
  updatedAt: normalizeDateValue(settings.updatedAt),
  updatedBy: normalizeText(settings.updatedBy),
  updatedById: normalizeText(settings.updatedById)
});

const getSortTime = (order) => {
  const parsed = new Date(order.createdAt || order.updatedAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const subscribeOnlineOrders = (onData, onError) => {
  return onSnapshot(
    collection(db, ONLINE_ORDERS_COLLECTION),
    (snapshot) => {
      const rows = snapshot.docs
        .map((docSnap) => normalizeOnlineOrder({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) => getSortTime(b) - getSortTime(a));
      onData(rows);
    },
    (error) => {
      onData([]);
      if (onError) onError(error);
    }
  );
};

export const subscribeOnlineStoreSettings = (onData, onError) => {
  return onSnapshot(
    doc(db, ONLINE_STORE_SETTINGS_COLLECTION, ONLINE_STORE_SETTINGS_DOC),
    (snapshot) => {
      onData(normalizeOnlineStoreSettings(snapshot.exists() ? snapshot.data() : DEFAULT_ONLINE_STORE_SETTINGS));
    },
    (error) => {
      onData(normalizeOnlineStoreSettings(DEFAULT_ONLINE_STORE_SETTINGS));
      if (onError) onError(error);
    }
  );
};

export const saveOnlineStoreSettings = async (settings, actor = {}) => {
  const normalized = normalizeOnlineStoreSettings(settings);
  const payload = {
    ...normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeText(actor.name),
    updatedById: normalizeText(actor.id)
  };

  await setDoc(
    doc(db, ONLINE_STORE_SETTINGS_COLLECTION, ONLINE_STORE_SETTINGS_DOC),
    payload,
    { merge: true }
  );

  return normalizeOnlineStoreSettings(payload);
};

export const cancelOnlineOrder = async ({ orderId, cancelledBy, cancelledById, note = '' }) => {
  const normalizedId = normalizeText(orderId);
  if (!normalizedId) {
    throw new Error('No se encontro la orden online para cancelar.');
  }

  const cancelledAt = new Date().toISOString();
  await updateDoc(doc(db, ONLINE_ORDERS_COLLECTION, normalizedId), {
    status: 'cancelled',
    orderStatus: 'cancelled',
    fulfillmentStatus: 'cancelled',
    fulfillment_status: 'cancelled',
    cancelledAt,
    canceledAt: cancelledAt,
    cancelledBy: normalizeText(cancelledBy),
    cancelledById: normalizeText(cancelledById),
    cancellationNote: normalizeText(note),
    updatedAt: cancelledAt
  });

  return {
    id: normalizedId,
    status: 'cancelled',
    cancelledAt
  };
};
