import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const shiftsCol = collection(db, 'shifts');

export const subscribeShifts = (onData, onError) => {
  const q = query(shiftsCol, orderBy('startTime', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(rows);
    },
    onError
  );
};

export const createShift = async (shift) => {
  await setDoc(doc(db, 'shifts', shift.id), shift, { merge: true });
};

export const patchShift = async (shiftId, payload) => {
  await updateDoc(doc(db, 'shifts', shiftId), payload);
};

export const deleteShift = async (shiftId) => {
  await deleteDoc(doc(db, 'shifts', shiftId));
};
