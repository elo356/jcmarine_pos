import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { ACTIVE_THRESHOLD, SESSIONS_COLLECTION_NAME } from '../services/systemPresenceService';

export const useActiveSystemsCount = (enabled = false) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return () => {};
    }

    const colRef = collection(db, SESSIONS_COLLECTION_NAME);
    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const now = Date.now();
        const active = snapshot.docs.filter((docSnap) => {
          const data = docSnap.data();
          if (data.status !== 'online') return false;

          const lastSeen = Number.isFinite(Number(data.lastSeenAtMs))
            ? Number(data.lastSeenAtMs)
            : (data.lastSeenAt?.toDate ? data.lastSeenAt.toDate().getTime() : null);
          const openedAt = Number.isFinite(Number(data.openedAtMs))
            ? Number(data.openedAtMs)
            : (data.openedAt?.toDate ? data.openedAt.toDate().getTime() : null);

          if (lastSeen && now - lastSeen <= ACTIVE_THRESHOLD) {
            return true;
          }

          if (openedAt && now - openedAt <= ACTIVE_THRESHOLD) {
            return true;
          }

          return docSnap.metadata.hasPendingWrites;
        }).length;

        setCount(active);
      },
      (error) => {
        console.error('Error subscribing active systems count:', error);
        setCount(0);
      }
    );

    return () => unsubscribe();
  }, [enabled]);

  return count;
};
