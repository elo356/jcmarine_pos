import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const categoriesCol = collection(db, 'categories');

export const subscribeCategories = (onData, onError) => {
  return onSnapshot(
    categoriesCol,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(rows);
    },
    onError
  );
};

export const saveCategory = async (category) => {
  await setDoc(doc(db, 'categories', category.id), {
    ...category,
    updatedAt: new Date().toISOString()
  }, { merge: true });
};

export const deleteCategory = async (categoryId) => {
  await deleteDoc(doc(db, 'categories', categoryId));
};
