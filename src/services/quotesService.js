import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { normalizeQuote } from '../utils/quoteUtils';

const quotesCol = collection(db, 'quotes');

export const subscribeQuotes = (onData, onError) => {
  const q = query(quotesCol, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((docSnap) => normalizeQuote({ id: docSnap.id, ...docSnap.data() })));
    },
    onError
  );
};

export const saveQuote = async (quote) => {
  const normalized = normalizeQuote(quote);
  await setDoc(doc(db, 'quotes', normalized.id), normalized, { merge: true });
  return normalized;
};

export const deleteQuote = async (quoteId) => {
  if (!quoteId) return;
  await deleteDoc(doc(db, 'quotes', quoteId));
};
