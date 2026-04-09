import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { generateId } from '../data/demoData';

const customersCol = collection(db, 'customers');

const normalizeCustomer = (customer = {}) => ({
  id: customer.id || generateId('customer'),
  name: customer.name || '',
  phone: customer.phone || '',
  email: customer.email || '',
  notes: customer.notes || '',
  active: customer.active !== false,
  createdAt: customer.createdAt || customer.created_at || new Date().toISOString(),
  updatedAt: customer.updatedAt || customer.updated_at || new Date().toISOString()
});

export const subscribeCustomers = (onData, onError) => {
  const q = query(customersCol, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((docSnap) => normalizeCustomer({ id: docSnap.id, ...docSnap.data() })));
    },
    onError
  );
};

export const saveCustomer = async (customer) => {
  const normalized = normalizeCustomer(customer);
  await setDoc(doc(db, 'customers', normalized.id), normalized, { merge: true });
  return normalized;
};
