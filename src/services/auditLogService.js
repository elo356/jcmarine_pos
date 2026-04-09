import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export const saveAuditLog = async (log) => {
  await setDoc(doc(db, 'auditLogs', log.id), log, { merge: true });
};
