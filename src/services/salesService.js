import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const salesCol = collection(db, 'sales');

export const subscribeSales = (onData, onError) => {
  const q = query(salesCol, orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(rows);
    },
    onError
  );
};

export const saveSale = async (sale) => {
  await setDoc(doc(db, 'sales', sale.id), sale, { merge: true });
};

export const refundSale = async (sale, refundedBy) => {
  const refundedAt = new Date().toISOString();

  return saveSale({
    ...sale,
    status: 'refunded',
    paymentStatus: 'refunded',
    refunded_at: refundedAt,
    refunded_by: refundedBy
  });
};
