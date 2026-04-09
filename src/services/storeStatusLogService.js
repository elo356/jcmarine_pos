import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const storeStatusLogsCol = collection(db, 'storeStatusLogs');

export const subscribeStoreStatusLogs = (onData, onError) => {
  const q = query(storeStatusLogsCol, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(rows);
    },
    onError
  );
};

export const createStoreStatusLog = async (log) => {
  await setDoc(doc(db, 'storeStatusLogs', log.id), log, { merge: true });
};
