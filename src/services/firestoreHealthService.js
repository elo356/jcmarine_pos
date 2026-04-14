import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../firebase/config';

const FIRESTORE_HEALTH_CACHE_TTL_MS = 15000;

let lastHealthCheck = {
  checkedAt: 0,
  ok: true,
  error: null
};

export const verifyFirestoreAvailability = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && now - lastHealthCheck.checkedAt < FIRESTORE_HEALTH_CACHE_TTL_MS) {
    return lastHealthCheck;
  }

  try {
    await getDocs(query(collection(db, 'products'), limit(1)));
    lastHealthCheck = {
      checkedAt: now,
      ok: true,
      error: null
    };
  } catch (error) {
    lastHealthCheck = {
      checkedAt: now,
      ok: false,
      error
    };
  }

  return lastHealthCheck;
};
