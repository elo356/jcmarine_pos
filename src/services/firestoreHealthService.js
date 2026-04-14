import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../firebase/config';

const FIRESTORE_HEALTH_CACHE_TTL_MS = 15000;
const NON_BLOCKING_FIRESTORE_ERROR_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'failed-precondition',
  'not-found',
  'already-exists',
  'invalid-argument'
]);

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
    const errorCode = typeof error?.code === 'string'
      ? error.code.replace(/^firestore\//, '')
      : '';

    lastHealthCheck = {
      checkedAt: now,
      ok: NON_BLOCKING_FIRESTORE_ERROR_CODES.has(errorCode),
      error
    };
  }

  return lastHealthCheck;
};
