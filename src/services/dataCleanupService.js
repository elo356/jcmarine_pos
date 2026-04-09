import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';

const DEMO_PRODUCT_IDS = [
  'prod_001','prod_002','prod_003','prod_004','prod_005',
  'prod_006','prod_007','prod_008','prod_009','prod_010'
];
const DEMO_SALE_IDS = ['sale_001', 'sale_002', 'sale_003', 'sale_004', 'sale_005'];
const DEMO_SHIFT_IDS = ['shift_001', 'shift_002', 'shift_003'];
const DEMO_EMPLOYEE_IDS = ['emp_001', 'emp_002', 'emp_003', 'emp_004'];

const CLEANUP_VERSION = 'v1';

export const purgeDemoDataIfNeeded = async () => {
  const markerRef = doc(db, '_meta', 'cleanup_marker');
  const markerSnap = await getDoc(markerRef);

  if (markerSnap.exists() && markerSnap.data()?.version === CLEANUP_VERSION) {
    return;
  }

  const batch = writeBatch(db);

  DEMO_PRODUCT_IDS.forEach((id) => batch.delete(doc(db, 'products', id)));
  DEMO_SALE_IDS.forEach((id) => batch.delete(doc(db, 'sales', id)));
  DEMO_SHIFT_IDS.forEach((id) => batch.delete(doc(db, 'shifts', id)));
  DEMO_EMPLOYEE_IDS.forEach((id) => {
    batch.delete(doc(db, 'employees', id));
    batch.delete(doc(db, 'users', id));
  });

  // limpia local legacy
  try {
    localStorage.removeItem('posData');
  } catch (_e) {
    // ignore
  }

  batch.set(markerRef, { version: CLEANUP_VERSION, cleanedAt: new Date().toISOString() }, { merge: true });
  await batch.commit();
};
