import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { generateId } from '../data/demoData';

const financeCompaniesCol = collection(db, 'financeCompanies');

const normalizeCompany = (company = {}) => ({
  id: company.id || generateId('finance_company'),
  name: String(company.name || '').trim(),
  active: company.active !== false,
  createdAt: company.createdAt || company.created_at || new Date().toISOString(),
  updatedAt: company.updatedAt || company.updated_at || new Date().toISOString()
});

export const subscribeFinanceCompanies = (onData, onError) => {
  const q = query(financeCompaniesCol, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        snapshot.docs
          .map((docSnap) => normalizeCompany({ id: docSnap.id, ...docSnap.data() }))
          .filter((company) => company.name)
      );
    },
    onError
  );
};

export const saveFinanceCompany = async (company) => {
  const normalized = normalizeCompany(company);
  await setDoc(doc(db, 'financeCompanies', normalized.id), normalized, { merge: true });
  return normalized;
};
