import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getNetSaleTotal, normalizeSaleRefund, normalizeSaleStatus } from '../utils/salesUtils';

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
  return sale;
};

export const refundSale = async (sale, refundInput) => {
  const refundRecord = normalizeSaleRefund(refundInput);
  const refunds = [...(Array.isArray(sale.refunds) ? sale.refunds : []), refundRecord];
  const status = normalizeSaleStatus(sale.status, {
    ...sale,
    refunds
  });

  return saveSale({
    ...sale,
    refunds,
    status,
    paymentStatus: status,
    refunded_at: refundRecord.refundedAt,
    refunded_by: refundRecord.refundedBy,
    refundedAmount: Math.round((Number(sale.total || 0) - getNetSaleTotal({ ...sale, refunds })) * 100) / 100
  });
};
