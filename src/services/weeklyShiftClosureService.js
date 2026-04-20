import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const weeklyShiftClosuresCol = collection(db, 'weeklyShiftClosures');
const WEEKLY_SHIFT_CLOSURES_CACHE_KEY = 'pos:weekly-shift-closures-cache';

const loadCache = () => {
  if (typeof window === 'undefined') return [];

  const raw = localStorage.getItem(WEEKLY_SHIFT_CLOSURES_CACHE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error parsing weekly shift closures cache:', error);
    localStorage.removeItem(WEEKLY_SHIFT_CLOSURES_CACHE_KEY);
    return [];
  }
};

const saveCache = (closures = []) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WEEKLY_SHIFT_CLOSURES_CACHE_KEY, JSON.stringify(closures));
};

const sortRows = (rows = []) => [...rows].sort(
  (a, b) => new Date(b.closedAt || b.createdAt || 0) - new Date(a.closedAt || a.createdAt || 0)
);

export const getCachedWeeklyShiftClosures = () => loadCache();

export const subscribeWeeklyShiftClosures = (onData, onError) => {
  onData(sortRows(loadCache()), { fromCache: true });

  const q = query(weeklyShiftClosuresCol, orderBy('closedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = sortRows(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      saveCache(rows);
      onData(rows, { fromCache: false });
    },
    (error) => {
      const cached = sortRows(loadCache());
      onData(cached, { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const saveWeeklyShiftClosure = async (closure) => {
  await setDoc(doc(db, 'weeklyShiftClosures', closure.id), closure, { merge: true });

  const nextRows = sortRows([closure, ...loadCache()])
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
  saveCache(nextRows);
};
