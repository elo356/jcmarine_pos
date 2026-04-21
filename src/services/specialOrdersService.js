import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { saveAuditLog } from './auditLogService';
import { savePayment } from './paymentService';
import { saveSale } from './salesService';
import {
  buildSpecialOrderPaymentSale,
  buildSpecialOrderAuditEntry,
  calculateSpecialOrderPaymentSummary,
  normalizeSpecialOrder,
  normalizeSpecialOrderPayment,
  shouldMirrorSpecialOrderPaymentToSale
} from '../utils/specialOrderUtils';

const specialOrdersCol = collection(db, 'specialOrders');
const specialOrderPaymentsCol = collection(db, 'specialOrderPayments');

export const subscribeSpecialOrders = (onData, onError) => {
  const q = query(specialOrdersCol, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((docSnap) => normalizeSpecialOrder({ id: docSnap.id, ...docSnap.data() })));
    },
    onError
  );
};

export const subscribeSpecialOrderPayments = (onData, onError) => {
  const q = query(specialOrderPaymentsCol, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((docSnap) => normalizeSpecialOrderPayment({ id: docSnap.id, ...docSnap.data() })));
    },
    onError
  );
};

export const saveSpecialOrder = async (order) => {
  const normalized = normalizeSpecialOrder(order);
  await setDoc(doc(db, 'specialOrders', normalized.id), normalized, { merge: true });
  return normalized;
};

export const saveSpecialOrderPayment = async (payment) => {
  const normalized = normalizeSpecialOrderPayment(payment);
  await setDoc(doc(db, 'specialOrderPayments', normalized.id), normalized, { merge: true });
  return normalized;
};

export const syncSpecialOrderPaymentArtifacts = async ({ order, payment }) => {
  const normalizedOrder = normalizeSpecialOrder(order);
  const normalizedPayment = normalizeSpecialOrderPayment(payment);

  await saveSpecialOrderPayment(normalizedPayment);
  await savePayment(normalizedPayment);

  if (!shouldMirrorSpecialOrderPaymentToSale(normalizedPayment)) {
    return {
      payment: normalizedPayment,
      sale: null
    };
  }

  const mirroredSale = buildSpecialOrderPaymentSale({
    order: normalizedOrder,
    payment: normalizedPayment
  });
  await saveSale(mirroredSale);

  return {
    payment: normalizedPayment,
    sale: mirroredSale
  };
};

export const saveSpecialOrderWithPayments = async ({
  order,
  payments = [],
  auditLogs = []
}) => {
  const normalizedOrder = await saveSpecialOrder(order);
  await Promise.all(payments.map((payment) => syncSpecialOrderPaymentArtifacts({
    order: normalizedOrder,
    payment
  })));
  await Promise.all(auditLogs.map((log) => saveAuditLog(log)));
  return normalizedOrder;
};

export const applySpecialOrderPayment = async ({
  order,
  payment,
  performedBy,
  performedById,
  description
}) => {
  const normalizedOrder = normalizeSpecialOrder(order);
  const normalizedPayment = normalizeSpecialOrderPayment(payment);
  const nextPayments = [...(normalizedOrder.payments || []), normalizedPayment];
  const paymentSummary = calculateSpecialOrderPaymentSummary(nextPayments, normalizedOrder.totalAmount);
  const nextOrder = {
    ...normalizedOrder,
    payments: nextPayments,
    amountPaid: paymentSummary.netPaid,
    depositAmount: paymentSummary.deposit,
    balanceDue: paymentSummary.balanceDue,
    paymentStatus: paymentSummary.paymentStatus,
    updatedAt: new Date().toISOString(),
    updatedBy: performedBy,
    updatedById: performedById
  };

  const auditLog = buildSpecialOrderAuditEntry({
    entityId: normalizedOrder.id,
    action: normalizedPayment.kind === 'refund' ? 'payment_refunded' : 'payment_registered',
    description,
    performedBy,
    performedById,
    metadata: {
      paymentId: normalizedPayment.id,
      amount: normalizedPayment.amount,
      method: normalizedPayment.method,
      kind: normalizedPayment.kind
    }
  });

  await saveSpecialOrder(nextOrder);
  await syncSpecialOrderPaymentArtifacts({
    order: nextOrder,
    payment: normalizedPayment
  });
  await saveAuditLog(auditLog);

  return nextOrder;
};
