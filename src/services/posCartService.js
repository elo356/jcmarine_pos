import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const POS_CARTS_COLLECTION = 'posCarts';
const SHARED_POS_CART_ID = 'shared_active';
const POS_CART_CACHE_KEY = 'pos:shared-cart-cache';
const TERMINAL_ID_KEY = 'pos:terminal-id';

export const DEFAULT_SHARED_POS_CART = {
  items: [],
  discount: { type: 'percentage', value: 0 },
  meta: null
};

const newClientId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeDiscount = (discount = {}) => ({
  type: discount?.type === 'fixed' ? 'fixed' : 'percentage',
  value: Number.isFinite(Number(discount?.value)) ? Number(discount.value) : 0
});

const normalizeCartItem = (item = {}) => {
  const rawQuantity = Number(item.quantity || 0);
  const quantity = item.unitType === 'feet'
    ? Number(rawQuantity.toFixed(2))
    : Math.max(0, Math.round(rawQuantity));

  return {
    ...item,
    cartKey: item.cartKey || `${item.id || 'item'}::${item.selectedSize || 'no-size'}`,
    selectedSize: item.selectedSize || '',
    linkedProductIds: Array.isArray(item.linkedProductIds) ? item.linkedProductIds : [],
    quantity
  };
};

const normalizeMeta = (meta = {}) => ({
  terminalId: meta?.terminalId || '',
  updatedByName: meta?.updatedByName || '',
  updatedByUid: meta?.updatedByUid || '',
  updatedAt: meta?.updatedAt || null
});

export const normalizeSharedPosCart = (raw = {}) => ({
  items: Array.isArray(raw?.items)
    ? raw.items.map(normalizeCartItem).filter((item) => item.id && item.quantity > 0)
    : [],
  discount: normalizeDiscount(raw?.discount),
  meta: normalizeMeta(raw?.meta || raw)
});

export const serializeSharedPosCartState = (state = DEFAULT_SHARED_POS_CART) =>
  JSON.stringify({
    items: normalizeSharedPosCart(state).items,
    discount: normalizeSharedPosCart(state).discount
  });

export const getPersistentTerminalId = () => {
  if (typeof window === 'undefined') return 'terminal_server';

  const cached = localStorage.getItem(TERMINAL_ID_KEY);
  if (cached) return cached;

  const created = newClientId('terminal');
  localStorage.setItem(TERMINAL_ID_KEY, created);
  return created;
};

export const loadSharedPosCartCache = () => {
  if (typeof window === 'undefined') return DEFAULT_SHARED_POS_CART;

  const cached = localStorage.getItem(POS_CART_CACHE_KEY);
  if (!cached) return DEFAULT_SHARED_POS_CART;

  try {
    return normalizeSharedPosCart(JSON.parse(cached));
  } catch (error) {
    console.error('Error parsing shared POS cart cache:', error);
    return DEFAULT_SHARED_POS_CART;
  }
};

const saveSharedPosCartCache = (state) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(POS_CART_CACHE_KEY, JSON.stringify(normalizeSharedPosCart(state)));
};

const sharedPosCartRef = doc(db, POS_CARTS_COLLECTION, SHARED_POS_CART_ID);

const buildCartPayload = ({ items, discount, updatedBy }) => ({
  items: normalizeSharedPosCart({ items }).items,
  discount: normalizeDiscount(discount),
  terminalId: updatedBy?.terminalId || getPersistentTerminalId(),
  updatedByName: updatedBy?.name || '',
  updatedByUid: updatedBy?.uid || '',
  updatedAt: serverTimestamp()
});

export const subscribeSharedPosCart = (onData, onError) => {
  onData(loadSharedPosCartCache(), { fromCache: true });

  return onSnapshot(
    sharedPosCartRef,
    (snapshot) => {
      const nextState = snapshot.exists()
        ? normalizeSharedPosCart(snapshot.data())
        : DEFAULT_SHARED_POS_CART;

      saveSharedPosCartCache(nextState);
      onData(nextState, { fromCache: false });
    },
    (error) => {
      console.error('Error subscribing shared POS cart:', error);
      const cachedState = loadSharedPosCartCache();
      onData(cachedState, { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const saveSharedPosCart = async ({ items, discount, updatedBy }) => {
  const optimisticState = normalizeSharedPosCart({
    items,
    discount,
    meta: {
      terminalId: updatedBy?.terminalId || getPersistentTerminalId(),
      updatedByName: updatedBy?.name || '',
      updatedByUid: updatedBy?.uid || '',
      updatedAt: new Date().toISOString()
    }
  });

  saveSharedPosCartCache(optimisticState);
  await setDoc(sharedPosCartRef, buildCartPayload({ items, discount, updatedBy }), { merge: true });
};

export const clearSharedPosCart = async (updatedBy) => {
  await saveSharedPosCart({
    items: [],
    discount: DEFAULT_SHARED_POS_CART.discount,
    updatedBy
  });
};
