import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getPersistentTerminalId } from './posCartService';

const SESSIONS_COLLECTION = 'systemSessions';
const HEARTBEAT_MS = 20000;
const ACTIVE_THRESHOLD_MS = 45000;

const newSessionId = () => `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const startSessionPresence = (user, profile) => {
  if (!user?.uid) return () => {};

  const sessionId = newSessionId();
  const ref = doc(db, SESSIONS_COLLECTION, sessionId);
  const terminalId = getPersistentTerminalId();
  const now = Date.now();

  const payload = {
    sessionId,
    uid: user.uid,
    role: profile?.role || 'cashier',
    terminalId,
    status: 'online',
    openedAtMs: now,
    lastSeenAtMs: now,
    openedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp()
  };

  setDoc(ref, payload, { merge: true }).catch((err) => {
    console.error('Presence start error:', err);
  });

  const interval = setInterval(() => {
    updateDoc(ref, {
      lastSeenAtMs: Date.now(),
      lastSeenAt: serverTimestamp(),
      status: 'online'
    }).catch(() => {});
  }, HEARTBEAT_MS);

  const markOffline = () => {
    const closedAtMs = Date.now();
    updateDoc(ref, {
      status: 'offline',
      closedAtMs,
      closedAt: serverTimestamp(),
      lastSeenAtMs: closedAtMs,
      lastSeenAt: serverTimestamp()
    }).catch(() => {});
  };

  window.addEventListener('beforeunload', markOffline);

  return () => {
    clearInterval(interval);
    window.removeEventListener('beforeunload', markOffline);
    markOffline();
  };
};

export const ACTIVE_THRESHOLD = ACTIVE_THRESHOLD_MS;
export const SESSIONS_COLLECTION_NAME = SESSIONS_COLLECTION;
