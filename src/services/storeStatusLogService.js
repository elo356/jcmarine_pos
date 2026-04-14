import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const storeStatusLogsCol = collection(db, 'storeStatusLogs');
const STORE_STATUS_CACHE_KEY = 'pos:store-status-logs-cache';

const loadStoreStatusLogsCache = () => {
  if (typeof window === 'undefined') return [];

  const cached = localStorage.getItem(STORE_STATUS_CACHE_KEY);
  if (!cached) return [];

  try {
    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error parsing store status logs cache:', error);
    localStorage.removeItem(STORE_STATUS_CACHE_KEY);
    return [];
  }
};

const saveStoreStatusLogsCache = (logs = []) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORE_STATUS_CACHE_KEY, JSON.stringify(logs));
};

export const getCachedStoreStatusLogs = () => loadStoreStatusLogsCache();

export const subscribeStoreStatusLogs = (onData, onError) => {
  onData(loadStoreStatusLogsCache(), { fromCache: true });

  const q = query(storeStatusLogsCol, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      saveStoreStatusLogsCache(rows);
      onData(rows, { fromCache: false });
    },
    (error) => {
      const cached = loadStoreStatusLogsCache();
      onData(cached, { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const createStoreStatusLog = async (log) => {
  await setDoc(doc(db, 'storeStatusLogs', log.id), log, { merge: true });
  const nextLogs = [log, ...loadStoreStatusLogsCache()]
    .filter((item, index, items) => items.findIndex((row) => row.id === item.id) === index)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  saveStoreStatusLogsCache(nextLogs);
};
