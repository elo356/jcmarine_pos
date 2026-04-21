import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const EXPENSES_COLLECTION = 'expenses';
const INVOICES_COLLECTION = 'invoices';
const EXPENSES_CACHE_KEY = 'pos:expenses-cache';
const INVOICES_CACHE_KEY = 'pos:invoices-cache';

const normalizeDateValue = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return '';
};

const toMoney = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
};

const normalizeText = (value) => String(value || '').trim();

const loadCachedRows = (cacheKey) => {
  if (typeof window === 'undefined') return [];

  const cached = localStorage.getItem(cacheKey);
  if (!cached) return [];

  try {
    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Error parsing cache for ${cacheKey}:`, error);
    localStorage.removeItem(cacheKey);
    return [];
  }
};

const saveCachedRows = (cacheKey, rows) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(cacheKey, JSON.stringify(rows));
};

const sortByUpdatedAt = (rows = []) => (
  [...rows].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
);

export const normalizeExpense = (expense = {}) => ({
  id: normalizeText(expense.id),
  title: normalizeText(expense.title),
  vendor: normalizeText(expense.vendor),
  category: normalizeText(expense.category),
  paymentMethod: normalizeText(expense.paymentMethod),
  amount: toMoney(expense.amount),
  paidAt: normalizeText(expense.paidAt),
  notes: normalizeText(expense.notes),
  createdAt: normalizeDateValue(expense.createdAt),
  updatedAt: normalizeDateValue(expense.updatedAt),
  createdBy: normalizeText(expense.createdBy),
  createdByName: normalizeText(expense.createdByName),
  updatedBy: normalizeText(expense.updatedBy),
  updatedByName: normalizeText(expense.updatedByName)
});

export const calculateInvoiceTotals = (invoice = {}) => {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const subtotal = toMoney(items.reduce((sum, item) => sum + (toMoney(item.quantity) * toMoney(item.unitPrice)), 0));
  const taxRate = toMoney(invoice.taxRate);
  const discountAmount = toMoney(invoice.discountAmount);
  const taxAmount = toMoney(subtotal * (taxRate / 100));
  const total = toMoney(subtotal + taxAmount - discountAmount);

  return {
    subtotal,
    taxRate,
    taxAmount,
    discountAmount,
    total
  };
};

export const normalizeInvoiceItem = (item = {}, index = 0) => ({
  id: normalizeText(item.id) || `item_${index + 1}`,
  description: normalizeText(item.description),
  quantity: toMoney(item.quantity || 1),
  unitPrice: toMoney(item.unitPrice),
  total: toMoney(toMoney(item.quantity || 1) * toMoney(item.unitPrice))
});

export const normalizeInvoice = (invoice = {}) => {
  const items = (Array.isArray(invoice.items) ? invoice.items : []).map(normalizeInvoiceItem);
  const totals = calculateInvoiceTotals({ ...invoice, items });

  return {
    id: normalizeText(invoice.id),
    invoiceNumber: normalizeText(invoice.invoiceNumber),
    title: normalizeText(invoice.title),
    customerName: normalizeText(invoice.customerName),
    customerEmail: normalizeText(invoice.customerEmail),
    customerPhone: normalizeText(invoice.customerPhone),
    billTo: normalizeText(invoice.billTo),
    issueDate: normalizeText(invoice.issueDate),
    dueDate: normalizeText(invoice.dueDate),
    status: normalizeText(invoice.status) || 'draft',
    notes: normalizeText(invoice.notes),
    terms: normalizeText(invoice.terms),
    footerText: normalizeText(invoice.footerText),
    items,
    subtotal: totals.subtotal,
    taxRate: totals.taxRate,
    taxAmount: totals.taxAmount,
    discountAmount: totals.discountAmount,
    total: totals.total,
    createdAt: normalizeDateValue(invoice.createdAt),
    updatedAt: normalizeDateValue(invoice.updatedAt),
    createdBy: normalizeText(invoice.createdBy),
    createdByName: normalizeText(invoice.createdByName),
    updatedBy: normalizeText(invoice.updatedBy),
    updatedByName: normalizeText(invoice.updatedByName)
  };
};

const upsertCachedRow = (cacheKey, row, normalizer) => {
  const normalized = normalizer(row);
  saveCachedRows(
    cacheKey,
    sortByUpdatedAt([
      normalized,
      ...loadCachedRows(cacheKey).map(normalizer).filter((item) => item.id !== normalized.id)
    ])
  );
  return normalized;
};

export const subscribeExpenses = (onData, onError) => {
  onData(sortByUpdatedAt(loadCachedRows(EXPENSES_CACHE_KEY).map(normalizeExpense)), { fromCache: true });

  const q = query(collection(db, EXPENSES_COLLECTION), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs
        .map((docSnap) => normalizeExpense({ id: docSnap.id, ...docSnap.data() }))
        .filter((expense) => expense.id);
      saveCachedRows(EXPENSES_CACHE_KEY, rows);
      onData(rows, { fromCache: false });
    },
    (error) => {
      const cached = sortByUpdatedAt(loadCachedRows(EXPENSES_CACHE_KEY).map(normalizeExpense));
      onData(cached, { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const saveExpense = async (expense) => {
  const now = new Date().toISOString();
  const cachedExisting = loadCachedRows(EXPENSES_CACHE_KEY)
    .map(normalizeExpense)
    .find((item) => item.id === expense.id);

  const normalized = normalizeExpense({
    ...cachedExisting,
    ...expense,
    createdAt: expense.createdAt || cachedExisting?.createdAt || now,
    updatedAt: now
  });

  upsertCachedRow(EXPENSES_CACHE_KEY, normalized, normalizeExpense);

  try {
    await setDoc(doc(db, EXPENSES_COLLECTION, normalized.id), normalized, { merge: true });
    return { ...normalized, localOnly: false };
  } catch (error) {
    console.error('Error saving expense remotely:', error);
    return { ...normalized, localOnly: true };
  }
};

export const deleteExpense = async (expenseId) => {
  const normalizedId = normalizeText(expenseId);
  if (!normalizedId) return { id: normalizedId, localOnly: true };

  saveCachedRows(
    EXPENSES_CACHE_KEY,
    loadCachedRows(EXPENSES_CACHE_KEY).map(normalizeExpense).filter((expense) => expense.id !== normalizedId)
  );

  try {
    await deleteDoc(doc(db, EXPENSES_COLLECTION, normalizedId));
    return { id: normalizedId, localOnly: false };
  } catch (error) {
    console.error('Error deleting expense remotely:', error);
    return { id: normalizedId, localOnly: true };
  }
};

export const subscribeInvoices = (onData, onError) => {
  onData(sortByUpdatedAt(loadCachedRows(INVOICES_CACHE_KEY).map(normalizeInvoice)), { fromCache: true });

  const q = query(collection(db, INVOICES_COLLECTION), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs
        .map((docSnap) => normalizeInvoice({ id: docSnap.id, ...docSnap.data() }))
        .filter((invoice) => invoice.id);
      saveCachedRows(INVOICES_CACHE_KEY, rows);
      onData(rows, { fromCache: false });
    },
    (error) => {
      const cached = sortByUpdatedAt(loadCachedRows(INVOICES_CACHE_KEY).map(normalizeInvoice));
      onData(cached, { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const saveInvoice = async (invoice) => {
  const now = new Date().toISOString();
  const cachedExisting = loadCachedRows(INVOICES_CACHE_KEY)
    .map(normalizeInvoice)
    .find((item) => item.id === invoice.id);

  const normalized = normalizeInvoice({
    ...cachedExisting,
    ...invoice,
    createdAt: invoice.createdAt || cachedExisting?.createdAt || now,
    updatedAt: now
  });

  upsertCachedRow(INVOICES_CACHE_KEY, normalized, normalizeInvoice);

  try {
    await setDoc(doc(db, INVOICES_COLLECTION, normalized.id), normalized, { merge: true });
    return { ...normalized, localOnly: false };
  } catch (error) {
    console.error('Error saving invoice remotely:', error);
    return { ...normalized, localOnly: true };
  }
};

export const deleteInvoice = async (invoiceId) => {
  const normalizedId = normalizeText(invoiceId);
  if (!normalizedId) return { id: normalizedId, localOnly: true };

  saveCachedRows(
    INVOICES_CACHE_KEY,
    loadCachedRows(INVOICES_CACHE_KEY).map(normalizeInvoice).filter((invoice) => invoice.id !== normalizedId)
  );

  try {
    await deleteDoc(doc(db, INVOICES_COLLECTION, normalizedId));
    return { id: normalizedId, localOnly: false };
  } catch (error) {
    console.error('Error deleting invoice remotely:', error);
    return { id: normalizedId, localOnly: true };
  }
};
