import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const paymentsCol = collection(db, 'payments');

export const savePayment = async (payment) => {
  await setDoc(doc(paymentsCol, payment.id), payment, { merge: true });
};

export const savePayments = async (payments = []) => {
  await Promise.all(payments.map((payment) => savePayment(payment)));
};
